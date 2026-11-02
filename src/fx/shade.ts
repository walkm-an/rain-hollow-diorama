import { HEIGHT, WIDTH } from '../contract.ts';
import type { Frame } from '../frame.ts';
import { COLOR_COUNT, SWATCH_LIST, type Response } from '../palette.ts';
import { BAYER } from '../raster.ts';

export const BANDS = 8;
export const FLASH_LEVELS = 4;

type RGB = [number, number, number];

function rgbOf(hex: number): RGB {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

function lerp3(a: RGB, b: RGB, k: number): RGB {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

const WARM_STOPS = [0x3a1410, 0x8c2a14, 0xd35a1a, 0xf08a24, 0xf7b440].map(rgbOf);
const GLOW_STEPS = [0x3a1410, 0x5a1a12, 0x8c2a14, 0xd35a1a, 0xf08a24, 0xf7b440, 0xffd970, 0xfff3c4];

function warmLight(k: number): RGB {
  const x = Math.min(1, Math.max(0, k)) * (WARM_STOPS.length - 1);
  const i = Math.min(WARM_STOPS.length - 2, Math.floor(x));
  return lerp3(WARM_STOPS[i], WARM_STOPS[i + 1], x - i);
}

function luma(c: RGB): number {
  return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
}

// warm: gain on the light band. flash: ramp steps lifted per lightning level.
const RESPONSE: Record<Response, { warm: number; flash: readonly number[] }> = {
  clear: { warm: 0, flash: [0, 0, 0, 0] },
  sky: { warm: 0, flash: [0, 1, 2, 2] },
  matte: { warm: 1, flash: [0, 0, 1, 1] },
  wet: { warm: 1.35, flash: [0, 1, 1, 2] },
  glow: { warm: 0, flash: [0, 0, 0, 0] },
  fixed: { warm: 0, flash: [0, 0, 0, 0] },
};

// Lightning lifts a color along the cold ramp it belongs to, so the flash
// stays inside the palette and never washes toward white.
const FLASH_RAMPS: readonly (readonly number[])[] = [
  [0x05060c, 0x0a0d1c, 0x0f1530, 0x172045, 0x22305c, 0x2e3f6e, 0x3d5585, 0x5873a3, 0x8fb0d9, 0xc4dcf5],
  [0x120f1a, 0x1c1726, 0x2a2233, 0x2b3346, 0x3c4760, 0x56627e, 0x8fb0d9],
  [0x1a2a2e, 0x24403f, 0x33594f, 0x56627e],
  [0x1e1620, 0x2e2129, 0x44303a, 0x56627e],
];

function flashLift(c: RGB, steps: number): RGB {
  if (steps === 0) return c;
  const hex = (c[0] << 16) | (c[1] << 8) | c[2];
  for (const ramp of FLASH_RAMPS) {
    const i = ramp.indexOf(hex);
    if (i >= 0) return rgbOf(ramp[Math.min(ramp.length - 1, i + steps)]);
  }
  return c;
}

// Firelight on a surface pulls it toward the light's color, scaled by how
// much the surface reflects; the hue deepens from ember red at the fringe to
// amber at the core, and only the core gets bright.
function warmLit(base: RGB, k: number): RGB {
  if (k <= 0) return base;
  const albedo = Math.min(1.1, 0.45 + 1.6 * luma(base));
  const l = warmLight(k);
  const a = Math.min(0.92, Math.pow(Math.min(1, k), 0.85) * 0.85);
  return lerp3(base, [l[0] * albedo, l[1] * albedo, l[2] * albedo], a);
}

// Emissive glass and flame step along the warm ramp with their own light, so
// a flickering window visibly breathes. Index by band.
const GLOW_SHIFT = [-3, -3, -2, -2, -1, -1, 0, 1];

function glowLit(hex: number, band: number): RGB {
  const i = GLOW_STEPS.indexOf(hex);
  return rgbOf(GLOW_STEPS[Math.max(0, Math.min(GLOW_STEPS.length - 1, i + GLOW_SHIFT[band]))]);
}

const SNAP = [...new Set(SWATCH_LIST.filter((s) => s.response !== 'clear').map((s) => s.rgb))].map(rgbOf);

// Redmean distance keeps hue shifts perceptually ordered when snapping.
function snap(c: RGB): RGB {
  let best = SNAP[0];
  let bestD = Infinity;
  for (const s of SNAP) {
    const rm = (c[0] + s[0]) / 2;
    const dr = c[0] - s[0];
    const dg = c[1] - s[1];
    const db = c[2] - s[2];
    const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

function pack(c: RGB): number {
  const r = Math.round(Math.min(255, Math.max(0, c[0])));
  const g = Math.round(Math.min(255, Math.max(0, c[1])));
  const b = Math.round(Math.min(255, Math.max(0, c[2])));
  return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
}

// (flash level, light band, palette index) -> 0xAABBGGRR, every entry snapped
// back onto the palette so lighting never invents new colors.
export function buildShadeTable(): Uint32Array {
  const table = new Uint32Array(FLASH_LEVELS * BANDS * COLOR_COUNT);
  for (let f = 0; f < FLASH_LEVELS; f++) {
    for (let band = 0; band < BANDS; band++) {
      for (let i = 0; i < COLOR_COUNT; i++) {
        const sw = SWATCH_LIST[i];
        const r = RESPONSE[sw.response];
        let c = rgbOf(sw.rgb);
        if (sw.response === 'glow') c = glowLit(sw.rgb, band);
        else if (r.warm > 0) c = snap(warmLit(c, (band / (BANDS - 1)) * r.warm));
        c = flashLift(c, r.flash[f]);
        table[(f * BANDS + band) * COLOR_COUNT + i] = pack(c);
      }
    }
  }
  return table;
}

// Quantizes the light field into bands with ordered dithering, so pools of
// light stay pixel-crisp, and resolves every palette index to its final color.
export function shadeFrame(f: Frame, table: Uint32Array, out: Uint32Array): void {
  const data = f.target.data;
  const light = f.light;
  const flashBase = f.flash * BANDS;
  const top = BANDS - 1;
  for (let y = 0; y < HEIGHT; y++) {
    const brow = (y & 3) << 2;
    let p = y * WIDTH;
    for (let x = 0; x < WIDTH; x++, p++) {
      const v = light[p];
      let band = 0;
      if (v > 0) {
        band = (v * top + BAYER[brow | (x & 3)]) | 0;
        if (band > top) band = top;
      }
      out[p] = table[(flashBase + band) * COLOR_COUNT + data[p]];
    }
  }
}
