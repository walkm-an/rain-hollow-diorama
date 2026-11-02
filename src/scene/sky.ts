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
    banks: 8,
    thickness: [12, 22],
    length: [110, 190],
    tones: [C.clear, C.sky2, C.sky3, C.sky4, C.sky5, C.sky6],
  },
  {
    seed: 29,
    width: 720,
    wraps: 1,
    phase: 0.75,
    top: 34,
    height: 96,
    banks: 9,
    thickness: [14, 28],
    length: [130, 240],
    tones: [C.clear, C.sky1, C.sky2, C.sky3, C.sky4, C.sky5],
  },
];

interface Lobe {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

const span = (range: readonly [number, number], k: number) => range[0] + k * (range[1] - range[0]);

// Each bank is a row of cumulus lobes sitting on a flat, ragged base. Lobes
// are painted top-down so a lower lobe's lit crown cuts across the shaded
// belly of the one above it, which is what draws the billow contours.
function bankLobes(spec: CloudSpec, b: number, cx: number, base: number): Lobe[] {
  const r = (k: number) => hashUnit(spec.seed, b, k);
  const len = span(spec.length, r(1));
  const thick = span(spec.thickness, r(2));
  const lobes: Lobe[] = [];
  const n = 7 + Math.floor(r(4) * 6);
  for (let l = 0; l < n; l++) {
    const along = (l + 0.5 + (r(20 + l) - 0.5) * 0.7) / n;
    const taper = 1 - Math.abs(along - 0.5) * 1.3;
    const rad = thick * (0.45 + 0.45 * r(10 + l)) * (0.45 + 0.55 * taper);
    lobes.push({ x: cx - len / 2 + len * along, y: base - rad * (0.2 + 0.4 * r(30 + l)), r: rad });
  }
  const crowns = 1 + Math.floor(r(5) * 3);
  for (let l = 0; l < crowns; l++) {
    const rad = thick * (0.35 + 0.25 * r(40 + l));
    const x = cx + (r(50 + l) - 0.5) * len * 0.45;
    lobes.push({ x, y: base - thick * (0.55 + 0.3 * r(60 + l)), r: rad });
  }
  return lobes.sort((a, z) => a.y - z.y);
}

function bakeCloudStrip(spec: CloudSpec): Uint8Array {
  const { width: w, height: h, seed } = spec;
  const strip = new Uint8Array(w * h);
  const put = (x: number, y: number, tone: number) => {
    if (y >= 0 && y < h) strip[y * w + (((x % w) + w) % w)] = tone;
  };
  for (let b = 0; b < spec.banks; b++) {
    const cx = ((b + hashUnit(seed, b, 0) * 0.6) / spec.banks) * w;
    const base = h * (0.4 + 0.5 * hashUnit(seed, b, 3));
    const thick = span(spec.thickness, hashUnit(seed, b, 2));
    const under = (x: number) => base + 1 + fbm1(x / 6, seed + b, 3) * 2.5;
    let left = Infinity;
    let right = -Infinity;
    for (const lobe of bankLobes(spec, b, cx, base)) {
      const ry = lobe.r * 0.66;
      left = Math.min(left, lobe.x - lobe.r);
      right = Math.max(right, lobe.x + lobe.r);
      for (let y = Math.floor(lobe.y - ry); y <= Math.ceil(lobe.y + ry); y++) {
        for (let x = Math.floor(lobe.x - lobe.r); x <= Math.ceil(lobe.x + lobe.r); x++) {
          const nx = (x - lobe.x) / lobe.r;
          const ny = (y - lobe.y) / ry;
          const d2 = nx * nx + ny * ny;
          const floor = under(x);
          if (d2 > 1 || y > floor) continue;
          const height = Math.min(1, (floor - y) / thick);
          let s = 0.12 + 0.55 * height - 0.06 * nx;
          if (ny < -0.15) s += 0.12;
          if (d2 > 0.62 && ny < -0.3) s += 0.3;
          if (floor - y < 1.5) s = 0;
          const tone = 1 + Math.floor(s * 3.1 + (bayer(x, y) - 0.5) * 0.45);
          put(x, y, tone < 1 ? 1 : tone > 4 ? 4 : tone);
        }
      }
    }
    // Rain hanging under the base, sparse and fading with depth.
    for (let x = Math.ceil(left) + 4; x < right - 4; x++) {
      const fall = Math.max(0, fbm1(x / 11, seed + 90 + b, 2) - 0.45) / 0.55;
      const reach = Math.floor(fall * 16);
      const y0 = Math.ceil(under(x)) + 1;
      for (let d = 0; d < reach; d++) {
        if (bayer(x, y0 + d) < 0.55 * (1 - d / reach)) put(x, y0 + d, 1);
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
