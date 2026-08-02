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

// ── Cooperative scheduling ───────────────────────────────────────────────────
// This code runs in the Electron main process, which is also the thread that
// pumps the window's OS event loop. A loop that runs for seconds without
// returning to the event loop makes the window stop responding, so the *Async
// variants below run the same kernels while handing control back whenever a
// slice has been running for longer than SLICE_MS.

const SLICE_MS = 10;

/**
 * Returns a function to `await` inside a hot loop. It is a no-op until the
 * current slice has used up its budget, then yields to the event loop once.
 */
export function makeYielder(sliceMs: number = SLICE_MS): () => Promise<void> {
  let deadline = Date.now() + sliceMs;
  return async function maybeYield(): Promise<void> {
    if (Date.now() < deadline) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
    deadline = Date.now() + sliceMs;
  };
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

/** One pulse of the range FFT, the unit of work both variants schedule. */
function _rangeFFTPulse(
  re: Float64Array, im: Float64Array, out: ComplexBuffers,
  c: number, p: number, nPulse: number, spp: number, n: number
): void {
  const inBase = (c * nPulse + p) * spp;
  const outBase = (c * nPulse + p) * n;
  const R = new Float64Array(n); R.set(re.subarray(inBase, inBase + Math.min(spp, n)));
  const I = new Float64Array(n); I.set(im.subarray(inBase, inBase + Math.min(spp, n)));
  fft(R, I);
  out.re.set(R, outBase);
  out.im.set(I, outBase);
}

export function applyRangeFFT(re: Float64Array, im: Float64Array, nPulse: number, nRx: number, spp: number, n?: number): ComplexBuffers {
  if (!n) n = nextPow2(spp);
  const out: ComplexBuffers = { re: new Float64Array(n * nPulse * nRx), im: new Float64Array(n * nPulse * nRx) };
  for (let c = 0; c < nRx; c++) {
    for (let p = 0; p < nPulse; p++) _rangeFFTPulse(re, im, out, c, p, nPulse, spp, n);
  }
  return out;
}

/** {@link applyRangeFFT}, yielding to the event loop between pulses. */
export async function applyRangeFFTAsync(re: Float64Array, im: Float64Array, nPulse: number, nRx: number, spp: number, n?: number): Promise<ComplexBuffers> {
  if (!n) n = nextPow2(spp);
  const out: ComplexBuffers = { re: new Float64Array(n * nPulse * nRx), im: new Float64Array(n * nPulse * nRx) };
  const maybeYield = makeYielder();
  for (let c = 0; c < nRx; c++) {
    for (let p = 0; p < nPulse; p++) {
      _rangeFFTPulse(re, im, out, c, p, nPulse, spp, n);
      await maybeYield();
    }
  }
  return out;
}

/** One range bin of the Doppler FFT, the unit of work both variants schedule. */
function _dopplerFFTBin(
  re: Float64Array, im: Float64Array, out: ComplexBuffers,
  c: number, s: number, nPulse: number, rangeDim: number, n: number
): void {
  const half = Math.floor(n / 2);
  const R = new Float64Array(n);
  const I = new Float64Array(n);
  for (let p = 0; p < nPulse; p++) {
    R[p] = re[(c * nPulse + p) * rangeDim + s];
    I[p] = im[(c * nPulse + p) * rangeDim + s];
  }
  fft(R, I);
  for (let p = 0; p < n; p++) {
    const shifted = (p + half) % n;
    out.re[(c * n + p) * rangeDim + s] = R[shifted];
    out.im[(c * n + p) * rangeDim + s] = I[shifted];
  }
}

export function applyDopplerFFT(re: Float64Array, im: Float64Array, nPulse: number, nRx: number, rangeDim: number, n?: number): ComplexBuffers {
  if (!n) n = nextPow2(nPulse);
  const out: ComplexBuffers = { re: new Float64Array(rangeDim * n * nRx), im: new Float64Array(rangeDim * n * nRx) };
  for (let c = 0; c < nRx; c++) {
    for (let s = 0; s < rangeDim; s++) _dopplerFFTBin(re, im, out, c, s, nPulse, rangeDim, n);
  }
  return out;
}

/** {@link applyDopplerFFT}, yielding to the event loop between range bins. */
export async function applyDopplerFFTAsync(re: Float64Array, im: Float64Array, nPulse: number, nRx: number, rangeDim: number, n?: number): Promise<ComplexBuffers> {
  if (!n) n = nextPow2(nPulse);
  const out: ComplexBuffers = { re: new Float64Array(rangeDim * n * nRx), im: new Float64Array(rangeDim * n * nRx) };
  const maybeYield = makeYielder();
  for (let c = 0; c < nRx; c++) {
    for (let s = 0; s < rangeDim; s++) {
      _dopplerFFTBin(re, im, out, c, s, nPulse, rangeDim, n);
      await maybeYield();
    }
  }
  return out;
}

/** One [pulse][rx] row in dB, the unit of work both variants schedule. */
function _dbMagRow(re: Float64Array, im: Float64Array, p: number, r: number, nPulse: number, spp: number): number[] {
  const row = new Array<number>(spp);
  const base = (r * nPulse + p) * spp;
  for (let s = 0; s < spp; s++) {
    const mag = Math.sqrt(re[base + s] ** 2 + im[base + s] ** 2);
    row[s] = 20 * Math.log10(mag + 1e-12);
  }
  return row;
}

export function toDbMag3D(re: Float64Array, im: Float64Array, nPulse: number, nRx: number, spp: number): number[][][] {
  const out: number[][][] = [];
  for (let p = 0; p < nPulse; p++) {
    const rxArr: number[][] = [];
    for (let r = 0; r < nRx; r++) rxArr.push(_dbMagRow(re, im, p, r, nPulse, spp));
    out.push(rxArr);
  }
  return out;
}

/** {@link toDbMag3D}, yielding to the event loop between rows. */
export async function toDbMag3DAsync(re: Float64Array, im: Float64Array, nPulse: number, nRx: number, spp: number): Promise<number[][][]> {
  const out: number[][][] = [];
  const maybeYield = makeYielder();
  for (let p = 0; p < nPulse; p++) {
    const rxArr: number[][] = [];
    for (let r = 0; r < nRx; r++) {
      rxArr.push(_dbMagRow(re, im, p, r, nPulse, spp));
      await maybeYield();
    }
    out.push(rxArr);
  }
  return out;
}

export interface ComplexData {
  re: number[];
  im: number[];
}

function _complexRow(re: Float64Array, im: Float64Array, p: number, r: number, nPulse: number, spp: number): ComplexData {
  const base = (r * nPulse + p) * spp;
  return {
    re: Array.from(re.subarray(base, base + spp)),
    im: Array.from(im.subarray(base, base + spp)),
  };
}

export function toComplex3D(re: Float64Array, im: Float64Array, nPulse: number, nRx: number, spp: number): ComplexData[][] {
  const out: ComplexData[][] = [];
  for (let p = 0; p < nPulse; p++) {
    const rxArr: ComplexData[] = [];
    for (let r = 0; r < nRx; r++) rxArr.push(_complexRow(re, im, p, r, nPulse, spp));
    out.push(rxArr);
  }
  return out;
}

/** {@link toComplex3D}, yielding to the event loop between rows. */
export async function toComplex3DAsync(re: Float64Array, im: Float64Array, nPulse: number, nRx: number, spp: number): Promise<ComplexData[][]> {
  const out: ComplexData[][] = [];
  const maybeYield = makeYielder();
  for (let p = 0; p < nPulse; p++) {
    const rxArr: ComplexData[] = [];
    for (let r = 0; r < nRx; r++) {
      rxArr.push(_complexRow(re, im, p, r, nPulse, spp));
      await maybeYield();
    }
    out.push(rxArr);
  }
  return out;
}
