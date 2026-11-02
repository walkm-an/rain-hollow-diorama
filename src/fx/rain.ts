import { HEIGHT, WIDTH } from '../contract.ts';
import type { Draw, Frame, Scene } from '../frame.ts';
import { clock, hash, slot, type Clock, type Slot } from '../loop.ts';
import { C } from '../palette.ts';
import { MAT } from '../raster.ts';
import { groundBack, groundFront } from '../scene/slab.ts';

interface RainLayer {
  readonly seed: number;
  readonly count: number;
  // Seconds to fall the full screen; each must divide the loop. Drop i uses
  // fall[i % fall.length], so speeds vary a little within a layer.
  readonly fall: readonly number[];
  readonly length: number;
  // Horizontal px per px of fall; shared by every layer so the wind reads as one.
  readonly slant: number;
  readonly body: number;
  readonly head: number;
  // Whether drops stop on roofs, stones and ground and splash there.
  readonly lands: boolean;
}

export const WIND_SLANT = 0.2;

export const RAIN_LAYERS: Record<'far' | 'mid' | 'near', RainLayer> = {
  far: { seed: 1201, count: 330, fall: [2, 1.875, 2.4], length: 3, slant: WIND_SLANT * 0.85, body: C.rain0, head: C.rain0, lands: false },
  mid: { seed: 1301, count: 270, fall: [1.25, 1.2, 1.333333333333333], length: 5, slant: WIND_SLANT, body: C.rain1, head: C.rain2, lands: true },
  near: { seed: 1401, count: 70, fall: [0.625, 0.6, 0.6666666666666666], length: 10, slant: WIND_SLANT * 1.15, body: C.rain2, head: C.rain3, lands: false },
};

const SPLASH_SECONDS = 0.13;
const SLAB_MID_Y = 179;

// Per sheared column: the y where a falling drop first meets a standing
// surface (roof, stone, pumpkin), or -1 when it reaches open ground first.
function bakeCatch(scene: Scene, slant: number, columns: number, shift: number): Int16Array {
  const out = new Int16Array(columns).fill(HEIGHT + 32);
  for (let c = 0; c < columns; c++) {
    for (let y = 0; y < HEIGHT; y++) {
      const x = Math.round(c - shift + slant * y);
      if (x < 0 || x >= WIDTH) continue;
      const mat = scene.mat[y * WIDTH + x];
      if (mat === MAT.prop) {
        out[c] = y;
        break;
      }
      if (mat === MAT.ground) {
        out[c] = -1;
        break;
      }
    }
  }
  return out;
}

function put(data: Uint8Array, x: number, y: number, c: number): boolean {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return false;
  data[y * WIDTH + x] = c;
  return true;
}

export function rainLayer(layer: RainLayer, scene: Scene): Draw {
  const clocks: Clock[] = layer.fall.map(clock);
  const shift = Math.ceil(layer.slant * HEIGHT);
  const columns = WIDTH + shift;
  const catchY = layer.lands ? bakeCatch(scene, layer.slant, columns, shift) : null;
  const travel = HEIGHT + layer.length * 2 + 8;
  const s: Slot = { age: 0, gen: 0 };

  return (f: Frame) => {
    const data = f.target.data;
    let drawn = 0;
    for (let i = 0; i < layer.count; i++) {
      const ck = clocks[i % clocks.length];
      slot(f.u, ck, ((i * 0.618034) % 1) * 120, s);
      const h = hash(layer.seed, i, s.gen);
      const col = h % columns;
      const x0 = col - shift;
      const head = -layer.length + s.age * travel;
      let stop = HEIGHT + layer.length;
      if (catchY) {
        const hit = catchY[col];
        if (hit === -1) {
          const gx = Math.round(x0 + layer.slant * (SLAB_MID_Y));
          const gb = groundBack(gx);
          const gf = groundFront(gx);
          stop = gb + ((h >>> 12) % (gf - gb + 1));
        } else {
          stop = hit;
        }
      }
      if (head > stop) {
        const since = ((head - stop) / travel) * ck.life;
        if (since < SPLASH_SECONDS) {
          const sx = Math.round(x0 + layer.slant * stop);
          const sy = stop - 1;
          const early = since < SPLASH_SECONDS / 2;
          const spread = early ? 1 : 2;
          const c = early ? layer.head : layer.body;
          put(data, sx - spread, sy - spread + 1, c);
          put(data, sx + spread, sy - spread + 1, c);
          if (early) put(data, sx, sy, layer.head);
          drawn++;
        }
        if (head - layer.length > stop) continue;
      }
      let visible = false;
      for (let k = 0; k < layer.length; k++) {
        const y = Math.floor(head) - k;
        if (y > stop) continue;
        const x = Math.round(x0 + layer.slant * y);
        if (put(data, x, y, k === 0 ? layer.head : layer.body)) visible = true;
      }
      if (visible) drawn++;
    }
    f.particles += drawn;
  };
}
