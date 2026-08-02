"use strict";
// ===== RadarSimApp - Conversions and library error codes =====
//
// Pure helpers shared by the native bridge. Kept out of bridge.ts so they can
// be imported (and tested) without koffi loading radarsimc.

// ── Error codes (radarsim.h) ─────────────────────────────────────────────────
export const ERROR_MESSAGES: Record<number, string> = {
  0: "Success",
  1: "Null pointer encountered",
  2: "Invalid parameter provided",
  3: "Memory allocation failed",
  4: "Free tier limit reached — purchase a license at https://radarsimx.com/ to unlock full capabilities",
  5: "Unhandled exception occurred",
  6: "Ray count exceeds grid capacity",
  7: "CUDA device query failed",
  100: "PointSimulator: cudaDeviceSynchronize failed (standard path)",
  101: "PointSimulator: CUDA kernel launch failed (standard path)",
  102: "PointSimulator: cudaDeviceSynchronize failed (per-frame phase noise path)",
  103: "PointSimulator: CUDA kernel launch failed (per-frame phase noise path)",
  200: "MeshSimulator ProcessBaseband: cudaDeviceSynchronize failed",
  201: "MeshSimulator ProcessBaseband: CUDA kernel launch failed",
  202: "MeshSimulator ProcessBackTracingBaseband: cudaDeviceSynchronize failed",
  203: "MeshSimulator ProcessBackTracingBaseband: CUDA kernel launch failed",
  300: "InterferenceSimulator: cudaDeviceSynchronize failed",
  301: "InterferenceSimulator: CUDA kernel launch failed",
  400: "LidarSimulator: CUDA kernel launch failed",
  401: "LidarSimulator: cudaDeviceSynchronize failed",
  500: "NoiseSimulator: CUDA kernel launch failed",
  501: "NoiseSimulator: cudaDeviceSynchronize failed",
};

export function errorMsg(code: number, context: string): string {
  const desc = ERROR_MESSAGES[code] || `Unknown error`;
  return `${context}: ${desc} (code ${code})`;
}

// ── Typed-array helpers ──────────────────────────────────────────────────────
export function toF32(arr: number[] | Float32Array): Float32Array {
  return arr instanceof Float32Array ? arr : new Float32Array(arr);
}
export function toF64(arr: number[] | Float64Array): Float64Array {
  return arr instanceof Float64Array ? arr : new Float64Array(arr);
}
export function toI32(arr: number[] | Int32Array): Int32Array {
  return arr instanceof Int32Array ? arr : new Int32Array(arr);
}

/** Degrees → radians. The UI works in degrees; the library takes radians. */
export function deg2rad(arr: number[]): Float32Array {
  return new Float32Array(arr.map((v) => (v * Math.PI) / 180));
}

// ── Complex numbers ──────────────────────────────────────────────────────────
export interface ComplexParsed {
  re: number;
  im: number;
}

/** Parse a complex number from string "1+2j", array [re, im], or plain number. */
export function parseComplex(v: string | number | number[]): ComplexParsed {
  if (typeof v === "number") return { re: v, im: 0 };
  if (Array.isArray(v)) return { re: v[0] || 0, im: v[1] || 0 };
  if (typeof v === "string") {
    const m = v.replace(/\s/g, "").match(/^([+-]?[\d.e+-]+)?([+-][\d.e+-]+)[ij]$/i);
    if (m) return { re: parseFloat(m[1] || "0"), im: parseFloat(m[2]) };
    return { re: parseFloat(v) || 0, im: 0 };
  }
  return { re: 0, im: 0 };
}

// ── Antenna patterns ─────────────────────────────────────────────────────────
export interface AntennaPattern {
  phi: Float32Array;
  phiPtn: Float32Array;
  theta: Float32Array;
  thetaPtn: Float32Array;
  antennaGain: number;
}

/**
 * Build the phi/theta pattern arrays the library expects.
 *
 * Azimuth is passed through in radians with the peak normalized out (the peak
 * becomes the channel's antenna gain). Elevation is converted to the library's
 * polar convention (theta = 90° - elevation) which reverses the sweep
 * direction, so both the angles and the pattern are flipped.
 */
export function buildAntennaPattern(
  azAngle: number[] | undefined,
  azPattern: number[] | undefined,
  elAngle: number[] | undefined,
  elPattern: number[] | undefined
): AntennaPattern {
  let phi: Float32Array, phiPtn: Float32Array, antennaGain: number;
  if (azAngle && azPattern && azAngle.length > 0) {
    if (azAngle.length !== azPattern.length) {
      throw new Error("The length of azimuth_angle and azimuth_pattern must be the same.");
    }
    antennaGain = Math.max(...azPattern);
    phi = new Float32Array(azAngle.map((v) => (v * Math.PI) / 180));
    phiPtn = new Float32Array(azPattern.map((v) => v - antennaGain));
  } else {
    phi = new Float32Array([-Math.PI / 2, Math.PI / 2]);
    phiPtn = new Float32Array([0, 0]);
    antennaGain = 0;
  }

  let theta: Float32Array, thetaPtn: Float32Array;
  if (elAngle && elPattern && elAngle.length > 0) {
    if (elAngle.length !== elPattern.length) {
      throw new Error("The length of elevation_angle and elevation_pattern must be the same.");
    }
    const elMax = Math.max(...elPattern);
    const transformed = elAngle.map((v) => (90 - v) * Math.PI / 180).reverse();
    const ptnFlipped = [...elPattern].reverse().map((v) => v - elMax);
    theta = new Float32Array(transformed);
    thetaPtn = new Float32Array(ptnFlipped);
  } else {
    theta = new Float32Array([0, Math.PI]);
    thetaPtn = new Float32Array([0, 0]);
  }

  return { phi, phiPtn, theta, thetaPtn, antennaGain };
}
