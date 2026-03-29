// ===== RadarSimApp - Plot Functions =====

// --- Plotly Theme ---
const plotlyLayout = {
  paper_bgcolor: "#12121a",
  plot_bgcolor: "#12121a",
  font: { color: "#e8e8f0", size: 12 },
  margin: { l: 60, r: 20, t: 10, b: 50 },
  xaxis: {
    gridcolor: "#2a2a3e",
    zerolinecolor: "#2a2a3e",
  },
  yaxis: {
    gridcolor: "#2a2a3e",
    zerolinecolor: "#2a2a3e",
  },
  coloraxis: {
    colorscale: "Viridis",
  },
};

const plotlyConfig = {
  responsive: true,
  displayModeBar: "hover",
  displaylogo: false,
};

const smallPlotLayout = {
  paper_bgcolor: "#12121a",
  plot_bgcolor: "#12121a",
  font: { color: "#e8e8f0", size: 10 },
  margin: { l: 0, r: 0, t: 20, b: 0 },
  scene: {
    xaxis: { title: "X (m)", gridcolor: "#2a2a3e", backgroundcolor: "#12121a", color: "#8888a0" },
    yaxis: { title: "Y (m)", gridcolor: "#2a2a3e", backgroundcolor: "#12121a", color: "#8888a0" },
    zaxis: { title: "Z (m)", gridcolor: "#2a2a3e", backgroundcolor: "#12121a", color: "#8888a0" },
    bgcolor: "#12121a",
    aspectmode: "data",
  },
  showlegend: false,
};

const smallPlotConfig = { responsive: true, displayModeBar: "hover", displaylogo: false };

// --- Antenna Pattern Plots ---
const patternPlotLayout = {
  paper_bgcolor: "#12121a",
  plot_bgcolor: "#12121a",
  font: { color: "#e8e8f0", size: 10 },
  margin: { l: 40, r: 10, t: 8, b: 32 },
  xaxis: { gridcolor: "#2a2a3e", zerolinecolor: "#3a3a4e", title: { text: "Angle (°)", font: { size: 10 } } },
  yaxis: { gridcolor: "#2a2a3e", zerolinecolor: "#3a3a4e", title: { text: "dB", font: { size: 10 } } },
  showlegend: false,
};

const patternPlotConfig = { responsive: true, displayModeBar: false };

function updateChannelPatternPlot(pfx, index) {
  const azAnglesEl = document.getElementById(`${pfx}-ch-${index}-az-angles`);
  const azPatternEl = document.getElementById(`${pfx}-ch-${index}-az-pattern`);
  const elAnglesEl = document.getElementById(`${pfx}-ch-${index}-el-angles`);
  const elPatternEl = document.getElementById(`${pfx}-ch-${index}-el-pattern`);
  if (!azAnglesEl) return;

  const azAngles = parseCSV(azAnglesEl.value);
  const azPattern = parseCSV(azPatternEl.value);
  const elAngles = parseCSV(elAnglesEl.value);
  const elPattern = parseCSV(elPatternEl.value);

  const plotDiv = document.getElementById(`${pfx}-ch-${index}-pattern-plot`);
  if (!plotDiv) return;

  const traces = [];
  if (azAngles.length > 0 && azPattern.length > 0) {
    traces.push({
      x: azAngles, y: azPattern,
      type: "scatter", mode: "lines+markers", name: "Azimuth",
      line: { color: "#689f38", width: 2 },
      marker: { size: 4, color: "#8bc34a" },
      fill: "tozeroy", fillcolor: "rgba(104, 159, 56, 0.08)",
    });
  }
  if (elAngles.length > 0 && elPattern.length > 0) {
    traces.push({
      x: elAngles, y: elPattern,
      type: "scatter", mode: "lines+markers", name: "Elevation",
      line: { color: "#00D2B4", width: 2 },
      marker: { size: 4, color: "#55EFC4" },
      fill: "tozeroy", fillcolor: "rgba(0, 210, 180, 0.08)",
    });
  }
  if (traces.length === 0) return;

  const layout = {
    ...patternPlotLayout,
    showlegend: true,
    legend: { x: 1, xanchor: "right", y: 1, font: { size: 10 }, bgcolor: "transparent", borderwidth: 0 },
  };
  Plotly.react(plotDiv, traces, layout, patternPlotConfig);
}

