// Integration tests against the real radarsimc library.
//
// These are the tests that catch drift between radarsim.h and the koffi
// bindings in bridge.ts -- a wrong signature is invisible to the type checker
// and only shows up as garbage results or a crash at runtime.
//
// They are skipped, not failed, when the native library is missing (the
// packaged Linux/macOS binaries lag the Windows one), and mesh cases are
// skipped without a license because the free tier rejects mesh targets.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LIB_DIR = path.join(REPO_ROOT, "radarsimlib");
const LIB_NAME = process.platform === "win32" ? "radarsimc.dll"
  : process.platform === "darwin" ? "libradarsimc.dylib"
    : "libradarsimc.so";
// Overridable so the skip path can be exercised without touching the real
// library, and so CI can point at a build output elsewhere.
const LIB_PATH = process.env.RADARSIMAPP_LIB_PATH || path.join(LIB_DIR, LIB_NAME);

let lib: any = null;
let loadError = "";
let licensed = false;

const fns: Record<string, any> = {};

before(async () => {
  if (!fs.existsSync(LIB_PATH)) {
    loadError = `native library not found at ${LIB_PATH}`;
    return;
  }
  try {
    const koffi = (await import("koffi")).default;
    lib = koffi.load(LIB_PATH);

    // Declared exactly as bridge.ts declares them. If a signature drifts from
    // radarsim.h, these calls are what notices.
    fns.Get_Version = lib.func("void Get_Version(int *version)");
    fns.Is_Licensed = lib.func("int Is_Licensed()");
    fns.Set_License_Files = lib.func("int Set_License_Files(const char **paths, int n, const char *product)");
    fns.Create_Transmitter = lib.func(
      "void *Create_Transmitter(double *freq, double *freq_time, int waveform_size," +
      " double *freq_offset, double *pulse_start_time, int num_pulses, float tx_power)"
    );
    fns.Add_Txchannel = lib.func(
      "int Add_Txchannel(float *location, float *polar_real, float *polar_imag," +
      " float *phi, float *phi_ptn, int phi_length," +
      " float *theta, float *theta_ptn, int theta_length, float antenna_gain," +
      " float *mod_t, float *mod_var_real, float *mod_var_imag, int mod_length," +
      " float *pulse_mod_real, float *pulse_mod_imag, float delay, float grid, void *ptr_tx_c)"
    );
    fns.Get_Num_Txchannel = lib.func("int Get_Num_Txchannel(void *p)");
    fns.Free_Transmitter = lib.func("void Free_Transmitter(void *p)");
    fns.Create_Receiver = lib.func(
      "void *Create_Receiver(float fs, float rf_gain, float resistor," +
      " float baseband_gain, float baseband_bw, double gate_delay)"
    );
    fns.Add_Rxchannel = lib.func(
      "int Add_Rxchannel(float *location, float *polar_real, float *polar_imag," +
      " float *phi, float *phi_ptn, int phi_length," +
      " float *theta, float *theta_ptn, int theta_length, float antenna_gain, void *p)"
    );
    fns.Get_Num_Rxchannel = lib.func("int Get_Num_Rxchannel(void *p)");
    fns.Free_Receiver = lib.func("void Free_Receiver(void *p)");
    fns.Create_Radar = lib.func(
      "void *Create_Radar(void *ptr_tx_c, void *ptr_rx_c, double *frame_start_time," +
      " int num_frames, float *location, float *speed, float *rotation, float *rotation_rate)"
    );
    fns.Get_BB_Size = lib.func("int Get_BB_Size(void *p)");
    fns.Free_Radar = lib.func("void Free_Radar(void *p)");
    fns.Get_Scene_State = lib.func(
      "int Get_Scene_State(void *ptr_radar_c, double *timestamp_array, int num_timestamps," +
      " float *tx_locations_out, float *rx_locations_out, float *boresight_out)"
    );
    fns.Init_Targets = lib.func("void *Init_Targets()");
    fns.Add_Point_Target = lib.func(
      "int Add_Point_Target(float *location, float *speed, float rcs, float phs, void *p)"
    );
    fns.Add_Mesh_Target = lib.func(
      "int Add_Mesh_Target(float *points, int *cells, int cell_size," +
      " float *origin, float *location, float *speed, float *rotation, float *rotation_rate," +
      " float ep_real, float ep_imag, float mu_real, float mu_imag," +
      " bool skip_diffusion, float density, bool environment, void *p)"
    );
    fns.Get_Num_Targets = lib.func("int Get_Num_Targets(void *p)");
    fns.Get_Target_Mesh_Size = lib.func("int Get_Target_Mesh_Size(void *p, int i)");
    fns.Get_Target_Mesh_State = lib.func(
      "int Get_Target_Mesh_State(void *p, int target_index, double *timestamp_array," +
      " int num_timestamps, double *sim_timestamps, int num_sim_timestamps, double *points_out)"
    );
    fns.Free_Targets = lib.func("void Free_Targets(void *p)");

    const licFiles = fs.readdirSync(LIB_DIR).filter((f) => /^license_.*\.lic$/.test(f));
    if (licFiles.length > 0) {
      const paths = licFiles.map((f) => path.join(LIB_DIR, f));
      for (const product of ["RadarSimApp", "RadarSimPy"]) {
        if (fns.Set_License_Files(paths, paths.length, product) === 1) break;
      }
    }
    licensed = fns.Is_Licensed() === 1;
  } catch (err) {
    loadError = (err as Error).message;
    lib = null;
  }
});

