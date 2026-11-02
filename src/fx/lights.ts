import { HEIGHT, WIDTH } from '../contract.ts';
import type { Frame, Scene } from '../frame.ts';
import { noiseTrack, sampleNoise, type NoiseTrack } from '../loop.ts';
import { MAT } from '../raster.ts';
import { farCabinWindow } from '../scene/backdrop.ts';
import { FIRE } from '../scene/campfire.ts';
import { ATTIC, DOOR, leanX, WALL_LANTERN, WINDOWS } from '../scene/cottage.ts';
import { pumpkinCenter, PUMPKINS } from '../scene/pumpkins.ts';
import { groundFront } from '../scene/slab.ts';
import { lanternX, lanternY } from '../scene/tree.ts';

// `area` lights glow around a rectangle (w = h = 0 is a point); `spill` lights
// only paint a wedge on the ground in front of an opening.
type Kind = 'area' | 'spill';

interface Light {
  readonly name: string;
  readonly kind: Kind;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  // Screen y where the light's vertical line meets the ground plane.
  readonly foot: number;
  readonly radius: number;
  readonly power: number;
  // How much reaches standing surfaces and open air; a window lights the
  // ground and the rain in front of it far more than the wall around it.
  readonly walls: number;
  readonly air: number;
  readonly seed: number;
  // Octaves of loop noise: [cycles per loop, relative depth].
  readonly flicker: readonly (readonly [number, number])[];
  readonly follow?: { readonly x: (u: number) => number; readonly y: (u: number) => number };
}

const CANDLE: Light['flicker'] = [
  [420, 0.2],
  [960, 0.1],
  [24, 0.08],
];
const HEARTH: Light['flicker'] = [
  [180, 0.16],
  [420, 0.07],
];

const POINT = { w: 0, h: 0 };

function windowLight(i: number): Light {
  const w = WINDOWS[i];
  return {
    name: `window${i}`,
    kind: 'area',
    x: leanX(w.x, w.y + w.h / 2),
    y: w.y,
    w: w.w,
    h: w.h,
    foot: 182,
    radius: i < 2 ? 18 : 13,
    power: 0.7,
    walls: 0.45,
    air: 0.8,
    seed: 40 + i,
    flicker: HEARTH,
  };
}

const doorX = leanX(DOOR.x, DOOR.y + DOOR.h / 2);

export const LIGHTS: readonly Light[] = [
  {
    name: 'campfire',
    kind: 'area',
    x: FIRE.x,
    y: FIRE.y - 8,
    ...POINT,
    foot: FIRE.y,
    radius: 74,
    power: 1.0,
    walls: 1,
    air: 0.7,
    seed: 10,
    flicker: [
      [360, 0.15],
      [840, 0.07],
      [30, 0.12],
    ],
  },
  ...WINDOWS.map((_, i) => windowLight(i)),
  {
    name: 'attic',
    kind: 'area',
    x: leanX(ATTIC.x - ATTIC.r, ATTIC.y),
    y: ATTIC.y - ATTIC.r,
    w: ATTIC.r * 2,
    h: ATTIC.r * 2,
    foot: 182,
    radius: 10,
    power: 0.62,
    walls: 0.4,
    air: 0.8,
    seed: 50,
    flicker: HEARTH,
  },
  {
    name: 'doorway',
    kind: 'area',
    x: doorX,
    y: DOOR.y,
    w: DOOR.w,
    h: DOOR.h,
    foot: DOOR.y + DOOR.h,
    radius: 14,
    power: 0.8,
    walls: 0.5,
    air: 0.8,
    seed: 51,
    flicker: HEARTH,
  },
  {
    name: 'door spill',
    kind: 'spill',
    x: doorX + 3,
    y: DOOR.y + DOOR.h,
    w: DOOR.w - 7,
    h: 0,
    foot: DOOR.y + DOOR.h,
    radius: 34,
    power: 0.9,
    walls: 0,
    air: 0,
    seed: 51,
    flicker: HEARTH,
  },
  {
    name: 'wall lantern',
    kind: 'area',
    x: leanX(WALL_LANTERN.x, WALL_LANTERN.y) + 1,
    y: WALL_LANTERN.y + 1,
    ...POINT,
    foot: 182,
    radius: 20,
    power: 0.8,
    walls: 0.8,
    air: 0.8,
    seed: 52,
    flicker: CANDLE,
  },
  {
    name: 'tree lantern',
    kind: 'area',
    x: Math.round(lanternX(0)),
    y: Math.round(lanternY(0)),
    ...POINT,
    foot: 179,
    radius: 34,
    power: 0.95,
    walls: 1,
    air: 1,
    seed: 53,
    flicker: CANDLE,
    follow: { x: lanternX, y: lanternY },
  },
  ...PUMPKINS.map((p, i): Light => {
    const c = pumpkinCenter(p);
    return {
      name: `pumpkin${i}`,
      kind: 'area',
      x: c.x,
      y: Math.round(c.y),
      ...POINT,
      foot: Math.round(c.y + p.ry),
      radius: 6 + p.rx * 1.6,
      power: 0.85,
      walls: 1,
      air: 0.7,
      seed: 60 + i,
      flicker: CANDLE,
    };
  }),
  {
    name: 'far cabin',
    kind: 'area',
    ...farCabinWindow(),
    ...POINT,
    foot: farCabinWindow().y,
    radius: 5,
    power: 0.5,
    walls: 1,
    air: 1,
    seed: 70,
    flicker: HEARTH,
  },
];

