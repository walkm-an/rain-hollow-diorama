import { HEIGHT, LOOP_SECONDS, WIDTH } from '../contract.ts';
import type { Draw, Frame } from '../frame.ts';
import { hashUnit } from '../loop.ts';
import { fbm1 } from '../noise.ts';
import { C } from '../palette.ts';
import { bayer, MAT, px, type Target } from '../raster.ts';

interface Ridge {
  readonly seed: number;
  readonly base: number;
  readonly amp: number;
  readonly scale: number;
  readonly color: number;
  readonly mist: number;
  // Rows below the crest where the ridge starts and finishes dissolving into mist.
  readonly fade: readonly [number, number];
  readonly pines: { readonly every: number; readonly height: readonly [number, number] };
}

// Back to front: each ridge is darker, taller-treed, and fades less.
export const RIDGES: readonly Ridge[] = [
  { seed: 3, base: 160, amp: 26, scale: 90, color: C.sky4, mist: C.sky5, fade: [6, 30], pines: { every: 7, height: [3, 6] } },
  { seed: 7, base: 188, amp: 22, scale: 70, color: C.sky3, mist: C.sky4, fade: [10, 40], pines: { every: 5, height: [5, 10] } },
  { seed: 13, base: 226, amp: 22, scale: 60, color: C.sky1, mist: C.sky3, fade: [16, 44], pines: { every: 4, height: [8, 16] } },
];

// A lone cabin on the middle ridge, the only warm pocket outside the diorama.
export const FAR_CABIN = { x: 446, ridge: 1 };

function crest(r: Ridge, x: number): number {
  return r.base - r.amp * fbm1(x / r.scale, r.seed, 3);
}

function pine(t: Target, x: number, baseY: number, h: number, c: number): void {
  for (let j = 0; j < h; j++) {
    const k = j / h;
    const tier = (j % 3) / 3;
    const half = Math.floor(k * h * 0.32 + tier * 1.2);
    for (let i = -half; i <= half; i++) px(t, x + i, baseY - h + j, c);
  }
  px(t, x, baseY - h - 1, c);
}

function bakeRidge(t: Target, r: Ridge): void {
  t.pen = MAT.air;
  for (let x = 0; x < WIDTH; x++) {
    const top = Math.round(crest(r, x));
    for (let y = top; y < HEIGHT; y++) {
      const d = y - top;
      const k = (d - r.fade[0]) / (r.fade[1] - r.fade[0]);
      px(t, x, y, bayer(x, y) < k ? r.mist : r.color);
    }
  }
  for (let x = -4, i = 0; x < WIDTH + 4; i++) {
    const h = r.pines.height[0] + hashUnit(r.seed, i, 1) * (r.pines.height[1] - r.pines.height[0]);
    if (hashUnit(r.seed, i, 2) < 0.8) pine(t, x, Math.round(crest(r, x)) + 2, Math.round(h), r.color);
    x += Math.max(2, Math.round(r.pines.every * (0.5 + hashUnit(r.seed, i, 3))));
  }
}

export function bakeRidges(t: Target): void {
  for (let i = 0; i < RIDGES.length; i++) {
    bakeRidge(t, RIDGES[i]);
    if (i === FAR_CABIN.ridge) bakeCabin(t);
  }
}

function bakeCabin(t: Target): void {
  const r = RIDGES[FAR_CABIN.ridge];
  const x = FAR_CABIN.x;
  const y = Math.round(crest(r, x)) + 1;
  for (let j = 0; j < 4; j++) for (let i = -2 + (j < 2 ? 2 - j : 0); i <= 2 - (j < 2 ? 2 - j : 0); i++) px(t, x + i, y - 5 + j, r.color);
  for (let i = -2; i <= 2; i++) px(t, x + i, y - 1, r.color);
  px(t, x + 1, y - 2, C.fire2);
}

export function farCabinWindow(): { x: number; y: number } {
  const r = RIDGES[FAR_CABIN.ridge];
  return { x: FAR_CABIN.x + 1, y: Math.round(crest(r, FAR_CABIN.x)) - 1 };
}

interface MistBand {
  readonly seed: number;
  readonly y: number;
  readonly height: number;
  readonly density: number;
  readonly wraps: number;
  readonly phase: number;
  readonly color: number;
}

// Low mist drifting across the valley, in front of the ridges and behind the slab.
export const MIST_BANDS: readonly MistBand[] = [
  { seed: 41, y: 176, height: 22, density: 0.55, wraps: 1, phase: 0.4, color: C.sky5 },
  { seed: 43, y: 214, height: 30, density: 0.5, wraps: 2, phase: 0.6, color: C.sky4 },
  { seed: 47, y: 246, height: 26, density: 0.6, wraps: 3, phase: 0.9, color: C.sky3 },
];

export function mistLayer(): Draw {
  const W = WIDTH;
  const profiles = MIST_BANDS.map((b) => {
    const n = new Float32Array(W);
    for (let x = 0; x < W; x++) n[x] = fbm1((x / W) * 8, b.seed, 3, 8);
    const rows = new Float32Array(b.height);
    for (let j = 0; j < b.height; j++) {
      const k = j / (b.height - 1);
      rows[j] = b.density * Math.sin(Math.PI * k) ** 1.5;
    }
    return { band: b, n, rows };
  });
  return (f: Frame) => {
    const data = f.target.data;
    for (let p = 0; p < profiles.length; p++) {
      const { band, n, rows } = profiles[p];
      const offset = Math.floor((f.u / LOOP_SECONDS) * W * band.wraps + band.phase) % W;
      for (let j = 0; j < band.height; j++) {
        const y = band.y + j;
        if (y >= HEIGHT) break;
        const row = rows[j];
        let col = (W - offset) % W;
        for (let x = 0; x < W; x++) {
          const cover = row * (0.25 + n[col] * 1.1);
          if (bayer(x, y) < cover) data[y * W + x] = band.color;
          if (++col === W) col = 0;
        }
      }
    }
  };
}
