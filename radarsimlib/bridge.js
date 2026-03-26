"use strict";
// ===== RadarSimApp - Native C Bridge =====

const koffi = require("koffi");
const path = require("path");
const fs = require("fs");

// ── Resolve real filesystem path (asar-unpacked in packaged builds) ──────────
const baseDir = __dirname.replace("app.asar", "app.asar.unpacked");

// ── DLL ──────────────────────────────────────────────────────────────────────
const dllPath = path.join(baseDir, "radarsimc.dll");
const lib = koffi.load(dllPath);

// ── Function bindings ─────────────────────────────────────────────────────────
const Get_Version = lib.func("void Get_Version(int *version)");
const Is_Licensed = lib.func("int Is_Licensed()");
const Set_License = lib.func("void Set_License(const char *license_file_path, const char *product)");

// ── License activation ─────────────────────────────────────────────────────────
{
  const licPattern = /^license_RadarSimApp_.*\.lic$/;
  const licFiles = fs.readdirSync(baseDir).filter((f) => licPattern.test(f));
  for (const f of licFiles) {
    const licPath = path.join(baseDir, f);
    console.log("[bridge] Activating license:", licPath);
    Set_License(licPath, "RadarSimApp");
  }
  if (licFiles.length === 0) {
    console.warn("[bridge] No license files found in", baseDir);
  }
}

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

// ── Error codes (radarsim.h) ───────────────────────────────────────────────────
const ERROR_MESSAGES = {
  0: "Success",
  1: "Null pointer encountered",
  2: "Invalid parameter provided",
  3: "Memory allocation failed",
  4: "Free tier limit reached — purchase a license at https://radarsimx.com/ to unlock full capabilities",
  5: "Unhandled exception occurred",
  6: "Ray count exceeds grid capacity",
};

function _errorMsg(code, context) {
  const desc = ERROR_MESSAGES[code] || `Unknown error`;
  return `${context}: ${desc} (code ${code})`;
}

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

/**
 * Build normalized antenna pattern arrays.
 *   phi     = azimuth_angle / 180 * pi
 *   phi_ptn = azimuth_pattern - max(azimuth_pattern)
 *   theta   = flip(90 - elevation_angle) / 180 * pi
 *   theta_ptn = flip(elevation_pattern) - max(elevation_pattern)
 *   antenna_gain = max(azimuth_pattern)
 */
function _buildAntennaPattern(azAngle, azPattern, elAngle, elPattern) {
  let phi, phiPtn, antennaGain;
  if (azAngle && azPattern && azAngle.length > 0) {
    if (azAngle.length !== azPattern.length) {
      throw new Error("The length of azimuth_angle and azimuth_pattern must be the same.");
    }
    antennaGain = Math.max(...azPattern);
    phi = new Float32Array(azAngle.map((v) => (v * Math.PI) / 180));
    phiPtn = new Float32Array(azPattern.map((v) => v - antennaGain));
  } else {
    // Default omnidirectional: [-90, 90] deg → [-pi/2, pi/2]
    phi = new Float32Array([-Math.PI / 2, Math.PI / 2]);
    phiPtn = new Float32Array([0, 0]);
    antennaGain = 0;
  }

  let theta, thetaPtn;
  if (elAngle && elPattern && elAngle.length > 0) {
    if (elAngle.length !== elPattern.length) {
      throw new Error("The length of elevation_angle and elevation_pattern must be the same.");
    }
    const elMax = Math.max(...elPattern);
    // flip(90 - elevation_angle) / 180 * pi
    const transformed = elAngle.map((v) => (90 - v) * Math.PI / 180).reverse();
    const ptnFlipped = [...elPattern].reverse().map((v) => v - elMax);
    theta = new Float32Array(transformed);
    thetaPtn = new Float32Array(ptnFlipped);
  } else {
    // Default: elevation [-90, 90] → theta flip([180, 0])*pi/180 = [0, pi]
    theta = new Float32Array([0, Math.PI]);
    thetaPtn = new Float32Array([0, 0]);
  }

  return { phi, phiPtn, theta, thetaPtn, antennaGain };
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
      points[b] = buf.readFloatLE(offset) * scale;
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

// ── Noise Utilities ──────────────────────────────────────────────────────────
/** Box-Muller transform: returns a standard-normal random variate. */
let _randnSpare = null;
function _randn() {
  if (_randnSpare !== null) { const v = _randnSpare; _randnSpare = null; return v; }
  let u, v, s;
  do { u = Math.random() * 2 - 1; v = Math.random() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
  const mul = Math.sqrt(-2 * Math.log(s) / s);
  _randnSpare = v * mul;
  return u * mul;
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
        re[i + k] = uRe + vRe; im[i + k] = uIm + vIm;
        re[i + k + half] = uRe - vRe; im[i + k + half] = uIm - vIm;
        const tmp = urRe * wRe - urIm * wIm;
        urIm = urRe * wIm + urIm * wRe;
        urRe = tmp;
      }
    }
  }
}

