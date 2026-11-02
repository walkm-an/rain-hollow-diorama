import { HEIGHT, LOOP_SECONDS, WIDTH } from '../contract.ts';
import type { Draw, Frame } from '../frame.ts';
import { clock, hash, mix32, slot, wave, type Slot } from '../loop.ts';
import { C, COLOR_COUNT, SWATCH_LIST } from '../palette.ts';
import { DOOR, EAVE_STREAMS, leanX } from '../scene/cottage.ts';
import { FIRE } from '../scene/campfire.ts';
import { groundAt } from '../scene/slab.ts';

interface Puddle {
  readonly x: number;
  readonly depth: number;
  readonly rx: number;
  readonly ry: number;
  // Rows of scene above the puddle squeezed into each puddle row.
  readonly squeeze: number;
}

export const PUDDLES: readonly Puddle[] = [
  { x: leanX(DOOR.x, 170) + 9, depth: 0.78, rx: 9, ry: 1.8, squeeze: 3 },
  { x: 141, depth: 0.82, rx: 6, ry: 1.4, squeeze: 3 },
  { x: FIRE.x + 17, depth: 0.88, rx: 7, ry: 1.5, squeeze: 2.5 },
  { x: 286, depth: 0.9, rx: 5, ry: 1.2, squeeze: 3 },
];

// What a palette color looks like mirrored in dark water: emissive colors keep
// their warmth, everything else falls onto the water ramp by brightness.
const REFLECT = (() => {
  const out = new Uint8Array(COLOR_COUNT);
  for (let i = 0; i < COLOR_COUNT; i++) {
    const s = SWATCH_LIST[i];
    if (s.response === 'glow' || s.response === 'fixed') {
      out[i] = i;
      continue;
    }
    const r = (s.rgb >> 16) & 255;
    const g = (s.rgb >> 8) & 255;
    const b = s.rgb & 255;
    const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    out[i] = l < 0.07 ? C.water0 : l < 0.14 ? C.water1 : l < 0.3 ? C.water2 : C.water3;
  }
  return out;
})();

const RIPPLE = { perPuddle: 3, life: 0.75, points: 10 };

export function puddleLayer(): Draw {
  const geo = PUDDLES.map((p) => {
    const cy = groundAt(p.x, p.depth);
    return { p, cx: p.x, cy, top: Math.round(cy - p.ry) };
  });
  const ck = clock(RIPPLE.life);
  const s: Slot = { age: 0, gen: 0 };
  return (f: Frame) => {
    const data = f.target.data;
    for (let n = 0; n < geo.length; n++) {
      const { p, cx, cy, top } = geo[n];
      const x0 = Math.floor(cx - p.rx);
      const x1 = Math.ceil(cx + p.rx);
      for (let y = top; y <= Math.ceil(cy + p.ry); y++) {
        const ny = (y + 0.5 - cy) / p.ry;
        const shimmer = Math.round(0.7 * wave(f.u, 37, y * 1.9 + n));
        for (let x = x0; x <= x1; x++) {
          const nx = (x + 0.5 - cx) / p.rx;
          const r = nx * nx + ny * ny;
          if (r > 1) continue;
          let c: number;
          if (y === top) c = C.water0;
          else {
            const sy = Math.round(top - 1 - (y - top) * p.squeeze);
            const sx = x + shimmer;
            c = sy >= 0 && sx >= 0 && sx < WIDTH ? REFLECT[data[sy * WIDTH + sx]] : C.water1;
            if (r > 0.75 && ny > 0 && ((x + y) & 1) === 0) c = C.water2;
          }
          data[y * WIDTH + x] = c;
        }
      }
      for (let i = 0; i < RIPPLE.perPuddle; i++) {
        slot(f.u, ck, ((i + n * 0.31) / RIPPLE.perPuddle) * ck.life, s);
        if (s.age > 0.85) continue;
        const h = hash(1601 + n, i, s.gen);
        const px = cx + ((mix32(h) / 4294967296) - 0.5) * p.rx * 1.1;
        const py = cy + ((mix32(h ^ 0x5bd1e995) / 4294967296) - 0.5) * p.ry * 0.8;
        const rr = 0.6 + s.age * 3.4;
        const c = s.age < 0.35 ? C.water4 : C.water3;
        let drawn = false;
        for (let k = 0; k < RIPPLE.points; k++) {
          const a = (k / RIPPLE.points) * Math.PI * 2;
          const x = Math.round(px + Math.cos(a) * rr);
          const y = Math.round(py + Math.sin(a) * rr * 0.4);
          const nx = (x + 0.5 - cx) / p.rx;
          const ny = (y + 0.5 - cy) / p.ry;
          if (nx * nx + ny * ny > 0.85 || y <= top) continue;
          data[y * WIDTH + x] = c;
          drawn = true;
        }
        if (drawn) f.particles++;
      }
    }
  };
}

const STREAM = { period: 6, dash: 3, wraps: 2000 };

// Roof runoff: thin dashed threads whose dashes slide down a whole number of
// periods per loop, with a two-frame splash where they hit the ground.
export function streamLayer(): Draw {
  return (f: Frame) => {
    const data = f.target.data;
    const offset = Math.floor((f.u / LOOP_SECONDS) * STREAM.period * STREAM.wraps) % STREAM.period;
    for (let n = 0; n < EAVE_STREAMS.length; n++) {
      const s = EAVE_STREAMS[n];
      for (let y = s.y; y < s.ground; y++) {
        const k = (((y - s.y - offset - n * 2) % STREAM.period) + STREAM.period) % STREAM.period;
        if (k >= STREAM.dash) continue;
        if (y < 0 || y >= HEIGHT) continue;
        data[y * WIDTH + s.x] = k === 0 ? C.rain3 : C.rain2;
      }
      const flip = wave(f.u, 420 + n * 60, n) > 0;
      const gy = s.ground - 1;
      data[gy * WIDTH + s.x - (flip ? 1 : 2)] = C.rain2;
      data[gy * WIDTH + s.x + (flip ? 1 : 2)] = C.rain2;
      data[(gy - 1) * WIDTH + s.x + (flip ? -1 : 1)] = C.rain3;
    }
  };
}
