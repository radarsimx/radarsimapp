"use strict";
// ===== RadarSimApp - Native C Bridge =====

import koffi from "koffi";
import * as path from "path";
import * as fs from "fs";

import {
  errorMsg, toF32, toF64, deg2rad,
  parseComplex, buildAntennaPattern, ComplexParsed,
} from "./convert.js";
import {
  randn, nextPow2, makeYielder,
  applyRangeFFTAsync, applyDopplerFFTAsync, toDbMag3DAsync, toComplex3DAsync,
} from "./dsp.js";
import { loadStl, packSceneMesh, SceneMesh } from "./mesh.js";

// ── Resolve real filesystem path (asar-unpacked in packaged builds) ──────────
// __dirname is dist/ at runtime; the native library lives in radarsimlib/
// at the project root (one level up from dist/).
const baseDir: string = path
  .join(__dirname, "..", "radarsimlib")
  .replace("app.asar", "app.asar.unpacked");

// ── Native library ───────────────────────────────────────────────────────────
const libName: string = process.platform === "win32" ? "radarsimc.dll"
  : process.platform === "darwin" ? "libradarsimc.dylib"
  : "libradarsimc.so";
const libPath: string = path.join(baseDir, libName);
const lib = koffi.load(libPath);

// ── Function bindings ─────────────────────────────────────────────────────────
const Get_Version = lib.func("void Get_Version(int *version)");
const Is_Licensed = lib.func("int Is_Licensed()");
const Set_License_Files = lib.func("int Set_License_Files(const char **license_file_paths, int num_files, const char *product)");

// ── License activation ─────────────────────────────────────────────────────────
interface LicenseProduct {
  pattern: RegExp;
  product: string;
}

const LICENSE_PRODUCTS: LicenseProduct[] = [
  { pattern: /^license_RadarSimApp_.*\.lic$/, product: "RadarSimApp" },
  { pattern: /^license_RadarSimPy_.*\.lic$/,  product: "RadarSimPy"  },
];

// radarsimc's own spelling of each platform. A license issued for "all" runs
// anywhere; anything else has to match the build it is loaded into.
const PLATFORM_NAMES: Record<string, string> = {
  win32: "Windows",
  darwin: "macOS",
  linux: "Linux",
};

interface LicensePayload {
  product_name?: string;
  product_platform?: string;
  expiration_date?: string;
}

interface LicenseRejection {
  reason: string;
  expired: boolean;
}

// A .lic file is a text envelope around two base64 blocks: the license key --
// JSON describing what was issued -- and its RSA signature. radarsimc writes
// the reason it rejected a file straight to stderr rather than returning it,
// so decode the key ourselves to explain the failure.
function readLicensePayload(licPath: string): LicensePayload | null {
  let text: string;
  try {
    text = fs.readFileSync(licPath, "utf8");
  } catch {
    return null;
  }
  for (const line of text.split(/\r?\n/)) {
    const block = line.trim();
    if (block.length < 40 || !/^[A-Za-z0-9+/]+={0,2}$/.test(block)) continue;
    try {
      // The signature is base64 too, but it is not JSON, so it falls through.
      const payload: unknown = JSON.parse(Buffer.from(block, "base64").toString("utf8"));
      if (payload && typeof payload === "object") return payload as LicensePayload;
    } catch { /* Not the key block -- keep looking. */ }
  }
  return null;
}

// Explains why radarsimc turned a license file down. Only `expired` is certain
// enough to archive a file on; every other verdict leaves it where it is, since
// moving it destroys the evidence needed to fix it.
function diagnoseLicense(licPath: string, product?: string): LicenseRejection {
  const payload = readLicensePayload(licPath);
  if (!payload) {
    return { reason: "no readable license key block -- malformed or truncated file", expired: false };
  }

  // Payload timestamps are UTC, unlike the local-time dates in the file header.
  const expiry = payload.expiration_date
    ? Date.parse(`${payload.expiration_date.replace(" ", "T")}Z`)
    : NaN;
  if (!Number.isNaN(expiry) && expiry < Date.now()) {
    return { reason: `expired on ${payload.expiration_date} UTC`, expired: true };
  }

  const platform = PLATFORM_NAMES[process.platform] ?? process.platform;
  const issuedFor = payload.product_platform;
  if (issuedFor && issuedFor.toLowerCase() !== "all" && issuedFor !== platform) {
    return { reason: `issued for ${issuedFor}, but this build is ${platform}`, expired: false };
  }

  if (product && payload.product_name && payload.product_name !== product) {
    return { reason: `issued for ${payload.product_name}, not ${product}`, expired: false };
  }

  return { reason: "rejected by radarsimc -- see its output above", expired: false };
}

