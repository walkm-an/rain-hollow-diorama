import { HEIGHT, WIDTH } from '../contract.ts';
import type { Draw, Frame } from '../frame.ts';
import { clock, hash, mix32, slot, smoothstep, type Clock, type Slot } from '../loop.ts';
import { C, FIRE_RAMP } from '../palette.ts';
import { BAYER } from '../raster.ts';
import { CAULDRON, FIRE } from '../scene/campfire.ts';
import { CHIMNEY_TOP, EAVE_DRIPS } from '../scene/cottage.ts';
import { DRIP_POINTS } from '../scene/slab.ts';

type Kind = 'spark' | 'puff' | 'drip' | 'bubble';

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Emitter {
  readonly name: string;
  readonly kind: Kind;
  readonly seed: number;
  // Particle i is born at origins[i % origins.length], jittered by `spread`.
  readonly origins: readonly Point[];
  readonly spread: number;
  readonly count: number;
  // Seconds; must divide the loop.
  readonly life: number;
  // px/s upward and downwind; wind grows with age so plumes bend over.
  readonly rise: number;
  readonly wind: number;
  readonly wobble: number;
  readonly wobbleCycles: number;
  readonly size: readonly [number, number];
  // Puffs: [lit top, body, underside].
  readonly colors: readonly number[];
}

const SMOKE = [C.stone2, C.stone1, C.stone0];

export const EMITTERS: readonly Emitter[] = [
  {
    name: 'chimney smoke',
    kind: 'puff',
    seed: 1501,
    origins: [CHIMNEY_TOP],
    spread: 1,
    count: 9,
    life: 10,
    rise: 5.5,
    wind: 4,
    wobble: 2,
    wobbleCycles: 1,
    size: [2, 7.5],
    colors: SMOKE,
  },
  {
    name: 'fire smoke',
    kind: 'puff',
    seed: 1511,
    origins: [{ x: FIRE.x + 1, y: CAULDRON.y - CAULDRON.ry - 3 }],
    spread: 3,
    count: 5,
    life: 6,
    rise: 7,
    wind: 3.5,
    wobble: 1.5,
    wobbleCycles: 1,
    size: [1.5, 4.5],
    colors: SMOKE,
  },
  {
    name: 'steam',
    kind: 'puff',
    seed: 1521,
    origins: [{ x: CAULDRON.x, y: CAULDRON.y - CAULDRON.ry - 1 }],
    spread: 5,
    count: 6,
    life: 2.4,
    rise: 9,
    wind: 2.5,
    wobble: 1,
    wobbleCycles: 1,
    size: [1, 2.5],
    colors: [C.pale, C.haze, C.steel],
  },
  {
    name: 'bubbles',
    kind: 'bubble',
    seed: 1531,
    origins: [{ x: CAULDRON.x, y: CAULDRON.y - CAULDRON.ry }],
    spread: 5,
    count: 5,
    life: 1.5,
    rise: 0,
    wind: 0,
    wobble: 0,
    wobbleCycles: 0,
    size: [1, 2],
    colors: [C.pale, C.moss2, C.haze],
  },
  {
    name: 'sparks',
    kind: 'spark',
    seed: 1541,
    origins: [{ x: FIRE.x, y: FIRE.y - 5 }],
    spread: 5,
    count: 46,
    life: 2.5,
    rise: 22,
    wind: 7,
    wobble: 3,
    wobbleCycles: 1.5,
    size: [1, 1],
    colors: FIRE_RAMP,
  },
  {
    name: 'slab drips',
    kind: 'drip',
    seed: 1551,
    origins: DRIP_POINTS,
    spread: 0,
    count: DRIP_POINTS.length * 2,
    life: 3,
    rise: 0,
    wind: 0,
    wobble: 0,
    wobbleCycles: 0,
    size: [1, 2],
    colors: [C.rain4, C.rain3, C.rain2],
  },
  {
    name: 'eave drips',
    kind: 'drip',
    seed: 1561,
    origins: EAVE_DRIPS,
    spread: 0,
    count: EAVE_DRIPS.length,
    life: 1.6,
    rise: 0,
    wind: 0,
    wobble: 0,
    wobbleCycles: 0,
    size: [1, 2],
    colors: [C.rain4, C.rain3, C.rain2],
  },
];

