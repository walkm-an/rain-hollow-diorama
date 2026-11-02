import { HEIGHT, LOOP_SECONDS, WIDTH } from '../contract.ts';
import type { Draw, Frame } from '../frame.ts';
import { hashUnit } from '../loop.ts';
import { fbm1 } from '../noise.ts';
import { C } from '../palette.ts';
import { bayer, MAT, px, type Target } from '../raster.ts';

const SKY = [C.sky0, C.sky1, C.sky2, C.sky3, C.sky4, C.sky5, C.sky6, C.sky7];

// Shade stops down the sky, in steps of the SKY ramp.
const GRADIENT: readonly (readonly [y: number, shade: number])[] = [
  [0, 1.0],
  [70, 1.9],
  [140, 2.8],
  [185, 3.6],
  [230, 4.1],
  [HEIGHT, 3.6],
];

// A faint, diffuse brightening somewhere inside the overcast, not a moon.
const GLOW = { x: 300, y: 18, rx: 230, ry: 95, lift: 1.1 };

function glowAt(x: number, y: number): number {
  const nx = (x - GLOW.x) / GLOW.rx;
  const ny = (y - GLOW.y) / GLOW.ry;
  const d = 1 - Math.sqrt(nx * nx + ny * ny);
  return d > 0 ? GLOW.lift * d * d : 0;
}

function gradientAt(y: number): number {
  for (let i = 1; i < GRADIENT.length; i++) {
    const [y1, s1] = GRADIENT[i];
    if (y <= y1) {
      const [y0, s0] = GRADIENT[i - 1];
      return s0 + ((s1 - s0) * (y - y0)) / (y1 - y0);
    }
  }
  return GRADIENT[GRADIENT.length - 1][1];
}

function shadeToColor(x: number, y: number, s: number): number {
  const base = Math.floor(s);
  const step = bayer(x, y) < s - base ? 1 : 0;
  return SKY[Math.min(SKY.length - 1, base + step)];
}

export function bakeSky(t: Target): void {
  t.pen = MAT.air;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) px(t, x, y, shadeToColor(x, y, gradientAt(y) + glowAt(x, y) * 0.8));
  }
}

interface CloudSpec {
  readonly seed: number;
  // Strip width; the strip scrolls exactly `wraps` widths per loop.
  readonly width: number;
  readonly wraps: number;
  // Fraction of a pixel, so layers do not all step on the same frame.
  readonly phase: number;
  readonly top: number;
  readonly height: number;
  readonly banks: number;
  readonly thickness: readonly [number, number];
  readonly length: readonly [number, number];
  // Palette index per tone, tone 0 is empty.
  readonly tones: readonly number[];
}

export const CLOUD_LAYERS: readonly CloudSpec[] = [
  {
    seed: 11,
    width: 480,
    wraps: 1,
    phase: 0.25,
    top: 4,
    height: 70,
    banks: 7,
    thickness: [9, 18],
    length: [90, 170],
    tones: [C.clear, C.sky2, C.sky3, C.sky4, C.sky5, C.sky6],
  },
  {
    seed: 29,
    width: 720,
    wraps: 1,
    phase: 0.75,
    top: 34,
    height: 96,
    banks: 8,
    thickness: [12, 24],
    length: [110, 220],
    tones: [C.clear, C.sky1, C.sky2, C.sky3, C.sky4, C.sky5],
  },
];

// Cloud banks are painted back to front as unions of cumulus lobes, so each
// bank's bright rim reads against the bank behind it. Values are tones.
function bakeCloudStrip(spec: CloudSpec): Uint8Array {
  const { width: w, height: h, seed } = spec;
  const strip = new Uint8Array(w * h);
  const top = new Float32Array(w);
  const bottom = new Float32Array(w);
  for (let b = 0; b < spec.banks; b++) {
    const r = (k: number) => hashUnit(seed, b, k);
    const cx = ((b + r(0) * 0.6) / spec.banks) * w;
    const len = spec.length[0] + r(1) * (spec.length[1] - spec.length[0]);
    const thick = spec.thickness[0] + r(2) * (spec.thickness[1] - spec.thickness[0]);
    const base = h * (0.35 + 0.55 * r(3));
    top.fill(Infinity);
    bottom.fill(-Infinity);
    const lobes = 4 + Math.floor(r(4) * 5);
    for (let l = 0; l < lobes; l++) {
      const lr = len * (0.12 + 0.16 * r(10 + l));
      const lx = cx - len / 2 + lr + (len - 2 * lr) * r(20 + l);
      const lh = thick * (0.45 + 0.55 * r(30 + l)) * (1 - 0.6 * Math.abs(lx - cx) / len);
      for (let dx = -Math.ceil(lr); dx <= Math.ceil(lr); dx++) {
        const k = 1 - (dx / lr) ** 2;
        if (k <= 0) continue;
        const col = ((Math.round(lx) + dx) % w + w) % w;
        const y = base - lh * Math.sqrt(k);
        top[col] = Math.min(top[col], y);
        const under = base + 2 + thick * 0.18 * k + fbm1((lx + dx) / 9, seed + b, 2) * 3;
        bottom[col] = Math.max(bottom[col], under);
      }
    }
    for (let col = 0; col < w; col++) {
      if (top[col] === Infinity) continue;
      const y0 = Math.max(0, Math.round(top[col]));
      const y1 = Math.min(h - 1, Math.round(bottom[col]));
      for (let y = y0; y <= y1; y++) {
        const d = y - top[col];
        const fromBottom = bottom[col] - y;
        let tone = d < 1.2 ? 4 : d < 3.5 ? 3 : 2;
        if (fromBottom < 2.5) tone = 1;
        else if (tone === 2 && fromBottom < 5 && bayer(col, y) < 0.5) tone = 1;
        else if (tone === 3 && d > 2.2 && bayer(col, y) < 0.5) tone = 2;
        strip[y * w + col] = tone;
      }
    }
  }
  return strip;
}

export function cloudLayer(spec: CloudSpec): Draw {
  const strip = bakeCloudStrip(spec);
  const { width: w, height: h, top, tones } = spec;
  const maxTone = tones.length - 1;
  const lift = new Uint8Array(WIDTH * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < WIDTH; x++) lift[y * WIDTH + x] = bayer(x, y + top) < glowAt(x, y + top) ? 1 : 0;
  }
  const toneColor = Uint8Array.from(tones);
  return (f: Frame) => {
    const data = f.target.data;
    const offset = Math.floor((f.u / LOOP_SECONDS) * w * spec.wraps + spec.phase) % w;
    for (let y = 0; y < h; y++) {
      const sy = top + y;
      if (sy < 0 || sy >= HEIGHT) continue;
      const row = y * w;
      let col = (w - offset) % w;
      for (let x = 0; x < WIDTH; x++) {
        const tone = strip[row + col];
        if (tone !== 0) {
          const lifted = tone + lift[y * WIDTH + x];
          data[sy * WIDTH + x] = toneColor[lifted > maxTone ? maxTone : lifted];
        }
        if (++col === w) col = 0;
      }
    }
  };
}