function attachPatternListeners(pfx, index) {
  const debouncedUpdate = debounce(() => updateChannelPatternPlot(pfx, index));
  ["az-angles", "az-pattern", "el-angles", "el-pattern"].forEach((field) => {
    const elem = document.getElementById(`${pfx}-ch-${index}-${field}`);
    if (elem) {
      elem.addEventListener("input", debouncedUpdate);
    }
  });
}

// --- Boresight Arrow Helper ---
function rotatePoint(x, y, z, yawDeg, pitchDeg, rollDeg) {
  const toRad = Math.PI / 180;
  const yaw = yawDeg * toRad, pitch = pitchDeg * toRad, roll = rollDeg * toRad;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  // Rz(yaw) * Ry(pitch) * Rx(roll)
  const rx = cy * cp * x + (cy * sp * sr - sy * cr) * y + (cy * sp * cr + sy * sr) * z;
  const ry = sy * cp * x + (sy * sp * sr + cy * cr) * y + (sy * sp * cr - cy * sr) * z;
  const rz = -sp * x + cp * sr * y + cp * cr * z;
  return [rx, ry, rz];
}

function preserveCamera(container) {
  return container._fullLayout?.scene?.camera ?? {};
}

const _sceneCounts = new WeakMap();
function scenePlot(container, traces, layout, config) {
  const cam = preserveCamera(container);
  if (layout.scene) layout.scene.camera = cam;
  const count = traces.reduce((n, t) => n + (t.x ? t.x.length : 0), 0);
  const prev = _sceneCounts.get(container);
  if (prev === count && container.data) {
    Plotly.react(container, traces, layout, config);
  } else {
    _sceneCounts.set(container, count);
    Plotly.newPlot(container, traces, layout, config);
  }
}

function sceneArrowLen(xs, ys, zs, minLen = 0.1) {
  if (xs.length === 0) return minLen;
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  const spanZ = Math.max(...zs) - Math.min(...zs);
  return Math.max(Math.max(spanX, spanY, spanZ) * 0.2, minLen);
}

function boresightTraces(arrowLen, color, origin = [0, 0, 0], dir = [1, 0, 0]) {
  const [ox, oy, oz] = origin;
  const [dx, dy, dz] = dir;

  // Tip of the arrow
  const tipX = ox + dx * arrowLen;
  const tipY = oy + dy * arrowLen;
  const tipZ = oz + dz * arrowLen;

  // Build two perpendicular vectors to create arrowhead barbs
  // Choose a reference that isn't parallel to dir
  let refX = 0, refY = 1, refZ = 0;
  if (Math.abs(dy) > 0.9) { refX = 0; refY = 0; refZ = 1; }
  // Cross product: perp1 = dir × ref
  const p1x = dy * refZ - dz * refY;
  const p1y = dz * refX - dx * refZ;
  const p1z = dx * refY - dy * refX;
  const p1len = Math.sqrt(p1x * p1x + p1y * p1y + p1z * p1z) || 1;
  const n1x = p1x / p1len, n1y = p1y / p1len, n1z = p1z / p1len;
  // Cross product: perp2 = dir × perp1
  const n2x = dy * n1z - dz * n1y;
  const n2y = dz * n1x - dx * n1z;
  const n2z = dx * n1y - dy * n1x;

  const headLen = arrowLen * 0.12;
  const headW = arrowLen * 0.04;

  // 4 barb endpoints forming a cross pattern
  const barbs = [
    [n1x, n1y, n1z],
    [-n1x, -n1y, -n1z],
    [n2x, n2y, n2z],
    [-n2x, -n2y, -n2z],
  ];

  const headXs = [], headYs = [], headZs = [];
  for (const [bx, by, bz] of barbs) {
    headXs.push(tipX, tipX - dx * headLen + bx * headW, null);
    headYs.push(tipY, tipY - dy * headLen + by * headW, null);
    headZs.push(tipZ, tipZ - dz * headLen + bz * headW, null);
  }

  // Label position past the tip
  const labelX = ox + dx * arrowLen * 1.15;
  const labelY = oy + dy * arrowLen * 1.15;
  const labelZ = oz + dz * arrowLen * 1.15;

  return [
    {
      x: [ox, tipX], y: [oy, tipY], z: [oz, tipZ],
      type: "scatter3d", mode: "lines",
      line: { color, width: 4 },
      showlegend: false, hoverinfo: "none", name: "",
    },
    {
      x: headXs, y: headYs, z: headZs,
      type: "scatter3d", mode: "lines",
      line: { color, width: 4 },
      showlegend: false, hoverinfo: "none", name: "",
    },
    {
      x: [labelX], y: [labelY], z: [labelZ],
      text: ["Boresight"],
      type: "scatter3d", mode: "text",
      textfont: { size: 9, color },
      showlegend: false, hoverinfo: "none", name: "",
    },
  ];
}

