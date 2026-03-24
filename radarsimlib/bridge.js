"use strict";
// ===== RadarSimApp - Native C Bridge =====
// Calls radarsimc.dll directly via koffi (FFI), replacing the Python/radarsimpy
// dependency. The public API (runSimulation, runRcsSimulation, checkPython,
// kill) is identical to the old PythonBridge so main.js needs no changes.

const koffi = require("koffi");
const path = require("path");
const fs = require("fs");

// ── DLL ──────────────────────────────────────────────────────────────────────
const dllPath = path.join(__dirname, "radarsimc.dll");
const lib = koffi.load(dllPath);

// ── Function bindings ─────────────────────────────────────────────────────────
const Get_Version = lib.func("void Get_Version(int *version)");
const Is_Licensed = lib.func("int Is_Licensed()");

const Create_Transmitter = lib.func(
  "void *Create_Transmitter(double *freq, double *freq_time, int waveform_size," +
    " double *freq_offset, double *pulse_start_time, int num_pulses, float tx_power)"
);
const Create_Transmitter_PhaseNoise = lib.func(
  "void *Create_Transmitter_PhaseNoise(double *freq, double *freq_time," +
    " int waveform_size, double *freq_offset, double *pulse_start_time," +
    " int num_pulses, float tx_power, double *phase_noise_real," +
    " double *phase_noise_imag, int phase_noise_size)"
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
const Free_Transmitter = lib.func("void Free_Transmitter(void *ptr_tx_c)");

const Create_Receiver = lib.func(
  "void *Create_Receiver(float fs, float rf_gain, float resistor," +
    " float baseband_gain, float baseband_bw)"
);
const Add_Rxchannel = lib.func(
  "int Add_Rxchannel(float *location, float *polar_real, float *polar_imag," +
    " float *phi, float *phi_ptn, int phi_length," +
    " float *theta, float *theta_ptn, int theta_length," +
    " float antenna_gain, void *ptr_rx_c)"
);
const Free_Receiver = lib.func("void Free_Receiver(void *ptr_rx_c)");

const Create_Radar = lib.func(
  "void *Create_Radar(void *ptr_tx_c, void *ptr_rx_c," +
    " double *frame_start_time, int num_frames," +
    " float *location, float *speed, float *rotation, float *rotation_rate)"
);
const Get_BB_Size = lib.func("int Get_BB_Size(void *ptr_radar_c)");
const Free_Radar = lib.func("void Free_Radar(void *ptr_radar_c)");

const Init_Targets = lib.func("void *Init_Targets()");
const Add_Point_Target = lib.func(
  "int Add_Point_Target(float *location, float *speed," +
    " float rcs, float phs, void *ptr_targets_c)"
);
const Add_Mesh_Target = lib.func(
  "int Add_Mesh_Target(float *points, int *cells, int cell_size," +
    " float *origin, float *location, float *speed," +
    " float *rotation, float *rotation_rate," +
    " float ep_real, float ep_imag, float mu_real, float mu_imag," +
    " bool skip_diffusion, float density, bool environment," +
    " void *ptr_targets_c)"
);
const Free_Targets = lib.func("void Free_Targets(void *ptr_targets_c)");

const Run_RadarSimulator = lib.func(
  "int Run_RadarSimulator(void *ptr_radar_c, void *ptr_targets_c," +
    " int level, float density, int *ray_filter," +
    " double *ptr_bb_real, double *ptr_bb_imag)"
);
const Run_RcsSimulator = lib.func(
  "int Run_RcsSimulator(void *ptr_targets_c," +
    " double *inc_dir_array, double *obs_dir_array, int num_directions," +
    " double *inc_polar_real, double *inc_polar_imag," +
    " double *obs_polar_real, double *obs_polar_imag," +
    " double frequency, double density, double *rcs_result)"
);

// ── Type helpers ──────────────────────────────────────────────────────────────
function toF32(arr) {
  return arr instanceof Float32Array ? arr : new Float32Array(arr);
}
function toF64(arr) {
  return arr instanceof Float64Array ? arr : new Float64Array(arr);
}
function toI32(arr) {
  return arr instanceof Int32Array ? arr : new Int32Array(arr);
}
function deg2rad(arr) {
  return new Float32Array(arr.map((v) => (v * Math.PI) / 180));
}

/** Parse a complex number from string "1+2j", array [re, im], or plain number. */
function parseComplex(v) {
  if (typeof v === "number") return { re: v, im: 0 };
  if (Array.isArray(v)) return { re: v[0] || 0, im: v[1] || 0 };
  if (typeof v === "string") {
    const m = v.replace(/\s/g, "").match(/^([+-]?[\d.e+-]+)?([+-][\d.e+-]+)[ij]$/i);
    if (m) return { re: parseFloat(m[1] || "0"), im: parseFloat(m[2]) };
    return { re: parseFloat(v) || 0, im: 0 };
  }
  return { re: 0, im: 0 };
}

/** Spherical angles (degrees) → Cartesian unit direction vector. */
function sphericalToXyz(phiDeg, thetaDeg) {
  const phi = (phiDeg * Math.PI) / 180;
  const theta = (thetaDeg * Math.PI) / 180;
  return [Math.sin(theta) * Math.cos(phi), Math.sin(theta) * Math.sin(phi), Math.cos(theta)];
}


// ── Mesh (STL) loader ─────────────────────────────────────────────────────────
const UNIT_SCALE = { mm: 1e-3, cm: 1e-2, m: 1.0, in: 0.0254 };

function loadStl(filePath, unit = "m") {
  const scale = UNIT_SCALE[unit] ?? 1.0;
  const buf = fs.readFileSync(filePath);

  // Detect ASCII STL (binary STL that begins with "solid" is rare but possible;
  // check for the "facet normal" keyword to be sure).
  const preview = buf.toString("ascii", 0, Math.min(buf.length, 256));
  if (preview.trimStart().startsWith("solid") && buf.toString("ascii").includes("facet normal")) {
    return _loadAsciiStl(buf.toString("ascii"), scale);
  }

  // Binary STL: 80-byte header, uint32 triangle count, then 50 bytes per face.
  const numTri = buf.readUInt32LE(80);
  const points = new Float32Array(numTri * 9);
  const cells = new Int32Array(numTri * 3);
  let offset = 84;
  for (let i = 0; i < numTri; i++) {
    offset += 12; // skip face normal
    for (let v = 0; v < 3; v++) {
      const b = i * 9 + v * 3;
      points[b]     = buf.readFloatLE(offset)     * scale;
      points[b + 1] = buf.readFloatLE(offset + 4) * scale;
      points[b + 2] = buf.readFloatLE(offset + 8) * scale;
      offset += 12;
    }
    cells[i * 3] = i * 3; cells[i * 3 + 1] = i * 3 + 1; cells[i * 3 + 2] = i * 3 + 2;
    offset += 2; // skip attribute byte count
  }
  return { points, cells, cellSize: numTri };
}

function _loadAsciiStl(text, scale) {
  const pts = [];
  const re = /vertex\s+([\d.e+\-]+)\s+([\d.e+\-]+)\s+([\d.e+\-]+)/gi;
  let m, idx = 0;
  while ((m = re.exec(text)) !== null) {
    pts.push(parseFloat(m[1]) * scale, parseFloat(m[2]) * scale, parseFloat(m[3]) * scale);
    idx++;
  }
  const cells = new Int32Array(idx);
  for (let i = 0; i < idx; i++) cells[i] = i;
  return { points: new Float32Array(pts), cells, cellSize: Math.floor(idx / 3) };
}

// ── FFT ───────────────────────────────────────────────────────────────────────
function _nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }

