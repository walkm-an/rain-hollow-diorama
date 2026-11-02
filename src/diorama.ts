import { HEIGHT, WIDTH, type FrameStats, type Renderer } from './contract.ts';
import type { Draw, Frame, Layer, Scene } from './frame.ts';
import { boltLayer, flashLevel, rimLayer } from './fx/lightning.ts';
import { lightPass } from './fx/lights.ts';
import { particleLayer } from './fx/particles.ts';
import { RAIN_LAYERS, rainLayer } from './fx/rain.ts';
import { buildShadeTable, shadeFrame } from './fx/shade.ts';
import { puddleLayer, streamLayer } from './fx/water.ts';
import { phase } from './loop.ts';
import { C } from './palette.ts';
import { createTarget, MAT, type Target } from './raster.ts';
import { bakeRidges, mistLayer } from './scene/backdrop.ts';
import { batLayer } from './scene/bats.ts';
import { bakeCampfire, campfireLayer } from './scene/campfire.ts';
import { bakeStump, catLayer } from './scene/cat.ts';
import { bakeCottage, silhouetteLayer } from './scene/cottage.ts';
import { bakeGraveyard, crowLayer } from './scene/graveyard.ts';
import { bakePumpkins } from './scene/pumpkins.ts';
import { bakeSky, CLOUD_LAYERS, cloudLayer } from './scene/sky.ts';
import { bakeSlab } from './scene/slab.ts';
import { bakeTree, lanternLayer } from './scene/tree.ts';

// Back to front. Consecutive `bake` rows merge into one cached sprite; `build`
// rows get the baked scene once and return the per-frame draw.
const LAYERS: readonly Layer[] = [
  { name: 'sky', bake: bakeSky },
  { name: 'bolt', build: () => boltLayer() },
  ...CLOUD_LAYERS.map((spec, i) => ({ name: `clouds${i}`, build: () => cloudLayer(spec) })),
  { name: 'ridges', bake: bakeRidges },
  { name: 'mist', build: () => mistLayer() },
  { name: 'far rain', build: (scene) => rainLayer(RAIN_LAYERS.far, scene) },
  { name: 'bats', build: () => batLayer() },
  { name: 'slab', bake: bakeSlab },
  { name: 'tree', bake: bakeTree },
  { name: 'graveyard', bake: bakeGraveyard },
  { name: 'cottage', bake: bakeCottage },
  { name: 'pumpkins', bake: bakePumpkins },
  { name: 'campfire', bake: bakeCampfire },
  { name: 'stump', bake: bakeStump },
  { name: 'lightning rim', build: (scene) => rimLayer(scene) },
  { name: 'silhouette', build: () => silhouetteLayer() },
  { name: 'lantern', build: () => lanternLayer() },
  { name: 'crow', build: () => crowLayer() },
  { name: 'fire', build: () => campfireLayer() },
  { name: 'cat', build: () => catLayer() },
  { name: 'puddles', build: () => puddleLayer() },
  { name: 'eave streams', build: () => streamLayer() },
  { name: 'particles', build: () => particleLayer() },
  { name: 'mid rain', build: (scene) => rainLayer(RAIN_LAYERS.mid, scene) },
  { name: 'near rain', build: (scene) => rainLayer(RAIN_LAYERS.near, scene) },
];

interface Sprite {
  readonly data: Uint8Array;
  readonly y0: number;
  readonly y1: number;
}

type Step = { readonly sprite: Sprite } | { readonly draw: Draw };

function rows(data: Uint8Array): [number, number] {
  let y0 = HEIGHT;
  let y1 = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] === C.clear) continue;
    const y = Math.floor(i / WIDTH);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y + 1);
  }
  return [y0, y1];
}

// Bakes every static group, composites them into the Scene that dynamic
// layers are built against, then builds the dynamic layers.
function bakeLayers(layers: readonly Layer[]): { steps: Step[]; scene: Scene } {
  const groups: (Target | Extract<Layer, { build: unknown }>)[] = [];
  for (const layer of layers) {
    if ('bake' in layer) {
      let target = groups[groups.length - 1];
      if (!target || !('data' in target)) {
        target = createTarget(WIDTH, HEIGHT);
        groups.push(target);
      }
      layer.bake(target);
    } else {
      groups.push(layer);
    }
  }
  const sprites = groups.filter((g): g is Target => 'data' in g);
  const data = new Uint8Array(WIDTH * HEIGHT);
  const mat = new Uint8Array(WIDTH * HEIGHT);
  const skyline: number[] = [];
  sprites.forEach((s, n) => {
    for (let i = 0; i < s.data.length; i++) {
      if (s.data[i] === C.clear) continue;
      data[i] = s.data[i];
      mat[i] = s.mat[i];
      if (n > 0 && (i < WIDTH || s.data[i - WIDTH] === C.clear)) skyline.push(i);
    }
  });
  const scene: Scene = { data, mat, skyline: Int32Array.from(skyline) };
  const steps = groups.map((g): Step => {
    if ('data' in g) {
      const [y0, y1] = rows(g.data);
      return { sprite: { data: g.data, y0, y1 } };
    }
    return { draw: g.build(scene) };
  });
  return { steps, scene };
}

export function createRenderer(): Renderer {
  const pixels = new Uint32Array(WIDTH * HEIGHT);
  const { steps, scene } = bakeLayers(LAYERS);
  const lights = lightPass(scene);
  const table = buildShadeTable();
  const frame: Frame = {
    target: { ...createTarget(WIDTH, HEIGHT), pen: MAT.air },
    light: new Float32Array(WIDTH * HEIGHT),
    u: 0,
    flash: 0,
    particles: 0,
  };
  const stats: FrameStats = { particles: 0 };
  const data = frame.target.data;

  return {
    pixels,
    render(t) {
      frame.u = phase(t);
      frame.flash = flashLevel(frame.u);
      frame.particles = 0;
      frame.light.fill(0);
      for (let s = 0; s < steps.length; s++) {
        const step = steps[s];
        if ('draw' in step) {
          step.draw(frame);
          continue;
        }
        const src = step.sprite.data;
        const end = step.sprite.y1 * WIDTH;
        for (let i = step.sprite.y0 * WIDTH; i < end; i++) {
          const v = src[i];
          if (v !== C.clear) data[i] = v;
        }
      }
      lights(frame);
      shadeFrame(frame, table, pixels);
      stats.particles = frame.particles;
      return stats;
    },
  };
}
