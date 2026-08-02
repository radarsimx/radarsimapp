// Integration tests that drive the real RadarSimBridge against radarsimc.
//
// These exercise bridge.ts's own koffi bindings rather than re-declaring them,
// so a signature that drifts from radarsim.h fails here. Merely importing the
// module is itself a check: koffi resolves every lib.func() declaration at
// import time, so a renamed or removed export throws before any test runs.
//
// Skipped, not failed, when the native library is missing or too old -- the
// packaged Linux/macOS binaries currently lag the Windows one. Cases that need
// a mesh target additionally skip without a license, since the free tier
// rejects them.

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LIB_DIR = path.join(REPO_ROOT, "radarsimlib");
const LIB_NAME = process.platform === "win32" ? "radarsimc.dll"
  : process.platform === "darwin" ? "libradarsimc.dylib"
    : "libradarsimc.so";
const LIB_PATH = process.env.RADARSIMAPP_LIB_PATH || path.join(LIB_DIR, LIB_NAME);

const C = 299792458;

let bridge: any = null;
let loadError = "";
let licensed = false;
let version = "";

before(async () => {
  if (!fs.existsSync(LIB_PATH)) {
    loadError = `native library not found at ${LIB_PATH}`;
    return;
  }
  try {
    // Importing binds all ~34 exports. A stale library missing any of them
    // throws right here, which is the signal we want.
    const mod = await import("../../dist/bridge.js");
    bridge = new mod.RadarSimBridge();
    const info = await bridge.checkLibrary();
    version = info.radarsimlib_version;
    licensed = info.licensed;
  } catch (err) {
    loadError = (err as Error).message || String(err);
    bridge = null;
  }
});

function needsLib(t: any): boolean {
  if (!bridge) { t.skip(loadError || "native library unavailable"); return true; }
  return false;
}

function needsLicense(t: any): boolean {
  if (needsLib(t)) return true;
  if (!licensed) { t.skip("no active license; free tier rejects mesh targets"); return true; }
  return false;
}

// ── Config builders ──────────────────────────────────────────────────────────
const PULSE_LEN = 80e-6;
const F_START = 24e9;
const F_END = 24.5e9;
const FS = 2e6;
/** Chirp slope, Hz/s. */
const SLOPE = (F_END - F_START) / PULSE_LEN;

function baseConfig(overrides: any = {}): any {
  return {
    transmitter: {
      f: [F_START, F_END], t: [0, PULSE_LEN],
      pulses: 4, prp: 100e-6, tx_power: 10,
      channels: [{ location: [0, 0, 0] }],
      ...(overrides.transmitter || {}),
    },
    receiver: {
      fs: FS, noise_figure: 0, rf_gain: 20, baseband_gain: 30,
      load_resistor: 500, bb_type: "complex", gate_delay: 0,
      channels: [{ location: [0, 0, 0] }],
      ...(overrides.receiver || {}),
    },
    radar: {
      location: [0, 0, 0], speed: [0, 0, 0],
      rotation: [0, 0, 0], rotation_rate: [0, 0, 0],
      ...(overrides.radar || {}),
    },
    targets: overrides.targets ?? [{ location: [10, 0, 0], rcs: 20, speed: [0, 0, 0], phase: 0 }],
    simulation: { density: 1, level: "frame", ...(overrides.simulation || {}) },
    // Noise off by default so assertions are deterministic.
    processing: { noise: false, range_doppler: false, range_profile: false, ...(overrides.processing || {}) },
  };
}