{
  const allFiles = fs.readdirSync(baseDir);
  let anyFound = false;
  for (const { pattern, product } of LICENSE_PRODUCTS) {
    const licFiles = allFiles.filter((f) => pattern.test(f));
    if (licFiles.length === 0) continue;
    anyFound = true;
    const licPaths = licFiles.map((f) => path.join(baseDir, f));
    const licensed = Set_License_Files(licPaths, licPaths.length, product) === 1;
    console.log(`[bridge] License activation (${product}):`, licensed ? "success" : "failed");
    if (!licensed) {
      // Name the build that did the rejecting. radarsimc's license parser has
      // changed between releases, so a bug report is only actionable with the
      // version attached -- and it catches a stale or mismatched library.
      const version = new Int32Array(3);
      Get_Version(version);
      console.warn(`[bridge] radarsimc ${version[0]}.${version[1]}.${version[2]} — ${libPath}`);

      // A batch only fails when every file in it does, so each one needs a
      // reason of its own. Expired files are archived; the rest stay put.
      const expiredDir = path.join(baseDir, "expired");
      for (const p of licPaths) {
        const { reason, expired } = diagnoseLicense(p, product);
        console.warn(`[bridge] ${path.basename(p)}: ${reason}`);
        if (!expired) continue;
        fs.mkdirSync(expiredDir, { recursive: true });
        fs.renameSync(p, path.join(expiredDir, path.basename(p)));
        console.warn(`[bridge] Moved expired license file to:`, expiredDir);
      }
    }
  }
  if (!anyFound) console.warn("[bridge] No license files found in", baseDir);
}

const Create_Transmitter = lib.func(
  "void *Create_Transmitter(double *freq, double *freq_time, int waveform_size," +
  " double *freq_offset, double *pulse_start_time, int num_pulses, float tx_power)"
);
const Create_Transmitter_SSBPhaseNoise = lib.func(
  "void *Create_Transmitter_SSBPhaseNoise(double *freq, double *freq_time," +
  " int waveform_size, double *freq_offset, double *pulse_start_time," +
  " int num_pulses, float tx_power, double *pn_freq, double *pn_power," +
  " int pn_size, double pn_fs, int pn_num_samples, uint64 pn_seed, bool pn_validation)"
);
const Add_Txchannel = lib.func(
  "int Add_Txchannel(float *location, float *polar_real, float *polar_imag," +
  " float *phi, float *phi_ptn, int phi_length," +
  " float *theta, float *theta_ptn, int theta_length," +
  " float antenna_gain," +
  " float *mod_t, float *mod_var_real, float *mod_var_imag, int mod_length," +
  " float *pulse_mod_real, float *pulse_mod_imag," +
  " float delay, float grid, void *ptr_tx_c)"
);
const Get_Num_Txchannel = lib.func("int Get_Num_Txchannel(void *ptr_tx_c)");
const Free_Transmitter = lib.func("void Free_Transmitter(void *ptr_tx_c)");

const Create_Receiver = lib.func(
  "void *Create_Receiver(float fs, float rf_gain, float resistor," +
  " float baseband_gain, float baseband_bw, double gate_delay)"
);
const Add_Rxchannel = lib.func(
  "int Add_Rxchannel(float *location, float *polar_real, float *polar_imag," +
  " float *phi, float *phi_ptn, int phi_length," +
  " float *theta, float *theta_ptn, int theta_length," +
  " float antenna_gain, void *ptr_rx_c)"
);
const Get_Num_Rxchannel = lib.func("int Get_Num_Rxchannel(void *ptr_rx_c)");
const Free_Receiver = lib.func("void Free_Receiver(void *ptr_rx_c)");

const Create_Radar = lib.func(
  "void *Create_Radar(void *ptr_tx_c, void *ptr_rx_c," +
  " double *frame_start_time, int num_frames," +
  " float *location, float *speed, float *rotation, float *rotation_rate)"
);
const Create_Radar_Array = lib.func(
  "void *Create_Radar_Array(void *ptr_tx_c, void *ptr_rx_c," +
  " double *frame_start_time, int num_frames," +
  " float *location_array, int num_locations, float *speed," +
  " float *rotation_array, int num_rotations, float *rotation_rate)"
);
const Get_BB_Size = lib.func("int Get_BB_Size(void *ptr_radar_c)");
const Free_Radar = lib.func("void Free_Radar(void *ptr_radar_c)");

const Init_Targets = lib.func("void *Init_Targets()");
const Add_Point_Target = lib.func(
  "int Add_Point_Target(float *location, float *speed," +
  " float rcs, float phs, void *ptr_targets_c)"
);
const Add_Point_Target_Array = lib.func(
  "int Add_Point_Target_Array(float *location_array, int num_locations, float *speed," +
  " float *rcs_array, float *phase_array, int num_rcs, void *ptr_targets_c)"
);
const Add_Mesh_Target = lib.func(
  "int Add_Mesh_Target(float *points, int *cells, int cell_size," +
  " float *origin, float *location, float *speed," +
  " float *rotation, float *rotation_rate," +
  " float ep_real, float ep_imag, float mu_real, float mu_imag," +
  " bool skip_diffusion, float density, bool environment," +
  " void *ptr_targets_c)"
);
const Add_Mesh_Target_Array = lib.func(
  "int Add_Mesh_Target_Array(float *points, int *cells, int cell_size," +
  " float *origin, float *location_array, float *speed_array," +
  " float *rotation_array, float *rotation_rate_array, int num_motions," +
  " float ep_real, float ep_imag, float mu_real, float mu_imag," +
  " bool skip_diffusion, float density, bool environment, void *ptr_targets_c)"
);
const Free_Targets = lib.func("void Free_Targets(void *ptr_targets_c)");