// --- TX Waveform Preview Plot ---
function updateTxWaveformPlot() {
  const container = document.getElementById("tx-waveform-plot");
  if (!container) return;

  const fStart = parseNumber(document.getElementById("tx-f-start").value);
  const fEnd = parseNumber(document.getElementById("tx-f-end").value);
  const tStart = parseNumber(document.getElementById("tx-t-start").value);
  const tEnd = parseNumber(document.getElementById("tx-t-end").value);
  const prp = parseNumber(document.getElementById("tx-prp").value, 100);

  const traces = [];
  const numCycles = 2;

  for (let i = 0; i < numCycles; i++) {
    const offset = i * prp;
    if (tStart > 0) {
      traces.push({
        x: [offset, offset + tStart],
        y: [fStart, fStart],
        type: "scatter", mode: "lines",
        line: { color: "#689f38", width: 1, dash: "dot" },
        showlegend: false,
      });
    }
    traces.push({
      x: [offset + tStart, offset + tEnd],
      y: [fStart, fEnd],
      type: "scatter", mode: "lines",
      line: { color: "#689f38", width: 2.5 },
      showlegend: false,
    });
    if (prp > tEnd) {
      traces.push({
        x: [offset + tEnd, offset + prp],
        y: [fEnd, fStart],
        type: "scatter", mode: "lines",
        line: { color: "#689f38", width: 1, dash: "dot" },
        showlegend: false,
      });
    }
  }

  const layout = {
    paper_bgcolor: "#12121a",
    plot_bgcolor: "#12121a",
    font: { color: "#e8e8f0", size: 10 },
    margin: { l: 56, r: 16, t: 16, b: 40 },
    xaxis: {
      title: { text: "Time (µs)", font: { size: 10 } },
      gridcolor: "#2a2a3e",
      zerolinecolor: "#3a3a4e",
      color: "#8888a0",
    },
    yaxis: {
      title: { text: "Frequency (GHz)", font: { size: 10 } },
      gridcolor: "#2a2a3e",
      zerolinecolor: "#3a3a4e",
      color: "#8888a0",
    },
    showlegend: false,
  };

  Plotly.react(container, traces, layout, smallPlotConfig);
}

// --- TX Channel Locations Plot ---
function updateTxLocationsPlot() {
  const container = document.getElementById("tx-locations-plot");
  if (!container) return;

  const xs = [], ys = [], zs = [], labels = [];
  txChannels.forEach((_, i) => {
    const x = parseNumber(document.getElementById(`tx-ch-${i}-loc-x`)?.value);
    const y = parseNumber(document.getElementById(`tx-ch-${i}-loc-y`)?.value);
    const z = parseNumber(document.getElementById(`tx-ch-${i}-loc-z`)?.value);
    xs.push(x); ys.push(y); zs.push(z);
    labels.push(`TX ${i + 1}`);
  });

  const trace = {
    x: xs, y: ys, z: zs,
    text: labels,
    type: "scatter3d",
    mode: "markers+text",
    marker: { size: 8, color: "#689f38", symbol: "diamond", line: { width: 1, color: "#8bc34a" } },
    textposition: "top center",
    textfont: { size: 10, color: "#8bc34a" },
  };

  const arrow = boresightTraces(sceneArrowLen(xs, ys, zs), "#fd7e14");
  const mmScene = { ...smallPlotLayout.scene, xaxis: { ...smallPlotLayout.scene.xaxis, title: "X (mm)" }, yaxis: { ...smallPlotLayout.scene.yaxis, title: "Y (mm)" }, zaxis: { ...smallPlotLayout.scene.zaxis, title: "Z (mm)" } };
  scenePlot(container, [...arrow, trace], { ...smallPlotLayout, scene: mmScene }, smallPlotConfig);
}