// Per-particle state for one frame, reused for every particle.
interface Particle {
  age: number;
  h: number;
  ox: number;
  oy: number;
  life: number;
}

function attr(p: Particle, k: number): number {
  return mix32(p.h ^ Math.imul(k + 1, 0x9e3779b9)) / 4294967296;
}

function put(data: Uint8Array, x: number, y: number, c: number): boolean {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return false;
  data[y * WIDTH + x] = c;
  return true;
}

function drawSpark(f: Frame, e: Emitter, p: Particle): boolean {
  const span = 0.62 + 0.38 * attr(p, 0);
  if (p.age >= span) return false;
  const heat = 1 - p.age / span;
  // The last fifth blinks. The slice is hashed, so the pattern repeats each loop.
  if (heat < 0.2 && (hash(p.h, (p.age * 14) | 0) & 7) >= heat * 28) return false;
  const t = p.age * p.life;
  const speed = 0.6 + 0.8 * attr(p, 1);
  const phase = attr(p, 2) * Math.PI * 2;
  const x = p.ox + e.wind * t * t * 0.35 + e.wobble * p.age * Math.sin(phase + Math.PI * 2 * e.wobbleCycles * p.age);
  const y = p.oy - e.rise * speed * t + 3 * t * t * attr(p, 3);
  const ramp = e.colors;
  const bright = heat * (0.45 + 0.55 * attr(p, 4));
  const c = ramp[Math.min(ramp.length - 1, Math.floor(bright * (ramp.length - 0.01)))];
  return put(f.target.data, x, y, c);
}

const TAU = Math.PI * 2;
const MAX_LOBES = 5;
const lobeX = new Float64Array(MAX_LOBES);
const lobeY = new Float64Array(MAX_LOBES);
const lobeR = new Float64Array(MAX_LOBES);
// Erosion noise lattice in puff space: cells of ERODE_CELL px, offset so the
// largest puff's coordinates stay non-negative.
const ERODE_CELL = 3;
const ERODE_OFFSET = 48;
const ERODE_GRID = 34;
const erodeLattice = new Float32Array(ERODE_GRID * ERODE_GRID);

function fillErosion(h: number, rx0: number, ry0: number, rx1: number, ry1: number): void {
  const i0 = Math.floor((rx0 + ERODE_OFFSET) / ERODE_CELL);
  const i1 = Math.min(ERODE_GRID - 1, Math.floor((rx1 + ERODE_OFFSET) / ERODE_CELL) + 1);
  const j0 = Math.floor((ry0 + ERODE_OFFSET) / ERODE_CELL);
  const j1 = Math.min(ERODE_GRID - 1, Math.floor((ry1 + ERODE_OFFSET) / ERODE_CELL) + 1);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) erodeLattice[j * ERODE_GRID + i] = mix32(h ^ Math.imul(i + 1, 0x85ebca6b) ^ Math.imul(j + 1, 0xc2b2ae35)) / 4294967296;
  }
}

function erosion(rx: number, ry: number): number {
  const gx = (rx + ERODE_OFFSET) / ERODE_CELL;
  const gy = (ry + ERODE_OFFSET) / ERODE_CELL;
  const i = Math.floor(gx);
  const j = Math.floor(gy);
  let fx = gx - i;
  let fy = gy - j;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const o = j * ERODE_GRID + i;
  const top = erodeLattice[o] + (erodeLattice[o + 1] - erodeLattice[o]) * fx;
  const bottom = erodeLattice[o + ERODE_GRID] + (erodeLattice[o + ERODE_GRID + 1] - erodeLattice[o + ERODE_GRID]) * fx;
  return top + (bottom - top) * fy;
}