const Get_Radar_State = lib.func(
  "int Get_Radar_State(void *ptr_radar_c, double *timestamp_array, int num_timestamps," +
  " float *tx_locations_out, float *rx_locations_out, float *boresight_out)"
);
const Get_Num_Targets = lib.func("int Get_Num_Targets(void *ptr_targets_c)");
const Get_Target_Mesh_Size = lib.func("int Get_Target_Mesh_Size(void *ptr_targets_c, int target_index)");
const Get_Target_Mesh_State = lib.func(
  "int Get_Target_Mesh_State(void *ptr_targets_c, int target_index," +
  " double *timestamp_array, int num_timestamps," +
  " double *sim_timestamps, int num_sim_timestamps, double *points_out)"
);

const Run_RadarSimulator = lib.func(
  "int Run_RadarSimulator(void *ptr_radar_c, void *ptr_targets_c," +
  " int level, float density, int *ray_filter," +
  " double *ptr_bb_real, double *ptr_bb_imag)"
);
const Run_InterferenceSimulator = lib.func(
  "int Run_InterferenceSimulator(void *ptr_radar_c, void *ptr_interf_radar_c," +
  " double *ptr_interf_real, double *ptr_interf_imag)"
);
const Run_LidarSimulator = lib.func(
  "int Run_LidarSimulator(void *ptr_targets_c, double *phi_array, double *theta_array," +
  " int num_rays, double *sensor_location, double *cloud_points," +
  " double *cloud_distances, double *cloud_intensities, int max_points, int *actual_points)"
);
const Run_NoiseSimulator = lib.func(
  "int Run_NoiseSimulator(void *ptr_radar_c, double noise_level, bool is_complex," +
  " double *timestamps, int ts_channel_size, int ts_pulse_size, int ts_sample_size," +
  " double *noise_real, double *noise_imag, uint64 seed)"
);
const Force_Cleanup_All = lib.func("void Force_Cleanup_All()");
const Is_Cleanup_In_Progress = lib.func("int Is_Cleanup_In_Progress()");
const Get_License_Info = lib.func("int Get_License_Info(char *buffer, int buffer_size)");