// --- RX Channel Locations Plot ---
function updateRxLocationsPlot() {
  const container = document.getElementById("rx-locations-plot");
  if (!container) return;

  const xs = [], ys = [], zs = [], labels = [];
  rxChannels.forEach((_, i) => {
    const x = parseNumber(document.getElementById(`rx-ch-${i}-loc-x`)?.value);
    const y = parseNumber(document.getElementById(`rx-ch-${i}-loc-y`)?.value);
    const z = parseNumber(document.getElementById(`rx-ch-${i}-loc-z`)?.value);
    xs.push(x); ys.push(y); zs.push(z);
    labels.push(`RX ${i + 1}`);
  });

  const trace = {
    x: xs, y: ys, z: zs,
    text: labels,
    type: "scatter3d",
    mode: "markers+text",
    marker: { size: 8, color: "#6C5CE7", symbol: "circle", line: { width: 1, color: "#A29BFE" } },
    textposition: "top center",
    textfont: { size: 10, color: "#A29BFE" },
  };

  const arrow = boresightTraces(sceneArrowLen(xs, ys, zs), "#fd7e14");
  const mmScene = { ...smallPlotLayout.scene, xaxis: { ...smallPlotLayout.scene.xaxis, title: "X (mm)" }, yaxis: { ...smallPlotLayout.scene.yaxis, title: "Y (mm)" }, zaxis: { ...smallPlotLayout.scene.zaxis, title: "Z (mm)" } };
  scenePlot(container, [...arrow, trace], { ...smallPlotLayout, scene: mmScene }, smallPlotConfig);
}

// --- Radar Array Overview Plot ---
function updateRadarOverviewPlot() {
  const container = document.getElementById("radar-overview-plot");
  if (!container) return;

  const radarX = parseNumber(document.getElementById("radar-loc-x")?.value);
  const radarY = parseNumber(document.getElementById("radar-loc-y")?.value);
  const radarZ = parseNumber(document.getElementById("radar-loc-z")?.value);
  const yaw = parseNumber(document.getElementById("radar-rot-yaw")?.value);
  const pitch = parseNumber(document.getElementById("radar-rot-pitch")?.value);
  const roll = parseNumber(document.getElementById("radar-rot-roll")?.value);

  const traces = [];

  traces.push({
    x: [radarX], y: [radarY], z: [radarZ],
    text: ["Radar"],
    type: "scatter3d", mode: "markers",
    marker: { size: 5, color: "#e17055", symbol: "square", line: { width: 1, color: "#fab1a0" } },
    textposition: "top center",
    textfont: { size: 10, color: "#fab1a0" },
    name: "Radar Origin", showlegend: true,
  });

  const txXs = [], txYs = [], txZs = [], txLabels = [];
  txChannels.forEach((_, i) => {
    const lx = parseNumber(document.getElementById(`tx-ch-${i}-loc-x`)?.value) * 1e-3;
    const ly = parseNumber(document.getElementById(`tx-ch-${i}-loc-y`)?.value) * 1e-3;
    const lz = parseNumber(document.getElementById(`tx-ch-${i}-loc-z`)?.value) * 1e-3;
    const [rx, ry, rz] = rotatePoint(lx, ly, lz, yaw, pitch, roll);
    txXs.push(radarX + rx); txYs.push(radarY + ry); txZs.push(radarZ + rz);
    txLabels.push(`TX${i + 1}`);
  });
  if (txXs.length > 0) {
    traces.push({
      x: txXs, y: txYs, z: txZs,
      text: txLabels,
      type: "scatter3d", mode: "markers+text",
      marker: { size: 7, color: "#689f38", symbol: "diamond", line: { width: 1, color: "#8bc34a" } },
      textposition: "top center",
      textfont: { size: 9, color: "#8bc34a" },
      name: "TX", showlegend: true,
    });
  }

  const rxXs = [], rxYs = [], rxZs = [], rxLabels = [];
  rxChannels.forEach((_, i) => {
    const lx = parseNumber(document.getElementById(`rx-ch-${i}-loc-x`)?.value) * 1e-3;
    const ly = parseNumber(document.getElementById(`rx-ch-${i}-loc-y`)?.value) * 1e-3;
    const lz = parseNumber(document.getElementById(`rx-ch-${i}-loc-z`)?.value) * 1e-3;
    const [rx, ry, rz] = rotatePoint(lx, ly, lz, yaw, pitch, roll);
    rxXs.push(radarX + rx); rxYs.push(radarY + ry); rxZs.push(radarZ + rz);
    rxLabels.push(`RX${i + 1}`);
  });
  if (rxXs.length > 0) {
    traces.push({
      x: rxXs, y: rxYs, z: rxZs,
      text: rxLabels,
      type: "scatter3d", mode: "markers+text",
      marker: { size: 7, color: "#6C5CE7", symbol: "circle", line: { width: 1, color: "#A29BFE" } },
      textposition: "top center",
      textfont: { size: 9, color: "#A29BFE" },
      name: "RX", showlegend: true,
    });
  }

  const boresightDir = rotatePoint(1, 0, 0, yaw, pitch, roll);
  const arrow = boresightTraces(
    sceneArrowLen([radarX, ...txXs, ...rxXs], [radarY, ...txYs, ...rxYs], [radarZ, ...txZs, ...rxZs], 0.001),
    "#fd7e14", [radarX, radarY, radarZ], boresightDir
  );

  const layout = {
    ...smallPlotLayout,
    scene: { ...smallPlotLayout.scene },
    legend: { x: 1, xanchor: "right", y: 1, font: { size: 10 }, bgcolor: "transparent", borderwidth: 0 },
    showlegend: true,
  };

  scenePlot(container, [...arrow, ...traces], layout, smallPlotConfig);
}

