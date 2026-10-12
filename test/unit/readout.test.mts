import { test, describe } from "node:test";
import assert from "node:assert/strict";

const readout: any = await import("../../dist/renderer/js/readout.js");

/** The default waveform: 24 - 24.5 GHz over 80 us, 256 pulses 100 us apart, 2 MHz sampling. */
const DEFAULTS = {
  fStart: 24e9, fEnd: 24.5e9,
  tStart: 0, tEnd: 80e-6,
  prp: 100e-6, pulses: 256, fs: 2e6,
};

function near(actual: number, expected: number, tolerance: number = 1e-9): void {
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.abs(expected),
    `expected ${expected}, got ${actual}`);
}

describe("deriveReadout", () => {
  const r = readout.deriveReadout(DEFAULTS);
  const wavelength = 299792458 / 24.25e9;

  test("bandwidth and pulse length are the sweep's extents", () => {
    near(r.bandwidth, 500e6);
    near(r.pulseLength, 80e-6);
  });

  test("samples per pulse is the sweep at the sampling rate, not one over", () => {
    assert.equal(r.samplesPerPulse, 160);
  });

  test("range resolution is c / 2B", () => {
    near(r.rangeResolution, 299792458 / 1e9);
  });

  test("unambiguous velocity is a quarter wavelength per pulse period", () => {
    near(r.maxVelocity, wavelength / 400e-6);
  });

  test("velocity resolution is half a wavelength over the frame", () => {
    near(r.velocityResolution, wavelength / (2 * 256 * 100e-6));
  });

  test("a down-chirp resolves the same as an up-chirp", () => {
    const down = readout.deriveReadout({ ...DEFAULTS, fStart: 24.5e9, fEnd: 24e9 });
    near(down.bandwidth, 500e6);
    near(down.rangeResolution, r.rangeResolution);
  });

  test("undefined quantities are NaN rather than infinite", () => {
    const flat = readout.deriveReadout({ ...DEFAULTS, fEnd: 24e9, prp: 0 });
    assert.ok(Number.isNaN(flat.rangeResolution));
    assert.ok(Number.isNaN(flat.maxVelocity));
    assert.ok(Number.isNaN(flat.velocityResolution));
  });
});

describe("formatting", () => {
  test("lengths pick the unit that keeps them readable", () => {
    assert.equal(readout.formatLength(12.345), "12.3 m");
    assert.equal(readout.formatLength(0.2998), "30 cm");
    assert.equal(readout.formatLength(0.0042), "4.2 mm");
  });

  test("an undefined value is a dash", () => {
    assert.equal(readout.formatLength(NaN), "—");
    assert.equal(readout.formatSpeed(NaN), "—");
  });

  test("speeds keep three significant figures", () => {
    assert.equal(readout.formatSpeed(30.9064), "30.9 m/s");
  });
});