/** Apply FFT along the "samples" axis. Returns new buffers of size n * nPulse * nRx. */
function _applyRangeFFT(re, im, nPulse, nRx, spp, n) {
  if (!n) n = _nextPow2(spp);
  const outRe = new Float64Array(n * nPulse * nRx);
  const outIm = new Float64Array(n * nPulse * nRx);
  for (let c = 0; c < nRx; c++) {
    for (let p = 0; p < nPulse; p++) {
      const inBase = (c * nPulse + p) * spp;
      const outBase = (c * nPulse + p) * n;
      const R = new Float64Array(n); R.set(re.subarray(inBase, inBase + Math.min(spp, n)));
      const I = new Float64Array(n); I.set(im.subarray(inBase, inBase + Math.min(spp, n)));
      _fft(R, I);
      outRe.set(R, outBase);
      outIm.set(I, outBase);
    }
  }
  return { re: outRe, im: outIm };
}

/** Apply FFT along the "pulses" axis. Returns new buffers of size rangeDim * n * nRx.
 *  Includes fftshift so zero-Doppler is centered.
 *  @param rangeDim - number of range bins per pulse (may differ from original spp after range FFT) */
function _applyDopplerFFT(re, im, nPulse, nRx, rangeDim, n) {
  if (!n) n = _nextPow2(nPulse);
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
      _fft(R, I);
      // fftshift: swap first half and second half
      for (let p = 0; p < n; p++) {
        const shifted = (p + half) % n;
        outRe[(c * n + p) * rangeDim + s] = R[shifted];
        outIm[(c * n + p) * rangeDim + s] = I[shifted];
      }
    }
  }
  return { re: outRe, im: outIm };
}

/** Convert flat re/im arrays → nested [pulse][channel][sample] dB-magnitude array.
 * DLL flat layout (column-major): flat[s + spp*p + spp*nPulse*c]
 */
