// ===== RadarSimApp - Native C Bridge =====
//
// Binds radarsimc through koffi and turns the renderer's configuration into
// library calls. The DLL-independent pieces live in convert.ts, dsp.ts and
// mesh.ts so they can be tested without loading the library.

import * as fs from "node:fs";
import * as path from "node:path";
import koffi from "koffi";

import { buildAntennaPattern, deg2rad, errorMsg, parseComplex, toF32, toF64 } from "./convert.js";
import {
  applyDopplerFFTAsync,
  applyRangeFFTAsync,
  makeYielder,
  nextPow2,
  randn,
  toComplex3DAsync,
  toDbMag3DAsync,
} from "./dsp.js";
import { loadMesh, packSceneMesh } from "./mesh.js";

// ── Native library ───────────────────────────────────────────────────────────
// __dirname is dist/ at runtime; the library sits in radarsimlib/ at the
// project root, unpacked from the asar archive in packaged builds.
const baseDir: string = path.join(__dirname, "..", "radarsimlib").replace("app.asar", "app.asar.unpacked");

const libName: string =
  process.platform === "win32"
    ? "radarsimc.dll"
    : process.platform === "darwin"
      ? "libradarsimc.dylib"
      : "libradarsimc.so";
const libPath: string = path.join(baseDir, libName);
const lib = koffi.load(libPath);

/** A bound native function. */
type NativeFunction = ReturnType<typeof lib.func>;

/** An opaque handle radarsimc hands out: only ever passed back to it. */
type NativePtr = unknown;

// ── Function bindings ────────────────────────────────────────────────────────
// Version and license
const Get_Version = lib.func("void Get_Version(int *version)");
const Is_Licensed = lib.func("int Is_Licensed()");
const Set_License_Files = lib.func(
  "int Set_License_Files(const char **license_file_paths, int num_files, const char *product)",
);
const Get_License_Info = lib.func("int Get_License_Info(char *buffer, int buffer_size)");

// Transmitter
const Create_Transmitter = lib.func(
  "void *Create_Transmitter(double *freq, double *freq_time, int waveform_size," +
    " double *freq_offset, double *pulse_start_time, int num_pulses, float tx_power)",
);
const Create_Transmitter_SSBPhaseNoise = lib.func(
  "void *Create_Transmitter_SSBPhaseNoise(double *freq, double *freq_time," +
    " int waveform_size, double *freq_offset, double *pulse_start_time," +
    " int num_pulses, float tx_power, double *pn_freq, double *pn_power," +
    " int pn_size, double pn_fs, int pn_num_samples, uint64 pn_seed, bool pn_validation)",
);
const Add_Txchannel = lib.func(
  "int Add_Txchannel(float *location, float *polar_real, float *polar_imag," +
    " float *phi, float *phi_ptn, int phi_length," +
    " float *theta, float *theta_ptn, int theta_length," +
    " float antenna_gain," +
    " float *mod_t, float *mod_var_real, float *mod_var_imag, int mod_length," +
    " float *pulse_mod_real, float *pulse_mod_imag," +
    " float delay, float grid, void *ptr_tx_c)",
);
const Get_Num_Txchannel = lib.func("int Get_Num_Txchannel(void *ptr_tx_c)");
const Free_Transmitter = lib.func("void Free_Transmitter(void *ptr_tx_c)");

// Receiver
const Create_Receiver = lib.func(
  "void *Create_Receiver(float fs, float rf_gain, float resistor," +
    " float baseband_gain, float baseband_bw, double gate_delay)",
);
const Add_Rxchannel = lib.func(
  "int Add_Rxchannel(float *location, float *polar_real, float *polar_imag," +
    " float *phi, float *phi_ptn, int phi_length," +
    " float *theta, float *theta_ptn, int theta_length," +
    " float antenna_gain, void *ptr_rx_c)",
);
const Get_Num_Rxchannel = lib.func("int Get_Num_Rxchannel(void *ptr_rx_c)");
const Free_Receiver = lib.func("void Free_Receiver(void *ptr_rx_c)");

