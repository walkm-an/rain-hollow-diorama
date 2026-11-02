import { HEIGHT, WIDTH } from '../contract.ts';
import type { Draw, Frame, Scene } from '../frame.ts';
import { hashUnit, since } from '../loop.ts';
import { C, COLOR_COUNT } from '../palette.ts';

interface Strike {
  // Loop time of the brightest frame.
  readonly at: number;
  readonly x: number;
  readonly seed: number;
}

export const STRIKES: readonly Strike[] = [
  { at: 41.0, x: 404, seed: 1701 },
  { at: 97.5, x: 52, seed: 1702 },
];

// Flash level by time from the peak: a faint pre-flicker, at most two bright
// frames at 60 fps, a short afterglow and one soft re-flash. Never white.
const ENVELOPE: readonly (readonly [from: number, to: number, level: number])[] = [
  [-0.2, -0.15, 1],
  [-0.034, -0.0084, 2],
  [-0.0084, 0.025, 3],
  [0.025, 0.09, 2],
  [0.09, 0.3, 1],
  [0.38, 0.44, 2],
  [0.44, 0.75, 1],
];

const BOLT_WINDOWS: readonly (readonly [number, number])[] = [
  [-0.034, 0.11],
  [0.38, 0.44],
];

export function flashLevel(u: number): number {
  let level = 0;
  for (let s = 0; s < STRIKES.length; s++) {
    const d = since(u, STRIKES[s].at);
    for (let i = 0; i < ENVELOPE.length; i++) {
      const e = ENVELOPE[i];
      if (d >= e[0] && d < e[1] && e[2] > level) level = e[2];
    }
  }
  return level;
}

function activeBolt(u: number): number {
  for (let s = 0; s < STRIKES.length; s++) {
    const d = since(u, STRIKES[s].at);
    for (let i = 0; i < BOLT_WINDOWS.length; i++) if (d >= BOLT_WINDOWS[i][0] && d < BOLT_WINDOWS[i][1]) return s;
  }
  return -1;
}

// A jagged trunk from the cloud base toward the far horizon, with forks.
// Stored as pixel offsets with a palette index each.
function bakeBolt(strike: Strike): { at: Int32Array; color: Uint8Array } {
  const pts: number[] = [];
  const cols: number[] = [];
  const plot = (x: number, y: number, c: number) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
    pts.push(y * WIDTH + x);
    cols.push(c);
  };
  const walk = (x: number, y: number, len: number, drift: number, depth: number, salt: number) => {
    for (let i = 0; i < len; i++) {
      const step = 2 + Math.floor(hashUnit(strike.seed, salt, i) * 3);
      const nx = x + drift + (hashUnit(strike.seed + 1, salt, i) - 0.5) * 6;
      for (let k = 1; k <= step; k++) {
        const px = x + ((nx - x) * k) / step;
        const py = y + k;
        plot(px, py, depth === 0 ? C.bolt : C.sky8);
        if (depth === 0) {
          plot(px - 1, py, C.sky7);
          plot(px + 1, py, C.sky6);
        }
      }
      x = nx;
      y += step;
      if (depth < 2 && hashUnit(strike.seed + 2, salt, i) < 0.12) {
        walk(x, y, 4 + Math.floor(hashUnit(strike.seed + 3, salt, i) * 8), drift + (hashUnit(strike.seed + 4, salt, i) - 0.5) * 4, depth + 1, salt * 31 + i);
      }
    }
  };
  walk(strike.x, 38, 46, (hashUnit(strike.seed, 99) - 0.5) * 1.2, 0, 1);
  return { at: Int32Array.from(pts), color: Uint8Array.from(cols) };
}

export function boltLayer(): Draw {
  const bolts = STRIKES.map(bakeBolt);
  return (f: Frame) => {
    const s = activeBolt(f.u);
    if (s < 0) return;
    const { at, color } = bolts[s];
    const data = f.target.data;
    for (let i = 0; i < at.length; i++) data[at[i]] = color[i];
  };
}

// Cold rim on every upward-facing silhouette edge while the sky is lit.
const RIM = (() => {
  const out = new Uint8Array(COLOR_COUNT);
  for (let i = 0; i < COLOR_COUNT; i++) out[i] = i;
  const lift: [number, number][] = [
    [C.sky1, C.sky2], [C.sky2, C.sky3], [C.sky3, C.sky4], [C.sky4, C.sky5], [C.sky5, C.sky6],
    [C.ink, C.slate], [C.night, C.slate], [C.deep, C.steel], [C.navy, C.steel], [C.indigo, C.haze],
    [C.slate, C.haze], [C.steel, C.pale], [C.stone0, C.stone2], [C.stone1, C.haze], [C.stone2, C.pale],
    [C.moss0, C.moss2], [C.moss1, C.stone2], [C.wood0, C.stone0], [C.wood1, C.stone1], [C.soil1, C.stone1],
  ];
  for (const [from, to] of lift) out[from] = to;
  return out;
})();

export function rimLayer(scene: Scene): Draw {
  return (f: Frame) => {
    if (f.flash < 2) return;
    const data = f.target.data;
    const edge = scene.skyline;
    for (let i = 0; i < edge.length; i++) data[edge[i]] = RIM[data[edge[i]]];
  };
}
