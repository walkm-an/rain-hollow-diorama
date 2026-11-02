import type { Draw, Frame } from '../frame.ts';
import { wave } from '../loop.ts';
import { hashUnit } from '../loop.ts';
import { C } from '../palette.ts';
import { line, MAT, px, stamp, stroke, type Target } from '../raster.ts';
import { groundAt } from './slab.ts';

// A gnarled dead tree leaning over the graves. Limbs are [x0, y0, x1, y1, r0, r1].
const ROOT = { x: 92, y: groundAt(92, 0.3) };

const LIMBS: readonly (readonly [number, number, number, number, number, number])[] = [
  [ROOT.x, ROOT.y, 97, 158, 3.6, 2.8],
  [97, 158, 95, 138, 2.8, 2.3],
  [95, 138, 101, 120, 2.3, 1.8],
  [101, 120, 98, 100, 1.8, 1.2],
  [98, 100, 102, 86, 1.2, 0.5],
  // The long limb that carries the lantern.
  [99, 124, 118, 113, 1.8, 1.3],
  [118, 113, 136, 110, 1.3, 1.0],
  [136, 110, 150, 106, 1.0, 0.7],
  [150, 106, 158, 108, 0.7, 0.4],
  // A low branch reaching back over the edge.
  [96, 146, 84, 136, 1.4, 0.9],
  [84, 136, 76, 124, 0.9, 0.5],
  [96, 136, 89, 116, 1.2, 0.6],
  [89, 116, 84, 104, 0.6, 0.4],
  [100, 103, 110, 94, 0.8, 0.4],
];

const TWIGS = 34;

function bakeTwigs(t: Target): void {
  for (let i = 0; i < TWIGS; i++) {
    const limb = LIMBS[4 + Math.floor(hashUnit(701, i) * (LIMBS.length - 4))];
    const k = 0.2 + hashUnit(703, i) * 0.8;
    let x = limb[0] + (limb[2] - limb[0]) * k;
    let y = limb[1] + (limb[3] - limb[1]) * k;
    let a = -Math.PI / 2 + (hashUnit(705, i) - 0.5) * 2.4;
    const n = 3 + Math.floor(hashUnit(707, i) * 6);
    for (let s = 0; s < n; s++) {
      const nx = x + Math.cos(a) * 1.6;
      const ny = y + Math.sin(a) * 1.6;
      line(t, x, y, nx, ny, C.ink);
      x = nx;
      y = ny;
      a += (hashUnit(709, i, s) - 0.5) * 0.9;
    }
  }
}

export function bakeTree(t: Target): void {
  t.pen = MAT.prop;
  for (const [x0, y0, x1, y1, r0, r1] of LIMBS) stroke(t, x0, y0, x1, y1, r0, r1, C.ink);
  bakeTwigs(t);
  for (const [x0, y0, x1, y1, r0] of LIMBS) {
    if (r0 < 1) continue;
    stroke(t, x0 - r0 * 0.5, y0 - 0.5, x1 - r0 * 0.4, y1 - 0.5, 0.5, 0.5, C.wood0);
  }
  for (let i = 0; i < 4; i++) px(t, ROOT.x - 4 + i * 3, ROOT.y, C.ink);
  line(t, ROOT.x - 6, ROOT.y + 1, ROOT.x - 2, ROOT.y - 1, C.ink);
  line(t, ROOT.x + 3, ROOT.y - 1, ROOT.x + 7, ROOT.y + 1, C.ink);
  px(t, 97, 150, C.night);
  px(t, 98, 151, C.night);
}

// The lantern swings from the end of the long limb.
export const LANTERN = { pivotX: 152, pivotY: 107, rope: 9 };
const SWAY = [
  [0.16, 22, 0],
  [0.05, 53, 1.3],
] as const;

export function lanternAngle(u: number): number {
  let a = 0;
  for (let i = 0; i < SWAY.length; i++) a += SWAY[i][0] * wave(u, SWAY[i][1], SWAY[i][2]);
  return a;
}

export function lanternX(u: number): number {
  return LANTERN.pivotX + Math.sin(lanternAngle(u)) * (LANTERN.rope + 4);
}

export function lanternY(u: number): number {
  return LANTERN.pivotY + Math.cos(lanternAngle(u)) * (LANTERN.rope + 4);
}

const LAMP = [
  '.ccc.',
  'fffff',
  'fghgf',
  'fgggf',
  'fhghf',
  'fffff',
  '..f..',
];

const LAMP_KEY = { c: C.ink, f: C.night, g: C.glow4, h: C.glow3 };

export function lanternLayer(): Draw {
  return (f: Frame) => {
    const a = lanternAngle(f.u);
    const tx = LANTERN.pivotX + Math.sin(a) * LANTERN.rope;
    const ty = LANTERN.pivotY + Math.cos(a) * LANTERN.rope;
    line(f.target, LANTERN.pivotX, LANTERN.pivotY, tx, ty, C.deep);
    stamp(f.target, LAMP, Math.round(tx) - 2, Math.round(ty), LAMP_KEY);
  };
}
