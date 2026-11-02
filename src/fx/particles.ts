import { HEIGHT, WIDTH } from '../contract.ts';
import type { Draw, Frame } from '../frame.ts';
import { clock, hash, mix32, slot, type Clock, type Slot } from '../loop.ts';
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
  readonly density: number;
  readonly colors: readonly number[];
}

const SMOKE = [C.stone2, C.stone1];

export const EMITTERS: readonly Emitter[] = [
  {
    name: 'chimney smoke',
    kind: 'puff',
    seed: 1501,
    origins: [CHIMNEY_TOP],
    spread: 1,
    count: 15,
    life: 10,
    rise: 6.5,
    wind: 3.2,
    wobble: 2.5,
    wobbleCycles: 1,
    size: [1.6, 10],
    density: 0.75,
    colors: SMOKE,
  },
  {
    name: 'fire smoke',
    kind: 'puff',
    seed: 1511,
    origins: [{ x: FIRE.x + 1, y: CAULDRON.y - CAULDRON.ry - 3 }],
    spread: 3,
    count: 9,
    life: 6,
    rise: 8,
    wind: 3.5,
    wobble: 2,
    wobbleCycles: 1,
    size: [2, 8],
    density: 0.5,
    colors: SMOKE,
  },
  {
    name: 'steam',
    kind: 'puff',
    seed: 1521,
    origins: [{ x: CAULDRON.x, y: CAULDRON.y - CAULDRON.ry - 1 }],
    spread: 5,
    count: 7,
    life: 2.4,
    rise: 9,
    wind: 2.5,
    wobble: 1.5,
    wobbleCycles: 1,
    size: [1, 3.5],
    density: 0.6,
    colors: [C.pale, C.haze],
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
    density: 1,
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
    density: 1,
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
    density: 1,
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
    density: 1,
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
  const lifeFrac = 0.4 + 0.6 * attr(p, 0);
  const heat = 1 - p.age / lifeFrac;
  if (heat <= 0) return false;
  const t = p.age * p.life;
  const speed = 0.6 + 0.8 * attr(p, 1);
  const phase = attr(p, 2) * Math.PI * 2;
  const x = p.ox + e.wind * t * t * 0.35 + e.wobble * p.age * Math.sin(phase + Math.PI * 2 * e.wobbleCycles * p.age);
  const y = p.oy - e.rise * speed * t + 3 * t * t * attr(p, 3);
  const ramp = e.colors;
  const c = ramp[Math.min(ramp.length - 1, Math.floor(heat * heat * (ramp.length - 0.01)))];
  return put(f.target.data, x, y, c);
}

function drawPuff(f: Frame, e: Emitter, p: Particle): boolean {
  const t = p.age * p.life;
  const phase = attr(p, 2) * Math.PI * 2;
  const cx = p.ox + e.wind * t * (0.6 + 0.4 * p.age) + e.wobble * Math.sin(phase + Math.PI * 2 * e.wobbleCycles * p.age);
  const cy = p.oy - e.rise * t * (0.85 + 0.3 * attr(p, 1));
  const r = e.size[0] + (e.size[1] - e.size[0]) * Math.pow(p.age, 0.7) * (0.8 + 0.4 * attr(p, 3));
  const cover = e.density * Math.min(1, p.age / 0.12) * Math.pow(1 - p.age, 1.4);
  if (cover < 0.04) return false;
  const data = f.target.data;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(WIDTH - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(HEIGHT - 1, Math.ceil(cy + r));
  const r2 = r * r;
  const light = e.colors[0];
  const dark = e.colors[1];
  let any = false;
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    const brow = (y & 3) << 2;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const k = 1 - d2 / r2;
      if (BAYER[brow | (x & 3)] < cover * (0.25 + 0.75 * k)) {
        data[y * WIDTH + x] = dy < -r * 0.15 ? light : dark;
        any = true;
      }
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
  return (f: Frame) => {
    for (let ei = 0; ei < EMITTERS.length; ei++) {
      const e = EMITTERS[ei];
      const ck = clocks[ei];
      const draw = DRAW[e.kind];
      for (let i = 0; i < e.count; i++) {
        slot(f.u, ck, ((i + 0.37 * ((i * 0.618034) % 1)) / e.count) * ck.life, s);
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
