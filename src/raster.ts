import { C } from './palette.ts';

// What a static pixel is, so light falloff can treat the ground plane,
// standing props, the cut face, and open air differently.
export const MAT = { air: 0, prop: 1, ground: 2, face: 3 } as const;
export type Material = (typeof MAT)[keyof typeof MAT];

// An indexed image: palette indices plus the material each pixel was painted as.
// Index 0 (C.clear) is transparent when the target is used as a sprite.
export interface Target {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8Array;
  readonly mat: Uint8Array;
  pen: Material;
}

export function createTarget(w: number, h: number): Target {
  return { w, h, data: new Uint8Array(w * h), mat: new Uint8Array(w * h), pen: MAT.prop };
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export const BAYER = new Float32Array(16);
for (let i = 0; i < 16; i++) BAYER[i] = (BAYER4[i] + 0.5) / 16;

export function bayer(x: number, y: number): number {
  return BAYER[((y & 3) << 2) | (x & 3)];
}

export function px(t: Target, x: number, y: number, c: number): void {
  x |= 0;
  y |= 0;
  if (x < 0 || y < 0 || x >= t.w || y >= t.h) return;
  const i = y * t.w + x;
  t.data[i] = c;
  t.mat[i] = t.pen;
}

// Sets the pixel only where the ordered-dither threshold is below `coverage`.
export function dpx(t: Target, x: number, y: number, c: number, coverage: number): void {
  if (bayer(x, y) < coverage) px(t, x, y, c);
}

export function hline(t: Target, x0: number, x1: number, y: number, c: number): void {
  for (let x = Math.min(x0, x1) | 0; x <= Math.max(x0, x1); x++) px(t, x, y, c);
}

export function vline(t: Target, x: number, y0: number, y1: number, c: number): void {
  for (let y = Math.min(y0, y1) | 0; y <= Math.max(y0, y1); y++) px(t, x, y, c);
}

export function rect(t: Target, x: number, y: number, w: number, h: number, c: number): void {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(t, x + i, y + j, c);
}

export function line(t: Target, x0: number, y0: number, x1: number, y1: number, c: number): void {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    px(t, x0, y0, c);
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

export function ellipse(t: Target, cx: number, cy: number, rx: number, ry: number, c: number): void {
  const x0 = Math.floor(cx - rx);
  const x1 = Math.ceil(cx + rx);
  const y0 = Math.floor(cy - ry);
  const y1 = Math.ceil(cy + ry);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      if (nx * nx + ny * ny <= 1) px(t, x, y, c);
    }
  }
}

export function disc(t: Target, cx: number, cy: number, r: number, c: number): void {
  ellipse(t, cx, cy, r, r, c);
}

// Thick polyline segment: a run of discs whose radius tapers from r0 to r1.
export function stroke(t: Target, x0: number, y0: number, x1: number, y1: number, r0: number, r1: number, c: number): void {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const r = r0 + (r1 - r0) * k;
    const x = x0 + (x1 - x0) * k;
    const y = y0 + (y1 - y0) * k;
    if (r < 0.75) px(t, x, y, c);
    else disc(t, x, y, r, c);
  }
}

// Scanline fill of a simple polygon given as [x0, y0, x1, y1, ...].
export function poly(t: Target, pts: readonly number[], c: number): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 1; i < pts.length; i += 2) {
    minY = Math.min(minY, pts[i]);
    maxY = Math.max(maxY, pts[i]);
  }
  const xs: number[] = [];
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    const sy = y + 0.5;
    xs.length = 0;
    for (let i = 0; i < pts.length; i += 2) {
      const ax = pts[i];
      const ay = pts[i + 1];
      const bx = pts[(i + 2) % pts.length];
      const by = pts[(i + 3) % pts.length];
      if (ay <= sy !== by <= sy) xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) px(t, x, y, c);
    }
  }
}

export type PixelMap = readonly string[];

// Stamps a small string-row pixel map; '.' is transparent, other chars look up `key`.
export function stamp(
  t: Target,
  map: PixelMap,
  x: number,
  y: number,
  key: Readonly<Record<string, number>>,
  flip = false,
): void {
  const w = map[0].length;
  for (let j = 0; j < map.length; j++) {
    const row = map[j];
    for (let i = 0; i < w; i++) {
      const ch = row[flip ? w - 1 - i : i];
      if (ch === '.') continue;
      px(t, x + i, y + j, key[ch]);
    }
  }
}

// Copies the non-transparent pixels of `src` onto `dst` (same size).
export function overlay(dst: Uint8Array, src: Uint8Array): void {
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (v !== C.clear) dst[i] = v;
  }
}