// --- Targets Scene Plot ---
function updateTargetsPlot() {
  const container = document.getElementById("targets-scene-plot");
  if (!container) return;

  const radarX = parseNumber(document.getElementById("radar-loc-x")?.value);
  const radarY = parseNumber(document.getElementById("radar-loc-y")?.value);
  const radarZ = parseNumber(document.getElementById("radar-loc-z")?.value);
  const yaw = parseNumber(document.getElementById("radar-rot-yaw")?.value);
  const pitch = parseNumber(document.getElementById("radar-rot-pitch")?.value);
  const roll = parseNumber(document.getElementById("radar-rot-roll")?.value);

  const traces = [];

  traces.push({
    x: [radarX], y: [radarY], z: [radarZ],
    text: ["Radar"],
    type: "scatter3d", mode: "markers",
    marker: { size: 5, color: "#e17055", symbol: "square", line: { width: 1, color: "#fab1a0" } },
    textposition: "top center",
    textfont: { size: 10, color: "#fab1a0" },
    name: "Radar Origin", showlegend: true,
  });

  const ptXs = [], ptYs = [], ptZs = [], ptLabels = [];
  pointTargets.forEach((_, i) => {
    ptXs.push(parseNumber(document.getElementById(`pt-${i}-loc-x`)?.value ?? 50));
    ptYs.push(parseNumber(document.getElementById(`pt-${i}-loc-y`)?.value));
    ptZs.push(parseNumber(document.getElementById(`pt-${i}-loc-z`)?.value));
    ptLabels.push(`T${i + 1}`);
  });
  if (ptXs.length > 0) {
    traces.push({
      x: ptXs, y: ptYs, z: ptZs,
      text: ptLabels,
      type: "scatter3d", mode: "markers+text",
      marker: { size: 7, color: "#fdcb6e", symbol: "circle", line: { width: 1, color: "#ffeaa7" } },
      textposition: "top center",
      textfont: { size: 9, color: "#ffeaa7" },
      name: "Point Target", showlegend: true,
    });
  }

  const mxs = [], mys = [], mzs = [], mLabels = [];
  meshTargets.forEach((_, i) => {
    mxs.push(parseNumber(document.getElementById(`mesh-${i}-loc-x`)?.value));
    mys.push(parseNumber(document.getElementById(`mesh-${i}-loc-y`)?.value));
    mzs.push(parseNumber(document.getElementById(`mesh-${i}-loc-z`)?.value));
    mLabels.push(`M${i + 1}`);
  });
  if (mxs.length > 0) {
    traces.push({
      x: mxs, y: mys, z: mzs,
      text: mLabels,
      type: "scatter3d", mode: "markers+text",
      marker: { size: 7, color: "#a29bfe", symbol: "diamond", line: { width: 1, color: "#dfe6e9" } },
      textposition: "top center",
      textfont: { size: 9, color: "#dfe6e9" },
      name: "Mesh Target", showlegend: true,
    });
  }

  const boresightDir = rotatePoint(1, 0, 0, yaw, pitch, roll);
  const arrow = boresightTraces(
    sceneArrowLen([radarX], [radarY], [radarZ], 1),
    "#fd7e14", [radarX, radarY, radarZ], boresightDir
  );

  const layout = {
    ...smallPlotLayout,
    scene: { ...smallPlotLayout.scene },
    legend: { x: 1, xanchor: "right", y: 1, font: { size: 10 }, bgcolor: "transparent", borderwidth: 0 },
    showlegend: true,
  };

  scenePlot(container, [...arrow, ...traces], layout, smallPlotConfig);
}

