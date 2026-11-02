import { HEIGHT, LOOP_SECONDS, WIDTH, type FrameDiff, type FrameStats } from './contract.ts';
import { createRenderer } from './diorama.ts';

const LETTERBOX = '#05060c';

const screen = document.querySelector<HTMLCanvasElement>('#screen')!;
const screenCtx = screen.getContext('2d', { alpha: false })!;
const buffer = document.createElement('canvas');
buffer.width = WIDTH;
buffer.height = HEIGHT;
const bufferCtx = buffer.getContext('2d')!;
const image = bufferCtx.createImageData(WIDTH, HEIGHT);
const hud = document.querySelector<HTMLPreElement>('#hud')!;

const renderer = createRenderer();
const imageWords = new Uint32Array(image.data.buffer);

const params = new URLSearchParams(location.search);
let playing = params.get('paused') !== '1';
let clockOrigin = performance.now();
let timeOrigin = Number(params.get('t') ?? 0) || 0;
let currentT = timeOrigin;
let lastStats: FrameStats = { particles: 0 };
let renderMs = 0;
let fps = 0;
let frames = 0;
let lastFrameAt = 0;

function fitScale(): { scale: number; x: number; y: number } {
  const fit = Math.min(screen.width / WIDTH, screen.height / HEIGHT);
  const whole = Math.floor(fit);
  const scale = whole >= 1 && whole / fit >= 0.9 ? whole : fit;
  return {
    scale,
    x: Math.round((screen.width - WIDTH * scale) / 2),
    y: Math.round((screen.height - HEIGHT * scale) / 2),
  };
}

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  screen.width = Math.round(window.innerWidth * dpr);
  screen.height = Math.round(window.innerHeight * dpr);
  present();
}

function present(): void {
  const { scale, x, y } = fitScale();
  screenCtx.imageSmoothingEnabled = false;
  screenCtx.fillStyle = LETTERBOX;
  screenCtx.fillRect(0, 0, screen.width, screen.height);
  screenCtx.drawImage(buffer, 0, 0, WIDTH, HEIGHT, x, y, WIDTH * scale, HEIGHT * scale);
}

function draw(t: number): FrameStats {
  const start = performance.now();
  lastStats = renderer.render(t);
  renderMs = performance.now() - start;
  imageWords.set(renderer.pixels);
  bufferCtx.putImageData(image, 0, 0);
  present();
  currentT = t;
  frames++;
  return lastStats;
}

function tick(now: number): void {
  if (playing) {
    if (lastFrameAt > 0) fps = fps * 0.9 + (1000 / Math.max(1, now - lastFrameAt)) * 0.1;
    lastFrameAt = now;
    draw(timeOrigin + (now - clockOrigin) / 1000);
    if (!hud.hidden) updateHud();
  }
  requestAnimationFrame(tick);
}

function updateHud(): void {
  const phase = ((currentT % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS;
  hud.textContent =
    `t ${currentT.toFixed(2)}s  loop ${phase.toFixed(2)}/${LOOP_SECONDS}s\n` +
    `fps ${fps.toFixed(0)}  render ${renderMs.toFixed(2)}ms  particles ${lastStats.particles}`;
}

function play(fromT = currentT): void {
  timeOrigin = fromT;
  clockOrigin = performance.now();
  lastFrameAt = 0;
  playing = true;
}

function pause(): void {
  playing = false;
}

function snapshot(t: number): Uint32Array {
  renderer.render(t);
  return renderer.pixels.slice();
}

function diff(tA: number, tB: number): FrameDiff {
  const a = snapshot(tA);
  const b = snapshot(tB);
  let changedPixels = 0;
  let maxChannelDelta = 0;
  let sumAbs = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    changedPixels++;
    for (let shift = 0; shift < 24; shift += 8) {
      const d = Math.abs(((a[i] >>> shift) & 255) - ((b[i] >>> shift) & 255));
      sumAbs += d;
      if (d > maxChannelDelta) maxChannelDelta = d;
    }
  }
  draw(currentT);
  return { changedPixels, totalPixels: a.length, maxChannelDelta, meanAbsDelta: sumAbs / (a.length * 3) };
}

function hash(t: number): string {
  const pixels = snapshot(t);
  let h = 0x811c9dc5;
  for (let i = 0; i < pixels.length; i++) {
    h ^= pixels[i];
    h = Math.imul(h, 0x01000193);
  }
  draw(currentT);
  return (h >>> 0).toString(16).padStart(8, '0');
}

window.__diorama = {
  width: WIDTH,
  height: HEIGHT,
  loopSeconds: LOOP_SECONDS,
  renderAt(t) {
    pause();
    return draw(t);
  },
  play,
  hash,
  diff,
  stats: () => ({ t: currentT, fps, particles: lastStats.particles, renderMs, frames, playing }),
};

hud.hidden = params.get('hud') !== '1';
window.addEventListener('resize', resize);
window.addEventListener('keydown', (event) => {
  if (event.key === 'f' || event.key === 'F') {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  } else if (event.key === 'h' || event.key === 'H') {
    hud.hidden = !hud.hidden;
    updateHud();
  } else if (event.key === ' ') {
    if (playing) pause();
    else play();
  }
});

resize();
draw(timeOrigin);
requestAnimationFrame(tick);