/** In-place Cooley-Tukey radix-2 DIT FFT. Arrays must be power-of-2 length. */
function _fft(re, im) {
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
        re[i + k]        = uRe + vRe;  im[i + k]        = uIm + vIm;
        re[i + k + half] = uRe - vRe;  im[i + k + half] = uIm - vIm;
        const tmp = urRe * wRe - urIm * wIm;
        urIm = urRe * wIm + urIm * wRe;
        urRe = tmp;
      }
    }
  }
}

/** Apply FFT along the "samples" axis (last axis) of a [pulses × rx × spp] flat buffer. */
function _applyRangeFFT(re, im, nPulse, nRx, spp) {
  const n = _nextPow2(spp);
  for (let p = 0; p < nPulse; p++) {
    for (let r = 0; r < nRx; r++) {
      const base = (p * nRx + r) * spp;
      const R = new Float64Array(n); R.set(re.subarray(base, base + spp));
      const I = new Float64Array(n); I.set(im.subarray(base, base + spp));
      _fft(R, I);
      re.set(R.subarray(0, spp), base);
      im.set(I.subarray(0, spp), base);
    }
  }
}

/** Apply FFT along the "pulses" axis (first axis) of a [pulses × rx × spp] flat buffer. */
function _applyDopplerFFT(re, im, nPulse, nRx, spp) {
  const n = _nextPow2(nPulse);
  for (let r = 0; r < nRx; r++) {
    for (let s = 0; s < spp; s++) {
      const R = new Float64Array(n);
      const I = new Float64Array(n);
      for (let p = 0; p < nPulse; p++) {
        R[p] = re[(p * nRx + r) * spp + s];
        I[p] = im[(p * nRx + r) * spp + s];
      }
      _fft(R, I);
      for (let p = 0; p < nPulse; p++) {
        re[(p * nRx + r) * spp + s] = R[p];
        im[(p * nRx + r) * spp + s] = I[p];
      }
    }
  }
}

