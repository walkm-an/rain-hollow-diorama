import { HEIGHT, WIDTH } from '../contract.ts';
import type { Draw, Frame } from '../frame.ts';
import { envelope, hashUnit, smoothstep } from '../loop.ts';
import { fbm2 } from '../noise.ts';
import { C } from '../palette.ts';
import { bayer, createTarget, disc, hline, line, MAT, px, rect, stamp, stroke, vline, type Target } from '../raster.ts';

// Drawn upright, then sheared: each row shifts right by LEAN px per px of
// height above the sill, so the whole house leans like it is tired.
const BASE = 181;
const LEAN = 0.05;

export function leanX(x: number, y: number): number {
  return x + Math.round((BASE - y) * LEAN);
}

const WALL = { x0: 194, x1: 268, top: 146 };
const UPPER = { x0: 190, x1: 272, top: 113, bottom: 145 };
// A witch hat: concave sides, a brim that flares over the last rows, and a
// crown pushed off-centre so the tip can flop over to the right.
const ROOF = { cx: 231, apex: 30, eave: 113, half: 46, brim: 7, bend: 16 };

interface Window {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export const WINDOWS: readonly Window[] = [
  { x: 199, y: 153, w: 13, h: 14 },
  { x: 249, y: 153, w: 13, h: 14 },
  { x: 198, y: 120, w: 13, h: 15 },
  { x: 250, y: 120, w: 13, h: 15 },
];
export const ATTIC = { x: 233, y: 82, r: 5 };
export const DOOR = { x: 223, y: 150, w: 14, h: 31 };
export const WALL_LANTERN = { x: 242, y: 156 };
// The lower part is drawn under the roof, so it rises out of the slope.
const CHIMNEY = { x: 248, top: 52, w: 7, base: 92 };

export const CHIMNEY_TOP = {
  x: leanX(CHIMNEY.x + Math.floor((CHIMNEY.base - CHIMNEY.top) / 10) + CHIMNEY.w / 2, CHIMNEY.top),
  y: CHIMNEY.top - 4,
};

// Where roof runoff pours off in thin streams, in world space.
function roofHalf(k: number): number {
  const flare = k > 0.86 ? ROOF.brim * ((k - 0.86) / 0.14) ** 2 : 0;
  return 1.5 + ROOF.half * (0.22 * k + 0.78 * k ** 2.3) + flare;
}

function roofCenter(k: number): number {
  return ROOF.cx + ROOF.bend * (1 - k) ** 2.2;
}

const BRIM_HALF = Math.round(roofHalf(1));

export const EAVE_STREAMS: readonly { x: number; y: number; ground: number }[] = [
  { x: leanX(ROOF.cx - BRIM_HALF, ROOF.eave), y: ROOF.eave + 1, ground: 179 },
  { x: leanX(ROOF.cx + BRIM_HALF, ROOF.eave), y: ROOF.eave + 1, ground: 180 },
  { x: leanX(UPPER.x0 - 1, UPPER.bottom), y: UPPER.bottom + 2, ground: 181 },
];

export const EAVE_DRIPS: readonly { x: number; y: number }[] = [-44, -27, -9, 8, 26, 45].map((dx) => ({
  x: leanX(ROOF.cx + dx, ROOF.eave),
  y: ROOF.eave + 2,
}));

const SHINGLE_ROW = 4;
const ROOF_RAMP = [C.night, C.deep, C.navy, C.indigo, C.slate, C.steel];

// Fish-scale shingles laid on a cone seen from slightly above: rows sag in the
// middle, columns narrow toward the silhouette, and shade follows the curve.
function shingle(x: number, y: number, k: number, cx: number, hw: number): number {
  const nx = Math.max(-1, Math.min(1, (x + 0.5 - cx) / hw));
  const bow = Math.min(4, hw * 0.09) * (1 - nx * nx);
  const along = y - ROOF.apex - bow;
  const row = Math.floor(along / SHINGLE_ROW);
  const v = along - row * SHINGLE_ROW;
  const around = (Math.asin(nx) / Math.PI + 0.5) * Math.max(3, Math.round((Math.PI * hw) / 5)) + (row & 1) * 0.5;
  const col = Math.floor(around);
  const u = around - col;
  const h = hashUnit(601, row, col);
  const facing = Math.sqrt(1 - nx * nx);
  const s = 0.12 + 0.5 * facing + 0.16 * nx + 0.14 * (1 - k) + (h - 0.5) * 0.3 + (v < 1 ? 0.12 : 0);
  let tone = Math.max(1, Math.min(ROOF_RAMP.length - 1, Math.floor(s * ROOF_RAMP.length)));
  const lip = SHINGLE_ROW - 1 - 1.4 * (2 * u - 1) ** 2;
  if (v >= lip) tone = Math.max(0, tone - 2);
  else if (fbm2(x / 7, y / 5, 640, 3) > 0.74 - 0.12 * k) {
    return v < 1 && h > 0.5 ? C.moss2 : v >= lip - 1 ? C.moss0 : C.moss1;
  }
  return ROOF_RAMP[tone];
}

function bakeRoof(t: Target): void {
  for (let y = ROOF.apex; y <= ROOF.eave; y++) {
    const k = (y - ROOF.apex) / (ROOF.eave - ROOF.apex);
    const cx = roofCenter(k);
    const hw = roofHalf(k);
    const x0 = Math.round(cx - hw);
    const x1 = Math.round(cx + hw);
    for (let x = x0; x <= x1; x++) {
      const edge = x === x0 || x === x1 || y === ROOF.eave;
      px(t, x, y, edge ? C.night : shingle(x, y, k, cx, hw));
    }
  }
  // The crown leans right, then the tip curls back left, clear of the smoke.
  const tx = roofCenter(0);
  const ty = ROOF.apex;
  const tip = [tx, ty + 3, tx + 1, ty - 3, tx - 2, ty - 8, tx - 7, ty - 10, tx - 11, ty - 8, tx - 12, ty - 4];
  const radius = [2.7, 2.4, 2.0, 1.6, 1.1, 0.6];
  for (const [c, grow] of [[C.night, 1], [C.navy, 0], [C.indigo, -0.6]] as const) {
    for (let i = 0; i + 3 < tip.length; i += 2) {
      const r0 = Math.max(0.3, radius[i >> 1] + grow);
      const r1 = Math.max(0.3, radius[(i >> 1) + 1] + grow);
      stroke(t, tip[i] - (grow < 0 ? 0.6 : 0), tip[i + 1] - (grow < 0 ? 0.6 : 0), tip[i + 2], tip[i + 3], r0, r1, c);
    }
  }
  hline(t, ROOF.cx - BRIM_HALF + 1, ROOF.cx + BRIM_HALF - 1, ROOF.eave + 1, C.wood0);
  hline(t, ROOF.cx - BRIM_HALF + 4, ROOF.cx + BRIM_HALF - 4, ROOF.eave + 2, C.night);
}

function bakeChimney(t: Target): void {
  const { x, top, w, base } = CHIMNEY;
  for (let y = top; y <= base; y++) {
    const shift = Math.floor((base - y) / 10);
    const row = Math.floor((y - top) / 3);
    for (let i = 0; i < w; i++) {
      const mortar = (y - top) % 3 === 2 || (i + (row % 2) * 2) % 4 === 0;
      const c = mortar ? C.soil1 : hashUnit(611, row, i >> 2) < 0.5 ? C.stone0 : C.stone1;
      px(t, x + i + shift, y, i === 0 ? C.soil0 : i === w - 1 && !mortar ? C.stone2 : c);
    }
  }
  const capShift = Math.floor((base - top) / 10);
  hline(t, x - 1 + capShift, x + w + capShift, top - 1, C.stone2);
  hline(t, x - 1 + capShift, x + w + capShift, top, C.stone0);
  rect(t, x + 2 + capShift, top - 3, 3, 2, C.stone0);
  hline(t, x + 2 + capShift, x + 4 + capShift, top - 4, C.soil0);
}

// Limewash weathered by rain: soft blotches, and streaks under the sills.
function plaster(x: number, y: number): number {
  const n = fbm2(x / 8, y / 6, 621, 3);
  const streak = fbm2(x / 1.6, y / 16, 623, 2);
  if (streak > 0.7 && bayer(x, y) < 0.75) return C.navy;
  if (n > 0.6 && bayer(x, y) < (n - 0.6) * 4) return C.slate;
  if (n < 0.34 && bayer(x, y) < (0.34 - n) * 4) return C.navy;
  return C.indigo;
}

function bakeTimberWall(t: Target, x0: number, x1: number, y0: number, y1: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px(t, x, y, plaster(x, y));
  const posts = [x0, x0 + 1, Math.round((x0 + x1) / 2), x1 - 1, x1];
  for (const x of posts) vline(t, x, y0, y1, C.wood0);
  hline(t, x0, x1, y0, C.wood0);
  hline(t, x0, x1, y0 + 1, C.wood1);
  hline(t, x0, x1, y1, C.wood0);
}

function brace(t: Target, x0: number, y0: number, x1: number, y1: number): void {
  line(t, x0, y0, x1, y1, C.wood0);
  line(t, x0 + 1, y0, x1 + 1, y1, C.wood1);
}

function bakeWindow(t: Target, w: Window, curtain: boolean): void {
  const { x, y } = w;
  rect(t, x - 1, y - 1, w.w + 2, w.h + 2, C.wood0);
  for (let j = 0; j < w.h; j++) {
    for (let i = 0; i < w.w; i++) {
      const k = (i + j * 0.6) / (w.w + w.h * 0.6);
      let c = k < 0.35 ? C.glow4 : k < 0.7 ? C.glow3 : C.glow2;
      if (j >= w.h - 2) c = C.glow2;
      if (curtain && i < 3) c = (j + i) % 4 === 0 ? C.glow0 : C.glow1;
      px(t, x + i, y + j, c);
    }
  }
  const mx = x + Math.floor(w.w / 2);
  const my = y + Math.floor(w.h / 2);
  vline(t, mx, y, y + w.h - 1, C.wood0);
  hline(t, x, x + w.w - 1, my, C.wood0);
  hline(t, x - 2, x + w.w + 1, y + w.h + 1, C.stone1);
  hline(t, x - 1, x + w.w, y + w.h + 2, C.soil1);
}

// Hanging from its top hinge only, so it has swung a little crooked.
function bakeShutter(t: Target, w: Window): void {
  const x = w.x + w.w + 2;
  const sw = 6;
  const sh = w.h + 1;
  for (let j = 0; j < sh; j++) {
    const skew = Math.floor(j / 5);
    for (let i = 0; i < sw; i++) {
      const rail = j === 1 || j === sh - 2;
      const diagonal = Math.abs(i - Math.round(((sh - 2 - j) / (sh - 3)) * (sw - 1))) < 1 && j > 1 && j < sh - 2;
      const frame = i === 0 || i === sw - 1 || j === 0 || j === sh - 1;
      const c = frame ? C.wood0 : rail || diagonal ? C.wood1 : i % 2 === 0 ? C.wood2 : C.lit0;
      px(t, x + i + skew, w.y + j, c);
    }
  }
  px(t, x - 1, w.y + 1, C.stone1);
}

function bakeDoor(t: Target): void {
  const { x, y, w, h } = DOOR;
  rect(t, x - 2, y - 2, w + 4, h + 2, C.wood0);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = i / w;
      px(t, x + i, y + j, k < 0.25 ? C.glow4 : k < 0.55 ? C.glow3 : C.glow2);
    }
  }
  // The door swung inward, seen edge-on against the lit room.
  for (let j = 0; j < h; j++) {
    for (let i = w - 5; i < w; i++) px(t, x + i, y + j, i === w - 5 ? C.wood0 : (i + j) % 7 === 0 ? C.wood0 : C.wood1);
  }
  px(t, x + w - 4, y + 15, C.stone2);
  stamp(t, KEEPER, x + 3, y + h - 13, { k: C.glow0, d: C.glow1 });
  hline(t, x - 3, x + w + 2, y + h, C.stone1);
}