// A billow of 3-5 overlapping lobes around an integer anchor. Lobes, rim
// dither and erosion are all in anchor-relative coordinates, so the whole
// puff moves as one body instead of sliding through a screen-fixed pattern.
function drawPuff(f: Frame, e: Emitter, p: Particle): boolean {
  const t = p.age * p.life;
  const sway = e.wobble * Math.sin(attr(p, 2) * TAU + TAU * e.wobbleCycles * p.age);
  const ax = Math.round(p.ox + e.wind * t * (0.2 + 1.1 * p.age) + sway);
  const ay = Math.round(p.oy - e.rise * t * (0.85 + 0.3 * attr(p, 1)) * (1 - 0.25 * p.age));
  const size = e.size[0] + (e.size[1] - e.size[0]) * Math.pow(p.age, 0.6) * (0.8 + 0.4 * attr(p, 3));
  const n = 3 + Math.floor(attr(p, 4) * 3);
  const apart = 0.3 + 0.7 * p.age;
  let rx0 = 0;
  let rx1 = 0;
  let ry0 = 0;
  let ry1 = 0;
  for (let j = 0; j < n; j++) {
    const a = attr(p, 10 + j) * TAU;
    const d = j === 0 ? 0 : size * apart * (0.55 + 0.45 * attr(p, 20 + j));
    const r = size * (j === 0 ? 0.8 : 0.5 + 0.3 * attr(p, 30 + j));
    const lx = Math.cos(a) * d * 1.3;
    const ly = Math.sin(a) * d * 0.7;
    // Sorted top to bottom: a lower lobe owns the pixels it shares, so its
    // lit cap sits on the shaded underside of the lobe above.
    let k = j;
    for (; k > 0 && lobeY[k - 1] > ly; k--) {
      lobeX[k] = lobeX[k - 1];
      lobeY[k] = lobeY[k - 1];
      lobeR[k] = lobeR[k - 1];
    }
    lobeX[k] = lx;
    lobeY[k] = ly;
    lobeR[k] = r;
    rx0 = Math.min(rx0, Math.floor(lx - r - 1));
    rx1 = Math.max(rx1, Math.ceil(lx + r + 1));
    ry0 = Math.min(ry0, Math.floor(ly - r - 1));
    ry1 = Math.max(ry1, Math.ceil(ly + r + 1));
  }
  const fade = smoothstep(0.5, 1, p.age);
  if (fade > 0) fillErosion(p.h, rx0, ry0, rx1, ry1);
  const data = f.target.data;
  const lit = e.colors[0];
  const body = e.colors[1];
  const under = e.colors[2];
  const y0 = Math.max(0, ay + ry0);
  const y1 = Math.min(HEIGHT - 1, ay + ry1);
  const x0 = Math.max(0, ax + rx0);
  const x1 = Math.min(WIDTH - 1, ax + rx1);
  let any = false;
  for (let y = y0; y <= y1; y++) {
    const ry = y - ay;
    const brow = (ry & 3) << 2;
    for (let x = x0; x <= x1; x++) {
      const rx = x - ax;
      let deep = -Infinity;
      let near = 0;
      let own = -1;
      for (let j = 0; j < n; j++) {
        const dx = rx - lobeX[j];
        const dy = ry - lobeY[j];
        const s = lobeR[j] - Math.sqrt(dx * dx + dy * dy);
        if (s > deep) {
          deep = s;
          near = j;
        }
        if (s > 0) own = j;
      }
      if (deep <= -1) continue;
      const b = BAYER[brow | (rx & 3)];
      if (deep <= 0 && b >= 0.5) continue;
      if (fade > 0) {
        const v = erosion(rx, ry) + Math.min(1, deep / size) * 0.6 - fade * 1.6;
        if (v < 0 || (v < 0.1 && b * 0.1 >= v)) continue;
      }
      const l = own >= 0 ? own : near;
      const shade = (ry - lobeY[l]) / lobeR[l] + (0.35 * (rx - lobeX[l])) / lobeR[l] + (deep <= 0 ? 0.7 : 0) + fade * 0.7;
      data[y * WIDTH + x] = shade < -0.3 ? lit : shade < 0.45 ? body : under;
      any = true;
    }
  }
  return any;
}

