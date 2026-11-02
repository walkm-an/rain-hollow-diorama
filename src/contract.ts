export const WIDTH = 480;
export const HEIGHT = 270;

// Every time-varying quantity in the scene must repeat with this period,
// so render(t) and render(t + LOOP_SECONDS) produce identical pixels.
export const LOOP_SECONDS = 120;

export interface FrameStats {
  particles: number;
}

export interface Renderer {
  // WIDTH * HEIGHT pixels, packed as ImageData expects on little-endian (0xAABBGGRR).
  readonly pixels: Uint32Array;
  // Pure in t: the output depends only on t, never on previously rendered frames.
  render(t: number): FrameStats;
}

export interface FrameDiff {
  changedPixels: number;
  totalPixels: number;
  maxChannelDelta: number;
  meanAbsDelta: number;
}

export interface LiveStats {
  t: number;
  fps: number;
  particles: number;
  renderMs: number;
  frames: number;
  playing: boolean;
}

export interface DioramaApi {
  readonly width: number;
  readonly height: number;
  readonly loopSeconds: number;
  renderAt(t: number): FrameStats;
  play(fromT?: number): void;
  hash(t: number): string;
  diff(tA: number, tB: number): FrameDiff;
  stats(): LiveStats;
}

declare global {
  interface Window {
    __diorama: DioramaApi;
  }
}
