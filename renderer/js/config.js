// ===== RadarSimApp - Configuration Collection =====

function collectConfig() {
  // TX
  const fStart = parseNumber(document.getElementById("tx-f-start").value) * 1e9;
  const fEnd = parseNumber(document.getElementById("tx-f-end").value) * 1e9;
  const tStart = parseNumber(document.getElementById("tx-t-start").value) * 1e-6;
  const tEnd = parseNumber(document.getElementById("tx-t-end").value) * 1e-6;

  const f = [fStart, fEnd];
  const t = [tStart, tEnd];

  const txConfig = {
    f,
    t,
    tx_power: parseNumber(document.getElementById("tx-power").value),
    pulses: parseInt(document.getElementById("tx-pulses").value) || 1,
    prp: parseNumber(document.getElementById("tx-prp").value) * 1e-6,
  };

  // TX Channels
  txConfig.channels = txChannels.map((_, i) => {
    const ch = {};
    ch.location = [
      parseNumber(document.getElementById(`tx-ch-${i}-loc-x`)?.value) * 1e-3,
      parseNumber(document.getElementById(`tx-ch-${i}-loc-y`)?.value) * 1e-3,
      parseNumber(document.getElementById(`tx-ch-${i}-loc-z`)?.value) * 1e-3,
    ];
    ch.polarization = [
      document.getElementById(`tx-ch-${i}-pol-x`)?.value || "0",
      document.getElementById(`tx-ch-${i}-pol-y`)?.value || "0",
      document.getElementById(`tx-ch-${i}-pol-z`)?.value || "1",
    ];
    const azAngles = parseCSV(document.getElementById(`tx-ch-${i}-az-angles`)?.value || "");
    const azPattern = parseCSV(document.getElementById(`tx-ch-${i}-az-pattern`)?.value || "");
    if (azAngles.length > 0) ch.azimuth_angle = azAngles;
    if (azPattern.length > 0) ch.azimuth_pattern = azPattern;
    const elAngles = parseCSV(document.getElementById(`tx-ch-${i}-el-angles`)?.value || "");
    const elPattern = parseCSV(document.getElementById(`tx-ch-${i}-el-pattern`)?.value || "");
    if (elAngles.length > 0) ch.elevation_angle = elAngles;
    if (elPattern.length > 0) ch.elevation_pattern = elPattern;
    const delay = parseNumber(document.getElementById(`tx-ch-${i}-delay`)?.value) * 1e-9;
    if (delay !== 0) ch.delay = delay;
    return ch;
  });

  if (txConfig.channels.length === 0) {
    txConfig.channels = [{}];
  }

  // RX
  const rxConfig = {
    fs: parseNumber(document.getElementById("rx-fs").value) * 1e6,
    noise_figure: parseNumber(document.getElementById("rx-nf").value),
    rf_gain: parseNumber(document.getElementById("rx-rf-gain").value),
    baseband_gain: parseNumber(document.getElementById("rx-bb-gain").value),
    load_resistor: parseNumber(document.getElementById("rx-load-r").value),
    bb_type: document.getElementById("rx-bb-type").value,
  };

  rxConfig.channels = rxChannels.map((_, i) => {
    const ch = {};
    ch.location = [
      parseNumber(document.getElementById(`rx-ch-${i}-loc-x`)?.value) * 1e-3,
      parseNumber(document.getElementById(`rx-ch-${i}-loc-y`)?.value) * 1e-3,
      parseNumber(document.getElementById(`rx-ch-${i}-loc-z`)?.value) * 1e-3,
    ];
    ch.polarization = [
      document.getElementById(`rx-ch-${i}-pol-x`)?.value || "0",
      document.getElementById(`rx-ch-${i}-pol-y`)?.value || "0",
      document.getElementById(`rx-ch-${i}-pol-z`)?.value || "1",
    ];
    const azAngles = parseCSV(document.getElementById(`rx-ch-${i}-az-angles`)?.value || "");
    const azPattern = parseCSV(document.getElementById(`rx-ch-${i}-az-pattern`)?.value || "");
    if (azAngles.length > 0) ch.azimuth_angle = azAngles;
    if (azPattern.length > 0) ch.azimuth_pattern = azPattern;
    const elAngles = parseCSV(document.getElementById(`rx-ch-${i}-el-angles`)?.value || "");
    const elPattern = parseCSV(document.getElementById(`rx-ch-${i}-el-pattern`)?.value || "");
    if (elAngles.length > 0) ch.elevation_angle = elAngles;
    if (elPattern.length > 0) ch.elevation_pattern = elPattern;
    return ch;
  });

  if (rxConfig.channels.length === 0) {
    rxConfig.channels = [{}];
  }

  // Radar
  const radarConfig = {
    location: [
      parseNumber(document.getElementById("radar-loc-x").value),
      parseNumber(document.getElementById("radar-loc-y").value),
      parseNumber(document.getElementById("radar-loc-z").value),
    ],
    speed: [
      parseNumber(document.getElementById("radar-spd-x").value),
      parseNumber(document.getElementById("radar-spd-y").value),
      parseNumber(document.getElementById("radar-spd-z").value),
    ],
    rotation: [
      parseNumber(document.getElementById("radar-rot-yaw").value),
      parseNumber(document.getElementById("radar-rot-pitch").value),
      parseNumber(document.getElementById("radar-rot-roll").value),
    ],
    rotation_rate: [
      parseNumber(document.getElementById("radar-rr-yaw").value),
      parseNumber(document.getElementById("radar-rr-pitch").value),
      parseNumber(document.getElementById("radar-rr-roll").value),
    ],
  };

  // Targets
  const targets = [];

  pointTargets.forEach((_, i) => {
    targets.push({
      location: [
        parseNumber(document.getElementById(`pt-${i}-loc-x`)?.value, 50),
        parseNumber(document.getElementById(`pt-${i}-loc-y`)?.value),
        parseNumber(document.getElementById(`pt-${i}-loc-z`)?.value),
      ],
      rcs: parseNumber(document.getElementById(`pt-${i}-rcs`)?.value, 20),
      speed: [
        parseNumber(document.getElementById(`pt-${i}-spd-x`)?.value),
        parseNumber(document.getElementById(`pt-${i}-spd-y`)?.value),
        parseNumber(document.getElementById(`pt-${i}-spd-z`)?.value),
      ],
      phase: parseNumber(document.getElementById(`pt-${i}-phase`)?.value),
    });
  });

  meshTargets.forEach((_, i) => {
    const mt = {};
    mt.model = document.getElementById(`mesh-${i}-model`)?.value || "";
    if (!mt.model) return;
    mt.location = [
      parseNumber(document.getElementById(`mesh-${i}-loc-x`)?.value),
      parseNumber(document.getElementById(`mesh-${i}-loc-y`)?.value),
      parseNumber(document.getElementById(`mesh-${i}-loc-z`)?.value),
    ];
    mt.speed = [
      parseNumber(document.getElementById(`mesh-${i}-spd-x`)?.value),
      parseNumber(document.getElementById(`mesh-${i}-spd-y`)?.value),
      parseNumber(document.getElementById(`mesh-${i}-spd-z`)?.value),
    ];
    mt.rotation = [
      parseNumber(document.getElementById(`mesh-${i}-rot-yaw`)?.value),
      parseNumber(document.getElementById(`mesh-${i}-rot-pitch`)?.value),
      parseNumber(document.getElementById(`mesh-${i}-rot-roll`)?.value),
    ];
    mt.rotation_rate = [
      parseNumber(document.getElementById(`mesh-${i}-rr-yaw`)?.value),
      parseNumber(document.getElementById(`mesh-${i}-rr-pitch`)?.value),
      parseNumber(document.getElementById(`mesh-${i}-rr-roll`)?.value),
    ];
    mt.unit = document.getElementById(`mesh-${i}-unit`)?.value || "m";
    const perm = document.getElementById(`mesh-${i}-perm`)?.value;
    if (perm && perm.toString().trim()) mt.permittivity = parseFloat(perm);
    targets.push(mt);
  });

  // Simulation
  const simConfig = {
    density: parseNumber(document.getElementById("sim-density").value, 1),
    level: document.getElementById("sim-level").value || null,
  };

  // Processing
  const rdRangeFftEnabled = document.getElementById("proc-rd-range-fft-enable").checked;
  const rdDopplerFftEnabled = document.getElementById("proc-rd-doppler-fft-enable").checked;
  const rdRangeFft = rdRangeFftEnabled ? (parseInt(document.getElementById("proc-rd-range-fft").value, 10) || null) : null;
  const rdDopplerFft = rdDopplerFftEnabled ? (parseInt(document.getElementById("proc-rd-doppler-fft").value, 10) || null) : null;
  const rdEnabled = document.getElementById("proc-range-doppler").checked;
  const processing = {
    range_doppler: rdEnabled,
    rd_range_fft: rdRangeFft,
    rd_doppler_fft: rdDopplerFft,
    // Range profile is auto-enabled by RD and reuses rd_range_fft
    range_profile: document.getElementById("proc-range-profile").checked || rdEnabled,
    rp_range_fft: rdRangeFft,
    noise: document.getElementById("proc-noise").checked,
  };

  return {
    transmitter: txConfig,
    receiver: rxConfig,
    radar: radarConfig,
    targets,
    simulation: simConfig,
    processing,
  };
}
