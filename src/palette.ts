// How a swatch reacts to the lighting pass:
//   sky    backdrop: faint warm halo, strong lightning lift
//   matte  scene surfaces: full warm response, moderate lightning lift
//   wet    rain and water: catches warm light early, glints in lightning
//   glow   emissive glass and flame: dims a step or two as its own light dips
//   fixed  emissive particles and signals: never relit
export type Response = 'clear' | 'sky' | 'matte' | 'wet' | 'glow' | 'fixed';

const SWATCHES = {
  clear: [0x000000, 'clear'],

  sky0: [0x05060c, 'sky'],
  sky1: [0x0a0d1c, 'sky'],
  sky2: [0x0f1530, 'sky'],
  sky3: [0x172045, 'sky'],
  sky4: [0x22305c, 'sky'],
  sky5: [0x2e3f6e, 'sky'],
  sky6: [0x3d5585, 'sky'],
  sky7: [0x5873a3, 'sky'],
  sky8: [0x8fb0d9, 'sky'],

  ink: [0x05060c, 'matte'],
  night: [0x0a0d1c, 'matte'],
  deep: [0x0f1530, 'matte'],
  navy: [0x172045, 'matte'],
  indigo: [0x22305c, 'matte'],
  slate: [0x2e3f6e, 'matte'],
  steel: [0x3d5585, 'matte'],
  haze: [0x5873a3, 'matte'],
  pale: [0x8fb0d9, 'matte'],
  frost: [0xc4dcf5, 'matte'],

  soil0: [0x120f1a, 'matte'],
  soil1: [0x1c1726, 'matte'],
  soil2: [0x2a2233, 'matte'],
  stone0: [0x2b3346, 'matte'],
  stone1: [0x3c4760, 'matte'],
  stone2: [0x56627e, 'matte'],

  moss0: [0x1a2a2e, 'matte'],
  moss1: [0x24403f, 'matte'],
  moss2: [0x33594f, 'matte'],

  wood0: [0x1e1620, 'matte'],
  wood1: [0x2e2129, 'matte'],
  wood2: [0x44303a, 'matte'],

  rust0: [0x3a1410, 'matte'],
  rust1: [0x5a1a12, 'matte'],
  rust2: [0x8c2a14, 'matte'],

  lit0: [0x4a2c34, 'matte'],
  lit1: [0x6b3b35, 'matte'],
  lit2: [0x93533a, 'matte'],
  lit3: [0xb8743e, 'matte'],
  lit4: [0xdca468, 'matte'],

  rain0: [0x22305c, 'sky'],
  rain1: [0x2e3f6e, 'wet'],
  rain2: [0x3d5585, 'wet'],
  rain3: [0x5873a3, 'wet'],
  rain4: [0x8fb0d9, 'wet'],

  water0: [0x0a0d1c, 'wet'],
  water1: [0x172045, 'wet'],
  water2: [0x2e3f6e, 'wet'],
  water3: [0x5873a3, 'wet'],
  water4: [0x8fb0d9, 'wet'],

  glow0: [0x8c2a14, 'glow'],
  glow1: [0xd35a1a, 'glow'],
  glow2: [0xf08a24, 'glow'],
  glow3: [0xf7b440, 'glow'],
  glow4: [0xffd970, 'glow'],
  glow5: [0xfff3c4, 'glow'],

  ember0: [0x3a1410, 'fixed'],
  ember1: [0x5a1a12, 'fixed'],
  ember2: [0x8c2a14, 'fixed'],
  fire0: [0xd35a1a, 'fixed'],
  fire1: [0xf08a24, 'fixed'],
  fire2: [0xf7b440, 'fixed'],
  fire3: [0xffd970, 'fixed'],
  fire4: [0xfff3c4, 'fixed'],
  bolt: [0xe8f2ff, 'fixed'],
} as const satisfies Record<string, readonly [number, Response]>;

export type ColorName = keyof typeof SWATCHES;

const NAMES = Object.keys(SWATCHES) as ColorName[];

export const C = Object.fromEntries(NAMES.map((name, i) => [name, i])) as Record<ColorName, number>;

export interface Swatch {
  readonly name: ColorName;
  readonly rgb: number;
  readonly response: Response;
}

export const SWATCH_LIST: readonly Swatch[] = NAMES.map((name) => ({
  name,
  rgb: SWATCHES[name][0],
  response: SWATCHES[name][1],
}));

export const COLOR_COUNT = SWATCH_LIST.length;

// Warm ramp from deepest ember to white-hot, as palette indices.
export const FIRE_RAMP = [C.ember0, C.ember1, C.ember2, C.fire0, C.fire1, C.fire2, C.fire3, C.fire4];
