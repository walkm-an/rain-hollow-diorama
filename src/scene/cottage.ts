import { HEIGHT, WIDTH } from '../contract.ts';
import type { Draw, Frame } from '../frame.ts';
import { envelope, hashUnit, smoothstep } from '../loop.ts';
import { C } from '../palette.ts';
import { bayer, createTarget, disc, hline, line, MAT, px, rect, stamp, vline, type Target } from '../raster.ts';

// Drawn upright, then sheared: each row shifts right by LEAN px per px of
// height above the sill, so the whole house leans like it is tired.
const BASE = 181;
const LEAN = 0.05;

export function leanX(x: number, y: number): number {
  return x + Math.round((BASE - y) * LEAN);
}

const WALL = { x0: 194, x1: 268, top: 146 };
const UPPER = { x0: 190, x1: 272, top: 113, bottom: 145 };
const ROOF = { cx: 231, apex: 30, eave: 113, half: 50, bend: 14 };

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
const CHIMNEY = { x: 258, top: 46, w: 8, base: 84 };

export const CHIMNEY_TOP = { x: leanX(CHIMNEY.x + CHIMNEY.w / 2 + 3, CHIMNEY.top), y: CHIMNEY.top - 1 };

// Where roof runoff pours off in thin streams, in world space.
export const EAVE_STREAMS: readonly { x: number; y: number; ground: number }[] = [
  { x: leanX(ROOF.cx - ROOF.half - 1, ROOF.eave), y: ROOF.eave + 1, ground: 179 },
  { x: leanX(ROOF.cx + ROOF.half + 1, ROOF.eave), y: ROOF.eave + 1, ground: 180 },
  { x: leanX(UPPER.x0 - 1, UPPER.bottom), y: UPPER.bottom + 2, ground: 181 },
];

export const EAVE_DRIPS: readonly { x: number; y: number }[] = [-38, -21, -6, 9, 27, 41].map((dx) => ({
  x: leanX(ROOF.cx + dx, ROOF.eave),
  y: ROOF.eave + 2,
}));

function roofHalf(k: number): number {
  return ROOF.half * k ** 1.55 + 1;
}

function roofCenter(k: number): number {
  return ROOF.cx + ROOF.bend * (1 - k) ** 2.4;
}

const PATCHES = [
  { x: 205, y: 96, w: 9, h: 7, kind: 'moss' },
  { x: 244, y: 70, w: 7, h: 6, kind: 'planks' },
  { x: 222, y: 104, w: 10, h: 5, kind: 'moss' },
  { x: 234, y: 52, w: 5, h: 6, kind: 'planks' },
] as const;

function shingle(x: number, y: number, k: number): number {
  const row = Math.floor((y - ROOF.apex) / 3);
  const off = row % 2 === 0 ? 0 : 2;
  const col = Math.floor((x + off) / 5);
  const inRow = (y - ROOF.apex) % 3;
  const h = hashUnit(601, row, col);
  for (const p of PATCHES) {
    if (x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h) {
      if (p.kind === 'planks') return (x - p.x) % 3 === 0 ? C.wood0 : y % 2 === 0 ? C.wood2 : C.wood1;
      return inRow === 2 ? C.moss0 : h < 0.5 ? C.moss1 : C.moss2;
    }
  }
  if (inRow === 2) return C.night;
  if ((x + off) % 5 === 0 && h < 0.7) return C.deep;
  const lit = x > roofCenter(k) ? 1 : 0;
  if (h < 0.12) return C.deep;
  return h < 0.55 - lit * 0.25 ? C.navy : h < 0.93 ? C.indigo : C.slate;
}

function bakeRoof(t: Target): void {
  for (let y = ROOF.apex; y <= ROOF.eave; y++) {
    const k = (y - ROOF.apex) / (ROOF.eave - ROOF.apex);
    const cx = roofCenter(k);
    const hw = roofHalf(k);
    const x0 = Math.round(cx - hw);
    const x1 = Math.round(cx + hw);
    for (let x = x0; x <= x1; x++) {
      const edge = x === x0 || x === x1;
      px(t, x, y, edge ? C.night : shingle(x, y, k));
    }
  }
  // The floppy tip of the hat.
  const tipX = Math.round(roofCenter(0));
  line(t, tipX, ROOF.apex, tipX + 4, ROOF.apex - 3, C.navy);
  line(t, tipX + 4, ROOF.apex - 3, tipX + 9, ROOF.apex - 2, C.navy);
  line(t, tipX + 1, ROOF.apex, tipX + 5, ROOF.apex - 2, C.indigo);
  px(t, tipX + 10, ROOF.apex - 1, C.night);
  hline(t, ROOF.cx - ROOF.half - 2, ROOF.cx + ROOF.half + 2, ROOF.eave, C.wood0);
  hline(t, ROOF.cx - ROOF.half - 1, ROOF.cx + ROOF.half + 1, ROOF.eave + 1, C.night);
}

function bakeChimney(t: Target): void {
  const { x, top, w, base } = CHIMNEY;
  for (let y = top; y <= base; y++) {
    const shift = Math.floor((base - y) / 9);
    const row = Math.floor((y - top) / 3);
    for (let i = 0; i < w; i++) {
      const mortar = (y - top) % 3 === 2 || (i + (row % 2) * 2) % 4 === 0;
      const c = mortar ? C.soil1 : hashUnit(611, row, i >> 2) < 0.5 ? C.stone0 : C.stone1;
      px(t, x + i + shift, y, i === 0 ? C.soil0 : c);
    }
  }
  const capShift = Math.floor((base - top) / 9);
  hline(t, x - 1 + capShift, x + w + capShift, top - 1, C.stone2);
  hline(t, x - 1 + capShift, x + w + capShift, top, C.stone0);
  rect(t, x + 2 + capShift, top - 3, 4, 2, C.stone0);
  hline(t, x + 2 + capShift, x + 5 + capShift, top - 4, C.soil0);
}

function plaster(x: number, y: number): number {
  const n = hashUnit(621, x >> 1, y >> 1);
  return n < 0.08 ? C.navy : n < 0.8 ? C.indigo : C.slate;
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

function bakeShutter(t: Target, w: Window): void {
  const x = w.x + w.w + 2;
  for (let j = 0; j < w.h + 1; j++) {
    const skew = Math.floor(j / 6);
    for (let i = 0; i < 4; i++) px(t, x + i + skew, w.y + j, i === 0 || j % 5 === 0 ? C.wood0 : C.wood1);
  }
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
  bakeRoof(t);
  bakeChimney(t);
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