// Furniture glimpsed through the door: a chair back and the hearth glow.
const KEEPER = [
  'k.....',
  'k.....',
  'kkkk..',
  'kddk..',
  'k..k..',
  'k..k..',
  'kkkkk.',
  'k...k.',
  'k...k.',
  'k...k.',
  'k...k.',
  'k...k.',
  'k...k.',
];

function bakeLantern(t: Target): void {
  const { x, y } = WALL_LANTERN;
  hline(t, x - 2, x, y - 3, C.wood0);
  vline(t, x + 1, y - 4, y - 2, C.wood0);
  stamp(t, WALL_LAMP, x - 1, y - 2, { f: C.night, g: C.glow4, h: C.glow3, c: C.wood0 });
}

const WALL_LAMP = [
  '.ccc.',
  'fffff',
  'fghgf',
  'fgggf',
  'fhghf',
  'fffff',
  '.f.f.',
];

function bakeBroom(t: Target): void {
  line(t, 214, 158, 218, 176, C.wood2);
  line(t, 215, 158, 219, 176, C.wood1);
  for (let j = 0; j < 7; j++) {
    const y = 175 + j;
    const spread = Math.floor(j / 2) + 1;
    for (let i = -spread; i <= spread; i++) px(t, 219 + i + (j > 4 ? 1 : 0), y, (i + j) % 2 === 0 ? C.rust0 : C.wood2);
  }
  hline(t, 217, 221, 176, C.wood0);
}

