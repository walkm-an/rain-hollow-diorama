import { WIDTH } from '../contract.ts';
import { hashUnit } from '../loop.ts';
import { fbm1, fbm2 } from '../noise.ts';
import { C } from '../palette.ts';
import { bayer, disc, ellipse, line, MAT, px, stamp, type Target } from '../raster.ts';

// The floating block of earth. The top face is a shallow 2.5D band between
// the back and front edges; the front is a vertical cut that crumbles below.
export const SLAB = {
  left: 68,
  right: 412,
  back: 172,
  front: 186,
  bottom: 236,
  inset: { left: 6, right: 6 },
  taper: { left: 0.34, right: 0.3 },
};

function profile(f: (x: number) => number): Int16Array {
  const out = new Int16Array(WIDTH);
  for (let x = 0; x < WIDTH; x++) out[x] = f(x);
  return out;
}

function sample(table: Int16Array, x: number): number {
  const i = Math.round(x);
  return table[i < 0 ? 0 : i >= WIDTH ? WIDTH - 1 : i];
}

const BACK = profile((x) => SLAB.back + Math.round((fbm1(x / 19, 501, 2) - 0.5) * 3));
const FRONT = profile((x) => SLAB.front + Math.round((fbm1(x / 14, 503, 2) - 0.5) * 4));

export function groundBack(x: number): number {
  return sample(BACK, x);
}

export function groundFront(x: number): number {
  return sample(FRONT, x);
}

// y on the top face at depth 0 (back edge) .. 1 (front edge).
export function groundAt(x: number, depth: number): number {
  return Math.round(groundBack(x) + (groundFront(x) - groundBack(x)) * depth);
}

function topLeft(y: number): number {
  return SLAB.left + SLAB.inset.left * (1 - (y - SLAB.back) / (SLAB.front - SLAB.back));
}

function topRight(y: number): number {
  return SLAB.right - SLAB.inset.right * (1 - (y - SLAB.back) / (SLAB.front - SLAB.back));
}

function faceLeft(y: number): number {
  return SLAB.left + (y - SLAB.front) * SLAB.taper.left + (fbm1(y / 5, 507, 2) - 0.5) * 3;
}

function faceRight(y: number): number {
  return SLAB.right - (y - SLAB.front) * SLAB.taper.right + (fbm1(y / 5, 509, 2) - 0.5) * 3;
}

// The crumbling underside: a shallow belly plus chunky steps and hanging lumps.
const BOTTOM = profile((x) => {
  const k = (x - 236) / 175;
  const belly = SLAB.bottom + 9 * Math.max(0, 1 - k * k);
  const chunk = Math.round((fbm1(x / 7, 511, 3) - 0.5) * 7);
  const lump = Math.max(0, fbm1(x / 11, 513, 2) - 0.62) * 30;
  return Math.round(belly + chunk + lump);
});

export function bottomAt(x: number): number {
  return sample(BOTTOM, x);
}

function insideFace(x: number, y: number): boolean {
  return x >= faceLeft(y) && x <= faceRight(y) && y < bottomAt(x);
}

interface Stratum {
  readonly depth: number;
  readonly colors: readonly [number, number, number];
  readonly grain: readonly [number, number];
}

// From the grass lip down; `depth` is where the band ends below the lip.
const STRATA: readonly Stratum[] = [
  { depth: 9, colors: [C.soil0, C.soil1, C.soil2], grain: [4, 2] },
  { depth: 15, colors: [C.soil2, C.stone0, C.stone1], grain: [9, 1.5] },
  { depth: 27, colors: [C.soil0, C.soil1, C.soil2], grain: [5, 3] },
  { depth: 32, colors: [C.wood1, C.wood2, C.stone1], grain: [10, 1.5] },
  { depth: 99, colors: [C.soil0, C.soil0, C.soil1], grain: [5, 3] },
];

function stratumAt(x: number, d: number): Stratum {
  const wobble = Math.sin(x / 23) * 1.6 + (fbm1(x / 31, 517, 2) - 0.5) * 5;
  for (const s of STRATA) if (d < s.depth + wobble) return s;
  return STRATA[STRATA.length - 1];
}

function faceColor(x: number, y: number): number {
  const d = y - groundFront(x);
  const s = stratumAt(x, d);
  const n = fbm2(x / s.grain[0], y / s.grain[1], 521, 2) + (bayer(x, y) - 0.5) * 0.18;
  let tone = n < 0.42 ? 0 : n < 0.66 ? 1 : 2;
  const edge = Math.min(x - faceLeft(y), faceRight(y) - x);
  if (edge < 2.5 || bottomAt(x) - y <= 2) tone = Math.max(0, tone - 1);
  if (d <= 1) tone = 0;
  return s.colors[tone];
}