/** Range-FFT one pulse of the returned baseband and report the peak bin. */
function peakRangeBin(baseband: any, pulse = 0, channel = 0): { bin: number; n: number } {
  const { re, im } = baseband[pulse][channel];
  const n = 1 << Math.ceil(Math.log2(re.length));
  const R = new Float64Array(n); R.set(re);
  const I = new Float64Array(n); I.set(im);
  // Naive DFT magnitude search: the arrays here are small and this keeps the
  // test independent of the app's own FFT.
  let best = 0, bestMag = -1;
  for (let k = 0; k < n; k++) {
    let sr = 0, si = 0;
    for (let s = 0; s < re.length; s++) {
      const ang = (-2 * Math.PI * k * s) / n;
      sr += R[s] * Math.cos(ang) - I[s] * Math.sin(ang);
      si += R[s] * Math.sin(ang) + I[s] * Math.cos(ang);
    }
    const mag = Math.hypot(sr, si);
    if (mag > bestMag) { bestMag = mag; best = k; }
  }
  return { bin: best, n };
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe("checkLibrary", () => {
  test("reports a version new enough for the bindings in use", (t) => {
    if (needsLib(t)) return;
    const [major, minor] = version.split(".").map(Number);
    assert.ok(major >= 15, `major ${major} older than expected`);
    // gate_delay on Create_Receiver and the scene-state API landed in 15.3.
    assert.ok(major * 1000 + minor >= 15003, `library is ${version}, need >= 15.3.0`);
  });

  test("reports availability and a boolean licence state", (t) => {
    if (needsLib(t)) return;
    assert.equal(typeof licensed, "boolean");
  });
});

describe("runSimulation", () => {
  test("returns a baseband shaped as [samples, pulses, channels]", async (t) => {
    if (needsLib(t)) return;
    const out = await bridge.runSimulation(baseConfig());
    const [spp, pulses, channels] = out.baseband_shape;
    assert.equal(pulses, 4);
    assert.equal(channels, 1);
    assert.ok(spp > 0, `samples per pulse was ${spp}`);
    // 80 us at 2 MS/s
    assert.equal(spp, Math.round(PULSE_LEN * FS));
  });

  test("baseband nests as [pulse][channel] with matching re/im lengths", async (t) => {
    if (needsLib(t)) return;
    const out = await bridge.runSimulation(baseConfig());
    const [spp, pulses, channels] = out.baseband_shape;
    assert.equal(out.baseband.length, pulses);
    assert.equal(out.baseband[0].length, channels);
    assert.equal(out.baseband[0][0].re.length, spp);
    assert.equal(out.baseband[0][0].im.length, spp);
  });

  test("a point target produces a non-zero return", async (t) => {
    if (needsLib(t)) return;
    const out = await bridge.runSimulation(baseConfig());
    const { re, im } = out.baseband[0][0];
    const energy = re.reduce((a: number, v: number, i: number) => a + v * v + im[i] * im[i], 0);
    assert.ok(energy > 0, "baseband was all zeros; the target produced no echo");
    assert.ok(re.every((v: number) => Number.isFinite(v)), "baseband contains NaN/Infinity");
  });

  test("no targets produces a silent baseband", async (t) => {
    if (needsLib(t)) return;
    const out = await bridge.runSimulation(baseConfig({ targets: [] }));
    const { re, im } = out.baseband[0][0];
    const energy = re.reduce((a: number, v: number, i: number) => a + v * v + im[i] * im[i], 0);
    assert.ok(energy < 1e-20, `expected silence, got energy ${energy}`);
  });

  test("a more distant target beats at a higher range bin", async (t) => {
    if (needsLib(t)) return;
    const near = await bridge.runSimulation(baseConfig({
      targets: [{ location: [10, 0, 0], rcs: 20, speed: [0, 0, 0], phase: 0 }],
    }));
    const far = await bridge.runSimulation(baseConfig({
      targets: [{ location: [30, 0, 0], rcs: 20, speed: [0, 0, 0], phase: 0 }],
    }));
    const a = peakRangeBin(near.baseband);
    const b = peakRangeBin(far.baseband);
    assert.ok(b.bin > a.bin, `10 m peaked at ${a.bin}, 30 m at ${b.bin}`);
  });

  test("the beat frequency matches the chirp slope", async (t) => {
    if (needsLib(t)) return;
    const range = 30;
    const out = await bridge.runSimulation(baseConfig({
      targets: [{ location: [range, 0, 0], rcs: 20, speed: [0, 0, 0], phase: 0 }],
    }));
    const { bin, n } = peakRangeBin(out.baseband);
    const expected = (SLOPE * ((2 * range) / C) * n) / FS;
    assert.ok(Math.abs(bin - expected) <= 2, `peak bin ${bin}, expected about ${expected.toFixed(1)}`);
  });

  // The parameter added for radarsimlib 15.3: the deramp reference is delayed
  // by gate_delay, so a target at c*gate_delay/2 beats at DC.
  test("gate_delay moves the matching target to DC", async (t) => {
    if (needsLib(t)) return;
    const range = 30;
    const target = [{ location: [range, 0, 0], rcs: 20, speed: [0, 0, 0], phase: 0 }];

    const ungated = await bridge.runSimulation(baseConfig({ targets: target }));
    const gated = await bridge.runSimulation(baseConfig({
      targets: target,
      receiver: { gate_delay: (2 * range) / C },
    }));

    const before = peakRangeBin(ungated.baseband).bin;
    const after = peakRangeBin(gated.baseband).bin;
    assert.ok(before > 5, `expected an off-DC peak without gating, got ${before}`);
    assert.ok(after <= 1, `expected a DC peak with gating, got ${after}`);
  });

  test("range-doppler output appears only when requested", async (t) => {
    if (needsLib(t)) return;
    const off = await bridge.runSimulation(baseConfig());
    assert.equal(off.range_doppler, undefined);

    const on = await bridge.runSimulation(baseConfig({ processing: { range_doppler: true } }));
    assert.ok(Array.isArray(on.range_doppler));
    assert.equal(on.range_doppler.length, on.rd_doppler_fft_size);
    assert.equal(on.range_doppler[0][0].length, on.rd_range_fft_size);
    assert.equal(on.rd_doppler_axis.length, on.rd_doppler_fft_size);
  });

  test("enabling noise perturbs an otherwise identical run", async (t) => {
    if (needsLib(t)) return;
    const quiet = await bridge.runSimulation(baseConfig());
    const noisy = await bridge.runSimulation(baseConfig({
      receiver: { noise_figure: 12 },
      processing: { noise: true },
    }));
    assert.notDeepEqual(noisy.baseband[0][0].re, quiet.baseband[0][0].re);
  });

  test("a real baseband has a zeroed imaginary part", async (t) => {
    if (needsLib(t)) return;
    const out = await bridge.runSimulation(baseConfig({ receiver: { bb_type: "real" } }));
    assert.equal(out.bb_type, "real");
    assert.ok(out.baseband[0][0].im.every((v: number) => v === 0));
  });

  test("results are JSON-serialisable, as IPC requires", async (t) => {
    if (needsLib(t)) return;
    const out = await bridge.runSimulation(baseConfig());
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(out)));
  });

  test("mismatched frequency and time vectors are rejected", async (t) => {
    if (needsLib(t)) return;
    await assert.rejects(
      () => bridge.runSimulation(baseConfig({
        transmitter: { f: [F_START, F_END, 25e9], t: [0, PULSE_LEN] },
      })),
      /same length/
    );
  });

  // A single-element t is normalized to [0, t0], so t:[0] yields a zero-length
  // pulse. That should surface as a clear error, not a crash or empty result.
  test("a zero-length pulse is rejected rather than silently producing nothing", async (t) => {
    if (needsLib(t)) return;
    await assert.rejects(
      () => bridge.runSimulation(baseConfig({ transmitter: { t: [0] } })),
      /Get_BB_Size returned 0/
    );
  });

  test("a prp shorter than the pulse is rejected", async (t) => {
    if (needsLib(t)) return;
    await assert.rejects(
      () => bridge.runSimulation(baseConfig({ transmitter: { prp: 1e-6 } })),
      /prp can't be smaller/
    );
  });
});

