import { hashUnit } from '../loop.ts';
import { C } from '../palette.ts';
import { line, MAT, px, stamp, type PixelMap, type Target } from '../raster.ts';
import { groundAt } from './slab.ts';

const FACES: Record<string, PixelMap> = {
  grin: [
    '..e.....e..',
    '.eee...eee.',
    '.ebe...ebe.',
    '.....b.....',
    'm.mmmmmmm.m',
    '.mmbm.mbmm.',
    '..mmm.mmm..',
  ],
  smile: [
    '.e...e.',
    'eee.eee',
    '.......',
    'mmmmmmm',
    '.m.m.m.',
  ],
  shock: [
    'ee...ee',
    'eb...be',
    '.......',
    '..mmm..',
    '..mbm..',
    '..mmm..',
  ],
  wink: [
    'e....',
    '...ee',
    'mmmmm',
    '.m.m.',
  ],
  tiny: [
    'e.e',
    '...',
    'mmm',
  ],
};

interface Pumpkin {
  readonly x: number;
  readonly depth: number;
  readonly rx: number;
  readonly ry: number;
  readonly face: keyof typeof FACES;
}

export const PUMPKINS: readonly Pumpkin[] = [
  { x: 296, depth: 0.32, rx: 6, ry: 5, face: 'wink' },
  { x: 310, depth: 0.74, rx: 9, ry: 7, face: 'grin' },
  { x: 324, depth: 0.28, rx: 4, ry: 3.5, face: 'tiny' },
  { x: 335, depth: 0.6, rx: 7, ry: 5.5, face: 'shock' },
  { x: 347, depth: 0.85, rx: 5, ry: 4, face: 'smile' },
];

export function pumpkinCenter(p: Pumpkin): { x: number; y: number } {
  return { x: p.x, y: groundAt(p.x, p.depth) - p.ry };
}

function bakeBody(t: Target, p: Pumpkin): void {
  const { x: cx, y: cy } = pumpkinCenter(p);
  const x0 = Math.floor(cx - p.rx);
  const y0 = Math.floor(cy - p.ry);
  for (let y = y0; y <= Math.ceil(cy + p.ry); y++) {
    for (let x = x0; x <= Math.ceil(cx + p.rx); x++) {
      const nx = (x + 0.5 - cx) / p.rx;
      const ny = (y + 0.5 - cy) / p.ry;
      const r = nx * nx + ny * ny;
      if (r > 1) continue;
      const ribs = Math.abs(Math.sin((Math.asin(Math.max(-1, Math.min(1, nx))) / Math.PI) * Math.PI * (p.rx > 6 ? 5 : 3)));
      let c = C.rust1;
      if (ribs < 0.28) c = C.rust0;
      else if (nx < -0.1 && ny < -0.2 && ribs > 0.6) c = C.rust2;
      if (r > 0.82 && ny > 0) c = C.rust0;
      if (r > 0.92) c = C.ember0;
      px(t, x, y, c);
    }
  }
  const sx = Math.round(cx);
  const sy = Math.floor(cy - p.ry);
  px(t, sx, sy, C.moss1);
  px(t, sx, sy - 1, C.moss1);
  px(t, sx + 1, sy - 2, C.moss2);
  const face = FACES[p.face];
  stamp(t, face, Math.round(cx - face[0].length / 2), Math.round(cy - face.length / 2 + 0.5), {
    e: C.glow3,
    m: C.glow2,
    b: C.glow4,
  });
}

function bakeVines(t: Target): void {
  for (let v = 0; v < 7; v++) {
    let x = 288 + hashUnit(801, v) * 64;
    let y = groundAt(Math.round(x), 0.2 + hashUnit(803, v) * 0.7);
    let a = hashUnit(805, v) * Math.PI * 2;
    const n = 10 + Math.floor(hashUnit(807, v) * 14);
    for (let s = 0; s < n; s++) {
      const nx = x + Math.cos(a) * 1.5;
      const ny = y + Math.sin(a) * 0.5;
      line(t, x, y, nx, ny, C.moss1);
      x = nx;
      y = ny;
      a += (hashUnit(809, v, s) - 0.5) * 1.4;
      if (hashUnit(811, v, s) < 0.18) {
        px(t, x, y - 1, C.moss2);
        px(t, x + 1, y - 1, C.moss1);
        px(t, x + 1, y - 2, C.moss2);
      }
    }
    for (let k = 0; k < 6; k++) {
      const ang = k * 1.1;
      px(t, x + Math.cos(ang) * (1 + k * 0.3), y - 1 + Math.sin(ang) * (0.8 + k * 0.2), C.moss1);
    }
  }
}

export function bakePumpkins(t: Target): void {
  t.pen = MAT.prop;
  bakeVines(t);
  const order = [...PUMPKINS].sort((a, b) => a.depth - b.depth);
  for (const p of order) bakeBody(t, p);
}
