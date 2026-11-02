import type { Draw, Frame } from '../frame.ts';
import { since } from '../loop.ts';
import { C } from '../palette.ts';
import { hline, MAT, px, stamp, type PixelMap, type Target } from '../raster.ts';
import { groundAt, groundFront } from './slab.ts';

interface Stone {
  readonly x: number;
  readonly depth: number;
  readonly w: number;
  readonly h: number;
  readonly shape: 'round' | 'cross' | 'slab';
  // Horizontal shift per px of height: a gentle settle into soft ground.
  readonly tilt: number;
}

export const STONES: readonly Stone[] = [
  { x: 110, depth: 0.42, w: 11, h: 16, shape: 'round', tilt: -0.08 },
  { x: 131, depth: 0.3, w: 11, h: 21, shape: 'cross', tilt: 0.05 },
  { x: 150, depth: 0.55, w: 10, h: 12, shape: 'slab', tilt: 0.16 },
  { x: 167, depth: 0.25, w: 8, h: 9, shape: 'round', tilt: -0.04 },
];

function inStone(s: Stone, i: number, j: number): boolean {
  const { w, h } = s;
  if (s.shape === 'round') {
    const r = w / 2;
    if (j < r) {
      const dx = i + 0.5 - r;
      const dy = r - j - 0.5;
      return dx * dx + dy * dy <= r * r;
    }
    return true;
  }
  if (s.shape === 'cross') {
    const arm = Math.floor(h * 0.25);
    const stem = Math.floor(w / 2) - 2;
    if (j >= arm && j < arm + 4) return true;
    return i >= stem && i < stem + 4;
  }
  return !(j === 0 && (i === 0 || i === w - 1));
}

function bakeStone(t: Target, s: Stone): void {
  const base = groundAt(s.x, s.depth);
  const left = s.x - Math.floor(s.w / 2);
  for (let j = 0; j < s.h; j++) {
    const shift = Math.round((s.h - j) * s.tilt);
    for (let i = 0; i < s.w; i++) {
      if (!inStone(s, i, j)) continue;
      const up = !inStone(s, i, j - 1) || j === 0;
      const leftEdge = !inStone(s, i - 1, j);
      const rightEdge = !inStone(s, i + 1, j);
      let c = C.stone1;
      if (up) c = C.stone2;
      else if (rightEdge) c = C.stone0;
      else if (leftEdge) c = C.stone1;
      if (j >= s.h - 2 && (i + j) % 3 !== 0) c = C.moss1;
      px(t, left + i + shift, base - s.h + j, c);
    }
  }
  const midShift = Math.round(s.h * 0.5 * s.tilt);
  if (s.shape !== 'cross') {
    hline(t, left + 3 + midShift, left + s.w - 4 + midShift, base - s.h + Math.floor(s.h * 0.45), C.stone0);
    hline(t, left + 3 + midShift, left + s.w - 5 + midShift, base - s.h + Math.floor(s.h * 0.45) + 2, C.stone0);
  }
  if (s.shape === 'slab') {
    px(t, left + 6 + midShift, base - s.h + 3, C.soil1);
    px(t, left + 7 + midShift, base - s.h + 4, C.soil1);
    px(t, left + 7 + midShift, base - s.h + 5, C.soil1);
  }
  hline(t, left - 1, left + s.w, base, C.soil1);
}

// A short wrought-iron fence along the front lip, one bay knocked askew.
function bakeFence(t: Target): void {
  const x0 = 80;
  const x1 = 180;
  for (let x = x0; x <= x1; x += 4) {
    if (x === 124) continue;
    const base = groundFront(x) - 1;
    const lean = x > 150 && x < 168 ? 1 : 0;
    const h = 9;
    for (let j = 0; j < h; j++) px(t, x + (j < 4 ? 0 : lean), base - j, j === h - 1 ? C.slate : C.deep);
    const top = base - h;
    px(t, x + lean, top, C.steel);
    px(t, x - 1 + lean, top + 1, C.deep);
    px(t, x + 1 + lean, top + 1, C.deep);
  }
  for (let x = x0; x <= x1; x++) {
    if (x > 121 && x < 127) continue;
    const base = groundFront(Math.round(x0 + Math.floor((x - x0) / 4) * 4)) - 1;
    const lean = x > 150 && x < 168 ? 1 : 0;
    px(t, x + lean, base - 6, C.deep);
    px(t, x, base - 2, C.deep);
    if ((x - x0) % 4 === 2) px(t, x + lean, base - 5, C.night);
  }
}

export function bakeGraveyard(t: Target): void {
  t.pen = MAT.prop;
  for (const s of STONES) bakeStone(t, s);
  bakeFence(t);
}

// A crow perched on the cross. Poses are keyed by loop time.
const CROW_BODY: PixelMap = [
  '...bbb...',
  '..bbbbb..',
  '.bbbbbbb.',
  'tbbbwbbb.',
  'tt.bbbb..',
  '....l.l..',
];

const CROW_HEAD: Record<string, PixelMap> = {
  side: ['.hh.', 'heh.', 'hhhk'],
  blink: ['.hh.', 'hhh.', 'hhhk'],
  back: ['.hh.', 'hhhh', '.hh.'],
};

interface CrowPose {
  readonly at: number;
  readonly dur: number;
  readonly head: keyof typeof CROW_HEAD;
  readonly flip: boolean;
}

// Default pose: facing the cottage. Events overlay that for a moment.
const CROW_POSES: readonly CrowPose[] = [
  { at: 8.0, dur: 0.15, head: 'blink', flip: false },
  { at: 19.5, dur: 3.2, head: 'side', flip: true },
  { at: 21.2, dur: 0.14, head: 'blink', flip: true },
  { at: 37.0, dur: 0.15, head: 'blink', flip: false },
  { at: 52.0, dur: 1.4, head: 'back', flip: false },
  { at: 66.0, dur: 4.5, head: 'side', flip: true },
  { at: 74.4, dur: 0.15, head: 'blink', flip: false },
  { at: 88.0, dur: 2.2, head: 'side', flip: true },
  { at: 103.0, dur: 0.15, head: 'blink', flip: false },
  { at: 112.5, dur: 0.15, head: 'blink', flip: false },
];

export const CROW = { x: STONES[1].x - 4, y: groundAt(STONES[1].x, STONES[1].depth) - STONES[1].h - 5 };

const CROW_KEY = { b: C.ink, t: C.ink, w: C.navy, l: C.night, h: C.ink, e: C.pale, k: C.stone1 };

export function crowLayer(): Draw {
  const pose = { head: 'side' as keyof typeof CROW_HEAD, flip: false };
  return (f: Frame) => {
    pose.head = 'side';
    pose.flip = false;
    for (let i = 0; i < CROW_POSES.length; i++) {
      const p = CROW_POSES[i];
      const d = since(f.u, p.at);
      if (d >= 0 && d < p.dur) {
        pose.head = p.head;
        pose.flip = p.flip;
      }
    }
    stamp(f.target, CROW_BODY, CROW.x, CROW.y, CROW_KEY);
    stamp(f.target, CROW_HEAD[pose.head], CROW.x + 5, CROW.y - 2, CROW_KEY, pose.flip);
  };
}