function bakeFoundation(t: Target): void {
  for (let y = 177; y <= BASE; y++) {
    for (let x = WALL.x0 - 2; x <= WALL.x1 + 2; x++) {
      const row = y - 177;
      const mortar = (x + (row % 2) * 3) % 6 === 0 || row === 2;
      px(t, x, y, mortar ? C.soil1 : hashUnit(631, x >> 2, row) < 0.5 ? C.stone0 : C.stone1);
    }
  }
}

function bakeUpright(t: Target): void {
  t.pen = MAT.prop;
  bakeTimberWall(t, WALL.x0, WALL.x1, WALL.top, 177);
  brace(t, WALL.x0 + 2, 170, WALL.x0 + 4, 151);
  brace(t, 244, 176, 246, 150);
  bakeTimberWall(t, UPPER.x0, UPPER.x1, UPPER.top, UPPER.bottom);
  hline(t, UPPER.x0 - 1, UPPER.x1 + 1, UPPER.bottom, C.wood0);
  hline(t, UPPER.x0 - 1, UPPER.x1 + 1, UPPER.bottom + 1, C.wood1);
  for (let x = UPPER.x0 + 3; x < UPPER.x1; x += 9) {
    px(t, x, UPPER.bottom + 2, C.wood0);
    px(t, x, UPPER.bottom + 3, C.night);
  }
  line(t, 218, 116, 244, 142, C.wood0);
  line(t, 244, 116, 218, 142, C.wood0);
  line(t, 219, 116, 245, 142, C.wood1);
  WINDOWS.forEach((w, i) => bakeWindow(t, w, i === 1));
  bakeShutter(t, WINDOWS[2]);
  bakeDoor(t);
  bakeLantern(t);
  bakeFoundation(t);
  bakeChimney(t);
  bakeRoof(t);
  disc(t, ATTIC.x, ATTIC.y, ATTIC.r + 1, C.wood0);
  disc(t, ATTIC.x, ATTIC.y, ATTIC.r - 0.4, C.glow2);
  disc(t, ATTIC.x - 1, ATTIC.y - 1, ATTIC.r - 2, C.glow3);
  hline(t, ATTIC.x - ATTIC.r, ATTIC.x + ATTIC.r, ATTIC.y, C.wood0);
  vline(t, ATTIC.x, ATTIC.y - ATTIC.r, ATTIC.y + ATTIC.r, C.wood0);
}