// ── Off-thread native calls ──────────────────────────────────────────────────
// The Electron main process is also the thread that pumps the window's OS
// event loop, so a synchronous call into radarsimc freezes the window for the
// entire simulation — minutes, for a heavy mesh scene. koffi's async variant
// runs the call on a libuv worker thread and resolves back here, leaving the
// event loop free to keep the window alive and repainting.
//
// Argument buffers must stay untouched until the callback fires; every caller
// below keeps them local and only reads them after the await.
function callAsync<T>(fn: any, ...args: unknown[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    fn.async(...args, (err: Error | null, result: T) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

// Async calls interleave with the rest of the event loop, so two bridge
// operations could otherwise be inside the library at once — a scene refresh
// triggered by typing while a simulation is still running, say. Public entry
// points run through this queue so the library keeps seeing one caller at a
// time, exactly as it did when every call was synchronous.
let _nativeQueue: Promise<unknown> = Promise.resolve();
function serialize<T>(work: () => Promise<T>): Promise<T> {
  // Run whether the previous entry resolved or rejected — a failed simulation
  // must not wedge the queue.
  const run = _nativeQueue.then(work, work);
  _nativeQueue = run.catch(() => undefined);
  return run;
}

// ── Builders ──────────────────────────────────────────────────────────────────
interface TransmitterResult {
  ptr: any;
  pulses: number;
  pulseDuration: number;
  prp: Float64Array;
  pulseStartTime: Float64Array;
  delays: number[];
}

function _buildTransmitter(txCfg: any): TransmitterResult {
  let f: number[] = txCfg.f || [24e9, 24.5e9];
  let t: number[] = txCfg.t || [0, 80e-6];
  if (!Array.isArray(f)) f = [f];
  if (!Array.isArray(t)) t = [t];
  if (f.length === 1) f = [f[0], f[0]];
  if (t.length === 1) t = [0, t[0]];
  if (f.length !== t.length) {
    throw new Error("f and t must have the same length.");
  }

  const numPulses: number = txCfg.pulses || 1;
  const txPower: number = txCfg.tx_power || 0;

  const freq = toF64(f);
  const freqTime = toF64(t);

  const pulseDuration = t[t.length - 1] - t[0];

  let prpArr: Float64Array;
  if (txCfg.prp == null) {
    prpArr = new Float64Array(numPulses).fill(pulseDuration);
  } else if (typeof txCfg.prp === "number") {
    prpArr = new Float64Array(numPulses).fill(txCfg.prp);
  } else {
    prpArr = toF64(txCfg.prp);
  }
  if (prpArr.length < numPulses) {
    throw new Error("The length of prp must be >= the number of pulses.");
  }
  for (let i = 0; i < numPulses; i++) {
    if (prpArr[i] < pulseDuration) {
      throw new Error("prp can't be smaller than the pulse length.");
    }
  }
  const pst = new Float64Array(numPulses);
  pst[0] = 0;
  for (let i = 1; i < numPulses; i++) pst[i] = pst[i - 1] + prpArr[i - 1];

  let fOffset: Float64Array;
  if (txCfg.f_offset == null) {
    fOffset = new Float64Array(numPulses);
  } else {
    fOffset = toF64(txCfg.f_offset);
    if (fOffset.length !== numPulses) {
      throw new Error("The length of f_offset must be the same as pulses.");
    }
  }

  let ptrTx: any;
  if (txCfg.pn_f && txCfg.pn_power) {
    const pnF = toF64(txCfg.pn_f);
    const pnPw = toF64(txCfg.pn_power);
    const pnFs: number = txCfg.pn_fs || 0;
    const pnNumSamples: number = txCfg.pn_num_samples || 0;
    const pnSeed: bigint = BigInt(txCfg.pn_seed || 0);
    const pnValidation: boolean = txCfg.pn_validation || false;
    console.log("[bridge] Create_Transmitter_SSBPhaseNoise args:",
      "freq.len=", freq.length, "freqTime.len=", freqTime.length,
      "waveform_size=", freq.length, "fOffset.len=", fOffset.length,
      "pst.len=", pst.length, "numPulses=", numPulses, "txPower=", txPower,
      "pnF.len=", pnF.length, "pnFs=", pnFs, "pnNumSamples=", pnNumSamples);
    ptrTx = Create_Transmitter_SSBPhaseNoise(
      freq, freqTime, freq.length, fOffset, pst, numPulses, txPower,
      pnF, pnPw, pnF.length, pnFs, pnNumSamples, pnSeed, pnValidation
    );
  } else {
    console.log("[bridge] Create_Transmitter args:",
      "freq=", Array.from(freq), "freqTime=", Array.from(freqTime),
      "waveform_size=", freq.length,
      "fOffset.len=", fOffset.length, "fOffset[0]=", fOffset[0],
      "pst.len=", pst.length, "pst[0]=", pst[0], "pst[last]=", pst[pst.length - 1],
      "numPulses=", numPulses, "txPower=", txPower);
    ptrTx = Create_Transmitter(freq, freqTime, freq.length, fOffset, pst, numPulses, txPower);
    console.log("[bridge] Create_Transmitter returned:", ptrTx);
  }
  if (!ptrTx) throw new Error("Create_Transmitter returned null");

  const txDelays: number[] = [];

  // The transmitter now exists and is registered for cleanup, so anything
  // thrown while adding channels has to release it first -- see the note in
  // _runSimulation on why a dropped handle is worse than a plain leak.
  try {
    for (const ch of txCfg.channels || [{}]) {
      const loc = toF32(ch.location || [0, 0, 0]);

      let polarRe: Float32Array, polarIm: Float32Array;
      if (ch.polarization) {
        const c = ch.polarization.map(parseComplex);
        polarRe = new Float32Array(c.map((v: ComplexParsed) => v.re));
        polarIm = new Float32Array(c.map((v: ComplexParsed) => v.im));
      } else {
        polarRe = new Float32Array([0, 0, 1]);
        polarIm = new Float32Array(3);
      }

      const { phi, phiPtn, theta, thetaPtn, antennaGain } =
        buildAntennaPattern(ch.azimuth_angle, ch.azimuth_pattern,
          ch.elevation_angle, ch.elevation_pattern);

      let pModRe: Float32Array, pModIm: Float32Array;
      if (ch.pulse_amp && ch.pulse_phs) {
        const phsRad = ch.pulse_phs.map((v: number) => (v * Math.PI) / 180);
        pModRe = new Float32Array(ch.pulse_amp.map((a: number, i: number) => a * Math.cos(phsRad[i])));
        pModIm = new Float32Array(ch.pulse_amp.map((a: number, i: number) => a * Math.sin(phsRad[i])));
      } else if (ch.pulse_phs && !ch.pulse_amp) {
        const phsRad = ch.pulse_phs.map((v: number) => (v * Math.PI) / 180);
        pModRe = new Float32Array(phsRad.map((p: number) => Math.cos(p)));
        pModIm = new Float32Array(phsRad.map((p: number) => Math.sin(p)));
      } else if (ch.pulse_amp && !ch.pulse_phs) {
        pModRe = toF32(ch.pulse_amp);
        pModIm = new Float32Array(ch.pulse_amp.length);
      } else {
        pModRe = new Float32Array(numPulses).fill(1);
        pModIm = new Float32Array(numPulses);
      }

      let modT: Float32Array, modVarRe: Float32Array, modVarIm: Float32Array, modLen = 0;
      if (ch.mod_t && (ch.phs != null || ch.amp != null)) {
        modT = toF32(ch.mod_t);
        const amp = ch.amp || new Array(modT.length).fill(1);
        const phs = ch.phs ? ch.phs.map((v: number) => (v * Math.PI) / 180)
          : new Array(modT.length).fill(0);
        modVarRe = new Float32Array(amp.map((a: number, i: number) => a * Math.cos(phs[i])));
        modVarIm = new Float32Array(amp.map((a: number, i: number) => a * Math.sin(phs[i])));
        modLen = modT.length;
      } else {
        modT = new Float32Array(0);
        modVarRe = new Float32Array(0);
        modVarIm = new Float32Array(0);
      }

      const chDelay: number = ch.delay || 0;
      txDelays.push(chDelay);

      const ret = Add_Txchannel(
        loc, polarRe, polarIm,
        phi, phiPtn, phi.length,
        theta, thetaPtn, theta.length,
        antennaGain,
        modT, modVarRe, modVarIm, modLen,
        pModRe, pModIm,
        chDelay, (1 / 180) * Math.PI, ptrTx
      );
      if (ret !== 0) throw new Error(errorMsg(ret, "Add_Txchannel"));
    }
  } catch (err) {
    Free_Transmitter(ptrTx);
    throw err;
  }

  return {
    ptr: ptrTx,
    pulses: numPulses,
    pulseDuration,
    prp: prpArr,
    pulseStartTime: pst,
    delays: txDelays,
  };
}

interface ReceiverResult {
  ptr: any;
  fs: number;
  rfGain: number;
  noiseFigure: number;
  basebandGain: number;
  loadResistor: number;
  noiseBw: number;
  bbType: string;
  gateDelay: number;
  numChannels: number;
}

function _buildReceiver(rxCfg: any): ReceiverResult {
  const rxFs: number = rxCfg.fs || 2e6;
  const rfGain: number = rxCfg.rf_gain || 0;
  const res: number = rxCfg.load_resistor || 500;
  const bbGain: number = rxCfg.baseband_gain || 0;
  const bbType: string = rxCfg.bb_type || "complex";

  // Range-gate / deramp reference delay (s). 0 keeps zero-delay deramp, the
  // behavior of builds without this parameter.
  const gateDelay: number = Number(rxCfg.gate_delay) || 0;
  if (!(gateDelay >= 0)) {
    throw new Error("gate_delay must be >= 0.");
  }

  const noiseBw = bbType === "real" ? rxFs / 2 : rxFs;

  const ptrRx = Create_Receiver(rxFs, rfGain, res, bbGain, noiseBw, gateDelay);
  if (!ptrRx) throw new Error("Create_Receiver returned null");

  // Same as the transmitter: the receiver is registered for cleanup the
  // moment it exists, so a rejected channel must not drop the handle.
  try {
    for (const ch of rxCfg.channels || [{}]) {
      const loc = toF32(ch.location || [0, 0, 0]);

      let polarRe: Float32Array, polarIm: Float32Array;
      if (ch.polarization) {
        const c = ch.polarization.map(parseComplex);
        polarRe = new Float32Array(c.map((v: ComplexParsed) => v.re));
        polarIm = new Float32Array(c.map((v: ComplexParsed) => v.im));
      } else {
        polarRe = new Float32Array([0, 0, 1]);
        polarIm = new Float32Array(3);
      }

      const { phi, phiPtn, theta, thetaPtn, antennaGain } =
        buildAntennaPattern(ch.azimuth_angle, ch.azimuth_pattern,
          ch.elevation_angle, ch.elevation_pattern);

      const ret = Add_Rxchannel(
        loc, polarRe, polarIm,
        phi, phiPtn, phi.length,
        theta, thetaPtn, theta.length,
        antennaGain, ptrRx
      );
      if (ret !== 0) throw new Error(errorMsg(ret, "Add_Rxchannel"));
    }
  } catch (err) {
    Free_Receiver(ptrRx);
    throw err;
  }

  return {
    ptr: ptrRx,
    fs: rxFs,
    rfGain,
    noiseFigure: rxCfg.noise_figure || 0,
    basebandGain: bbGain,
    loadResistor: res,
    noiseBw,
    bbType,
    gateDelay,
    numChannels: (rxCfg.channels || [{}]).length,
  };
}

/**
 * Create a single-frame radar platform from the UI radar config.
 *
 * Note the unit change: the config carries orientation in degrees (matching the
 * UI labels), while Create_Radar takes rad and rad/s.
 */
function _createRadar(ptrTx: any, ptrRx: any, radarCfg: any): any {
  const ptrRadar = Create_Radar(
    ptrTx, ptrRx, new Float64Array([0.0]), 1,
    toF32(radarCfg.location || [0, 0, 0]),
    toF32(radarCfg.speed || [0, 0, 0]),
    deg2rad(radarCfg.rotation || [0, 0, 0]),
    deg2rad(radarCfg.rotation_rate || [0, 0, 0])
  );
  if (!ptrRadar) throw new Error("Create_Radar returned null");
  return ptrRadar;
}

async function _buildTargets(targetsCfg: any[], density: number = 1): Promise<any> {
  const ptrTargets = Init_Targets();
  if (!ptrTargets) throw new Error("Init_Targets returned null");

  // An unreadable model or a target the library rejects must not leave the
  // target list behind for the unload-time cleanup to free.
  try {
    for (const t of targetsCfg) {
      const loc = toF32(t.location || [0, 0, 0]);
      const speed = toF32(t.speed || [0, 0, 0]);

      if (t.model) {
        const mesh = loadStl(t.model, t.unit || "m");
        const origin = toF32(t.origin || [0, 0, 0]);

        const rot = toF32((t.rotation || [0, 0, 0]).map((v: number) => (v * Math.PI) / 180));
        const rotRate = toF32((t.rotation_rate || [0, 0, 0]).map((v: number) => (v * Math.PI) / 180));

        let epReal: number, epImag: number;
        if (!t.permittivity || t.permittivity === "PEC") {
          epReal = -1;
          epImag = 0;
        } else {
          const perm = parseComplex(t.permittivity);
          epReal = perm.re;
          epImag = perm.im;
        }

        // Off-thread: a million-triangle mesh takes real time to ingest.
        const ret = await callAsync<number>(
          Add_Mesh_Target,
          mesh.points, mesh.cells, mesh.cellSize,
          origin, loc, speed, rot, rotRate,
          epReal, epImag, 1.0, 0.0,
          t.skip_diffusion || false,
          t.density || 0,
          t.environment || false,
          ptrTargets
        );
        if (ret !== 0) throw new Error(errorMsg(ret, "Add_Mesh_Target"));
      } else {
        const phaseRad = t.phase != null ? (t.phase * Math.PI) / 180 : 0;
        const ret = await callAsync<number>(
          Add_Point_Target,
          loc, speed,
          t.rcs != null ? t.rcs : 0,
          phaseRad,
          ptrTargets
        );
        if (ret !== 0) throw new Error(errorMsg(ret, "Add_Point_Target"));
      }
    }
  } catch (err) {
    Free_Targets(ptrTargets);
    throw err;
  }
  return ptrTargets;
}

// ── Scene state ─────────────────────────────────────────────────────────────
interface SceneState {
  timestamp: number;
  /** Global Tx channel locations, [numTx][3] flattened (m). */
  txLocations: Float32Array | null;
  /** Global Rx channel locations, [numRx][3] flattened (m). */
  rxLocations: Float32Array | null;
  /** Global radar boresight unit vector. */
  boresight: Float32Array | null;
  meshes: SceneMesh[];
  /** Non-fatal problems — the caller falls back for whatever is missing. */
  warnings: string[];
}

// ── RadarSimBridge ───────────────────────────────────────────────────────────
export class RadarSimBridge {
  constructor() { }

  async runSimulation(config: any): Promise<any> {
    return serialize(() => this._runSimulation(config));
  }

  private async _runSimulation(config: any): Promise<any> {
    const txCfg = config.transmitter || {};
    const rxCfg = config.receiver || {};
    const radarCfg = config.radar || {};
    const simCfg = config.simulation || {};
    const procCfg = config.processing || {};

    console.log("[bridge] runSimulation config:", JSON.stringify({
      tx_f: txCfg.f, tx_t: txCfg.t, tx_pulses: txCfg.pulses, tx_prp: txCfg.prp,
      tx_channels: txCfg.channels?.length,
      rx_fs: rxCfg.fs, rx_gate_delay: rxCfg.gate_delay, rx_channels: rxCfg.channels?.length,
      num_targets: config.targets?.length,
      density: simCfg.density, level: simCfg.level,
    }));

    const density = Number(simCfg.density) || 1;
    const levelMap: Record<string, number> = { frame: 0, pulse: 1, sample: 2 };
    const level = levelMap[simCfg.level] ?? 0;

    // Every handle the library hands out is also entered in its own cleanup
    // registry, and Free_* is what unregisters it. So a handle dropped on an
    // error path is not merely leaked for the life of the process: it is freed
    // again by Force_Cleanup_All() when the library unloads at exit. On Linux
    // that second pass corrupts the heap and aborts the process — after the
    // work is done, which made it look like a phantom test-runner failure. The
    // handles therefore live in a try/finally, so every exit from the native
    // section releases them exactly once.
    let tx: TransmitterResult | null = null;
    let rx: ReceiverResult | null = null;
    let ptrRadar: any = null;
    let ptrTargets: any = null;
    let bbSize = 0;
    let bbRe: Float64Array;
    let bbIm: Float64Array;
    let status: number;

    try {
      console.log("[bridge] Building transmitter...");
      tx = _buildTransmitter(txCfg);
      console.log("[bridge] TX pointer:", tx.ptr);

      console.log("[bridge] Building receiver...");
      rx = _buildReceiver(rxCfg);
      console.log("[bridge] RX pointer:", rx.ptr);

      console.log("[bridge] Creating radar...");
      ptrRadar = _createRadar(tx.ptr, rx.ptr, radarCfg);
      console.log("[bridge] Radar pointer:", ptrRadar);

      console.log("[bridge] Building targets...");
      ptrTargets = await _buildTargets(config.targets || [], density);
      console.log("[bridge] Targets pointer:", ptrTargets);

      console.log("[bridge] Getting BB size...");
      bbSize = Get_BB_Size(ptrRadar);
      console.log("[bridge] BB size:", bbSize);
      if (bbSize <= 0) throw new Error(`Get_BB_Size returned ${bbSize} — check radar configuration`);
      bbRe = new Float64Array(bbSize);
      bbIm = new Float64Array(bbSize);
      const rayFilter = new Int32Array(simCfg.ray_filter || [0, 10]);

      console.log("[bridge] Running RadarSimulator (level=%d, density=%f)...", level, density);
      // The long one. Runs on a worker thread so the window stays responsive.
      status = await callAsync<number>(
        Run_RadarSimulator, ptrRadar, ptrTargets, level, density, rayFilter, bbRe, bbIm
      );
      console.log("[bridge] Run_RadarSimulator status:", status);
    } finally {
      // Reverse order of creation. Free_Radar does not touch the TX/RX it was
      // built from, so those are released separately.
      if (ptrTargets) Free_Targets(ptrTargets);
      if (ptrRadar) Free_Radar(ptrRadar);
      if (rx) Free_Receiver(rx.ptr);
      if (tx) Free_Transmitter(tx.ptr);
    }

    if (status !== 0) throw new Error(errorMsg(status, "Run_RadarSimulator"));

    const bbType = rxCfg.bb_type || "complex";
    if (bbType === "real") bbIm.fill(0);

    const numPulses: number = txCfg.pulses || 1;
    const numTxCh = (txCfg.channels || [{}]).length;
    const numRxCh = (rxCfg.channels || [{}]).length;
    const numChannels = numTxCh * numRxCh;
    const spp = Math.round(bbSize / (numPulses * numChannels));

    const output: any = { baseband_shape: [spp, numPulses, numChannels] };

    // --- Add receiver noise ---
    if (procCfg.noise !== false) {
      const boltzmannConst = 1.38064852e-23;
      const Ts = 290;
      const inputNoiseDbm = 10 * Math.log10(boltzmannConst * Ts * 1000);
      const noiseFigure: number = rxCfg.noise_figure || 0;
      const rfGain: number = rxCfg.rf_gain || 0;
      const bbGain: number = rxCfg.baseband_gain || 0;
      const rxFs: number = rxCfg.fs || 2e6;
      const loadR: number = rxCfg.load_resistor || 500;
      const rxBbType: string = rxCfg.bb_type || "complex";

      const noiseBandwidth = rxFs;
      const receiverNoiseDbm = inputNoiseDbm + rfGain + noiseFigure + 10 * Math.log10(noiseBandwidth) + bbGain;
      const receiverNoiseWatts = 1e-3 * Math.pow(10, receiverNoiseDbm / 10);
      const noiseAmplitude = Math.sqrt(receiverNoiseWatts * loadR);

      const scale = rxBbType === "real" ? noiseAmplitude : noiseAmplitude / Math.SQRT2;
      const totalSamplesPerRx = numPulses * spp;
      const maybeYield = makeYielder();
      const noisePerRx: { re: Float64Array; im: Float64Array }[] = new Array(numRxCh);
      // Millions of samples for a large run, so generate them in blocks and
      // let the event loop back in between.
      const NOISE_BLOCK = 8192;
      for (let r = 0; r < numRxCh; r++) {
        const reNoise = new Float64Array(totalSamplesPerRx);
        const imNoise = new Float64Array(totalSamplesPerRx);
        for (let start = 0; start < totalSamplesPerRx; start += NOISE_BLOCK) {
          await maybeYield();
          const end = Math.min(start + NOISE_BLOCK, totalSamplesPerRx);
          for (let i = start; i < end; i++) {
            reNoise[i] = randn() * scale;
            if (rxBbType !== "real") imNoise[i] = randn() * scale;
          }
        }
        noisePerRx[r] = { re: reNoise, im: imNoise };
      }
      for (let c = 0; c < numChannels; c++) {
        const rxIdx = c % numRxCh;
        const nRe = noisePerRx[rxIdx].re;
        const nIm = noisePerRx[rxIdx].im;
        for (let p = 0; p < numPulses; p++) {
          await maybeYield();
          const base = (c * numPulses + p) * spp;
          const nBase = p * spp;
          for (let s = 0; s < spp; s++) {
            bbRe[base + s] += nRe[nBase + s];
            bbIm[base + s] += nIm[nBase + s];
          }
        }
      }
      console.log("[bridge] Noise added (amplitude=%.3e, type=%s)", noiseAmplitude, rxBbType);
    }

    output.baseband = await toComplex3DAsync(bbRe, bbIm, numPulses, numChannels, spp);
    output.bb_type = rxCfg.bb_type || "complex";

    if (procCfg.range_doppler !== false && numPulses > 1) {
      const rdRangeN = procCfg.rd_range_fft || nextPow2(spp);
      const rdDopplerN = procCfg.rd_doppler_fft || nextPow2(numPulses);
      const rangeOut = await applyRangeFFTAsync(bbRe, bbIm, numPulses, numChannels, spp, rdRangeN);
      const rdOut = await applyDopplerFFTAsync(rangeOut.re, rangeOut.im, numPulses, numChannels, rdRangeN, rdDopplerN);
      output.range_doppler = await toDbMag3DAsync(rdOut.re, rdOut.im, rdDopplerN, numChannels, rdRangeN);
      output.rd_range_fft_size = rdRangeN;
      output.rd_doppler_fft_size = rdDopplerN;
      output.rd_range_axis = Array.from({ length: rdRangeN }, (_, i) => i);
      const rdHalf = Math.floor(rdDopplerN / 2);
      output.rd_doppler_axis = Array.from({ length: rdDopplerN }, (_, i) => i - rdHalf);
    }

    if (procCfg.range_profile) {
      const rpRangeN = procCfg.rp_range_fft || nextPow2(spp);
      const rpOut = await applyRangeFFTAsync(bbRe, bbIm, numPulses, numChannels, spp, rpRangeN);
      output.range_profile = await toDbMag3DAsync(rpOut.re, rpOut.im, numPulses, numChannels, rpRangeN);
      output.rp_range_fft_size = rpRangeN;
      output.rp_range_axis = Array.from({ length: rpRangeN }, (_, i) => i);
    }

    output.range_axis = Array.from({ length: spp }, (_, i) => i);

    if (numPulses > 1) {
      const half = Math.floor(numPulses / 2);
      output.velocity_axis = Array.from({ length: numPulses },
        (_, i) => i - half
      );
    }

    return output;
  }

  /**
   * Query the library for where the radar and its mesh targets actually are at
   * a given timestamp, for the Scene Overview plot.
   *
   * Radar pose comes from Get_Radar_State and mesh geometry from
   * Get_Target_Mesh_State, so the plot shows the library's own transforms
   * rather than a JS re-implementation of them. Failures are collected in
   * `warnings` instead of thrown — a scene preview should degrade, not break,
   * when e.g. the free-tier channel limit rejects a multi-channel array.
   */
  async getSceneState(config: any): Promise<SceneState> {
    return serialize(() => this._getSceneState(config));
  }

  private async _getSceneState(config: any): Promise<SceneState> {
    const timestamp = Number(config.timestamp) || 0;
    const ts = new Float64Array([timestamp]);
    const out: SceneState = {
      timestamp,
      txLocations: null,
      rxLocations: null,
      boresight: null,
      meshes: [],
      warnings: [],
    };

    // --- Radar pose ---
    let tx: TransmitterResult | null = null;
    let rx: ReceiverResult | null = null;
    let ptrRadar: any = null;
    try {
      tx = _buildTransmitter(config.transmitter || {});
      rx = _buildReceiver(config.receiver || {});
      ptrRadar = _createRadar(tx.ptr, rx.ptr, config.radar || {});

      const numTx: number = Get_Num_Txchannel(tx.ptr);
      const numRx: number = Get_Num_Rxchannel(rx.ptr);
      if (numTx <= 0 || numRx <= 0) {
        throw new Error(`radar reports ${numTx} TX / ${numRx} RX channels`);
      }
      const txLoc = new Float32Array(numTx * 3);
      const rxLoc = new Float32Array(numRx * 3);
      const boresight = new Float32Array(3);
      const status: number = Get_Radar_State(ptrRadar, ts, 1, txLoc, rxLoc, boresight);
      if (status !== 0) throw new Error(errorMsg(status, "Get_Radar_State"));

      out.txLocations = txLoc;
      out.rxLocations = rxLoc;
      out.boresight = boresight;
    } catch (err) {
      out.warnings.push(`Radar pose: ${(err as Error).message || String(err)}`);
    } finally {
      if (ptrRadar) Free_Radar(ptrRadar);
      if (rx) Free_Receiver(rx.ptr);
      if (tx) Free_Transmitter(tx.ptr);
    }

    // --- Mesh geometry ---
    // Models whose file is not readable are dropped up front rather than
    // failing the whole batch — the model path is a live text field, so it is
    // routinely half-typed. uiIndex maps native mesh order back to the
    // caller's mesh-target numbering across those gaps.
    const allMeshes = (config.targets || []).filter((t: any) => t && t.model);
    const meshCfgs: any[] = [];
    const uiIndex: number[] = [];
    allMeshes.forEach((t: any, n: number) => {
      if (!fs.existsSync(t.model)) {
        out.warnings.push(`Mesh ${n + 1}: model file not found (${t.model})`);
        return;
      }
      meshCfgs.push(t);
      uiIndex.push(n);
    });

    if (meshCfgs.length > 0) {
      let ptrTargets: any = null;
      try {
        ptrTargets = await _buildTargets(meshCfgs);
        const numMesh: number = Get_Num_Targets(ptrTargets);
        for (let m = 0; m < numMesh; m++) {
          const label = `Mesh ${(uiIndex[m] ?? m) + 1}`;
          const cells: number = Get_Target_Mesh_Size(ptrTargets, m);
          if (cells <= 0) {
            out.warnings.push(`${label}: Get_Target_Mesh_Size returned ${cells}`);
            continue;
          }
          const pts = new Float64Array(cells * 9);
          const status: number = await callAsync<number>(
            Get_Target_Mesh_State, ptrTargets, m, ts, 1, null, 0, pts
          );
          if (status !== 0) {
            out.warnings.push(errorMsg(status, label));
            continue;
          }
          out.meshes.push(packSceneMesh(uiIndex[m] ?? m, cells, pts));
        }
      } catch (err) {
        out.warnings.push(`Mesh geometry: ${(err as Error).message || String(err)}`);
      } finally {
        if (ptrTargets) Free_Targets(ptrTargets);
      }
    }

    return out;
  }

  async checkLibrary(): Promise<{ radarsimlib_version: string; radarsimlib_available: boolean; licensed: boolean }> {
    const version = new Int32Array(3);
    Get_Version(version);
    const licensed: number = Is_Licensed();
    return {
      radarsimlib_version: `${version[0]}.${version[1]}.${version[2]}`,
      radarsimlib_available: true,
      licensed: licensed === 1,
    };
  }

  async activateLicense(licFilePath: string): Promise<{ licensed: boolean; product?: string }> {
    const fileName = path.basename(licFilePath);
    const dest = path.join(baseDir, fileName);
    fs.copyFileSync(licFilePath, dest);

    const match = LICENSE_PRODUCTS.find(({ pattern }) => pattern.test(fileName));
    const candidates = match ? [match.product] : LICENSE_PRODUCTS.map((e) => e.product);

    for (const product of candidates) {
      const licensed = Set_License_Files([dest], 1, product) === 1;
      if (licensed) return { licensed, product };
    }

    // `dest` is our copy, so dropping it costs nothing -- the file the user
    // picked is untouched -- and it keeps a rejected license from being retried
    // on every launch. An expired one is archived instead, as it always was.
    const { reason, expired } = diagnoseLicense(dest, match?.product);
    if (expired) {
      const expiredDir = path.join(baseDir, "expired");
      fs.mkdirSync(expiredDir, { recursive: true });
      fs.renameSync(dest, path.join(expiredDir, fileName));
    } else {
      fs.rmSync(dest, { force: true });
    }
    throw new Error(`License activation failed — ${reason}`);
  }

  kill(): void {
    // No persistent process — DLL cleanup is automatic on process exit.
  }
}