// --- Plot Simulation Results ---
function plotResults(data) {
  document.getElementById("results-outdated-banner")?.classList.add("hidden");
  if (data.range_doppler) {
    _lastRangeDopplerData = data.range_doppler;
    _lastRdRangeAxis = data.rd_range_axis || null;
    _lastRdVelocityAxis = data.rd_doppler_axis || null;
    _plotRangeDoppler();
  }

  if (data.range_profile) {
    _lastRangeProfileData = data.range_profile;
    _lastRangeAxis = data.rp_range_axis || null;
    _plotRangeProfile();
  }

  if (data.baseband) {
    _lastBasebandData = data.baseband;
    _lastBbType = data.bb_type || "complex";
    const numPulses = data.baseband.length;
    const numCh = Array.isArray(data.baseband[0]) ? data.baseband[0].length : 1;
    const pulseInput = document.getElementById("bb-pulse-idx");
    const chInput = document.getElementById("bb-ch-idx");
    pulseInput.max = numPulses - 1;
    chInput.max = numCh - 1;
    pulseInput.value = Math.min(parseInt(pulseInput.value) || 0, numPulses - 1);
    chInput.value = Math.min(parseInt(chInput.value) || 0, numCh - 1);
    _plotBaseband();
  }
}

let _lastBasebandData = null;
let _lastBbType = "complex";
let _lastRangeProfileData = null;
let _lastRangeAxis = null;
let _lastRangeDopplerData = null;
let _lastRdRangeAxis = null;
let _lastRdVelocityAxis = null;

function _plotRangeDoppler() {
  const container = document.getElementById("plot-range-doppler");
  if (!_lastRangeDopplerData || !container) return;
  const chIdx = Math.max(0, parseInt(document.getElementById("bb-ch-idx").value) || 0);

  // data is [pulse][channel][sample] — extract the 2D [pulse][sample] slice for selected channel
  const rd = [];
  for (let p = 0; p < _lastRangeDopplerData.length; p++) {
    const pulseData = _lastRangeDopplerData[p];
    if (Array.isArray(pulseData?.[0])) {
      rd.push(pulseData[Math.min(chIdx, pulseData.length - 1)]);
    } else {
      rd.push(pulseData);
    }
  }

  container.classList.add("has-data");
  const trace = {
    z: rd,
    type: "surface",
    colorscale: "Viridis",
    colorbar: { title: "dB" },
    showscale: true,
  };
  if (_lastRdRangeAxis) trace.x = _lastRdRangeAxis;
  if (_lastRdVelocityAxis) trace.y = _lastRdVelocityAxis;

  const layout = {
    paper_bgcolor: "#12121a",
    font: { color: "#e8e8f0", size: 12 },
    margin: { l: 0, r: 0, t: 10, b: 0 },
    scene: {
      xaxis: { title: "Range Bin", gridcolor: "#2a2a3e", backgroundcolor: "#12121a", color: "#8888a0" },
      yaxis: { title: "Doppler Bin", gridcolor: "#2a2a3e", backgroundcolor: "#12121a", color: "#8888a0" },
      zaxis: { title: "dB", gridcolor: "#2a2a3e", backgroundcolor: "#12121a", color: "#8888a0" },
      bgcolor: "#12121a",
    },
  };
  Plotly.newPlot(container, [trace], layout, plotlyConfig);
}