export function bakeCottage(t: Target): void {
  const upright = createTarget(WIDTH, HEIGHT);
  bakeUpright(upright);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = y * WIDTH + x;
      const c = upright.data[i];
      if (c === C.clear) continue;
      t.pen = upright.mat[i] as typeof t.pen;
      px(t, leanX(x, y), y, c);
    }
  }
  t.pen = MAT.prop;
  bakeBroom(t);
}

// A pointed hat and shoulders, backlit, crossing an upper window once a loop.
const WITCH = [
  '.....x....',
  '....xx....',
  '....xxx...',
  '...xxxx...',
  '...xxxx...',
  '..xxxxxx..',
  'xxxxxxxxxx',
  '...xxxx...',
  '...xxxx...',
  '..xxxxxx..',
  '.xxxxxxxx.',
  'xxxxxxxxxx',
  'xxxxxxxxxx',
  'xxxxxxxxxx',
];

export const SILHOUETTE = { window: 3, start: 63, duration: 7.5 };

function isGlass(c: number): boolean {
  return c >= C.glow0 && c <= C.glow5;
}

export function silhouetteLayer(): Draw {
  const w = WINDOWS[SILHOUETTE.window];
  const wx = leanX(w.x, w.y + w.h / 2);
  const span = w.w + WITCH[0].length + 4;
  return (f: Frame) => {
    const k = envelope(f.u, SILHOUETTE.start, SILHOUETTE.duration, 0.001);
    if (k === 0) return;
    const p = smoothstep(0, 1, (f.u - SILHOUETTE.start) / SILHOUETTE.duration);
    const sx = Math.round(wx - WITCH[0].length - 2 + p * span);
    const bob = Math.round(Math.sin(p * Math.PI * 6) * 0.6);
    const sy = w.y + w.h - WITCH.length + 2 + bob;
    const data = f.target.data;
    for (let j = 0; j < WITCH.length; j++) {
      const row = WITCH[j];
      for (let i = 0; i < row.length; i++) {
        if (row.charCodeAt(i) !== 120) continue;
        const x = sx + i;
        const y = sy + j;
        if (x < 0 || x >= WIDTH || y < w.y || y >= w.y + w.h) continue;
        const p2 = y * WIDTH + x;
        if (isGlass(data[p2])) data[p2] = bayer(x, y) < 0.85 ? C.ember1 : C.ember2;
      }
    }
  };
}
