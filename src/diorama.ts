import { HEIGHT, LOOP_SECONDS, WIDTH, type Renderer } from './contract.ts';

export function createRenderer(): Renderer {
  const pixels = new Uint32Array(WIDTH * HEIGHT);
  return {
    pixels,
    render(t) {
      const barX = Math.floor(((t / LOOP_SECONDS) % 1) * WIDTH);
      for (let y = 0; y < HEIGHT; y++) {
        const shade = 20 + Math.floor((y / HEIGHT) * 40);
        for (let x = 0; x < WIDTH; x++) {
          const lit = Math.abs(x - barX) < 3;
          const r = lit ? 255 : shade / 2;
          const g = lit ? 150 : shade / 2;
          const b = lit ? 40 : shade + 30;
          pixels[y * WIDTH + x] = 0xff000000 | (b << 16) | (g << 8) | r;
        }
      }
      return { particles: 0 };
    },
  };
}
