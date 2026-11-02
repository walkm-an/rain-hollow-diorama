import { WIDTH } from '../contract.ts';
import { hashUnit } from '../loop.ts';
import { fbm1, fbm2 } from '../noise.ts';
import { C } from '../palette.ts';
import { bayer, disc, line, MAT, poly, px, stamp, type Target } from '../raster.ts';

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

// Pointed clods hanging off the underside, like the earth tore loose.
const CLODS = Array.from({ length: 11 }, (_, i) => ({
  x: SLAB.left + 26 + ((i + 0.2 + hashUnit(514, i) * 0.6) / 11) * (SLAB.right - SLAB.left - 52),
  half: 4 + hashUnit(515, i) * 8,
  drop: 5 + hashUnit(516, i) * 13,
}));

// The crumbling underside: a belly, broken into 3 px terraces, plus clods.
const BOTTOM = profile((x) => {
  const k = (x - 240) / 172;
  const belly = SLAB.bottom + 10 * Math.max(0, 1 - k * k);
  const terrace = Math.round(((fbm1(x / 9, 511, 2) - 0.5) * 12) / 3) * 3;
  let clod = 0;
  for (const c of CLODS) clod = Math.max(clod, c.drop * (1 - Math.abs(x - c.x) / c.half));
  return Math.round(belly + terrace + clod + (hashUnit(513, x >> 1) < 0.25 ? 1 : 0));
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
  { depth: 44, colors: [C.soil0, C.soil1, C.soil2], grain: [5, 3] },
  { depth: 49, colors: [C.soil1, C.stone0, C.soil2], grain: [3, 2] },
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
  const under = bottomAt(x) - y;
  if (under <= 1) return C.ink;
  if (under <= 4) return bayer(x, y) < 0.6 ? C.soil0 : C.ink;
  if (edge < 2.5 || under <= 7) tone = Math.max(0, tone - 1);
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

// A faceted rock: each pixel takes the shade of the polygon edge it sits
// behind, lit from the upper left, with a dark lip along the underside.
function bakeRock(t: Target, cx: number, cy: number, r: number, seed: number): void {
  const n = 5 + Math.floor(hashUnit(seed, 0) * 3);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((i + (hashUnit(seed, 1, i) - 0.5) * 0.5) / n) * Math.PI * 2;
    const rr = r * (0.75 + 0.35 * hashUnit(seed, 2, i));
    xs.push(cx + Math.cos(a) * rr * 1.25);
    ys.push(cy + Math.sin(a) * rr * 0.85);
  }
  for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
    for (let x = Math.floor(cx - r * 1.4 - 1); x <= Math.ceil(cx + r * 1.4 + 1); x++) {
      const px0 = x + 0.5;
      const py0 = y + 0.5;
      let inside = true;
      let nearest = Infinity;
      let lit = 0;
      for (let i = 0; i < n && inside; i++) {
        const ax = xs[i];
        const ay = ys[i];
        const ex = xs[(i + 1) % n] - ax;
        const ey = ys[(i + 1) % n] - ay;
        const len = Math.hypot(ex, ey);
        const dist = ((px0 - ax) * ey - (py0 - ay) * ex) / -len;
        if (dist < 0) inside = false;
        else if (dist < nearest) {
          nearest = dist;
          lit = (ey / len) * -0.6 + (-ex / len) * -0.8;
        }
      }
      if (!inside || !insideFace(x, y)) continue;
      const rim = nearest < 1;
      const c = rim
        ? lit > 0.45 ? C.stone2 : lit < -0.3 ? C.ink : C.soil0
        : lit > 0.45 ? C.stone2 : lit > -0.2 ? C.stone1 : C.stone0;
      px(t, x, y, c);
    }
  }
}

const ROCK_CLUSTERS: readonly { x: number; y: number; n: number }[] = [
  { x: 84, y: 209, n: 3 },
  { x: 178, y: 224, n: 4 },
  { x: 238, y: 207, n: 3 },
  { x: 285, y: 225, n: 5 },
  { x: 346, y: 208, n: 3 },
  { x: 388, y: 223, n: 4 },
];

