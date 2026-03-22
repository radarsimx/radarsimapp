// ===== RadarSimApp - Plot Functions =====

// --- Plotly Theme ---
const plotlyLayout = {
  paper_bgcolor: "#12121a",
  plot_bgcolor: "#12121a",
  font: { color: "#e8e8f0", size: 12 },
  margin: { l: 60, r: 20, t: 40, b: 50 },
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
  displayModeBar: true,
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

const smallPlotConfig = { responsive: true, displayModeBar: false };

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
  Plotly.newPlot(plotDiv, traces, layout, patternPlotConfig);
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

function boresightTraces(allCoords, color, origin = [0, 0, 0], dir = [1, 0, 0]) {
  const arrowLen = Math.max(...allCoords.map(Math.abs), 0.05) * 1.5;
  const [ox, oy, oz] = origin;
  const [dx, dy, dz] = dir;
  const shaft = [ox, ox + dx * arrowLen * 0.85];
  const shaftY = [oy, oy + dy * arrowLen * 0.85];
  const shaftZ = [oz, oz + dz * arrowLen * 0.85];
  const labelX = ox + dx * arrowLen * 1.12;
  const labelY = oy + dy * arrowLen * 1.12;
  const labelZ = oz + dz * arrowLen * 1.12;
  return [
    {
      x: shaft, y: shaftY, z: shaftZ,
      type: "scatter3d", mode: "lines",
      line: { color, width: 3 },
      showlegend: false, hoverinfo: "none", name: "",
    },
    {
      x: [ox + dx * arrowLen * 0.85], y: [oy + dy * arrowLen * 0.85], z: [oz + dz * arrowLen * 0.85],
      u: [dx * arrowLen * 0.15], v: [dy * arrowLen * 0.15], w: [dz * arrowLen * 0.15],
      type: "cone",
      colorscale: [[0, color], [1, color]],
      showscale: false, showlegend: false,
      hoverinfo: "none", anchor: "tail",
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

  Plotly.newPlot(container, traces, layout, smallPlotConfig);
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

  const arrow = boresightTraces(xs.concat(ys).concat(zs), "#fd7e14");
  Plotly.newPlot(container, [...arrow, trace], { ...smallPlotLayout }, smallPlotConfig);
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

  const arrow = boresightTraces(xs.concat(ys).concat(zs), "#fd7e14");
  Plotly.newPlot(container, [...arrow, trace], { ...smallPlotLayout }, smallPlotConfig);
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
    type: "scatter3d", mode: "markers+text",
    marker: { size: 10, color: "#e17055", symbol: "square", line: { width: 1, color: "#fab1a0" } },
    textposition: "top center",
    textfont: { size: 10, color: "#fab1a0" },
    name: "Radar", showlegend: true,
  });

  const txXs = [], txYs = [], txZs = [], txLabels = [];
  txChannels.forEach((_, i) => {
    const lx = parseNumber(document.getElementById(`tx-ch-${i}-loc-x`)?.value);
    const ly = parseNumber(document.getElementById(`tx-ch-${i}-loc-y`)?.value);
    const lz = parseNumber(document.getElementById(`tx-ch-${i}-loc-z`)?.value);
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
    const lx = parseNumber(document.getElementById(`rx-ch-${i}-loc-x`)?.value);
    const ly = parseNumber(document.getElementById(`rx-ch-${i}-loc-y`)?.value);
    const lz = parseNumber(document.getElementById(`rx-ch-${i}-loc-z`)?.value);
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
  const allCoords = [radarX, radarY, radarZ, ...txXs, ...txYs, ...txZs, ...rxXs, ...rxYs, ...rxZs];
  const arrow = boresightTraces(allCoords, "#fd7e14", [radarX, radarY, radarZ], boresightDir);

  const layout = {
    ...smallPlotLayout,
    legend: { x: 1, xanchor: "right", y: 1, font: { size: 10 }, bgcolor: "transparent", borderwidth: 0 },
    showlegend: true,
  };

  Plotly.newPlot(container, [...arrow, ...traces], layout, smallPlotConfig);
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
    type: "scatter3d", mode: "markers+text",
    marker: { size: 10, color: "#e17055", symbol: "square", line: { width: 1, color: "#fab1a0" } },
    textposition: "top center",
    textfont: { size: 10, color: "#fab1a0" },
    name: "Radar", showlegend: true,
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
  const arrow = boresightTraces([radarX, radarY, radarZ], "#fd7e14", [radarX, radarY, radarZ], boresightDir);

  const layout = {
    ...smallPlotLayout,
    legend: { x: 1, xanchor: "right", y: 1, font: { size: 10 }, bgcolor: "transparent", borderwidth: 0 },
    showlegend: true,
  };

  Plotly.newPlot(container, [...arrow, ...traces], layout, smallPlotConfig);
}

// --- Plot Simulation Results ---
function plotResults(data) {
  if (data.range_doppler) {
    const container = document.getElementById("plot-range-doppler");
    container.classList.add("has-data");
    const rdData = data.range_doppler;
    const rd = Array.isArray(rdData[0]?.[0]) ? rdData[0] : rdData;
    const trace = {
      z: rd,
      type: "heatmap",
      colorscale: "Viridis",
      colorbar: { title: "dB" },
    };
    const layout = {
      ...plotlyLayout,
      title: "Range-Doppler Map",
      xaxis: { ...plotlyLayout.xaxis, title: "Range Bin" },
      yaxis: { ...plotlyLayout.yaxis, title: "Doppler Bin" },
    };
    if (data.range_axis) {
      trace.x = data.range_axis;
      layout.xaxis.title = "Range (m)";
    }
    if (data.velocity_axis) {
      trace.y = data.velocity_axis;
      layout.yaxis.title = "Velocity (m/s)";
    }
    Plotly.newPlot(container, [trace], layout, plotlyConfig);
  }

  if (data.range_profile) {
    const container = document.getElementById("plot-range-profile");
    container.classList.add("has-data");
    const rpData = data.range_profile;
    let rp;
    if (Array.isArray(rpData[0]?.[0])) {
      rp = rpData[0][0];
    } else if (Array.isArray(rpData[0])) {
      rp = rpData[0];
    } else {
      rp = rpData;
    }
    const trace = {
      y: rp,
      type: "scatter",
      mode: "lines",
      line: { color: "#689f38", width: 1.5 },
    };
    if (data.range_axis) {
      trace.x = data.range_axis;
    }
    const layout = {
      ...plotlyLayout,
      title: "Range Profile",
      xaxis: { ...plotlyLayout.xaxis, title: data.range_axis ? "Range (m)" : "Range Bin" },
      yaxis: { ...plotlyLayout.yaxis, title: "Magnitude (dB)" },
    };
    Plotly.newPlot(container, [trace], layout, plotlyConfig);
  }

  if (data.baseband) {
    const container = document.getElementById("plot-baseband");
    container.classList.add("has-data");
    const bbData = data.baseband;
    let bb;
    if (Array.isArray(bbData[0]?.[0])) {
      bb = bbData[0][0];
    } else if (Array.isArray(bbData[0])) {
      bb = bbData[0];
    } else {
      bb = bbData;
    }
    const trace = {
      y: bb,
      type: "scatter",
      mode: "lines",
      line: { color: "#8bc34a", width: 1 },
    };
    const layout = {
      ...plotlyLayout,
      title: "Baseband Signal (First Channel, First Pulse)",
      xaxis: { ...plotlyLayout.xaxis, title: "Sample" },
      yaxis: { ...plotlyLayout.yaxis, title: "Magnitude (dB)" },
    };
    Plotly.newPlot(container, [trace], layout, plotlyConfig);
  }
}