function _toDbMag3D(re, im, nPulse, nRx, spp) {
  const out = [];
  for (let p = 0; p < nPulse; p++) {
    const rxArr = [];
    for (let r = 0; r < nRx; r++) {
      const row = new Array(spp);
      const base = (r * nPulse + p) * spp;  // channel varies slowest
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

/** Convert flat re/im arrays → nested [pulse][channel]{re, im} complex array.
 * DLL flat layout (column-major): flat[s + spp*p + spp*nPulse*c]
 */
function _toComplex3D(re, im, nPulse, nRx, spp) {
  const out = [];
  for (let p = 0; p < nPulse; p++) {
    const rxArr = [];
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

// ── Builders ──────────────────────────────────────────────────────────────────
function _buildTransmitter(txCfg) {
  // ── Normalize f and t ────────────────────────────────────────────────────
  let f = txCfg.f || [24e9, 24.5e9];
  let t = txCfg.t || [0, 80e-6];
  if (!Array.isArray(f)) f = [f];
  if (!Array.isArray(t)) t = [t];
  if (f.length === 1) f = [f[0], f[0]];
  if (t.length === 1) t = [0, t[0]];
  if (f.length !== t.length) {
    throw new Error("f and t must have the same length.");
  }

  const numPulses = txCfg.pulses || 1;
  const txPower = txCfg.tx_power || 0;

  const freq = toF64(f);
  const freqTime = toF64(t);

  const pulseDuration = t[t.length - 1] - t[0];

  // ── PRP → pulse_start_time ───────────────────────────────────────────────
  let prpArr;
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
  // pulse_start_time = cumsum(prp) - prp[0]
  const pst = new Float64Array(numPulses);
  pst[0] = 0;
  for (let i = 1; i < numPulses; i++) pst[i] = pst[i - 1] + prpArr[i - 1];

  // ── f_offset ──────────────────────────────────────────────────────────────
  let fOffset;
  if (txCfg.f_offset == null) {
    fOffset = new Float64Array(numPulses);
  } else {
    fOffset = toF64(txCfg.f_offset);
    if (fOffset.length !== numPulses) {
      throw new Error("The length of f_offset must be the same as pulses.");
    }
  }

  let ptrTx;
  if (txCfg.pn_f && txCfg.pn_power) {
    const pnF = toF64(txCfg.pn_f);
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

  // ── Track delays for timestamp computation ──────────────────────────
  const txDelays = [];

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

    // ── Antenna pattern ───────────────────────────────────────────────────
    const { phi, phiPtn, theta, thetaPtn, antennaGain } =
      _buildAntennaPattern(ch.azimuth_angle, ch.azimuth_pattern,
        ch.elevation_angle, ch.elevation_pattern);

    // ── Pulse modulation ────────────────────────────────────────────────
    let pModRe, pModIm;
    if (ch.pulse_amp && ch.pulse_phs) {
      const phsRad = ch.pulse_phs.map((v) => (v * Math.PI) / 180);
      pModRe = new Float32Array(ch.pulse_amp.map((a, i) => a * Math.cos(phsRad[i])));
      pModIm = new Float32Array(ch.pulse_amp.map((a, i) => a * Math.sin(phsRad[i])));
    } else if (ch.pulse_phs && !ch.pulse_amp) {
      const phsRad = ch.pulse_phs.map((v) => (v * Math.PI) / 180);
      pModRe = new Float32Array(phsRad.map((p) => Math.cos(p)));
      pModIm = new Float32Array(phsRad.map((p) => Math.sin(p)));
    } else if (ch.pulse_amp && !ch.pulse_phs) {
      pModRe = toF32(ch.pulse_amp);
      pModIm = new Float32Array(ch.pulse_amp.length);
    } else {
      // Default: ones
      pModRe = new Float32Array(numPulses).fill(1);
      pModIm = new Float32Array(numPulses);
    }

    // ── Waveform modulation ───────────────────────────────────────────────
    let modT, modVarRe, modVarIm, modLen = 0;
    if (ch.mod_t && (ch.phs != null || ch.amp != null)) {
      modT = toF32(ch.mod_t);
      const amp = ch.amp || new Array(modT.length).fill(1);
      const phs = ch.phs ? ch.phs.map((v) => (v * Math.PI) / 180)
        : new Array(modT.length).fill(0);
      modVarRe = new Float32Array(amp.map((a, i) => a * Math.cos(phs[i])));
      modVarIm = new Float32Array(amp.map((a, i) => a * Math.sin(phs[i])));
      modLen = modT.length;
    } else {
      modT = new Float32Array(0);
      modVarRe = new Float32Array(0);
      modVarIm = new Float32Array(0);
    }

    const chDelay = ch.delay || 0;
    txDelays.push(chDelay);

    // grid = 1/180*pi ≈ 0.01745 rad
    const ret = Add_Txchannel(
      loc, polarRe, polarIm,
      phi, phiPtn, phi.length,
      theta, thetaPtn, theta.length,
      antennaGain,
      modT, modVarRe, modVarIm, modLen,
      pModRe, pModIm,
      chDelay, (1 / 180) * Math.PI, ptrTx
    );
    if (ret !== 0) throw new Error(_errorMsg(ret, "Add_Txchannel"));
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

function _buildReceiver(rxCfg) {
  const fs = rxCfg.fs || 2e6;
  const rfGain = rxCfg.rf_gain || 0;
  const res = rxCfg.load_resistor || 500;
  const bbGain = rxCfg.baseband_gain || 0;
  const bbType = rxCfg.bb_type || "complex";

  // Noise bandwidth depends on bb_type
  const noiseBw = bbType === "real" ? fs / 2 : fs;

  const ptrRx = Create_Receiver(fs, rfGain, res, bbGain, noiseBw);
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

    // ── Antenna pattern ───────────────────────────────────────────────────
    const { phi, phiPtn, theta, thetaPtn, antennaGain } =
      _buildAntennaPattern(ch.azimuth_angle, ch.azimuth_pattern,
        ch.elevation_angle, ch.elevation_pattern);

    const ret = Add_Rxchannel(
      loc, polarRe, polarIm,
      phi, phiPtn, phi.length,
      theta, thetaPtn, theta.length,
      antennaGain, ptrRx
    );
    if (ret !== 0) throw new Error(_errorMsg(ret, "Add_Rxchannel"));
  }

  return {
    ptr: ptrRx,
    fs,
    rfGain,
    noiseFigure: rxCfg.noise_figure || 0,
    basebandGain: bbGain,
    loadResistor: res,
    noiseBw: noiseBw,
    bbType,
    numChannels: (rxCfg.channels || [{}]).length,
  };
}

function _buildTargets(targetsCfg, density = 1) {
  const ptrTargets = Init_Targets();
  if (!ptrTargets) throw new Error("Init_Targets returned null");

  for (const t of targetsCfg) {
    const loc = toF32(t.location || [0, 0, 0]);
    const speed = toF32(t.speed || [0, 0, 0]);

    if (t.model) {
      const mesh = loadStl(t.model, t.unit || "m");
      const origin = toF32(t.origin || [0, 0, 0]);

      // Convert rotation/rotation_rate degrees → radians
      const rot = toF32((t.rotation || [0, 0, 0]).map((v) => (v * Math.PI) / 180));
      const rotRate = toF32((t.rotation_rate || [0, 0, 0]).map((v) => (v * Math.PI) / 180));

      // Permittivity: 'PEC' → {-1, 0}
      let epReal, epImag;
      if (!t.permittivity || t.permittivity === "PEC") {
        epReal = -1;
        epImag = 0;
      } else {
        const perm = parseComplex(t.permittivity);
        epReal = perm.re;
        epImag = perm.im;
      }

      const ret = Add_Mesh_Target(
        mesh.points, mesh.cells, mesh.cellSize,
        origin, loc, speed, rot, rotRate,
        epReal, epImag, 1.0, 0.0,
        t.skip_diffusion || false,
        t.density || 0,
        t.environment || false,
        ptrTargets
      );
      if (ret !== 0) throw new Error(_errorMsg(ret, "Add_Mesh_Target"));
    } else {
      // Phase: degrees → radians
      const phaseRad = t.phase != null ? (t.phase * Math.PI) / 180 : 0;
      const ret = Add_Point_Target(
        loc, speed,
        t.rcs != null ? t.rcs : 0,
        phaseRad,
        ptrTargets
      );
      if (ret !== 0) throw new Error(_errorMsg(ret, "Add_Point_Target"));
    }
  }
  return ptrTargets;
}

// ── RadarSimBridge ───────────────────────────────────────────────────────────
class RadarSimBridge {
  constructor() { }

  async runSimulation(config) {
    const txCfg = config.transmitter || {};
    const rxCfg = config.receiver || {};
    const radarCfg = config.radar || {};
    const simCfg = config.simulation || {};
    const procCfg = config.processing || {};

    console.log("[bridge] runSimulation config:", JSON.stringify({
      tx_f: txCfg.f, tx_t: txCfg.t, tx_pulses: txCfg.pulses, tx_prp: txCfg.prp,
      tx_channels: txCfg.channels?.length,
      rx_fs: rxCfg.fs, rx_channels: rxCfg.channels?.length,
      num_targets: config.targets?.length,
      density: simCfg.density, level: simCfg.level,
    }));

    console.log("[bridge] Building transmitter...");
    const tx = _buildTransmitter(txCfg);
    console.log("[bridge] TX pointer:", tx.ptr);

    console.log("[bridge] Building receiver...");
    const rx = _buildReceiver(rxCfg);
    console.log("[bridge] RX pointer:", rx.ptr);

    console.log("[bridge] Creating radar...");
    const frameStart = new Float64Array([0.0]);
    const ptrRadar = Create_Radar(
      tx.ptr, rx.ptr, frameStart, 1,
      toF32(radarCfg.location || [0, 0, 0]),
      toF32(radarCfg.speed || [0, 0, 0]),
      toF32(radarCfg.rotation || [0, 0, 0]),
      toF32(radarCfg.rotation_rate || [0, 0, 0])
    );
    console.log("[bridge] Radar pointer:", ptrRadar);
    if (!ptrRadar) throw new Error("Create_Radar returned null");

    const density = Number(simCfg.density) || 1;
    // Map level strings to ints
    const levelMap = { frame: 0, pulse: 1, sample: 2 };
    const level = levelMap[simCfg.level] ?? 0;

    console.log("[bridge] Building targets...");
    const ptrTargets = _buildTargets(config.targets || [], density);
    console.log("[bridge] Targets pointer:", ptrTargets);

    console.log("[bridge] Getting BB size...");
    const bbSize = Get_BB_Size(ptrRadar);
    console.log("[bridge] BB size:", bbSize);
    if (bbSize <= 0) throw new Error(`Get_BB_Size returned ${bbSize} — check radar configuration`);
    const bbRe = new Float64Array(bbSize);
    const bbIm = new Float64Array(bbSize);
    // ray_filter default [0, 10]
    const rayFilter = new Int32Array(simCfg.ray_filter || [0, 10]);

    console.log("[bridge] Running RadarSimulator (level=%d, density=%f)...", level, density);
    const status = Run_RadarSimulator(ptrRadar, ptrTargets, level, density, rayFilter, bbRe, bbIm);
    console.log("[bridge] Run_RadarSimulator status:", status);

    Free_Targets(ptrTargets);
    Free_Radar(ptrRadar);
    Free_Receiver(rx.ptr);
    Free_Transmitter(tx.ptr);

    if (status !== 0) throw new Error(_errorMsg(status, "Run_RadarSimulator"));

    // Discard imaginary part for real baseband
    const bbType = rxCfg.bb_type || "complex";
    if (bbType === "real") bbIm.fill(0);

    const numPulses = txCfg.pulses || 1;
    // Total channels = num_tx * num_rx
    const numTxCh = (txCfg.channels || [{}]).length;
    const numRxCh = (rxCfg.channels || [{}]).length;
    const numChannels = numTxCh * numRxCh;
    const spp = Math.round(bbSize / (numPulses * numChannels));

    const output = { baseband_shape: [spp, numPulses, numChannels] };

    // --- Add receiver noise ---
    if (procCfg.noise !== false) {
      const boltzmannConst = 1.38064852e-23;
      const Ts = 290;
      const inputNoiseDbm = 10 * Math.log10(boltzmannConst * Ts * 1000); // dBm/Hz
      const noiseFigure = rxCfg.noise_figure || 0;
      const rfGain = rxCfg.rf_gain || 0;
      const bbGain = rxCfg.baseband_gain || 0;
      const fs = rxCfg.fs || 2e6;
      const loadR = rxCfg.load_resistor || 500;
      const bbType = rxCfg.bb_type || "complex";

      // noise_bandwidth = fs
      const noiseBandwidth = fs;
      const receiverNoiseDbm = inputNoiseDbm + rfGain + noiseFigure + 10 * Math.log10(noiseBandwidth) + bbGain;
      const receiverNoiseWatts = 1e-3 * Math.pow(10, receiverNoiseDbm / 10);
      const noiseAmplitude = Math.sqrt(receiverNoiseWatts * loadR);

      // Generate noise per RX channel, then map to each virtual channel
      // DLL flat layout: flat[s + spp*p + spp*nPulse*c]
      const scale = bbType === "real" ? noiseAmplitude : noiseAmplitude / Math.SQRT2;
      // Pre-generate noise for each physical RX channel (all samples contiguous)
      const totalSamplesPerRx = numPulses * spp;
      const noisePerRx = new Array(numRxCh);
      for (let r = 0; r < numRxCh; r++) {
        const reNoise = new Float64Array(totalSamplesPerRx);
        const imNoise = new Float64Array(totalSamplesPerRx);
        for (let i = 0; i < totalSamplesPerRx; i++) {
          reNoise[i] = _randn() * scale;
          if (bbType !== "real") imNoise[i] = _randn() * scale;
        }
        noisePerRx[r] = { re: reNoise, im: imNoise };
      }
      // Add noise to baseband: virtual channel c → physical RX = c % numRxCh
      for (let c = 0; c < numChannels; c++) {
        const rxIdx = c % numRxCh;
        const nRe = noisePerRx[rxIdx].re;
        const nIm = noisePerRx[rxIdx].im;
        for (let p = 0; p < numPulses; p++) {
          const base = (c * numPulses + p) * spp;
          const nBase = p * spp;
          for (let s = 0; s < spp; s++) {
            bbRe[base + s] += nRe[nBase + s];
            bbIm[base + s] += nIm[nBase + s];
          }
        }
      }
      console.log("[bridge] Noise added (amplitude=%.3e, type=%s)", noiseAmplitude, bbType);
    }

    // Raw baseband as complex {re, im} per [pulse][channel]
    output.baseband = _toComplex3D(bbRe, bbIm, numPulses, numChannels, spp);
    output.bb_type = rxCfg.bb_type || "complex";

    // Range-Doppler (default on when there are multiple pulses)
    if (procCfg.range_doppler !== false && numPulses > 1) {
      const rdRangeN = procCfg.rd_range_fft || _nextPow2(spp);
      const rdDopplerN = procCfg.rd_doppler_fft || _nextPow2(numPulses);
      const rangeOut = _applyRangeFFT(bbRe, bbIm, numPulses, numChannels, spp, rdRangeN);
      const rdOut = _applyDopplerFFT(rangeOut.re, rangeOut.im, numPulses, numChannels, rdRangeN, rdDopplerN);
      output.range_doppler = _toDbMag3D(rdOut.re, rdOut.im, rdDopplerN, numChannels, rdRangeN);
      output.rd_range_fft_size = rdRangeN;
      output.rd_doppler_fft_size = rdDopplerN;
      output.rd_range_axis = Array.from({ length: rdRangeN }, (_, i) => i);
      const rdHalf = Math.floor(rdDopplerN / 2);
      output.rd_doppler_axis = Array.from({ length: rdDopplerN }, (_, i) => i - rdHalf);
    }

    // Range profile (on request)
    if (procCfg.range_profile) {
      const rpRangeN = procCfg.rp_range_fft || _nextPow2(spp);
      const rpOut = _applyRangeFFT(bbRe, bbIm, numPulses, numChannels, spp, rpRangeN);
      output.range_profile = _toDbMag3D(rpOut.re, rpOut.im, numPulses, numChannels, rpRangeN);
      output.rp_range_fft_size = rpRangeN;
      output.rp_range_axis = Array.from({ length: rpRangeN }, (_, i) => i);
    }

    // Baseband axis
    output.range_axis = Array.from({ length: spp }, (_, i) => i);

    if (numPulses > 1) {
      const half = Math.floor(numPulses / 2);
      output.velocity_axis = Array.from({ length: numPulses },
        (_, i) => i - half
      );
    }

    return output;
  }

  async runRcsSimulation(config) {
    const rcsCfg = config.rcs || {};
    const density = rcsCfg.density || 1;

    const ptrTargets = _buildTargets(config.targets || [], density);

    const incPhi = (rcsCfg.inc_phi || [0]).map(Number);
    const incTheta = (rcsCfg.inc_theta || [90]).map(Number);
    const obsPhi = rcsCfg.obs_phi ? rcsCfg.obs_phi.map(Number) : incPhi;
    const obsTheta = rcsCfg.obs_theta ? rcsCfg.obs_theta.map(Number) : incTheta;
    const numDirs = incPhi.length;

    const incDirs = new Float64Array(numDirs * 3);
    const obsDirs = new Float64Array(numDirs * 3);
    for (let i = 0; i < numDirs; i++) {
      incDirs.set(sphericalToXyz(incPhi[i], incTheta[i]), i * 3);
      obsDirs.set(sphericalToXyz(obsPhi[i], obsTheta[i]), i * 3);
    }

    const ipCfg = rcsCfg.inc_pol || [0, 0, 1];
    const opCfg = rcsCfg.obs_pol || ipCfg;
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
    if (status !== 0) throw new Error(_errorMsg(status, "Run_RcsSimulator"));

    const rcsLinear = Array.from(rcsResult);
    const rcsDbsm = rcsLinear.map((v) => 10 * Math.log10(Math.abs(v) + 1e-30));

    return { rcs_linear: rcsLinear, rcs_dbsm: rcsDbsm, inc_phi: incPhi, inc_theta: incTheta };
  }

  async checkLibrary() {
    const version = new Int32Array(3);
    Get_Version(version);
    const licensed = Is_Licensed();
    return {
      radarsimlib_version: `${version[0]}.${version[1]}.${version[2]}`,
      radarsimlib_available: true,
      licensed: licensed === 1,
    };
  }

  async activateLicense(licFilePath) {
    const fileName = path.basename(licFilePath);
    const dest = path.join(baseDir, fileName);
    fs.copyFileSync(licFilePath, dest);
    console.log("[bridge] Copied license file to:", dest);
    Set_License(dest, "RadarSimApp");
    const licensed = Is_Licensed();
    return { licensed: licensed === 1 };
  }

  kill() {
    // No persistent process — DLL cleanup is automatic on process exit.
  }
}

module.exports = { RadarSimBridge };