// Radar platform
const Create_Radar = lib.func(
  "void *Create_Radar(void *ptr_tx_c, void *ptr_rx_c," +
    " double *frame_start_time, int num_frames," +
    " float *location, float *speed, float *rotation, float *rotation_rate)",
);
const Get_BB_Size = lib.func("int Get_BB_Size(void *ptr_radar_c)");
const Get_Radar_State = lib.func(
  "int Get_Radar_State(void *ptr_radar_c, double *timestamp_array, int num_timestamps," +
    " float *tx_locations_out, float *rx_locations_out, float *boresight_out)",
);
const Free_Radar = lib.func("void Free_Radar(void *ptr_radar_c)");

// Targets
const Init_Targets = lib.func("void *Init_Targets()");
const Add_Point_Target = lib.func(
  "int Add_Point_Target(float *location, float *speed, float rcs, float phs, void *ptr_targets_c)",
);
const Add_Mesh_Target = lib.func(
  "int Add_Mesh_Target(float *points, int *cells, int cell_size," +
    " float *origin, float *location, float *speed," +
    " float *rotation, float *rotation_rate," +
    " float ep_real, float ep_imag, float mu_real, float mu_imag," +
    " bool skip_diffusion, float density, bool environment," +
    " void *ptr_targets_c)",
);
const Get_Num_Targets = lib.func("int Get_Num_Targets(void *ptr_targets_c)");
const Get_Target_Mesh_Size = lib.func("int Get_Target_Mesh_Size(void *ptr_targets_c, int target_index)");
const Get_Target_Mesh_State = lib.func(
  "int Get_Target_Mesh_State(void *ptr_targets_c, int target_index," +
    " double *timestamp_array, int num_timestamps," +
    " double *sim_timestamps, int num_sim_timestamps, double *points_out)",
);
const Free_Targets = lib.func("void Free_Targets(void *ptr_targets_c)");

// Simulation
const Run_RadarSimulator = lib.func(
  "int Run_RadarSimulator(void *ptr_radar_c, void *ptr_targets_c," +
    " int level, float density, int *ray_filter," +
    " double *ptr_bb_real, double *ptr_bb_imag)",
);

// ── Licensing ────────────────────────────────────────────────────────────────
interface LicenseProduct {
  pattern: RegExp;
  product: string;
}