function bakeFace(t: Target): void {
  t.pen = MAT.face;
  for (let y = SLAB.front - 3; y < SLAB.bottom + 40; y++) {
    for (let x = SLAB.left - 4; x <= SLAB.right + 4; x++) {
      if (y <= groundFront(x) || !insideFace(x, y)) continue;
      px(t, x, y, faceColor(x, y));
    }
  }
}

function bakeStones(t: Target): void {
  t.pen = MAT.face;
  for (let i = 0; i < 46; i++) {
    const x = SLAB.left + 14 + hashUnit(531, i) * (SLAB.right - SLAB.left - 28);
    const y = SLAB.front + 8 + hashUnit(533, i) * 50;
    const r = 1.2 + hashUnit(535, i) ** 2 * 3.4;
    if (!insideFace(x - r, y + r + 1) || !insideFace(x + r, y + r + 1)) continue;
    const rx = r * (1.1 + hashUnit(537, i) * 0.5);
    ellipse(t, x, y, rx, r, C.soil0);
    ellipse(t, x - 0.4, y - 0.4, rx - 0.6, r - 0.6, C.stone0);
    ellipse(t, x - 0.8, y - 0.9, Math.max(0.6, rx - 1.6), Math.max(0.5, r - 1.4), C.stone1);
    if (r > 2.5) px(t, x - rx * 0.4, y - r * 0.5, C.stone2);
  }
}

// A coffin cut lengthwise by the face, with a few bones inside.
const COFFIN = { x: 104, y: 204, w: 46, h: 11 };

function bakeCoffin(t: Target): void {
  t.pen = MAT.face;
  const { x, y, w, h } = COFFIN;
  const shoulder = 12;
  const outline = (inset: number, c: number) => {
    for (let i = inset; i < w - inset; i++) {
      const taper = i < shoulder ? (i / shoulder) * 2 : 2 - ((i - shoulder) / (w - shoulder)) * 3;
      const top = Math.round(y + 2 - taper) + inset;
      const bot = Math.round(y + h - 2 + taper * 0.4) - inset;
      for (let j = top; j <= bot; j++) px(t, x + i, j, c);
    }
  };
  outline(0, C.wood0);
  outline(1, C.wood2);
  outline(2, C.ink);
  stamp(t, SKULL, x + 4, y + 2, { o: C.stone2, x: C.ink, d: C.stone1 });
  line(t, x + 11, y + 6, x + 34, y + 6, C.stone1);
  for (let r = 0; r < 4; r++) {
    px(t, x + 14 + r * 3, y + 5, C.stone2);
    px(t, x + 14 + r * 3, y + 7, C.stone2);
  }
  line(t, x + 34, y + 6, x + 41, y + 5, C.stone1);
  line(t, x + 34, y + 7, x + 41, y + 8, C.stone1);
  px(t, x + 42, y + 5, C.stone2);
  px(t, x + 42, y + 8, C.stone2);
  for (let i = 3; i < w - 4; i += 9) px(t, x + i, y + 1 + (i < shoulder ? 1 : 0), C.wood1);
}

const SKULL = [
  '.ooo.',
  'odoxo',
  'oooo.',
  '.x.x.',
];

const BOTTLE = [
  '..d..',
  '..s..',
  '.sgs.',
  'sghgs',
  'sgggs',
  'sgggs',
  '.sss.',
];

function bakeBottle(t: Target): void {
  t.pen = MAT.face;
  stamp(t, BOTTLE, 318, 205, { d: C.wood2, s: C.moss0, g: C.moss1, h: C.moss2 });
}

// A rusted lantern lost in the clay, on its side.
function bakeOldLantern(t: Target): void {
  t.pen = MAT.face;
  stamp(t, OLD_LANTERN, 214, 222, { r: C.wood2, k: C.ink, g: C.soil2, h: C.stone1 });
}

const OLD_LANTERN = [
  '.rrrrr..',
  'rkgkgkrr',
  'rghgggkr',
  'rkgkgkrr',
  '.rrrrr..',
];

