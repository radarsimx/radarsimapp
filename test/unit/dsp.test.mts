import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  randn, nextPow2, fft, applyRangeFFT, applyDopplerFFT, toDbMag3D, toComplex3D,
} from "../../dist/dsp.js";

/** Peak bin of a magnitude spectrum. */
function peakBin(re: Float64Array, im: Float64Array, offset = 0, len = re.length): number {
  let best = 0, bestMag = -1;
  for (let i = 0; i < len; i++) {
    const mag = Math.hypot(re[offset + i], im[offset + i]);
    if (mag > bestMag) { bestMag = mag; best = i; }
  }
  return best;
}

describe("nextPow2", () => {
  test("rounds up to the next power of two", () => {
    assert.equal(nextPow2(1), 1);
    assert.equal(nextPow2(2), 2);
    assert.equal(nextPow2(3), 4);
    assert.equal(nextPow2(100), 128);
    assert.equal(nextPow2(1024), 1024);
    assert.equal(nextPow2(1025), 2048);
  });

  test("zero and negatives collapse to 1", () => {
    assert.equal(nextPow2(0), 1);
    assert.equal(nextPow2(-5), 1);
  });
});

describe("fft", () => {
  test("DC input puts all energy in bin 0", () => {
    const n = 8;
    const re = new Float64Array(n).fill(1);
    const im = new Float64Array(n);
    fft(re, im);
    assert.ok(Math.abs(re[0] - n) < 1e-9);
    for (let i = 1; i < n; i++) {
      assert.ok(Math.hypot(re[i], im[i]) < 1e-9, `bin ${i} should be empty`);
    }
  });

  test("an impulse produces a flat spectrum", () => {
    const n = 8;
    const re = new Float64Array(n); re[0] = 1;
    const im = new Float64Array(n);
    fft(re, im);
    for (let i = 0; i < n; i++) {
      assert.ok(Math.abs(Math.hypot(re[i], im[i]) - 1) < 1e-9);
    }
  });

  test("a complex exponential lands in exactly its bin", () => {
    const n = 16, k = 3;
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      re[i] = Math.cos((2 * Math.PI * k * i) / n);
      im[i] = Math.sin((2 * Math.PI * k * i) / n);
    }
    fft(re, im);
    assert.equal(peakBin(re, im), k);
    assert.ok(Math.abs(Math.hypot(re[k], im[k]) - n) < 1e-9);
  });

  test("Parseval: energy is preserved up to the N factor", () => {
    const n = 16;
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) { re[i] = Math.sin(i); im[i] = Math.cos(i * 0.3); }
    const before = re.reduce((a, v, i) => a + v * v + im[i] * im[i], 0);
    fft(re, im);
    const after = re.reduce((a, v, i) => a + v * v + im[i] * im[i], 0);
    assert.ok(Math.abs(after - n * before) < 1e-6, `${after} vs ${n * before}`);
  });

  test("transforms in place", () => {
    const re = new Float64Array([1, 0, 0, 0]);
    const im = new Float64Array(4);
    const ret = fft(re, im);
    assert.equal(ret, undefined);
    assert.equal(re[1], 1, "input buffer was rewritten with the spectrum");
  });
});

describe("applyRangeFFT", () => {
  test("shapes output as nRx * nPulse * fftSize", () => {
    const nPulse = 2, nRx = 3, spp = 8, n = 16;
    const re = new Float64Array(nPulse * nRx * spp);
    const im = new Float64Array(nPulse * nRx * spp);
    const out = applyRangeFFT(re, im, nPulse, nRx, spp, n);
    assert.equal(out.re.length, n * nPulse * nRx);
    assert.equal(out.im.length, n * nPulse * nRx);
  });

  test("defaults the FFT size to the next power of two", () => {
    const nPulse = 1, nRx = 1, spp = 5;
    const out = applyRangeFFT(new Float64Array(spp), new Float64Array(spp), nPulse, nRx, spp);
    assert.equal(out.re.length, 8);
  });

  test("each channel/pulse is transformed independently", () => {
    const nPulse = 2, nRx = 2, spp = 8, n = 8;
    const re = new Float64Array(nPulse * nRx * spp);
    const im = new Float64Array(nPulse * nRx * spp);
    // Give every (channel, pulse) a distinct tone.
    const tones = [1, 2, 3, 4];
    for (let c = 0; c < nRx; c++) {
      for (let p = 0; p < nPulse; p++) {
        const k = tones[c * nPulse + p];
        const base = (c * nPulse + p) * spp;
        for (let s = 0; s < spp; s++) {
          re[base + s] = Math.cos((2 * Math.PI * k * s) / spp);
          im[base + s] = Math.sin((2 * Math.PI * k * s) / spp);
        }
      }
    }
    const out = applyRangeFFT(re, im, nPulse, nRx, spp, n);
    for (let c = 0; c < nRx; c++) {
      for (let p = 0; p < nPulse; p++) {
        const base = (c * nPulse + p) * n;
        assert.equal(peakBin(out.re, out.im, base, n), tones[c * nPulse + p]);
      }
    }
  });

  test("zero-pads when the FFT is longer than the sample count", () => {
    const spp = 4, n = 16;
    const re = new Float64Array(spp).fill(1);
    const im = new Float64Array(spp);
    const out = applyRangeFFT(re, im, 1, 1, spp, n);
    // 4 ones zero-padded to 16 -> DC bin equals 4
    assert.ok(Math.abs(out.re[0] - 4) < 1e-9);
  });

  test("does not modify its input buffers", () => {
    const re = new Float64Array([1, 2, 3, 4]);
    const im = new Float64Array(4);
    applyRangeFFT(re, im, 1, 1, 4, 4);
    assert.deepEqual(Array.from(re), [1, 2, 3, 4]);
  });
});