describe("getSceneState", () => {
  test("places a stationary radar at its configured location", async (t) => {
    if (needsLib(t)) return;
    const s = await bridge.getSceneState(baseConfig({ radar: { location: [1, 2, 0.5] } }));
    assert.deepEqual(s.warnings, [], `unexpected warnings: ${s.warnings.join("; ")}`);
    assert.deepEqual(Array.from(s.txLocations), [1, 2, 0.5]);
    assert.deepEqual(Array.from(s.rxLocations), [1, 2, 0.5]);
  });

  test("an unrotated radar looks down +x", async (t) => {
    if (needsLib(t)) return;
    const s = await bridge.getSceneState(baseConfig());
    assert.ok(Math.abs(s.boresight[0] - 1) < 1e-5, `got ${Array.from(s.boresight)}`);
  });

  // Regression: the config carries degrees, Create_Radar takes radians, and
  // the bridge is what converts. 90 sent through raw yaws by 90 rad.
  test("a 90 degree yaw in the config turns the boresight to +y", async (t) => {
    if (needsLib(t)) return;
    const s = await bridge.getSceneState(baseConfig({ radar: { rotation: [90, 0, 0] } }));
    assert.ok(Math.abs(s.boresight[0]) < 1e-5, `boresight x should be ~0, got ${s.boresight[0]}`);
    assert.ok(Math.abs(s.boresight[1] - 1) < 1e-5, `boresight y should be ~1, got ${s.boresight[1]}`);
  });

  test("a moving platform advances with the query timestamp", async (t) => {
    if (needsLib(t)) return;
    const cfg = baseConfig({ radar: { speed: [10, 0, 0] } });
    const at0 = await bridge.getSceneState({ ...cfg, timestamp: 0 });
    const at2 = await bridge.getSceneState({ ...cfg, timestamp: 2 });
    assert.ok(Math.abs(at0.txLocations[0]) < 1e-4);
    assert.ok(Math.abs(at2.txLocations[0] - 20) < 1e-4, `expected x=20, got ${at2.txLocations[0]}`);
  });

  test("point targets contribute no mesh geometry", async (t) => {
    if (needsLib(t)) return;
    const s = await bridge.getSceneState(baseConfig());
    assert.deepEqual(s.meshes, []);
  });

  test("a missing model file is reported as a warning, not a throw", async (t) => {
    if (needsLib(t)) return;
    const s = await bridge.getSceneState(baseConfig({
      targets: [{ model: path.join(LIB_DIR, "does-not-exist.stl"), location: [10, 0, 0] }],
    }));
    assert.equal(s.meshes.length, 0);
    assert.match(s.warnings.join(" "), /model file not found/);
  });

  test("mesh geometry comes back transformed to the target's pose", async (t) => {
    if (needsLicense(t)) return;
    const stl = path.join(REPO_ROOT, "test", "fixtures", "plate.stl");
    const s = await bridge.getSceneState(baseConfig({
      targets: [{
        model: stl, unit: "m", location: [20, 5, 0],
        speed: [0, 0, 0], rotation: [0, 0, 0], rotation_rate: [0, 0, 0],
      }],
    }));
    assert.deepEqual(s.warnings, [], `unexpected warnings: ${s.warnings.join("; ")}`);
    assert.equal(s.meshes.length, 1);

    const m = s.meshes[0];
    assert.equal(m.index, 0);
    assert.equal(m.totalCells, 2);
    assert.equal(m.cells, 2);
    assert.equal(m.x.length, 6, "2 triangles x 3 vertices");
    const [minX, minY, , maxX, maxY] = m.bounds;
    assert.ok(Math.abs(minX - 20) < 1e-4 && Math.abs(maxX - 20) < 1e-4, `x bounds ${minX}..${maxX}`);
    assert.ok(Math.abs(minY - 4.5) < 1e-4, `min y ${minY}`);
    assert.ok(Math.abs(maxY - 5.5) < 1e-4, `max y ${maxY}`);
  });

  test("mesh rotation is applied, and the config's degrees are converted", async (t) => {
    if (needsLicense(t)) return;
    const stl = path.join(REPO_ROOT, "test", "fixtures", "plate.stl");
    const s = await bridge.getSceneState(baseConfig({
      targets: [{
        model: stl, unit: "m", location: [10, 0, 0],
        speed: [0, 0, 0], rotation: [90, 0, 0], rotation_rate: [0, 0, 0],
      }],
    }));
    assert.equal(s.meshes.length, 1);
    // A 90 deg yaw turns the x=const plate into a y=const one.
    const [minX, , , maxX] = s.meshes[0].bounds;
    assert.ok(Math.abs(minX - 9.5) < 1e-4, `min x ${minX}`);
    assert.ok(Math.abs(maxX - 10.5) < 1e-4, `max x ${maxX}`);
  });

  test("the model unit scales the geometry", async (t) => {
    if (needsLicense(t)) return;
    const stl = path.join(REPO_ROOT, "test", "fixtures", "plate.stl");
    const mk = (unit: string) => bridge.getSceneState(baseConfig({
      targets: [{
        model: stl, unit, location: [10, 0, 0],
        speed: [0, 0, 0], rotation: [0, 0, 0], rotation_rate: [0, 0, 0],
      }],
    }));
    const inMetres = await mk("m");
    const inMillimetres = await mk("mm");
    const spanY = (s: any) => s.meshes[0].bounds[4] - s.meshes[0].bounds[1];
    assert.ok(Math.abs(spanY(inMetres) - 1) < 1e-4);
    assert.ok(Math.abs(spanY(inMillimetres) - 1e-3) < 1e-6);
  });

  test("mesh indices survive an unreadable model earlier in the list", async (t) => {
    if (needsLicense(t)) return;
    const stl = path.join(REPO_ROOT, "test", "fixtures", "plate.stl");
    const s = await bridge.getSceneState(baseConfig({
      targets: [
        { model: path.join(LIB_DIR, "missing.stl"), location: [5, 0, 0] },
        {
          model: stl, unit: "m", location: [20, 0, 0],
          speed: [0, 0, 0], rotation: [0, 0, 0], rotation_rate: [0, 0, 0],
        },
      ],
    }));
    assert.equal(s.meshes.length, 1);
    assert.equal(s.meshes[0].index, 1, "the surviving mesh keeps its original position");
    assert.match(s.warnings.join(" "), /Mesh 1: model file not found/);
  });
});
