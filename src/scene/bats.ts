import type { Draw, Frame } from '../frame.ts';
import { wave } from '../loop.ts';
import { C } from '../palette.ts';
import { stamp, type PixelMap } from '../raster.ts';

interface Bat {
  readonly x: number;
  readonly y: number;
  readonly ax: number;
  readonly ay: number;
  // Whole cycles per loop keep each Lissajous path closed.
  readonly cx: number;
  readonly cy: number;
  readonly phase: number;
  readonly flap: number;
}

export const BATS: readonly Bat[] = [
  { x: 330, y: 92, ax: 70, ay: 16, cx: 2, cy: 5, phase: 0.4, flap: 540 },
  { x: 150, y: 70, ax: 55, ay: 12, cx: 3, cy: 7, phase: 2.1, flap: 600 },
];

const UP: PixelMap = ['x.....x', '.xx.xx.', '..xxx..'];
const DOWN: PixelMap = ['..xxx..', '.xx.xx.', 'x.....x'];
const KEY = { x: C.ink };

export function batLayer(): Draw {
  return (f: Frame) => {
    for (let i = 0; i < BATS.length; i++) {
      const b = BATS[i];
      const x = Math.round(b.x + b.ax * wave(f.u, b.cx, b.phase));
      const y = Math.round(b.y + b.ay * wave(f.u, b.cy, b.phase * 1.7));
      stamp(f.target, wave(f.u, b.flap, i) > 0 ? UP : DOWN, x - 3, y - 1, KEY);
    }
  };
}