/** Convert flat re/im arrays → nested [pulse][rx][sample] dB-magnitude array. */
function _toDbMag3D(re, im, nPulse, nRx, spp) {
  const out = [];
  for (let p = 0; p < nPulse; p++) {
    const rxArr = [];
    for (let r = 0; r < nRx; r++) {
      const row = new Array(spp);
      const base = (p * nRx + r) * spp;
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

// ── Builders ──────────────────────────────────────────────────────────────────
function _buildTransmitter(txCfg) {
  const f         = txCfg.f         || [24e9, 24.5e9];
  const t         = txCfg.t         || [0, 80e-6];
  const numPulses = txCfg.pulses    || 1;
  const txPower   = txCfg.tx_power  || 0;

  const freq     = toF64(f);
  const freqTime = toF64(t);
  const fOffset  = txCfg.f_offset ? toF64(txCfg.f_offset) : new Float64Array(numPulses);

  // pulse_start_time: prp * [0, 1, 2, …, pulses-1]
  let prp = txCfg.prp;
  if (prp == null) {
    prp = Array.isArray(t) && t.length >= 2 ? Math.abs(t[t.length - 1] - t[0]) : 1e-3;
  }
  const pst = new Float64Array(numPulses);
  for (let i = 0; i < numPulses; i++) pst[i] = i * prp;

  let ptrTx;
  if (txCfg.pn_f && txCfg.pn_power) {
    const pnF  = toF64(txCfg.pn_f);
    const pnPw = toF64(txCfg.pn_power);
    console.log("[bridge] Create_Transmitter_PhaseNoise args:",
      "freq.len=", freq.length, "freqTime.len=", freqTime.length,
      "waveform_size=", freq.length, "fOffset.len=", fOffset.length,
      "pst.len=", pst.length, "numPulses=", numPulses, "txPower=", txPower,
      "pnF.len=", pnF.length);
    ptrTx = Create_Transmitter_PhaseNoise(
      freq, freqTime, freq.length, fOffset, pst, numPulses, txPower,
      pnF, pnPw, pnF.length
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

  for (const ch of txCfg.channels || [{}]) {
    const loc = toF32(ch.location || [0, 0, 0]);

    let polarRe, polarIm;
    if (ch.polarization) {
      const c = ch.polarization.map(parseComplex);
      polarRe = new Float32Array(c.map((v) => v.re));
      polarIm = new Float32Array(c.map((v) => v.im));
    } else {
      polarRe = new Float32Array([0, 0, 1]);
      polarIm = new Float32Array(3);
    }

    let phi = null, phiPtn = null, phiLen = 0;
    if (ch.azimuth_angle && ch.azimuth_pattern && ch.azimuth_angle.length > 0) {
      phi    = deg2rad(ch.azimuth_angle);
      phiPtn = toF32(ch.azimuth_pattern);
      phiLen = phi.length;
    } else {
      // Provide a minimal omnidirectional pattern (required by DLL — cannot be null/empty)
      phi    = new Float32Array([-Math.PI / 2, Math.PI / 2]);
      phiPtn = new Float32Array([0, 0]);
      phiLen = 2;
    }
    let theta = null, thetaPtn = null, thetaLen = 0;
    if (ch.elevation_angle && ch.elevation_pattern && ch.elevation_angle.length > 0) {
      theta    = deg2rad(ch.elevation_angle);
      thetaPtn = toF32(ch.elevation_pattern);
      thetaLen = theta.length;
    } else {
      theta    = new Float32Array([-Math.PI / 2, Math.PI / 2]);
      thetaPtn = new Float32Array([0, 0]);
      thetaLen = 2;
    }

    // pulse_mod_real/imag must always be valid arrays sized to numPulses (DLL requirement)
    let pModRe = new Float32Array(numPulses).fill(1);
    let pModIm = new Float32Array(numPulses);
    if (ch.pulse_amp && ch.pulse_phs) {
      pModRe = new Float32Array(ch.pulse_amp.map((a, i) => a * Math.cos(ch.pulse_phs[i])));
      pModIm = new Float32Array(ch.pulse_amp.map((a, i) => a * Math.sin(ch.pulse_phs[i])));
    }

    const ret = Add_Txchannel(
      loc, polarRe, polarIm,
      phi, phiPtn, phiLen,
      theta, thetaPtn, thetaLen,
      ch.antenna_gain || 0,
      null, null, null, 0,  // no in-flight waveform modulation
      pModRe, pModIm,
      ch.delay || 0, ch.grid || 0.5, ptrTx
    );
    if (ret !== 0) throw new Error("Add_Txchannel failed");
  }
  return ptrTx;
}

function _buildReceiver(rxCfg) {
  const fs      = rxCfg.fs             || 2e6;
  const rfGain  = rxCfg.rf_gain        || 0;
  const res     = rxCfg.load_resistor  || 500;
  const bbGain  = rxCfg.baseband_gain  || 0;
  const bbBw    = fs / 2; // Nyquist bandwidth

  const ptrRx = Create_Receiver(fs, rfGain, res, bbGain, bbBw);
  if (!ptrRx) throw new Error("Create_Receiver returned null");

  for (const ch of rxCfg.channels || [{}]) {
    const loc = toF32(ch.location || [0, 0, 0]);

    let polarRe, polarIm;
    if (ch.polarization) {
      const c = ch.polarization.map(parseComplex);
      polarRe = new Float32Array(c.map((v) => v.re));
      polarIm = new Float32Array(c.map((v) => v.im));
    } else {
      polarRe = new Float32Array([0, 0, 1]);
      polarIm = new Float32Array(3);
    }

    let phi = null, phiPtn = null, phiLen = 0;
    if (ch.azimuth_angle && ch.azimuth_pattern && ch.azimuth_angle.length > 0) {
      phi    = deg2rad(ch.azimuth_angle);
      phiPtn = toF32(ch.azimuth_pattern);
      phiLen = phi.length;
    } else {
      phi    = new Float32Array([-Math.PI / 2, Math.PI / 2]);
      phiPtn = new Float32Array([0, 0]);
      phiLen = 2;
    }
    let theta = null, thetaPtn = null, thetaLen = 0;
    if (ch.elevation_angle && ch.elevation_pattern && ch.elevation_angle.length > 0) {
      theta    = deg2rad(ch.elevation_angle);
      thetaPtn = toF32(ch.elevation_pattern);
      thetaLen = theta.length;
    } else {
      theta    = new Float32Array([-Math.PI / 2, Math.PI / 2]);
      thetaPtn = new Float32Array([0, 0]);
      thetaLen = 2;
    }

    const emptyF32 = new Float32Array(0);
    const ret = Add_Rxchannel(
      loc, polarRe, polarIm,
      phi, phiPtn, phiLen,
      theta, thetaPtn, thetaLen,
      ch.antenna_gain || 0, ptrRx
    );
    if (ret !== 0) throw new Error("Add_Rxchannel failed");
  }
  return ptrRx;
}

function _buildTargets(targetsCfg, density = 1) {
  const ptrTargets = Init_Targets();
  if (!ptrTargets) throw new Error("Init_Targets returned null");

  for (const t of targetsCfg) {
    const loc     = toF32(t.location      || [0, 0, 0]);
    const speed   = toF32(t.speed         || [0, 0, 0]);
    const rot     = toF32(t.rotation      || [0, 0, 0]);
    const rotRate = toF32(t.rotation_rate || [0, 0, 0]);

    if (t.model) {
      const mesh   = loadStl(t.model, t.unit || "m");
      const origin = toF32(t.origin || [0, 0, 0]);
      const perm   = t.permittivity ? parseComplex(t.permittivity) : { re: 1, im: 0 };
      const ret = Add_Mesh_Target(
        mesh.points, mesh.cells, mesh.cellSize,
        origin, loc, speed, rot, rotRate,
        perm.re, perm.im, 1.0, 0.0,
        false, density, false, ptrTargets
      );
      if (ret !== 0) throw new Error("Add_Mesh_Target failed");
    } else {
      const ret = Add_Point_Target(
        loc, speed,
        t.rcs   !== undefined ? t.rcs   : 0,
        t.phase !== undefined ? t.phase : 0,
        ptrTargets
      );
      if (ret !== 0) throw new Error("Add_Point_Target failed");
    }
  }
  return ptrTargets;
}

// ── PythonBridge (same public API as before) ──────────────────────────────────
class PythonBridge {
  constructor() {}

  async runSimulation(config) {
    const txCfg    = config.transmitter || {};
    const rxCfg    = config.receiver    || {};
    const radarCfg = config.radar       || {};
    const simCfg   = config.simulation  || {};
    const procCfg  = config.processing  || {};

    console.log("[bridge] runSimulation config:", JSON.stringify({
      tx_f: txCfg.f, tx_t: txCfg.t, tx_pulses: txCfg.pulses, tx_prp: txCfg.prp,
      tx_channels: txCfg.channels?.length,
      rx_fs: rxCfg.fs, rx_channels: rxCfg.channels?.length,
      num_targets: config.targets?.length,
      density: simCfg.density, level: simCfg.level,
    }));

    console.log("[bridge] Building transmitter...");
    const ptrTx = _buildTransmitter(txCfg);
    console.log("[bridge] TX pointer:", ptrTx);

    console.log("[bridge] Building receiver...");
    const ptrRx = _buildReceiver(rxCfg);
    console.log("[bridge] RX pointer:", ptrRx);

    console.log("[bridge] Creating radar...");
    const frameStart = new Float64Array([0.0]);
    const ptrRadar = Create_Radar(
      ptrTx, ptrRx, frameStart, 1,
      toF32(radarCfg.location      || [0, 0, 0]),
      toF32(radarCfg.speed         || [0, 0, 0]),
      toF32(radarCfg.rotation      || [0, 0, 0]),
      toF32(radarCfg.rotation_rate || [0, 0, 0])
    );
    console.log("[bridge] Radar pointer:", ptrRadar);
    if (!ptrRadar) throw new Error("Create_Radar returned null");

    const density = simCfg.density || 1;
    const level   = simCfg.level   || 0;

    console.log("[bridge] Building targets...");
    const ptrTargets = _buildTargets(config.targets || [], density);
    console.log("[bridge] Targets pointer:", ptrTargets);

    console.log("[bridge] Getting BB size...");
    const bbSize   = Get_BB_Size(ptrRadar);
    console.log("[bridge] BB size:", bbSize);
    if (bbSize <= 0) throw new Error(`Get_BB_Size returned ${bbSize} — check radar configuration`);
    const bbRe     = new Float64Array(bbSize);
    const bbIm     = new Float64Array(bbSize);
    const rayFilter = new Int32Array([0, 1000000]); // include all reflection orders

    console.log("[bridge] Running RadarSimulator (level=%d, density=%f)...", level, density);
    const status = Run_RadarSimulator(ptrRadar, ptrTargets, level, density, rayFilter, bbRe, bbIm);
    console.log("[bridge] Run_RadarSimulator status:", status);

    Free_Targets(ptrTargets);
    Free_Radar(ptrRadar);
    Free_Receiver(ptrRx);
    Free_Transmitter(ptrTx);

    if (status !== 0) throw new Error(`Run_RadarSimulator failed (code ${status})`);

    const numPulses = txCfg.pulses || 1;
    const numRx     = (rxCfg.channels || [{}]).length;
    const spp       = Math.round(bbSize / (numPulses * numRx));

    const output = { baseband_shape: [numPulses, numRx, spp] };

    // Raw baseband magnitude
    output.baseband = _toDbMag3D(bbRe, bbIm, numPulses, numRx, spp);

    // Range-Doppler (default on when there are multiple pulses)
    if (procCfg.range_doppler !== false && numPulses > 1) {
      const rdRe = bbRe.slice(), rdIm = bbIm.slice();
      _applyRangeFFT(rdRe, rdIm, numPulses, numRx, spp);
      _applyDopplerFFT(rdRe, rdIm, numPulses, numRx, spp);
      output.range_doppler = _toDbMag3D(rdRe, rdIm, numPulses, numRx, spp);
    }

    // Range profile (on request)
    if (procCfg.range_profile) {
      const rpRe = bbRe.slice(), rpIm = bbIm.slice();
      _applyRangeFFT(rpRe, rpIm, numPulses, numRx, spp);
      output.range_profile = _toDbMag3D(rpRe, rpIm, numPulses, numRx, spp);
    }

    // Axis metadata
    const f    = txCfg.f || [24e9, 24.5e9];
    const tArr = txCfg.t || [0, 80e-6];
    const c    = 3e8;
    const bw   = Array.isArray(f) && f.length >= 2 ? Math.abs(f[f.length - 1] - f[0]) : 0;
    const sweepTime = Array.isArray(tArr) && tArr.length >= 2
      ? Math.abs(tArr[tArr.length - 1] - tArr[0]) : 0;

    if (bw > 0) {
      const rangeRes = c / (2 * bw);
      output.range_res  = rangeRes;
      output.range_axis = Array.from({ length: spp }, (_, i) => (i / spp) * rangeRes * spp);
    }

    if (numPulses > 1) {
      let prp = txCfg.prp;
      if (prp == null) prp = sweepTime > 0 ? sweepTime : 1e-3;
      const fc         = Array.isArray(f) ? f.reduce((a, b) => a + b, 0) / f.length : f;
      const maxVelocity = c / fc / (4 * prp);
      output.max_velocity  = maxVelocity;
      output.velocity_axis = Array.from({ length: numPulses },
        (_, i) => -maxVelocity + (2 * maxVelocity * i) / (numPulses - 1)
      );
    }

    return output;
  }

  async runRcsSimulation(config) {
    const rcsCfg  = config.rcs || {};
    const density = rcsCfg.density || 1;

    const ptrTargets = _buildTargets(config.targets || [], density);

    const incPhi   = (rcsCfg.inc_phi   || [0]).map(Number);
    const incTheta = (rcsCfg.inc_theta || [90]).map(Number);
    const obsPhi   = rcsCfg.obs_phi   ? rcsCfg.obs_phi.map(Number)   : incPhi;
    const obsTheta = rcsCfg.obs_theta ? rcsCfg.obs_theta.map(Number) : incTheta;
    const numDirs  = incPhi.length;

    const incDirs = new Float64Array(numDirs * 3);
    const obsDirs = new Float64Array(numDirs * 3);
    for (let i = 0; i < numDirs; i++) {
      incDirs.set(sphericalToXyz(incPhi[i], incTheta[i]), i * 3);
      obsDirs.set(sphericalToXyz(obsPhi[i], obsTheta[i]), i * 3);
    }

    const ipCfg  = rcsCfg.inc_pol || [0, 0, 1];
    const opCfg  = rcsCfg.obs_pol || ipCfg;
    const incPolRe = new Float64Array(3), incPolIm = new Float64Array(3);
    const obsPolRe = new Float64Array(3), obsPolIm = new Float64Array(3);
    for (let i = 0; i < 3; i++) {
      const ip = parseComplex(ipCfg[i]);
      const op = parseComplex(opCfg[i]);
      incPolRe[i] = ip.re; incPolIm[i] = ip.im;
      obsPolRe[i] = op.re; obsPolIm[i] = op.im;
    }

    const frequency = rcsCfg.frequency || 24e9;
    const rcsResult = new Float64Array(numDirs);

    const status = Run_RcsSimulator(
      ptrTargets, incDirs, obsDirs, numDirs,
      incPolRe, incPolIm, obsPolRe, obsPolIm,
      frequency, density, rcsResult
    );

    Free_Targets(ptrTargets);
    if (status !== 0) throw new Error(`Run_RcsSimulator failed (code ${status})`);

    const rcsLinear = Array.from(rcsResult);
    const rcsDbsm   = rcsLinear.map((v) => 10 * Math.log10(Math.abs(v) + 1e-30));

    return { rcs_linear: rcsLinear, rcs_dbsm: rcsDbsm, inc_phi: incPhi, inc_theta: incTheta };
  }

  async checkPython() {
    const version  = new Int32Array(3);
    Get_Version(version);
    const licensed = Is_Licensed();
    return {
      radarsimlib_version:   `${version[0]}.${version[1]}.${version[2]}`,
      radarsimlib_available: true,
      licensed:              licensed === 1,
    };
  }

  kill() {
    // No persistent process — DLL cleanup is automatic on process exit.
  }
}

module.exports = { PythonBridge };
