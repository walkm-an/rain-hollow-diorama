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

// Periodic value noise: `cycles` lattice points around the loop, so the curve
// closes on itself. The lattice is hashed once at init; sampling only reads it.
export interface NoiseTrack {
  readonly cycles: number;
  readonly lattice: Float64Array;
}

export function noiseTrack(cycles: number, seed: number): NoiseTrack {
  assertCycles(cycles);
  const lattice = new Float64Array(cycles);
  for (let k = 0; k < cycles; k++) lattice[k] = hashUnit(seed, k) * 2 - 1;
  return { cycles, lattice };
}

// Catmull-Rom through the lattice, in [-1, 1] with slight overshoot.
export function sampleNoise(track: NoiseTrack, t: number): number {
  const n = track.cycles;
  const l = track.lattice;
  const x = (phase(t) / LOOP_SECONDS) * n;
  const i = Math.floor(x);
  const f = x - i;
  const p0 = l[(i - 1 + n) % n];
  const p1 = l[i % n];
  const p2 = l[(i + 1) % n];
  const p3 = l[(i + 2) % n];
  return p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)));
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