function bakeStones(t: Target): void {
  t.pen = MAT.face;
  ROCK_CLUSTERS.forEach((cl, k) => {
    for (let i = 0; i < cl.n; i++) {
      const seed = 531 + k * 17 + i;
      const r = 2.2 + hashUnit(seed, 9) ** 1.5 * 3.6;
      const x = cl.x + (hashUnit(seed, 7) - 0.5) * 22;
      const y = cl.y + (hashUnit(seed, 8) - 0.5) * 9;
      bakeRock(t, x, y, r, seed);
    }
  });
  for (let i = 0; i < 30; i++) {
    const x = Math.round(SLAB.left + 14 + hashUnit(538, i) * (SLAB.right - SLAB.left - 28));
    const y = Math.round(SLAB.front + 6 + hashUnit(539, i) * 48);
    if (!insideFace(x, y + 1)) continue;
    px(t, x, y, C.stone1);
    px(t, x, y + 1, C.soil0);
  }
}

// An open coffin, seen from above where the face cuts it, with its occupant.
const COFFIN = { x: 96, y: 199, w: 58, h: 17 };

function bakeCoffin(t: Target): void {
  t.pen = MAT.face;
  const { x, y, w, h } = COFFIN;
  const hex = (i: number) => [
    x + i, y + h * 0.3 + i * 0.6,
    x + w * 0.27, y + i,
    x + w - i, y + h * 0.2 + i * 0.6,
    x + w - i, y + h * 0.8 - i * 0.6,
    x + w * 0.27, y + h - i,
    x + i, y + h * 0.7 - i * 0.6,
  ];
  poly(t, hex(0), C.wood0);
  poly(t, hex(1), C.wood2);
  poly(t, hex(2.2), C.wood1);
  poly(t, hex(3), C.ink);
  const cy = y + Math.floor(h / 2);
  const bone = { o: C.stone2, h: C.haze, x: C.ink, d: C.stone1 };
  stamp(t, SKULL, x + 4, cy - 3, bone);
  for (let i = x + 12; i <= x + 33; i++) px(t, i, cy, i % 2 === 0 ? C.stone2 : C.stone1);
  for (let r = 0; r < 5; r++) {
    const rx = x + 14 + r * 3;
    const reach = r < 4 ? 4 : 3;
    for (let dy = 1; dy <= reach; dy++) {
      const bend = dy === reach ? 1 : 0;
      px(t, rx + bend, cy - dy, dy === 1 ? C.haze : C.stone2);
      px(t, rx + bend, cy + dy, C.stone2);
    }
  }
  line(t, x + 13, cy - 5, x + 27, cy - 6, C.stone1);
  line(t, x + 13, cy + 5, x + 27, cy + 6, C.stone1);
  stamp(t, HAND, x + 28, cy - 7, bone);
  stamp(t, HAND, x + 28, cy + 5, bone);
  stamp(t, PELVIS, x + 32, cy - 3, bone);
  line(t, x + 36, cy - 2, x + w - 7, cy - 3, C.stone2);
  line(t, x + 36, cy + 2, x + w - 7, cy + 3, C.stone2);
  line(t, x + 37, cy - 1, x + w - 8, cy - 2, C.stone1);
  px(t, x + 45, cy - 3, C.haze);
  px(t, x + 45, cy + 3, C.haze);
  stamp(t, FOOT, x + w - 7, cy - 5, bone);
  stamp(t, FOOT, x + w - 7, cy + 2, bone);
  // The lid, split and slid off the foot end.
  line(t, x + w - 2, y - 2, x + w + 9, y + 4, C.wood2);
  line(t, x + w - 2, y - 1, x + w + 9, y + 5, C.wood1);
  line(t, x + w - 2, y, x + w + 8, y + 6, C.wood0);
}

// Lying face up, crown to the left.
const SKULL = [
  '..oho..',
  '.ohhoo.',
  'oohxooo',
  'ooooxod',
  'oohxooo',
  '.oooood',
  '..ooo..',
];

const PELVIS = ['.oo.', 'oxxo', 'ooxo', 'oxxo', 'oooo', '.oo.', '....'];
const HAND = ['dod', 'o.o'];
const FOOT = ['oo.', 'ooo', 'oo.'];

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
      let c = n < 0.42 ? C.navy : n < 0.6 ? C.moss0 : n < 0.7 ? C.indigo : C.moss1;
      if (dirt > 0.6) c = dirt > 0.68 ? C.soil2 : C.soil1;
      if (depth < 0.12) c = C.moss0;
      if (y === front) c = C.moss1;
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
