"use strict";
// ===== RadarSimApp - Signal processing =====
//
// Pure DSP shared by the native bridge. Kept out of bridge.ts so it can be
// imported (and tested) without koffi loading radarsimc.

// ── Noise Utilities ──────────────────────────────────────────────────────────
let _randnSpare: number | null = null;
export function randn(): number {
  if (_randnSpare !== null) { const v = _randnSpare; _randnSpare = null; return v; }
  let u: number, v: number, s: number;
  do { u = Math.random() * 2 - 1; v = Math.random() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
  const mul = Math.sqrt(-2 * Math.log(s) / s);
  _randnSpare = v * mul;
  return u * mul;
}

// ── FFT ───────────────────────────────────────────────────────────────────────
export function nextPow2(n: number): number { let p = 1; while (p < n) p <<= 1; return p; }

export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let urRe = 1, urIm = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const uRe = re[i + k], uIm = im[i + k];
        const vRe = re[i + k + half] * urRe - im[i + k + half] * urIm;
        const vIm = re[i + k + half] * urIm + im[i + k + half] * urRe;
        re[i + k] = uRe + vRe; im[i + k] = uIm + vIm;
        re[i + k + half] = uRe - vRe; im[i + k + half] = uIm - vIm;
        const tmp = urRe * wRe - urIm * wIm;
        urIm = urRe * wIm + urIm * wRe;
        urRe = tmp;
      }
    }
  }
}

export interface ComplexBuffers {
  re: Float64Array;
  im: Float64Array;
}

export function applyRangeFFT(re: Float64Array, im: Float64Array, nPulse: number, nRx: number, spp: number, n?: number): ComplexBuffers {
  if (!n) n = nextPow2(spp);
  const outRe = new Float64Array(n * nPulse * nRx);
  const outIm = new Float64Array(n * nPulse * nRx);
  for (let c = 0; c < nRx; c++) {
    for (let p = 0; p < nPulse; p++) {
      const inBase = (c * nPulse + p) * spp;
      const outBase = (c * nPulse + p) * n;
      const R = new Float64Array(n); R.set(re.subarray(inBase, inBase + Math.min(spp, n)));
      const I = new Float64Array(n); I.set(im.subarray(inBase, inBase + Math.min(spp, n)));
      fft(R, I);
      outRe.set(R, outBase);
      outIm.set(I, outBase);
    }
  }
  return { re: outRe, im: outIm };
}

export function applyDopplerFFT(re: Float64Array, im: Float64Array, nPulse: number, nRx: number, rangeDim: number, n?: number): ComplexBuffers {
  if (!n) n = nextPow2(nPulse);
  const outRe = new Float64Array(rangeDim * n * nRx);
  const outIm = new Float64Array(rangeDim * n * nRx);
  const half = Math.floor(n / 2);
  for (let c = 0; c < nRx; c++) {
    for (let s = 0; s < rangeDim; s++) {
      const R = new Float64Array(n);
      const I = new Float64Array(n);
      for (let p = 0; p < nPulse; p++) {
        R[p] = re[(c * nPulse + p) * rangeDim + s];
        I[p] = im[(c * nPulse + p) * rangeDim + s];
      }
      fft(R, I);
      for (let p = 0; p < n; p++) {
        const shifted = (p + half) % n;
        outRe[(c * n + p) * rangeDim + s] = R[shifted];
        outIm[(c * n + p) * rangeDim + s] = I[shifted];
      }
    }
  }
  return { re: outRe, im: outIm };
}

export function toDbMag3D(re: Float64Array, im: Float64Array, nPulse: number, nRx: number, spp: number): number[][][] {
  const out: number[][][] = [];
  for (let p = 0; p < nPulse; p++) {
    const rxArr: number[][] = [];
    for (let r = 0; r < nRx; r++) {
      const row = new Array<number>(spp);
      const base = (r * nPulse + p) * spp;
      for (let s = 0; s < spp; s++) {
        const mag = Math.sqrt(re[base + s] ** 2 + im[base + s] ** 2);
        row[s] = 20 * Math.log10(mag + 1e-12);
      }
      rxArr.push(row);
    }
    out.push(rxArr);
  }
  return out;
}

export interface ComplexData {
  re: number[];
  im: number[];
}

export function toComplex3D(re: Float64Array, im: Float64Array, nPulse: number, nRx: number, spp: number): ComplexData[][] {
  const out: ComplexData[][] = [];
  for (let p = 0; p < nPulse; p++) {
    const rxArr: ComplexData[] = [];
    for (let r = 0; r < nRx; r++) {
      const base = (r * nPulse + p) * spp;
      rxArr.push({
        re: Array.from(re.subarray(base, base + spp)),
        im: Array.from(im.subarray(base, base + spp)),
      });
    }
    out.push(rxArr);
  }
  return out;
}
