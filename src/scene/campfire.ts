import { HEIGHT, LOOP_SECONDS, WIDTH } from '../contract.ts';
import type { Draw, Frame } from '../frame.ts';
import { hashUnit, loopNoise } from '../loop.ts';
import { fbm2 } from '../noise.ts';
import { C, FIRE_RAMP } from '../palette.ts';
import { bayer, createTarget, ellipse, hline, line, MAT, px, type Target } from '../raster.ts';
import { groundAt } from './slab.ts';

export const FIRE = { x: 364, y: groundAt(364, 0.6) };
export const CAULDRON = { x: FIRE.x, y: FIRE.y - 16, rx: 9, ry: 6 };
const APEX = { x: FIRE.x + 1, y: FIRE.y - 44 };

function bakeStonesRing(t: Target, front: boolean): void {
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const sy = Math.sin(a);
    if (front !== sy > 0) continue;
    const x = FIRE.x + Math.cos(a) * 10;
    const y = FIRE.y + sy * 2.2;
    ellipse(t, x, y, 2.2, 1.6, C.stone0);
    px(t, x - 1, y - 1, C.stone2);
    px(t, x, y - 1, C.stone1);
  }
}

export function bakeCampfire(t: Target): void {
  t.pen = MAT.prop;
  const legs = [
    [FIRE.x - 15, FIRE.y + 2],
    [FIRE.x + 16, FIRE.y + 1],
    [FIRE.x + 5, FIRE.y - 3],
  ];
  for (const [x, y] of legs) {
    const ex = APEX.x + (APEX.x - x) * 0.09;
    const ey = APEX.y - 3;
    line(t, x, y, ex, ey, C.wood0);
    line(t, x + 1, y, ex + 1, ey, C.wood1);
  }
  hline(t, APEX.x - 1, APEX.x + 2, APEX.y, C.wood0);
  t.pen = MAT.ground;
  ellipse(t, FIRE.x, FIRE.y, 9, 2.4, C.soil0);
  for (let i = 0; i < 9; i++) px(t, FIRE.x - 6 + hashUnit(901, i) * 12, FIRE.y - 1 + hashUnit(903, i) * 2.5, C.glow0);
  t.pen = MAT.prop;
  bakeStonesRing(t, false);
  line(t, FIRE.x - 7, FIRE.y + 1, FIRE.x + 6, FIRE.y - 2, C.wood0);
  line(t, FIRE.x - 7, FIRE.y, FIRE.x + 6, FIRE.y - 3, C.wood2);
  line(t, FIRE.x + 7, FIRE.y + 1, FIRE.x - 5, FIRE.y - 2, C.wood1);
  line(t, FIRE.x + 7, FIRE.y, FIRE.x - 5, FIRE.y - 3, C.wood2);
}

function bakeCauldron(t: Target): void {
  const { x, y, rx, ry } = CAULDRON;
  line(t, APEX.x, APEX.y + 1, x, y - ry - 3, C.deep);
  for (let j = y - ry - 3; j < y - ry; j += 2) px(t, x, j, C.slate);
  line(t, x - rx + 1, y - ry, x, y - ry - 3, C.navy);
  line(t, x + rx - 1, y - ry, x, y - ry - 3, C.navy);
  ellipse(t, x, y, rx, ry, C.ink);
  ellipse(t, x - 2, y - 1, rx - 3, ry - 2.5, C.night);
  px(t, x - 5, y - 2, C.slate);
  px(t, x - 5, y - 1, C.navy);
  hline(t, x - rx - 1, x + rx + 1, y - ry + 1, C.night);
  hline(t, x - rx, x + rx, y - ry + 1, C.indigo);
  hline(t, x - rx + 1, x + rx - 1, y - ry, C.ink);
  hline(t, x - rx + 2, x + rx - 2, y - ry, C.moss1);
  hline(t, x - rx + 3, x + rx - 4, y - ry, C.moss2);
  px(t, x - 3, y + ry, C.ink);
  px(t, x + 3, y + ry, C.ink);
}

function bakeFront(t: Target): void {
  t.pen = MAT.prop;
  bakeStonesRing(t, true);
}

// The flame body: a heat field that scrolls upward through a tiling noise
// texture, a whole number of tile heights per loop.
const FLAME = { w: 16, h: 17, tile: 32, wraps: 120 };

export function campfireLayer(): Draw {
  const tile = new Float32Array(FLAME.w * FLAME.tile);
  for (let y = 0; y < FLAME.tile; y++) {
    for (let x = 0; x < FLAME.w; x++) tile[y * FLAME.w + x] = fbm2(x / 4, y / 5, 921, 2, 0, FLAME.tile / 5);
  }
  const profile = new Float32Array(FLAME.w);
  for (let x = 0; x < FLAME.w; x++) {
    const d = (x + 0.5 - FLAME.w / 2) / (FLAME.w / 2);
    profile[x] = Math.max(0, 1 - d * d * 1.15);
  }
  const front = createTarget(WIDTH, HEIGHT);
  bakeFront(front);
  const cauldron = createTarget(WIDTH, HEIGHT);
  bakeCauldron(cauldron);
  const sprites = [front.data, cauldron.data];
  const y0 = Math.max(0, APEX.y - 2);
  const y1 = Math.min(HEIGHT, FIRE.y + 6);
  const x0 = FIRE.x - 22;
  const x1 = FIRE.x + 22;

  return (f: Frame) => {
    const data = f.target.data;
    const scroll = Math.floor((f.u / LOOP_SECONDS) * FLAME.tile * FLAME.wraps) % FLAME.tile;
    const sway = loopNoise(f.u, 96, 931) * 1.4;
    const lift = 0.85 + 0.15 * loopNoise(f.u, 360, 933);
    const left = FIRE.x - FLAME.w / 2;
    for (let j = 0; j < FLAME.h; j++) {
      const y = FIRE.y - 1 - j;
      const k = j / FLAME.h;
      const ty = ((j + scroll) % FLAME.tile) * FLAME.w;
      const shift = Math.round(sway * k * k * 2);
      for (let i = 0; i < FLAME.w; i++) {
        const heat = profile[i] * lift * (1.15 - k * 1.25) + (tile[ty + i] - 0.5) * 0.9 * (0.4 + k);
        if (heat < 0.18) continue;
        const level = Math.min(FIRE_RAMP.length - 1, Math.floor((heat - 0.18) * 9 + bayer(i, j) * 0.6) + 2);
        data[y * WIDTH + left + i + shift] = FIRE_RAMP[level];
      }
    }
    for (let s = 0; s < sprites.length; s++) {
      const src = sprites[s];
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const v = src[y * WIDTH + x];
          if (v !== C.clear) data[y * WIDTH + x] = v;
        }
      }
    }
  };
}