function bakeRoots(t: Target): void {
  t.pen = MAT.face;
  for (let i = 0; i < 26; i++) {
    let x = SLAB.left + 12 + hashUnit(541, i) * (SLAB.right - SLAB.left - 24);
    let y = groundFront(Math.round(x)) + 2;
    const len = 6 + hashUnit(543, i) * 24;
    const dir = hashUnit(545, i) < 0.5 ? -1 : 1;
    const c = hashUnit(547, i) < 0.5 ? C.wood1 : C.wood2;
    for (let s = 0; s < len; s++) {
      if (!insideFace(x, y)) break;
      px(t, x, y, c);
      y += 1;
      x += Math.round((fbm1(s / 4, 549 + i, 2) - 0.5) * 2.2) * 0.6 * dir;
    }
  }
  for (let i = 0; i < 16; i++) {
    const x = Math.round(SLAB.left + 30 + hashUnit(551, i) * (SLAB.right - SLAB.left - 60));
    const len = 3 + Math.round(hashUnit(553, i) * 12);
    let rx = x;
    for (let s = 0; s < len; s++) {
      const y = bottomAt(x) + s;
      if (s > 0 && hashUnit(555, i, s) < 0.3) rx += hashUnit(557, i, s) < 0.5 ? -1 : 1;
      px(t, rx, y, s < 2 ? C.wood1 : C.wood0);
    }
  }
}

function bakeTop(t: Target): void {
  t.pen = MAT.ground;
  for (let x = SLAB.left - 2; x <= SLAB.right + 2; x++) {
    const back = groundBack(x);
    const front = groundFront(x);
    for (let y = back; y <= front; y++) {
      if (x < topLeft(Math.min(y, SLAB.front)) || x > topRight(Math.min(y, SLAB.front))) continue;
      const depth = (y - back) / Math.max(1, front - back);
      const n = fbm2(x / 9, y / 3, 561, 3) + (bayer(x, y) - 0.5) * 0.15;
      const dirt = fbm2(x / 13, y / 4, 563, 2);
      let c = n < 0.4 ? C.moss0 : n < 0.62 ? C.moss1 : C.moss0;
      if (dirt > 0.62) c = dirt > 0.7 ? C.soil2 : C.soil1;
      if (depth < 0.12) c = C.moss1;
      if (y === front) c = C.moss2;
      px(t, x, y, c);
    }
  }
  for (let i = 0; i < 70; i++) {
    const x = SLAB.left + 6 + hashUnit(565, i) * (SLAB.right - SLAB.left - 12);
    const y = groundAt(Math.round(x), 0.2 + hashUnit(567, i) * 0.75);
    px(t, x, y, hashUnit(569, i) < 0.5 ? C.stone1 : C.stone0);
  }
  t.pen = MAT.prop;
  for (let x = SLAB.left; x <= SLAB.right; x++) {
    const r = hashUnit(571, x);
    if (r < 0.45) continue;
    const h = 1 + Math.floor(hashUnit(573, x) * 3);
    const y = groundBack(x) - 1;
    for (let j = 0; j < h; j++) px(t, x, y - j, j === 0 ? C.moss1 : C.moss0);
  }
  t.pen = MAT.face;
  for (let x = SLAB.left; x <= SLAB.right; x++) {
    const r = hashUnit(575, x);
    if (r < 0.55) continue;
    const h = 1 + Math.floor(hashUnit(577, x) ** 2 * 4);
    for (let j = 1; j <= h; j++) px(t, x, groundFront(x) + j, j === h ? C.moss0 : C.moss1);
  }
}

// Small rocks that broke off and hang in the void beneath.
function bakeDebris(t: Target): void {
  t.pen = MAT.face;
  const rocks = [
    [150, 258, 2.2],
    [312, 262, 1.6],
    [262, 266, 1.2],
    [118, 247, 1.4],
  ] as const;
  for (const [x, y, r] of rocks) {
    disc(t, x, y, r, C.soil1);
    disc(t, x - 0.5, y - 0.6, r - 0.8, C.stone0);
  }
}

export function bakeSlab(t: Target): void {
  bakeFace(t);
  bakeStones(t);
  bakeCoffin(t);
  bakeBottle(t);
  bakeOldLantern(t);
  bakeRoots(t);
  bakeTop(t);
  bakeDebris(t);
}

// The lowest points of the underside, where rainwater gathers and drips off.
export const DRIP_POINTS: readonly { x: number; y: number }[] = (() => {
  const xs: number[] = [];
  for (let x = SLAB.left + 30; x <= SLAB.right - 30; x++) {
    if (!insideFace(x, bottomAt(x) - 1)) continue;
    const b = bottomAt(x);
    let lowest = true;
    for (let d = -9; d <= 9 && lowest; d++) if (d !== 0 && bottomAt(x + d) > b) lowest = false;
    if (lowest && (xs.length === 0 || x - xs[xs.length - 1] > 24)) xs.push(x);
  }
  return xs.map((x) => ({ x, y: bottomAt(x) }));
})();