const GRAVITY = 260;

function drawDrip(f: Frame, e: Emitter, p: Particle): boolean {
  const data = f.target.data;
  const swell = 0.62;
  const ox = Math.round(p.ox);
  const oy = Math.round(p.oy);
  if (p.age < 0.2) return false;
  if (p.age < swell) {
    put(data, ox, oy, e.colors[1]);
    if (p.age > swell - 0.15) put(data, ox, oy + 1, e.colors[0]);
    return true;
  }
  const t = (p.age - swell) * p.life;
  const y = oy + 1 + 0.5 * GRAVITY * t * t;
  if (y >= HEIGHT) return false;
  const shown = put(data, ox, y, e.colors[0]);
  put(data, ox, y - 1, e.colors[1]);
  if (t > 0.08) put(data, ox, y - 2, e.colors[2]);
  return shown;
}

function drawBubble(f: Frame, e: Emitter, p: Particle): boolean {
  const data = f.target.data;
  const x = Math.round(p.ox);
  const y = Math.round(p.oy);
  if (p.age < 0.3) return false;
  if (p.age < 0.75) {
    put(data, x, y, e.colors[1]);
    if (p.age > 0.5) {
      put(data, x, y - 1, e.colors[0]);
      put(data, x + 1, y, e.colors[1]);
    }
    return true;
  }
  if (p.age < 0.86) {
    put(data, x - 1, y - 1, e.colors[2]);
    put(data, x + 2, y - 1, e.colors[2]);
    put(data, x, y - 2, e.colors[0]);
    return true;
  }
  return false;
}

const DRAW: Record<Kind, (f: Frame, e: Emitter, p: Particle) => boolean> = {
  spark: drawSpark,
  puff: drawPuff,
  drip: drawDrip,
  bubble: drawBubble,
};

export function particleLayer(): Draw {
  const clocks: Clock[] = EMITTERS.map((e) => clock(e.life));
  const s: Slot = { age: 0, gen: 0 };
  const p: Particle = { age: 0, h: 0, ox: 0, oy: 0, life: 0 };
  const offset = (e: Emitter, ck: Clock, i: number) => ((i + 0.37 * ((i * 0.618034) % 1)) / e.count) * ck.life;
  return (f: Frame) => {
    for (let ei = 0; ei < EMITTERS.length; ei++) {
      const e = EMITTERS[ei];
      const ck = clocks[ei];
      const draw = DRAW[e.kind];
      // Offsets rise with i, so ages rise with i from the youngest slot round
      // to the one before it; walking down from there draws oldest first and
      // lets younger puffs overlap older ones.
      let youngest = 0;
      let minAge = 2;
      for (let i = 0; i < e.count; i++) {
        slot(f.u, ck, offset(e, ck, i), s);
        if (s.age < minAge) {
          minAge = s.age;
          youngest = i;
        }
      }
      for (let k = 1; k <= e.count; k++) {
        const i = (youngest - k + e.count) % e.count;
        slot(f.u, ck, offset(e, ck, i), s);
        const o = e.origins[i % e.origins.length];
        p.age = s.age;
        p.h = hash(e.seed, i, s.gen);
        p.life = ck.life;
        p.ox = o.x + (attr(p, 7) - 0.5) * 2 * e.spread;
        p.oy = o.y;
        if (draw(f, e, p)) f.particles++;
      }
    }
  };
}
