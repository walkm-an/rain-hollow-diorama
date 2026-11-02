import { hashUnit } from './loop.ts';

function fade(f: number): number {
  return f * f * (3 - 2 * f);
}

function wrapIndex(i: number, period: number): number {
  return period > 0 ? ((i % period) + period) % period : i;
}

// 1D value noise in [0, 1]; `period` > 0 makes it tile every `period` lattice cells.
export function noise1(x: number, seed: number, period = 0): number {
  const i = Math.floor(x);
  const f = fade(x - i);
  const a = hashUnit(seed, wrapIndex(i, period));
  const b = hashUnit(seed, wrapIndex(i + 1, period));
  return a + (b - a) * f;
}

// 2D value noise in [0, 1]; periods > 0 tile on that axis.
export function noise2(x: number, y: number, seed: number, px = 0, py = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const x0 = wrapIndex(ix, px);
  const x1 = wrapIndex(ix + 1, px);
  const y0 = wrapIndex(iy, py);
  const y1 = wrapIndex(iy + 1, py);
  const a = hashUnit(seed, x0, y0);
  const b = hashUnit(seed, x1, y0);
  const c = hashUnit(seed, x0, y1);
  const d = hashUnit(seed, x1, y1);
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return top + (bottom - top) * fy;
}

export function fbm1(x: number, seed: number, octaves: number, period = 0): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise1(x * freq, seed + o * 31, period * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

export function fbm2(x: number, y: number, seed: number, octaves: number, px = 0, py = 0): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise2(x * freq, y * freq, seed + o * 31, px * freq, py * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
