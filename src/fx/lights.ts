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

interface LightBase {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  // Screen y where the light's vertical line meets the ground plane.
  readonly foot: number;
  readonly radius: number;
  // Exponent on (1 - d / radius): 2 is a soft pool; lower holds its strength
  // farther out and still ends at the radius, so a wide light stays a pocket.
  readonly falloff: number;
  readonly power: number;
  readonly seed: number;
  // Octaves of loop noise: [cycles per loop, relative depth].
  readonly flicker: readonly (readonly [number, number])[];
  readonly follow?: { readonly x: (u: number) => number; readonly y: (u: number) => number };
}

// Glows around a rectangle (w = h = 0 is a point).
interface AreaLight extends LightBase {
  readonly kind: 'area';
  // How much reaches standing surfaces and open air; a window lights the
  // ground and the rain in front of it far more than the wall around it.
  readonly walls: number;
  readonly air: number;
}

// Paints only a wedge on the ground in front of an opening, `fan` px wider
// on each side per px it travels toward the viewer, and over the cut lip.
interface SpillLight extends LightBase {
  readonly kind: 'spill';
  readonly fan: number;
}

type Light = AreaLight | SpillLight;

// Cycles are per 120 s loop, so 120 cycles is 1 Hz. Windows stay well under
// that, with a small depth, so a band flips only now and then.
const WINDOW: Light['flicker'] = [
  [36, 0.05],
  [12, 0.03],
];
// Lanterns and pumpkins waver slowly. The 8-cycle octave is the occasional gutter.
const CANDLE: Light['flicker'] = [
  [72, 0.08],
  [24, 0.05],
  [8, 0.1],
];
// The fire breathes between 0.4 Hz and 2.5 Hz. Nothing faster, or the bands strobe.
const FIRE_FLICKER: Light['flicker'] = [
  [48, 0.1],
  [180, 0.1],
  [300, 0.05],
];

const POINT = { w: 0, h: 0 };
const HOUSE_FOOT = 182;
const LOWER_WINDOWS = [0, 1];

function windowLight(i: number): AreaLight {
  const w = WINDOWS[i];
  const lower = LOWER_WINDOWS.includes(i);
  return {
    name: `window${i}`,
    kind: 'area',
    x: leanX(w.x, w.y + w.h / 2),
    y: w.y,
    w: w.w,
    h: w.h,
    foot: HOUSE_FOOT,
    radius: lower ? 18 : 13,
    falloff: 2,
    power: 0.7,
    walls: 0.45,
    air: 0.8,
    seed: 40 + i,
    flicker: WINDOW,
  };
}

// The patch a lower window throws on the ground in front of the house.
function windowSpill(i: number): SpillLight {
  const w = WINDOWS[i];
  return {
    name: `window${i} spill`,
    kind: 'spill',
    x: leanX(w.x, HOUSE_FOOT) + 1,
    y: HOUSE_FOOT,
    w: w.w - 2,
    h: 0,
    foot: HOUSE_FOOT,
    radius: 32,
    falloff: 1.8,
    power: 0.65,
    fan: 2.2,
    seed: 40 + i,
    flicker: WINDOW,
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
    radius: 96,
    falloff: 1.7,
    power: 1.05,
    walls: 1,
    air: 0.4,
    seed: 10,
    flicker: FIRE_FLICKER,
  },
  ...WINDOWS.map((_, i) => windowLight(i)),
  ...LOWER_WINDOWS.map(windowSpill),
  {
    name: 'attic',
    kind: 'area',
    x: leanX(ATTIC.x - ATTIC.r, ATTIC.y),
    y: ATTIC.y - ATTIC.r,
    w: ATTIC.r * 2,
    h: ATTIC.r * 2,
    foot: 182,
    radius: 10,
    falloff: 2,
    power: 0.62,
    walls: 0.4,
    air: 0.8,
    seed: 50,
    flicker: WINDOW,
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
    falloff: 2,
    power: 0.8,
    walls: 0.5,
    air: 0.8,
    seed: 51,
    flicker: WINDOW,
  },
  {
    name: 'door spill',
    kind: 'spill',
    x: doorX + 2,
    y: DOOR.y + DOOR.h,
    w: DOOR.w - 5,
    h: 0,
    foot: DOOR.y + DOOR.h,
    radius: 44,
    falloff: 1.8,
    power: 1.15,
    fan: 2.4,
    seed: 51,
    flicker: WINDOW,
  },
  {
    name: 'wall lantern',
    kind: 'area',
    x: leanX(WALL_LANTERN.x, WALL_LANTERN.y) + 1,
    y: WALL_LANTERN.y + 1,
    ...POINT,
    foot: HOUSE_FOOT,
    radius: 20,
    falloff: 2,
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
    radius: 52,
    falloff: 1.7,
    power: 1.05,
    walls: 1,
    air: 0.5,
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
      radius: 8 + p.rx * 2,
      falloff: 2,
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
    falloff: 2,
    power: 0.5,
    walls: 1,
    air: 1,
    seed: 70,
    flicker: WINDOW,
  },
];

function falloff(l: Light, d: number): number {
  return d >= 1 ? 0 : Math.pow(1 - d, l.falloff);
}

function lip(x: number, y: number): number {
  return Math.max(0, 1 - (y - groundFront(x)) / 5) * 0.6;
}

// How much of a light reaches a pixel, from its material and position. The
// ground uses a flattened, foot-anchored distance so pools lie on the plane;
// the cut face only catches light on its lip.

function reach(l: Light, scene: Scene, x: number, y: number): number {
  const mat = scene.mat[y * WIDTH + x];
  const dx = x < l.x ? l.x - x : x > l.x + l.w ? x - (l.x + l.w) : 0;
  if (l.kind === 'spill') {
    if (y < l.foot || (mat !== MAT.ground && mat !== MAT.face)) return 0;
    const dy = y - l.foot;
    if (dx > 1 + dy * l.fan) return 0;
    const d = falloff(l, Math.hypot(dy * 2.6, dx * 0.35) / l.radius);
    return mat === MAT.face ? d * lip(x, y) : d;
  }
  const dy = y < l.y ? l.y - y : y > l.y + l.h ? y - (l.y + l.h) : 0;
  if (mat === MAT.ground) {
    const lift = Math.max(0, l.foot - (l.y + l.h));
    return falloff(l, Math.hypot(dx, (y - l.foot) * 2.6, lift) / l.radius);
  }
  const d = falloff(l, Math.hypot(dx, dy) / l.radius);
  if (mat === MAT.face) return d * lip(x, y);
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
