import type { Target } from './raster.ts';

// Everything a dynamic layer may touch while drawing one frame. All buffers
// are allocated once; layers overwrite them, never resize or replace them.
export interface Frame {
  readonly target: Target;
  // Warm light accumulated by the LIGHTS pass, 1.0 = full brightness.
  readonly light: Float32Array;
  // Canonical loop time in [0, LOOP_SECONDS).
  u: number;
  // Lightning level, 0 = none.
  flash: number;
  particles: number;
}

// The composite of every static layer, for systems that need to know where
// things are: where rain lands, which pixels catch a lightning rim, how a
// light pool falls on ground versus walls.
export interface Scene {
  readonly data: Uint8Array;
  readonly mat: Uint8Array;
  // Pixels on the upper edge of a static silhouette, as indices into data.
  readonly skyline: Int32Array;
}

export type Draw = (f: Frame) => void;

export type Layer =
  | { readonly name: string; readonly bake: (t: Target) => void }
  | { readonly name: string; readonly build: (scene: Scene) => Draw };