describe("applyDopplerFFT", () => {
  test("output is fftshifted so zero Doppler sits at the centre", () => {
    const nPulse = 8, nRx = 1, rangeDim = 1, n = 8;
    // Constant across pulses -> all energy at zero Doppler.
    const re = new Float64Array(nPulse).fill(1);
    const im = new Float64Array(nPulse);
    const out = applyDopplerFFT(re, im, nPulse, nRx, rangeDim, n);
    assert.equal(peakBin(out.re, out.im, 0, n), n / 2, "DC should be shifted to the middle");
    assert.ok(Math.abs(out.re[n / 2] - nPulse) < 1e-9);
  });

  test("shapes output as nRx * fftSize * rangeDim", () => {
    const nPulse = 4, nRx = 2, rangeDim = 3, n = 8;
    const re = new Float64Array(nPulse * nRx * rangeDim);
    const im = new Float64Array(nPulse * nRx * rangeDim);
    const out = applyDopplerFFT(re, im, nPulse, nRx, rangeDim, n);
    assert.equal(out.re.length, rangeDim * n * nRx);
  });

  test("range bins stay separated", () => {
    const nPulse = 4, nRx = 1, rangeDim = 2, n = 4;
    const re = new Float64Array(nPulse * rangeDim);
    const im = new Float64Array(nPulse * rangeDim);
    // Only range bin 1 carries energy.
    for (let p = 0; p < nPulse; p++) re[p * rangeDim + 1] = 1;
    const out = applyDopplerFFT(re, im, nPulse, nRx, rangeDim, n);
    let bin0 = 0, bin1 = 0;
    for (let p = 0; p < n; p++) {
      bin0 += Math.hypot(out.re[p * rangeDim], out.im[p * rangeDim]);
      bin1 += Math.hypot(out.re[p * rangeDim + 1], out.im[p * rangeDim + 1]);
    }
    assert.ok(bin0 < 1e-9, "empty range bin stays empty");
    assert.ok(bin1 > 1, "occupied range bin carries the energy");
  });
});

describe("toDbMag3D", () => {
  test("magnitude 1 is 0 dB", () => {
    const out = toDbMag3D(new Float64Array([1]), new Float64Array([0]), 1, 1, 1);
    assert.ok(Math.abs(out[0][0][0]) < 1e-9);
  });

  test("a factor of 10 in amplitude is 20 dB", () => {
    const out = toDbMag3D(new Float64Array([10]), new Float64Array([0]), 1, 1, 1);
    assert.ok(Math.abs(out[0][0][0] - 20) < 1e-9);
  });

  test("uses complex magnitude, not just the real part", () => {
    const out = toDbMag3D(new Float64Array([3]), new Float64Array([4]), 1, 1, 1);
    assert.ok(Math.abs(out[0][0][0] - 20 * Math.log10(5)) < 1e-9);
  });

  test("zero is floored instead of -Infinity", () => {
    const out = toDbMag3D(new Float64Array([0]), new Float64Array([0]), 1, 1, 1);
    assert.ok(Number.isFinite(out[0][0][0]));
    assert.ok(out[0][0][0] < -200);
  });

  test("nests as [pulse][channel][sample]", () => {
    const nPulse = 2, nRx = 3, spp = 4;
    const re = new Float64Array(nPulse * nRx * spp).fill(1);
    const im = new Float64Array(nPulse * nRx * spp);
    const out = toDbMag3D(re, im, nPulse, nRx, spp);
    assert.equal(out.length, nPulse);
    assert.equal(out[0].length, nRx);
    assert.equal(out[0][0].length, spp);
  });
});

describe("toComplex3D", () => {
  test("splits the flat buffers into per-pulse, per-channel slices", () => {
    const nPulse = 2, nRx = 2, spp = 3;
    const re = new Float64Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const im = new Float64Array(12).fill(-1);
    const out = toComplex3D(re, im, nPulse, nRx, spp);
    assert.equal(out.length, nPulse);
    assert.equal(out[0].length, nRx);
    // layout is (channel * nPulse + pulse) * spp
    assert.deepEqual(out[0][0].re, [1, 2, 3]);   // c=0 p=0
    assert.deepEqual(out[1][0].re, [4, 5, 6]);   // c=0 p=1
    assert.deepEqual(out[0][1].re, [7, 8, 9]);   // c=1 p=0
    assert.deepEqual(out[1][1].re, [10, 11, 12]); // c=1 p=1
    assert.deepEqual(out[0][0].im, [-1, -1, -1]);
  });

  test("returns plain arrays, which survive IPC structured clone", () => {
    const out = toComplex3D(new Float64Array([1]), new Float64Array([2]), 1, 1, 1);
    assert.ok(Array.isArray(out[0][0].re));
  });
});

describe("randn", () => {
  test("produces a roughly standard normal distribution", () => {
    const n = 20000;
    let sum = 0, sumSq = 0;
    for (let i = 0; i < n; i++) {
      const v = randn();
      assert.ok(Number.isFinite(v), "must never emit NaN or Infinity");
      sum += v; sumSq += v * v;
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    assert.ok(Math.abs(mean) < 0.05, `mean ${mean} should be near 0`);
    assert.ok(Math.abs(variance - 1) < 0.1, `variance ${variance} should be near 1`);
  });

  test("consecutive draws differ", () => {
    const vals = new Set(Array.from({ length: 10 }, () => randn()));
    assert.ok(vals.size > 1);
  });
});