const LICENSE_PRODUCTS: LicenseProduct[] = [
  { pattern: /^license_RadarSimApp_.*\.lic$/, product: "RadarSimApp" },
  { pattern: /^license_RadarSimPy_.*\.lic$/, product: "RadarSimPy" },
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

function libraryVersion(): string {
  const version = new Int32Array(3);
  Get_Version(version);
  return `${version[0]}.${version[1]}.${version[2]}`;
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
    } catch {
      /* Not the key block -- keep looking. */
    }
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
  const expiry = payload.expiration_date ? Date.parse(`${payload.expiration_date.replace(" ", "T")}Z`) : NaN;
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

/** Move an expired license file into radarsimlib/expired/, out of the way of the next launch. */
function archiveExpired(licPath: string): string {
  const expiredDir = path.join(baseDir, "expired");
  fs.mkdirSync(expiredDir, { recursive: true });
  fs.renameSync(licPath, path.join(expiredDir, path.basename(licPath)));
  return expiredDir;
}

/** Hand every license file shipped beside the library to radarsimc, one product at a time. */
function activateBundledLicenses(): void {
  const allFiles = fs.readdirSync(baseDir);
  let anyFound = false;
  for (const { pattern, product } of LICENSE_PRODUCTS) {
    const licFiles = allFiles.filter((f) => pattern.test(f));
    if (licFiles.length === 0) continue;
    anyFound = true;
    const licPaths = licFiles.map((f) => path.join(baseDir, f));
    const licensed = Set_License_Files(licPaths, licPaths.length, product) === 1;
    console.log(`[bridge] License activation (${product}):`, licensed ? "success" : "failed");
    if (licensed) continue;

    // Name the build that did the rejecting. radarsimc's license parser has
    // changed between releases, so a bug report is only actionable with the
    // version attached -- and it catches a stale or mismatched library.
    console.warn(`[bridge] radarsimc ${libraryVersion()} — ${libPath}`);

    // A batch only fails when every file in it does, so each one needs a
    // reason of its own. Expired files are archived; the rest stay put.
    for (const p of licPaths) {
      const { reason, expired } = diagnoseLicense(p, product);
      console.warn(`[bridge] ${path.basename(p)}: ${reason}`);
      if (expired) console.warn("[bridge] Moved expired license file to:", archiveExpired(p));
    }
  }
  if (!anyFound) console.warn("[bridge] No license files found in", baseDir);
}

activateBundledLicenses();

// radarsimc reports the active license as "Key: value" lines (empty when
// unlicensed). Returned as a map so the renderer can pick the fields it shows.
function readLicenseInfo(): Record<string, string> {
  let buf = Buffer.alloc(1024);
  let len: number = Get_License_Info(buf, buf.length);
  if (len > buf.length - 1) {
    buf = Buffer.alloc(len + 1);
    len = Get_License_Info(buf, buf.length);
  }
  const info: Record<string, string> = {};
  if (len <= 0) return info;
  for (const line of buf.toString("utf8", 0, Math.min(len, buf.length - 1)).split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) info[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return info;
}

// ── Off-thread native calls ──────────────────────────────────────────────────
// The Electron main process is also the thread that pumps the window's OS
// event loop, so a synchronous call into radarsimc freezes the window for the
// entire simulation — minutes, for a heavy mesh scene. koffi's async variant
// runs the call on a libuv worker thread and resolves back here, leaving the
// event loop free to keep the window alive and repainting.
//
// Argument buffers must stay untouched until the callback fires; every caller
// below keeps them local and only reads them after the await.
function callAsync<T>(fn: NativeFunction, ...args: unknown[]): Promise<T> {
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

// ── Configuration defaults ───────────────────────────────────────────────────
// The values a missing field stands for. The simulation and the noise added
// to its output have to agree on these, so both read them from here.

function numPulsesOf(txCfg: TransmitterConfig): number {
  return txCfg.pulses || 1;
}

function receiverParams(rxCfg: ReceiverConfig) {
  return {
    fs: rxCfg.fs || 2e6,
    rfGain: rxCfg.rf_gain || 0,
    noiseFigure: rxCfg.noise_figure || 0,
    basebandGain: rxCfg.baseband_gain || 0,
    loadResistor: rxCfg.load_resistor || 500,
    bbType: rxCfg.bb_type || "complex",
  };
}

// ── Builders ─────────────────────────────────────────────────────────────────
function _asArray(v: number | number[]): number[] {
  return Array.isArray(v) ? v : [v];
}

/** A mesh target is one with a model file; anything else is a point target. */
function isMeshTarget(t: TargetConfig): t is MeshTargetConfig {
  return Boolean(t?.model);
}

/** Degrees to radians, one value. */
function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Complex weights from amplitudes and phases (deg), `n` of them. A missing
 * amplitude is 1 and a missing phase 0, so either list may be left out.
 */
function amplitudePhase(
  amp: number[] | undefined,
  phsDeg: number[] | undefined,
  n: number,
): { re: Float32Array; im: Float32Array } {
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = amp?.[i] ?? 1;
    const p = rad(phsDeg?.[i] ?? 0);
    re[i] = a * Math.cos(p);
    im[i] = a * Math.sin(p);
  }
  return { re, im };
}

/**
 * The leading arguments Add_Txchannel and Add_Rxchannel share: location,
 * polarization, and the antenna pattern with its gain.
 */
function antennaArgs(ch: AntennaChannelConfig): unknown[] {
  const loc = toF32(ch.location || [0, 0, 0]);
  const pol = (ch.polarization ?? [0, 0, 1]).map(parseComplex);
  const polRe = new Float32Array(pol.map((v) => v.re));
  const polIm = new Float32Array(pol.map((v) => v.im));
  const { phi, phiPtn, theta, thetaPtn, antennaGain } = buildAntennaPattern(
    ch.azimuth_angle,
    ch.azimuth_pattern,
    ch.elevation_angle,
    ch.elevation_pattern,
  );
  return [loc, polRe, polIm, phi, phiPtn, phi.length, theta, thetaPtn, theta.length, antennaGain];
}

function _buildTransmitter(txCfg: TransmitterConfig): NativePtr {
  let f = _asArray(txCfg.f || [24e9, 24.5e9]);
  let t = _asArray(txCfg.t || [0, 80e-6]);
  if (f.length === 1) f = [f[0], f[0]];
  if (t.length === 1) t = [0, t[0]];
  if (f.length !== t.length) {
    throw new Error("f and t must have the same length.");
  }

  const numPulses = numPulsesOf(txCfg);
  const txPower: number = txCfg.tx_power || 0;
  const freq = toF64(f);
  const freqTime = toF64(t);
  const pulseDuration = t[t.length - 1] - t[0];

  let prp: Float64Array;
  if (txCfg.prp == null) {
    prp = new Float64Array(numPulses).fill(pulseDuration);
  } else if (typeof txCfg.prp === "number") {
    prp = new Float64Array(numPulses).fill(txCfg.prp);
  } else {
    prp = toF64(txCfg.prp);
  }
  if (prp.length < numPulses) {
    throw new Error("The length of prp must be >= the number of pulses.");
  }
  for (let i = 0; i < numPulses; i++) {
    if (prp[i] < pulseDuration) {
      throw new Error("prp can't be smaller than the pulse length.");
    }
  }
  const pulseStart = new Float64Array(numPulses);
  for (let i = 1; i < numPulses; i++) pulseStart[i] = pulseStart[i - 1] + prp[i - 1];

  let fOffset: Float64Array;
  if (txCfg.f_offset == null) {
    fOffset = new Float64Array(numPulses);
  } else {
    fOffset = toF64(txCfg.f_offset);
    if (fOffset.length !== numPulses) {
      throw new Error("The length of f_offset must be the same as pulses.");
    }
  }

  let ptrTx: NativePtr;
  if (txCfg.pn_f && txCfg.pn_power) {
    const pnF = toF64(txCfg.pn_f);
    ptrTx = Create_Transmitter_SSBPhaseNoise(
      freq,
      freqTime,
      freq.length,
      fOffset,
      pulseStart,
      numPulses,
      txPower,
      pnF,
      toF64(txCfg.pn_power),
      pnF.length,
      txCfg.pn_fs || 0,
      txCfg.pn_num_samples || 0,
      BigInt(txCfg.pn_seed || 0),
      txCfg.pn_validation || false,
    );
  } else {
    ptrTx = Create_Transmitter(freq, freqTime, freq.length, fOffset, pulseStart, numPulses, txPower);
  }
  if (!ptrTx) throw new Error("Create_Transmitter returned null");

  // The transmitter now exists and is registered for cleanup, so anything
  // thrown while adding channels has to release it first -- see the note in
  // _runSimulation on why a dropped handle is worse than a plain leak.
  try {
    for (const ch of txCfg.channels || [{}]) {
      // Pulse-by-pulse modulation, one weight per pulse unless given
      const pulseMod = amplitudePhase(ch.pulse_amp, ch.pulse_phs, (ch.pulse_amp ?? ch.pulse_phs)?.length ?? numPulses);

      // Intra-pulse modulation, only when there is something to modulate with
      const modT = ch.mod_t && (ch.phs != null || ch.amp != null) ? toF32(ch.mod_t) : new Float32Array(0);
      const mod = amplitudePhase(ch.amp, ch.phs, modT.length);

      const ret = Add_Txchannel(
        ...antennaArgs(ch),
        modT,
        mod.re,
        mod.im,
        modT.length,
        pulseMod.re,
        pulseMod.im,
        ch.delay || 0,
        rad(1), // ray grid
        ptrTx,
      );
      if (ret !== 0) throw new Error(errorMsg(ret, "Add_Txchannel"));
    }
  } catch (err) {
    Free_Transmitter(ptrTx);
    throw err;
  }

  return ptrTx;
}

function _buildReceiver(rxCfg: ReceiverConfig): NativePtr {
  const rx = receiverParams(rxCfg);

  // Range-gate / deramp reference delay (s). 0 deramps against the
  // transmitted chirp itself.
  const gateDelay: number = Number(rxCfg.gate_delay) || 0;
  if (!(gateDelay >= 0)) {
    throw new Error("gate_delay must be >= 0.");
  }

  const noiseBw = rx.bbType === "real" ? rx.fs / 2 : rx.fs;
  const ptrRx = Create_Receiver(rx.fs, rx.rfGain, rx.loadResistor, rx.basebandGain, noiseBw, gateDelay);
  if (!ptrRx) throw new Error("Create_Receiver returned null");

  // Same as the transmitter: the receiver is registered for cleanup the
  // moment it exists, so a rejected channel must not drop the handle.
  try {
    for (const ch of rxCfg.channels || [{}]) {
      const ret = Add_Rxchannel(...antennaArgs(ch), ptrRx);
      if (ret !== 0) throw new Error(errorMsg(ret, "Add_Rxchannel"));
    }
  } catch (err) {
    Free_Receiver(ptrRx);
    throw err;
  }

  return ptrRx;
}

/**
 * Create a single-frame radar platform from the UI radar config.
 *
 * Note the unit change: the config carries orientation in degrees (matching the
 * UI labels), while Create_Radar takes rad and rad/s.
 */
function _createRadar(ptrTx: NativePtr, ptrRx: NativePtr, radarCfg: PlatformConfig): NativePtr {
  const ptrRadar = Create_Radar(
    ptrTx,
    ptrRx,
    new Float64Array([0.0]),
    1,
    toF32(radarCfg.location || [0, 0, 0]),
    toF32(radarCfg.speed || [0, 0, 0]),
    deg2rad(radarCfg.rotation || [0, 0, 0]),
    deg2rad(radarCfg.rotation_rate || [0, 0, 0]),
  );
  if (!ptrRadar) throw new Error("Create_Radar returned null");
  return ptrRadar;
}

async function _buildTargets(targetsCfg: TargetConfig[]): Promise<NativePtr> {
  const ptrTargets = Init_Targets();
  if (!ptrTargets) throw new Error("Init_Targets returned null");

  // An unreadable model or a target the library rejects must not leave the
  // target list behind for the unload-time cleanup to free.
  try {
    for (const t of targetsCfg) {
      const loc = toF32(t.location || [0, 0, 0]);
      const speed = toF32(t.speed || [0, 0, 0]);

      if (isMeshTarget(t)) {
        const mesh = loadMesh(t.model, t.unit || "m");
        // A perfect conductor is passed as a permittivity of -1
        const perm = !t.permittivity || t.permittivity === "PEC" ? { re: -1, im: 0 } : parseComplex(t.permittivity);

        // Off-thread: a million-triangle mesh takes real time to ingest.
        const ret = await callAsync<number>(
          Add_Mesh_Target,
          mesh.points,
          mesh.cells,
          mesh.cellSize,
          toF32(t.origin || [0, 0, 0]),
          loc,
          speed,
          deg2rad(t.rotation || [0, 0, 0]),
          deg2rad(t.rotation_rate || [0, 0, 0]),
          perm.re,
          perm.im,
          1.0, // permeability, real
          0.0, // permeability, imaginary
          t.skip_diffusion || false,
          t.density || 0,
          t.environment || false,
          ptrTargets,
        );
        if (ret !== 0) throw new Error(errorMsg(ret, "Add_Mesh_Target"));
      } else {
        const ret = await callAsync<number>(Add_Point_Target, loc, speed, t.rcs ?? 0, rad(t.phase ?? 0), ptrTargets);
        if (ret !== 0) throw new Error(errorMsg(ret, "Add_Point_Target"));
      }
    }
  } catch (err) {
    Free_Targets(ptrTargets);
    throw err;
  }
  return ptrTargets;
}

// ── Receiver noise ───────────────────────────────────────────────────────────
const BOLTZMANN = 1.38064852e-23;
/** Reference noise temperature (K). */
const T0 = 290;
/** Noise samples generated between chances for the event loop to run. */
const NOISE_BLOCK = 8192;

/**
 * Add thermal receiver noise to the baseband in place. Every TX channel seen
 * through one RX channel shares that receiver's noise, so it is drawn once
 * per RX channel and added to each virtual channel built on it.
 */
async function addReceiverNoise(
  bbRe: Float64Array,
  bbIm: Float64Array,
  rxCfg: ReceiverConfig,
  numPulses: number,
  numChannels: number,
  numRxCh: number,
  spp: number,
): Promise<void> {
  const rx = receiverParams(rxCfg);
  const inputNoiseDbm = 10 * Math.log10(BOLTZMANN * T0 * 1000);
  const receiverNoiseDbm = inputNoiseDbm + rx.rfGain + rx.noiseFigure + 10 * Math.log10(rx.fs) + rx.basebandGain;
  const receiverNoiseWatts = 1e-3 * 10 ** (receiverNoiseDbm / 10);
  const noiseAmplitude = Math.sqrt(receiverNoiseWatts * rx.loadResistor);
  const isReal = rx.bbType === "real";
  const scale = isReal ? noiseAmplitude : noiseAmplitude / Math.SQRT2;

  const totalSamplesPerRx = numPulses * spp;
  const maybeYield = makeYielder();
  const noisePerRx: { re: Float64Array; im: Float64Array }[] = [];
  for (let r = 0; r < numRxCh; r++) {
    const re = new Float64Array(totalSamplesPerRx);
    const im = new Float64Array(totalSamplesPerRx);
    for (let start = 0; start < totalSamplesPerRx; start += NOISE_BLOCK) {
      await maybeYield();
      const end = Math.min(start + NOISE_BLOCK, totalSamplesPerRx);
      for (let i = start; i < end; i++) {
        re[i] = randn() * scale;
        if (!isReal) im[i] = randn() * scale;
      }
    }
    noisePerRx.push({ re, im });
  }

  for (let c = 0; c < numChannels; c++) {
    const noise = noisePerRx[c % numRxCh];
    for (let p = 0; p < numPulses; p++) {
      await maybeYield();
      const base = (c * numPulses + p) * spp;
      const nBase = p * spp;
      for (let s = 0; s < spp; s++) {
        bbRe[base + s] += noise.re[nBase + s];
        bbIm[base + s] += noise.im[nBase + s];
      }
    }
  }
}

// ── RadarSimBridge ───────────────────────────────────────────────────────────
export class RadarSimBridge {
  async runSimulation(config: SimConfig): Promise<SimResult> {
    return serialize(() => this._runSimulation(config));
  }

  private async _runSimulation(config: SimConfig): Promise<SimResult> {
    const txCfg: TransmitterConfig = config.transmitter || {};
    const rxCfg: ReceiverConfig = config.receiver || {};
    const simCfg: SimulationConfig = config.simulation || {};
    const procCfg: ProcessingConfig = config.processing || {};

    const density = Number(simCfg.density) || 1;
    const levelMap: Record<string, number> = { frame: 0, pulse: 1, sample: 2 };
    const level = levelMap[simCfg.level ?? ""] ?? 0;

    // Every handle the library hands out is also entered in its own cleanup
    // registry, and Free_* is what unregisters it. So a handle dropped on an
    // error path is not merely leaked for the life of the process: it is freed
    // again by Force_Cleanup_All() when the library unloads at exit. On Linux
    // that second pass corrupts the heap and aborts the process — after the
    // work is done, which made it look like a phantom test-runner failure. The
    // handles therefore live in a try/finally, so every exit from the native
    // section releases them exactly once.
    let ptrTx: NativePtr = null;
    let ptrRx: NativePtr = null;
    let ptrRadar: NativePtr = null;
    let ptrTargets: NativePtr = null;
    let bbSize = 0;
    let bbRe: Float64Array;
    let bbIm: Float64Array;
    let status: number;

    try {
      ptrTx = _buildTransmitter(txCfg);
      ptrRx = _buildReceiver(rxCfg);
      ptrRadar = _createRadar(ptrTx, ptrRx, config.radar || {});
      ptrTargets = await _buildTargets(config.targets || []);

      bbSize = Get_BB_Size(ptrRadar);
      if (bbSize <= 0) throw new Error(`Get_BB_Size returned ${bbSize} — check radar configuration`);
      bbRe = new Float64Array(bbSize);
      bbIm = new Float64Array(bbSize);
      const rayFilter = new Int32Array(simCfg.ray_filter || [0, 10]);

      // The long one. Runs on a worker thread so the window stays responsive.
      status = await callAsync<number>(Run_RadarSimulator, ptrRadar, ptrTargets, level, density, rayFilter, bbRe, bbIm);
    } finally {
      // Reverse order of creation. Free_Radar does not touch the TX/RX it was
      // built from, so those are released separately.
      if (ptrTargets) Free_Targets(ptrTargets);
      if (ptrRadar) Free_Radar(ptrRadar);
      if (ptrRx) Free_Receiver(ptrRx);
      if (ptrTx) Free_Transmitter(ptrTx);
    }

    if (status !== 0) throw new Error(errorMsg(status, "Run_RadarSimulator"));

    const { bbType } = receiverParams(rxCfg);
    if (bbType === "real") bbIm.fill(0);

    const numPulses = numPulsesOf(txCfg);
    const numTxCh = (txCfg.channels || [{}]).length;
    const numRxCh = (rxCfg.channels || [{}]).length;
    const numChannels = numTxCh * numRxCh;
    const spp = Math.round(bbSize / (numPulses * numChannels));

    if (procCfg.noise !== false) {
      await addReceiverNoise(bbRe, bbIm, rxCfg, numPulses, numChannels, numRxCh, spp);
    }

    const output: SimResult = {
      baseband_shape: [spp, numPulses, numChannels],
      baseband: await toComplex3DAsync(bbRe, bbIm, numPulses, numChannels, spp),
      bb_type: bbType,
      range_axis: Array.from({ length: spp }, (_, i) => i),
    };

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

    if (numPulses > 1) {
      const half = Math.floor(numPulses / 2);
      output.velocity_axis = Array.from({ length: numPulses }, (_, i) => i - half);
    }

    return output;
  }

  /**
   * Query the library for where the radar and its mesh targets actually are at
   * a given timestamp, for the scene view.
   *
   * Radar pose comes from Get_Radar_State and mesh geometry from
   * Get_Target_Mesh_State, so the view shows the library's own transforms
   * rather than a JS re-implementation of them. Failures are collected in
   * `warnings` instead of thrown — a scene preview should degrade, not break,
   * when e.g. the free-tier channel limit rejects a multi-channel array.
   */
  async getSceneState(config: SimConfig): Promise<SceneState> {
    return serialize(() => this._getSceneState(config));
  }

  private async _getSceneState(config: SimConfig): Promise<SceneState> {
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
    let ptrTx: NativePtr = null;
    let ptrRx: NativePtr = null;
    let ptrRadar: NativePtr = null;
    try {
      ptrTx = _buildTransmitter(config.transmitter || {});
      ptrRx = _buildReceiver(config.receiver || {});
      ptrRadar = _createRadar(ptrTx, ptrRx, config.radar || {});

      const numTx: number = Get_Num_Txchannel(ptrTx);
      const numRx: number = Get_Num_Rxchannel(ptrRx);
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
      if (ptrRx) Free_Receiver(ptrRx);
      if (ptrTx) Free_Transmitter(ptrTx);
    }

    // --- Mesh geometry ---
    // Models whose file is not readable are dropped up front rather than
    // failing the whole batch — the model path is a live text field, so it is
    // routinely half-typed. uiIndex maps native mesh order back to the
    // caller's mesh-target numbering across those gaps.
    const allMeshes = (config.targets || []).filter(isMeshTarget);
    const meshCfgs: MeshTargetConfig[] = [];
    const uiIndex: number[] = [];
    allMeshes.forEach((t, n) => {
      if (!fs.existsSync(t.model)) {
        out.warnings.push(`Mesh ${n + 1}: model file not found (${t.model})`);
        return;
      }
      meshCfgs.push(t);
      uiIndex.push(n);
    });

    if (meshCfgs.length > 0) {
      let ptrTargets: NativePtr = null;
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
          const status: number = await callAsync<number>(Get_Target_Mesh_State, ptrTargets, m, ts, 1, null, 0, pts);
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

  checkLibrary(): LibraryInfo {
    return {
      radarsimlib_version: libraryVersion(),
      licensed: Is_Licensed() === 1,
      license_info: readLicenseInfo(),
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
    // on every launch. An expired one is archived instead.
    const { reason, expired } = diagnoseLicense(dest, match?.product);
    if (expired) archiveExpired(dest);
    else fs.rmSync(dest, { force: true });
    throw new Error(`License activation failed — ${reason}`);
  }
}