function falloff(d: number): number {
  return d >= 1 ? 0 : (1 - d) * (1 - d);
}

// How much of a light reaches a pixel, from its material and position. The
// ground uses a flattened, foot-anchored distance so pools lie on the plane;
// the cut face only catches light on its lip.
function reach(l: Light, scene: Scene, x: number, y: number): number {
  const mat = scene.mat[y * WIDTH + x];
  const dx = x < l.x ? l.x - x : x > l.x + l.w ? x - (l.x + l.w) : 0;
  if (l.kind === 'spill') {
    if (mat !== MAT.ground || y < l.foot) return 0;
    const dy = y - l.foot;
    if (dx > 1 + dy * 1.7) return 0;
    return falloff(Math.hypot(dy * 2.6, dx * 0.35) / l.radius);
  }
  const dy = y < l.y ? l.y - y : y > l.y + l.h ? y - (l.y + l.h) : 0;
  if (mat === MAT.ground) {
    const lift = Math.max(0, l.foot - (l.y + l.h));
    return falloff(Math.hypot(dx, (y - l.foot) * 2.6, lift) / l.radius);
  }
  const d = falloff(Math.hypot(dx, dy) / l.radius);
  if (mat === MAT.face) return d * Math.max(0, 1 - (y - groundFront(x)) / 5) * 0.6;
  if (mat === MAT.air) return d * l.air;
  return d * l.walls;
}

interface Mask {
  readonly light: Light;
  readonly x0: number;
  readonly y0: number;
  readonly w: number;
  readonly h: number;
  readonly data: Float32Array;
  readonly flicker: readonly NoiseTrack[];
  readonly depth: Float64Array;
}

function bakeMask(l: Light, scene: Scene): Mask {
  const r = Math.ceil(l.radius);
  const x0 = Math.max(0, Math.floor(l.x - r));
  const y0 = Math.max(0, Math.floor(l.y - r));
  const x1 = Math.min(WIDTH - 1, Math.ceil(l.x + l.w + r));
  const y1 = Math.min(HEIGHT - 1, Math.ceil(l.y + l.h + r * 1.2));
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const data = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) data[j * w + i] = reach(l, scene, x0 + i, y0 + j);
  const flicker = l.flicker.map(([cycles], o) => noiseTrack(cycles, l.seed * 7 + o));
  const depth = Float64Array.from(l.flicker, ([, d]) => d);
  return { light: l, x0, y0, w, h, data, flicker, depth };
}

function intensity(mask: Mask, u: number): number {
  let k = 1;
  for (let o = 0; o < mask.flicker.length; o++) k += mask.depth[o] * sampleNoise(mask.flicker[o], u);
  return mask.light.power * k;
}

// Builds the masks once against the baked scene; the returned pass adds
// every light, scaled by its flicker, into the frame's light field.
export function lightPass(scene: Scene): (f: Frame) => void {
  const masks = LIGHTS.map((l) => bakeMask(l, scene));
  return (f: Frame) => {
    const field = f.light;
    for (let m = 0; m < masks.length; m++) {
      const mask = masks[m];
      const l = mask.light;
      const k = intensity(mask, f.u);
      let ox = 0;
      let oy = 0;
      if (l.follow) {
        ox = Math.round(l.follow.x(f.u) - l.x);
        oy = Math.round(l.follow.y(f.u) - l.y);
      }
      const { w, h, data } = mask;
      for (let j = 0; j < h; j++) {
        const y = mask.y0 + j + oy;
        if (y < 0 || y >= HEIGHT) continue;
        for (let i = 0; i < w; i++) {
          const x = mask.x0 + i + ox;
          if (x < 0 || x >= WIDTH) continue;
          field[y * WIDTH + x] += data[j * w + i] * k;
        }
      }
    }
  };
}