function _plotRangeProfile() {
  const container = document.getElementById("plot-range-profile");
  if (!_lastRangeProfileData || !container) return;
  const pulseIdx = Math.max(0, parseInt(document.getElementById("bb-pulse-idx").value) || 0);
  const chIdx = Math.max(0, parseInt(document.getElementById("bb-ch-idx").value) || 0);

  // data is [pulse][channel][sample]
  const pulseData = _lastRangeProfileData[Math.min(pulseIdx, _lastRangeProfileData.length - 1)];
  const rp = Array.isArray(pulseData?.[0])
    ? pulseData[Math.min(chIdx, pulseData.length - 1)]
    : Array.isArray(pulseData) ? pulseData : _lastRangeProfileData;

  container.classList.add("has-data");
  const trace = {
    y: rp,
    type: "scatter", mode: "lines",
    line: { color: "#689f38", width: 1.5 },
  };
  if (_lastRangeAxis) trace.x = _lastRangeAxis;
  const layout = {
    ...plotlyLayout,
    xaxis: { ...plotlyLayout.xaxis, title: "Range Bin" },
    yaxis: { ...plotlyLayout.yaxis, title: "Magnitude (dB)" },
  };
  Plotly.newPlot(container, [trace], layout, plotlyConfig);
}

function _plotBaseband() {
  const container = document.getElementById("plot-baseband");
  if (!_lastBasebandData || !container) return;
  const pulseIdx = Math.max(0, parseInt(document.getElementById("bb-pulse-idx").value) || 0);
  const chIdx = Math.max(0, parseInt(document.getElementById("bb-ch-idx").value) || 0);

  // data is [pulse][channel]{re, im}
  const pulseData = _lastBasebandData[Math.min(pulseIdx, _lastBasebandData.length - 1)];
  const chData = Array.isArray(pulseData)
    ? pulseData[Math.min(chIdx, pulseData.length - 1)]
    : pulseData;

  container.classList.add("has-data");
  const traces = [
    {
      y: chData.re,
      type: "scatter", mode: "lines", name: "Real",
      line: { color: "#8bc34a", width: 1 },
    },
  ];
  if (_lastBbType !== "real") {
    traces.push({
      y: chData.im,
      type: "scatter", mode: "lines", name: "Imag",
      line: { color: "#e17055", width: 1 },
    });
  }
  const layout = {
    ...plotlyLayout,
    showlegend: true,
    xaxis: { ...plotlyLayout.xaxis, title: "Sample" },
    yaxis: { ...plotlyLayout.yaxis, title: "Amplitude" },
  };
  Plotly.newPlot(container, traces, layout, plotlyConfig);
}

function markResultsOutdated() {
  if (!_lastBasebandData && !_lastRangeProfileData && !_lastRangeDopplerData) return;
  document.getElementById("results-outdated-banner")?.classList.remove("hidden");
}

function clearResultPlots() {
  _lastBasebandData = null;
  _lastRangeProfileData = null;
  _lastRangeAxis = null;
  _lastRangeDopplerData = null;
  _lastRdRangeAxis = null;
  _lastRdVelocityAxis = null;

  document.getElementById("results-outdated-banner")?.classList.add("hidden");

  const statusEl = document.getElementById("sim-status");
  if (statusEl) { statusEl.textContent = ""; statusEl.className = "status-msg"; }

  const exportBtn = document.getElementById("btn-export");
  if (exportBtn) exportBtn.disabled = true;

  ["plot-baseband", "plot-range-profile", "plot-range-doppler"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.remove("has-data");
      Plotly.purge(el);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("bb-pulse-idx")?.addEventListener("change", () => {
    _plotBaseband();
    _plotRangeProfile();
  });
  document.getElementById("bb-ch-idx")?.addEventListener("change", () => {
    _plotBaseband();
    _plotRangeProfile();
    _plotRangeDoppler();
  });

  // Mark results outdated on any configuration input change (delegated for dynamic elements)
  const debouncedMarkOutdated = debounce(markResultsOutdated, 200);
  const configPanels = ["panel-transmitter", "panel-receiver", "panel-radar", "panel-targets"];
  const handler = (e) => {
    if (e.target.matches("input, select")) debouncedMarkOutdated();
  };
  configPanels.forEach((panelId) => {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    panel.addEventListener("input", handler);
    panel.addEventListener("change", handler);
  });
  // For panel-simulation, only listen on the config section (panel-split-left)
  // to avoid false triggers from Plotly plots in the results area during resize.
  const simConfigArea = document.querySelector("#panel-simulation .panel-split-left");
  if (simConfigArea) {
    simConfigArea.addEventListener("input", handler);
    simConfigArea.addEventListener("change", handler);
  }
});