after(() => { lib = null; });

/** Skip the body when the library could not be loaded. */
function needsLib(t: any): boolean {
  if (!lib) { t.skip(loadError || "native library unavailable"); return true; }
  return false;
}

/** Skip the body when no license is active (free tier limits mesh + channels). */
function needsLicense(t: any): boolean {
  if (needsLib(t)) return true;
  if (!licensed) { t.skip("no active license; free tier rejects mesh targets"); return true; }
  return false;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const ISO_PHI = new Float32Array([-Math.PI / 2, Math.PI / 2]);
const ISO_THETA = new Float32Array([0, Math.PI]);
const ISO_PTN = new Float32Array([0, 0]);
const ZERO3 = () => new Float32Array(3);

function makeTransmitter(numPulses = 4): any {
  const tx = fns.Create_Transmitter(
    new Float64Array([24e9, 24.5e9]), new Float64Array([0, 80e-6]), 2,
    new Float64Array(numPulses), new Float64Array(numPulses), numPulses, 0
  );
  assert.ok(tx, "Create_Transmitter returned null");
  const ret = fns.Add_Txchannel(
    ZERO3(), new Float32Array([0, 0, 1]), ZERO3(),
    ISO_PHI, ISO_PTN, 2, ISO_THETA, ISO_PTN, 2, 0,
    new Float32Array(0), new Float32Array(0), new Float32Array(0), 0,
    new Float32Array(numPulses).fill(1), new Float32Array(numPulses),
    0, Math.PI / 180, tx
  );
  assert.equal(ret, 0, `Add_Txchannel failed with ${ret}`);
  return tx;
}

function makeReceiver(gateDelay = 0): any {
  const rx = fns.Create_Receiver(2e6, 20, 500, 30, 2e6, gateDelay);
  assert.ok(rx, "Create_Receiver returned null");
  const ret = fns.Add_Rxchannel(
    ZERO3(), new Float32Array([0, 0, 1]), ZERO3(),
    ISO_PHI, ISO_PTN, 2, ISO_THETA, ISO_PTN, 2, 0, rx
  );
  assert.equal(ret, 0, `Add_Rxchannel failed with ${ret}`);
  return rx;
}

/** A 1 m square in the x=0 plane, as two triangles. */
function unitPlate(): { points: Float32Array; cells: Int32Array; cellSize: number } {
  const points = new Float32Array([
    0, -0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5,
    0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5,
  ]);
  return { points, cells: new Int32Array([0, 1, 2, 3, 4, 5]), cellSize: 2 };
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe("library version", () => {
  test("reports the version the bindings were written against", (t) => {
    if (needsLib(t)) return;
    const v = new Int32Array(3);
    fns.Get_Version(v);
    assert.ok(v[0] >= 15, `major version ${v[0]} is older than expected`);
    // gate_delay on Create_Receiver and the scene-state API arrived in 15.3.
    const numeric = v[0] * 1000 + v[1];
    assert.ok(numeric >= 15003, `library is ${v.join(".")}, need >= 15.3.0`);
  });
});

describe("Create_Receiver", () => {
  test("accepts the gate_delay argument", (t) => {
    if (needsLib(t)) return;
    const rx = fns.Create_Receiver(2e6, 20, 500, 30, 2e6, 0);
    assert.ok(rx, "6-argument Create_Receiver should succeed");
    fns.Free_Receiver(rx);
  });

  test("accepts a non-zero gate delay", (t) => {
    if (needsLib(t)) return;
    const rx = fns.Create_Receiver(2e6, 20, 500, 30, 2e6, 1e-6);
    assert.ok(rx);
    fns.Free_Receiver(rx);
  });

  test("channel count reflects what was added", (t) => {
    if (needsLib(t)) return;
    const rx = makeReceiver();
    assert.equal(fns.Get_Num_Rxchannel(rx), 1);
    fns.Free_Receiver(rx);
  });
});

describe("Get_Scene_State", () => {
  test("places a stationary radar at its configured location", (t) => {
    if (needsLib(t)) return;
    const tx = makeTransmitter(), rx = makeReceiver();
    const radar = fns.Create_Radar(
      tx, rx, new Float64Array([0]), 1,
      new Float32Array([1, 2, 0.5]), ZERO3(), ZERO3(), ZERO3()
    );
    assert.ok(radar, "Create_Radar returned null");

    const txLoc = new Float32Array(3), rxLoc = new Float32Array(3), bore = new Float32Array(3);
    const status = fns.Get_Scene_State(radar, new Float64Array([0]), 1, txLoc, rxLoc, bore);
    assert.equal(status, 0, `Get_Scene_State returned ${status}`);
    assert.deepEqual(Array.from(txLoc), [1, 2, 0.5]);
    assert.deepEqual(Array.from(rxLoc), [1, 2, 0.5]);

    fns.Free_Radar(radar); fns.Free_Receiver(rx); fns.Free_Transmitter(tx);
  });

  test("rotation is interpreted in radians, not degrees", (t) => {
    if (needsLib(t)) return;
    const tx = makeTransmitter(), rx = makeReceiver();
    // 90 degrees expressed in radians must yaw the boresight from +x to +y.
    const radar = fns.Create_Radar(
      tx, rx, new Float64Array([0]), 1,
      ZERO3(), ZERO3(), new Float32Array([Math.PI / 2, 0, 0]), ZERO3()
    );
    const txLoc = new Float32Array(3), rxLoc = new Float32Array(3), bore = new Float32Array(3);
    assert.equal(fns.Get_Scene_State(radar, new Float64Array([0]), 1, txLoc, rxLoc, bore), 0);
    assert.ok(Math.abs(bore[0]) < 1e-5, `boresight x should be ~0, got ${bore[0]}`);
    assert.ok(Math.abs(bore[1] - 1) < 1e-5, `boresight y should be ~1, got ${bore[1]}`);
    fns.Free_Radar(radar); fns.Free_Receiver(rx); fns.Free_Transmitter(tx);
  });

  test("an unrotated radar looks down +x", (t) => {
    if (needsLib(t)) return;
    const tx = makeTransmitter(), rx = makeReceiver();
    const radar = fns.Create_Radar(tx, rx, new Float64Array([0]), 1, ZERO3(), ZERO3(), ZERO3(), ZERO3());
    const bore = new Float32Array(3);
    fns.Get_Scene_State(radar, new Float64Array([0]), 1, new Float32Array(3), new Float32Array(3), bore);
    assert.ok(Math.abs(bore[0] - 1) < 1e-5, `expected +x boresight, got ${Array.from(bore)}`);
    fns.Free_Radar(radar); fns.Free_Receiver(rx); fns.Free_Transmitter(tx);
  });

  test("a moving platform advances with time", (t) => {
    if (needsLib(t)) return;
    const tx = makeTransmitter(), rx = makeReceiver();
    const radar = fns.Create_Radar(
      tx, rx, new Float64Array([0]), 1,
      ZERO3(), new Float32Array([10, 0, 0]), ZERO3(), ZERO3()
    );
    const txLoc = new Float32Array(3);
    fns.Get_Scene_State(radar, new Float64Array([2]), 1, txLoc, new Float32Array(3), new Float32Array(3));
    assert.ok(Math.abs(txLoc[0] - 20) < 1e-4, `10 m/s for 2 s should reach x=20, got ${txLoc[0]}`);
    fns.Free_Radar(radar); fns.Free_Receiver(rx); fns.Free_Transmitter(tx);
  });

  test("rejects a null radar rather than crashing", (t) => {
    if (needsLib(t)) return;
    const status = fns.Get_Scene_State(
      null, new Float64Array([0]), 1,
      new Float32Array(3), new Float32Array(3), new Float32Array(3)
    );
    assert.notEqual(status, 0, "null radar should be an error, not success");
  });

  test("rejects a non-positive timestamp count", (t) => {
    if (needsLib(t)) return;
    const tx = makeTransmitter(), rx = makeReceiver();
    const radar = fns.Create_Radar(tx, rx, new Float64Array([0]), 1, ZERO3(), ZERO3(), ZERO3(), ZERO3());
    const status = fns.Get_Scene_State(
      radar, new Float64Array([0]), 0,
      new Float32Array(3), new Float32Array(3), new Float32Array(3)
    );
    assert.notEqual(status, 0);
    fns.Free_Radar(radar); fns.Free_Receiver(rx); fns.Free_Transmitter(tx);
  });
});

describe("Get_BB_Size", () => {
  test("scales with pulses and channels", (t) => {
    if (needsLib(t)) return;
    const tx = makeTransmitter(4), rx = makeReceiver();
    const radar = fns.Create_Radar(tx, rx, new Float64Array([0]), 1, ZERO3(), ZERO3(), ZERO3(), ZERO3());
    const size = fns.Get_BB_Size(radar);
    assert.ok(size > 0, `expected a positive baseband size, got ${size}`);
    assert.equal(size % 4, 0, "should be divisible by the pulse count");
    fns.Free_Radar(radar); fns.Free_Receiver(rx); fns.Free_Transmitter(tx);
  });
});

describe("target management", () => {
  test("Get_Num_Targets counts mesh targets only", (t) => {
    if (needsLib(t)) return;
    const targets = fns.Init_Targets();
    assert.ok(targets);
    assert.equal(fns.Get_Num_Targets(targets), 0);
    fns.Add_Point_Target(new Float32Array([10, 0, 0]), ZERO3(), 10, 0, targets);
    assert.equal(fns.Get_Num_Targets(targets), 0, "point targets are not mesh targets");
    fns.Free_Targets(targets);
  });

  test("Get_Num_Targets is 0 for a null handle", (t) => {
    if (needsLib(t)) return;
    assert.equal(fns.Get_Num_Targets(null), 0);
  });

  test("Get_Target_Mesh_Size is 0 for an out-of-range index", (t) => {
    if (needsLib(t)) return;
    const targets = fns.Init_Targets();
    assert.equal(fns.Get_Target_Mesh_Size(targets, 0), 0);
    assert.equal(fns.Get_Target_Mesh_Size(targets, -1), 0);
    fns.Free_Targets(targets);
  });
});

describe("Get_Target_Mesh_State", () => {
  test("returns the mesh translated to its configured location", (t) => {
    if (needsLicense(t)) return;
    const targets = fns.Init_Targets();
    const plate = unitPlate();
    const ret = fns.Add_Mesh_Target(
      plate.points, plate.cells, plate.cellSize,
      ZERO3(), new Float32Array([20, 5, 0]), ZERO3(), ZERO3(), ZERO3(),
      -1, 0, 1, 0, false, 0, false, targets
    );
    assert.equal(ret, 0, `Add_Mesh_Target failed with ${ret}`);
    assert.equal(fns.Get_Num_Targets(targets), 1);

    const cells = fns.Get_Target_Mesh_Size(targets, 0);
    assert.equal(cells, 2);

    const pts = new Float64Array(cells * 9);
    const status = fns.Get_Target_Mesh_State(targets, 0, new Float64Array([0]), 1, null, 0, pts);
    assert.equal(status, 0, `Get_Target_Mesh_State returned ${status}`);

    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < cells * 3; i++) {
      const x = pts[i * 3], y = pts[i * 3 + 1];
      assert.ok(Math.abs(x - 20) < 1e-4, `plate should sit at x=20, got ${x}`);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    assert.ok(Math.abs(minY - 4.5) < 1e-4, `min y ${minY}`);
    assert.ok(Math.abs(maxY - 5.5) < 1e-4, `max y ${maxY}`);

    fns.Free_Targets(targets);
  });

  test("applies rotation, in radians", (t) => {
    if (needsLicense(t)) return;
    const targets = fns.Init_Targets();
    const plate = unitPlate();
    // 90 deg yaw turns the x=0 plane into the y=0 plane.
    fns.Add_Mesh_Target(
      plate.points, plate.cells, plate.cellSize,
      ZERO3(), new Float32Array([10, 0, 0]), ZERO3(),
      new Float32Array([Math.PI / 2, 0, 0]), ZERO3(),
      -1, 0, 1, 0, false, 0, false, targets
    );
    const cells = fns.Get_Target_Mesh_Size(targets, 0);
    const pts = new Float64Array(cells * 9);
    assert.equal(fns.Get_Target_Mesh_State(targets, 0, new Float64Array([0]), 1, null, 0, pts), 0);

    let minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < cells * 3; i++) {
      minX = Math.min(minX, pts[i * 3]);
      maxX = Math.max(maxX, pts[i * 3 + 0]);
    }
    assert.ok(Math.abs(minX - 9.5) < 1e-4, `min x ${minX}`);
    assert.ok(Math.abs(maxX - 10.5) < 1e-4, `max x ${maxX}`);
    fns.Free_Targets(targets);
  });

  test("rejects an out-of-range target index", (t) => {
    if (needsLicense(t)) return;
    const targets = fns.Init_Targets();
    const plate = unitPlate();
    fns.Add_Mesh_Target(
      plate.points, plate.cells, plate.cellSize,
      ZERO3(), ZERO3(), ZERO3(), ZERO3(), ZERO3(),
      -1, 0, 1, 0, false, 0, false, targets
    );
    const status = fns.Get_Target_Mesh_State(targets, 5, new Float64Array([0]), 1, null, 0, new Float64Array(18));
    assert.notEqual(status, 0);
    fns.Free_Targets(targets);
  });

  test("does not mutate the live target: repeat queries agree", (t) => {
    if (needsLicense(t)) return;
    const targets = fns.Init_Targets();
    const plate = unitPlate();
    fns.Add_Mesh_Target(
      plate.points, plate.cells, plate.cellSize,
      ZERO3(), new Float32Array([7, 0, 0]), ZERO3(), ZERO3(), ZERO3(),
      -1, 0, 1, 0, false, 0, false, targets
    );
    const cells = fns.Get_Target_Mesh_Size(targets, 0);
    const a = new Float64Array(cells * 9);
    const b = new Float64Array(cells * 9);
    fns.Get_Target_Mesh_State(targets, 0, new Float64Array([0]), 1, null, 0, a);
    fns.Get_Target_Mesh_State(targets, 0, new Float64Array([0]), 1, null, 0, b);
    assert.deepEqual(Array.from(a), Array.from(b));
    fns.Free_Targets(targets);
  });
});
