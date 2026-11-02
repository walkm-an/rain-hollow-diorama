import type { Draw, Frame } from '../frame.ts';
import { since, wave } from '../loop.ts';
import { C } from '../palette.ts';
import { ellipse, hline, MAT, px, stamp, vline, type PixelMap, type Target } from '../raster.ts';
import { groundAt } from './slab.ts';

export const STUMP = { x: 396, y: groundAt(396, 0.5), w: 13, h: 8 };
const CAT = { x: STUMP.x - 5, y: STUMP.y - STUMP.h - 12 };

export function bakeStump(t: Target): void {
  t.pen = MAT.prop;
  const { x, y, w, h } = STUMP;
  const left = x - Math.floor(w / 2);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const c = i === 0 || i === w - 1 ? C.wood0 : i % 3 === 1 ? C.wood0 : C.wood1;
      px(t, left + i, y - h + j, c);
    }
  }
  px(t, left - 1, y - 1, C.wood0);
  px(t, left - 2, y, C.wood0);
  px(t, left + w, y - 1, C.wood0);
  px(t, left + w + 1, y, C.wood0);
  ellipse(t, x - 0.5, y - h, w / 2, 1.6, C.wood2);
  hline(t, left + 3, left + w - 4, y - h, C.lit0);
  vline(t, left + 2, y - h + 3, y - h + 5, C.moss1);
}

const SITTING: PixelMap = [
  '.k..k.....',
  '.kkkk.....',
  'kEkkkr....',
  'kkkkkr....',
  '.kkkr.....',
  '.kkkkr....',
  'kkkkkkr...',
  'kkkkkkkr..',
  'kkkkkkkkr.',
  'kkkkkkkkr.',
  'kkkkkkkkk.',
  '.kk.kkkkk.',
];

const BLINKS = [11.0, 33.5, 34.0, 58.2, 81.0, 99.6, 117.0];

export function catLayer(): Draw {
  const open = { k: C.ink, r: C.deep, E: C.fire2 };
  const shut = { k: C.ink, r: C.deep, E: C.night };
  return (f: Frame) => {
    let blink = false;
    for (let i = 0; i < BLINKS.length; i++) {
      const d = since(f.u, BLINKS[i]);
      if (d >= 0 && d < 0.16) blink = true;
    }
    stamp(f.target, SITTING, CAT.x, CAT.y, blink ? shut : open);
    // The tail hangs over the back of the stump and sways slowly.
    let x = CAT.x + 8.5;
    let y = CAT.y + 10.5;
    let a = 0.9 + 0.22 * wave(f.u, 15, 0.4);
    for (let s = 0; s < 11; s++) {
      x += Math.cos(a);
      y += Math.sin(a) * 0.9;
      px(f.target, x, y, C.ink);
      a += 0.1 + 0.07 * wave(f.u, 15, s * 0.35);
    }
  };
}
