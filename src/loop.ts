import { LOOP_SECONDS } from './contract.ts';

const TAU = Math.PI * 2;

// Ticks per second for the canonical loop clock: a power-of-two multiple of
// 60, so every 1/60 frame time is an exact tick.
const TICKS = 60 * 1024;
const LOOP_TICKS = LOOP_SECONDS * TICKS;

// Canonical position inside the loop, snapped to the tick grid. t + k * LOOP
// carries float error that grows with k; snapping absorbs it, so t and
// t + k * LOOP land on the same bits and no threshold can flip between them.
export function phase(t: number): number {
  const raw = ((t % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS;
  return (Math.round(raw * TICKS) % LOOP_TICKS) / TICKS;
}

function assertCycles(cycles: number): void {
  if (!Number.isInteger(cycles)) throw new Error(`cycles must be an integer, got ${cycles}`);
}

export function wave(t: number, cycles: number, phaseOffset = 0): number {
  assertCycles(cycles);
  return Math.sin((TAU * cycles * phase(t)) / LOOP_SECONDS + phaseOffset);
}

export function mix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

export function hash(a: number, b = 0, c = 0): number {
  return mix32(mix32(mix32(a ^ 0x9e3779b9) ^ (b + 0x632be59b)) ^ (c + 0x7f4a7c15));
}

export function hashUnit(a: number, b = 0, c = 0): number {
  return hash(a, b, c) / 4294967296;
}

function lattice(seed: number, k: number): number {
  return hashUnit(seed, k) * 2 - 1;
}

// Periodic Catmull-Rom value noise in [-1, 1] (slight overshoot possible):
// `cycles` lattice points around the loop, so the curve closes on itself.
export function loopNoise(t: number, cycles: number, seed: number): number {
  assertCycles(cycles);
  const x = (phase(t) / LOOP_SECONDS) * cycles;
  const i = Math.floor(x);
  const f = x - i;
  const p0 = lattice(seed, (i - 1 + cycles) % cycles);
  const p1 = lattice(seed, i % cycles);
  const p2 = lattice(seed, (i + 1) % cycles);
  const p3 = lattice(seed, (i + 2) % cycles);
  return p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)));
}

export function loopFbm(t: number, cycles: number, seed: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * loopNoise(t, cycles << o, seed + o * 101);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

export interface Clock {
  readonly life: number;
  readonly m: number;
}

// A particle life must divide the loop so every slot repeats each LOOP_SECONDS.
export function clock(life: number): Clock {
  const m = Math.round(LOOP_SECONDS / life);
  if (m < 1 || Math.abs(m * life - LOOP_SECONDS) > 1e-9) {
    throw new Error(`particle life ${life}s does not divide the ${LOOP_SECONDS}s loop`);
  }
  return { life: LOOP_SECONDS / m, m };
}

export interface Slot {
  age: number;
  gen: number;
}

// Stateless particle slot: `offset` in [0, LOOP_SECONDS) staggers particles;
// age is in [0, 1) and gen in [0, m) so hash(seed, i, gen) varies per life
// while the whole sequence repeats every loop.
export function slot(t: number, c: Clock, offset: number, out: Slot): Slot {
  const x = (phase(t) + offset) / c.life;
  const k = Math.floor(x);
  out.age = x - k;
  out.gen = k % c.m;
  return out;
}

// Shortest signed distance from a scheduled loop time to u, for one-off events.
export function since(u: number, at: number): number {
  let d = u - at;
  if (d > LOOP_SECONDS / 2) d -= LOOP_SECONDS;
  else if (d < -LOOP_SECONDS / 2) d += LOOP_SECONDS;
  return d;
}

// 0 outside [start, start + dur], ramps in and out over `edge` seconds.
export function envelope(u: number, start: number, dur: number, edge: number): number {
  const d = since(u, start);
  if (d < 0 || d > dur) return 0;
  return Math.min(1, d / edge, (dur - d) / edge);
}

export function smoothstep(a: number, b: number, x: number): number {
  const s = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return s * s * (3 - 2 * s);
}
