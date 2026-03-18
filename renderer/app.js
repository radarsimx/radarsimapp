// ===== RadarSimApp - Main Renderer Script =====

// --- State ---
let txChannels = [];
let rxChannels = [];
let pointTargets = [];
let meshTargets = [];
let lastSimResult = null;

// --- Navigation ---
document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    item.classList.add("active");
    const panelId = "panel-" + item.dataset.panel;
    document.getElementById(panelId).classList.add("active");
  });
});

// --- Helpers ---
function parseNumber(val, fallback = 0) {
  const n = parseFloat(val);
  return isNaN(n) ? fallback : n;
}

function parseCSV(str) {
  return str
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number)
    .filter((n) => !isNaN(n));
}

function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "className") e.className = v;
    else if (k === "textContent") e.textContent = v;
    else if (k === "innerHTML") e.innerHTML = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2).toLowerCase(), v);
    else e.setAttribute(k, v);
  }
  children.forEach((c) => {
    if (typeof c === "string") e.appendChild(document.createTextNode(c));
    else if (c) e.appendChild(c);
  });
  return e;
}

// --- TX Bandwidth / Sweep Info ---
function updateTxInfo() {
  const fStart = parseNumber(document.getElementById("tx-f-start").value) * 1e9;
  const fEnd = parseNumber(document.getElementById("tx-f-end").value) * 1e9;
  const tStart = parseNumber(document.getElementById("tx-t-start").value) * 1e-6;
  const tEnd = parseNumber(document.getElementById("tx-t-end").value) * 1e-6;
  const bw = Math.abs(fEnd - fStart);
  const sw = Math.abs(tEnd - tStart);
  document.getElementById("tx-bandwidth").textContent =
    bw >= 1e9 ? (bw / 1e9).toFixed(2) + " GHz" : (bw / 1e6).toFixed(1) + " MHz";
  document.getElementById("tx-sweep-time").textContent =
    sw >= 1e-3 ? (sw * 1e3).toFixed(2) + " ms" : (sw * 1e6).toFixed(1) + " µs";
}
["tx-f-start", "tx-f-end", "tx-t-start", "tx-t-end"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateTxInfo)
);

// --- Phase Noise Toggle ---
document.getElementById("tx-pn-enable").addEventListener("change", (e) => {
  document.getElementById("tx-pn-fields").classList.toggle("hidden", !e.target.checked);
});

// --- TX Channels ---
function renderTxChannels() {
  const container = document.getElementById("tx-channels-list");
  container.innerHTML = "";
  txChannels.forEach((ch, i) => {
    container.appendChild(createChannelCard("TX", i, ch, true));
  });

  // After DOM is ready, render pattern plots and location plot
  requestAnimationFrame(() => {
    txChannels.forEach((_, i) => {
      updateChannelPatternPlot("tx", i);
      attachPatternListeners("tx", i);
    });
    updateTxLocationsPlot();
    attachLocationListeners();
  });
}

function createChannelCard(prefix, index, data, isTx) {
  const pfx = prefix.toLowerCase();

  // Build the fields column
  const fields = el("div", { className: "channel-card-fields" }, [
    // Location
    el("div", { className: "form-group" }, [
      el("label", { textContent: "LOCATION (X, Y, Z) [M]" }),
      el("div", { className: "form-row triple" }, [
        createInput(`${pfx}-ch-${index}-loc-x`, data.location?.[0] ?? 0, 0.001),
        createInput(`${pfx}-ch-${index}-loc-y`, data.location?.[1] ?? 0, 0.001),
        createInput(`${pfx}-ch-${index}-loc-z`, data.location?.[2] ?? 0, 0.001),
      ]),
    ]),

    // Polarization
    el("div", { className: "form-group" }, [
      el("label", { textContent: "POLARIZATION (X, Y, Z)" }),
      el("div", { className: "form-row triple" }, [
        createInput(`${pfx}-ch-${index}-pol-x`, data.polarization?.[0] ?? 0, 0.1),
        createInput(`${pfx}-ch-${index}-pol-y`, data.polarization?.[1] ?? 0, 0.1),
        createInput(`${pfx}-ch-${index}-pol-z`, data.polarization?.[2] ?? 1, 0.1),
      ]),
    ]),

    // Antenna Pattern (azimuth)
    el("div", { className: "form-group" }, [
      el("label", { textContent: "AZIMUTH ANGLES (°, COMMA-SEPARATED)" }),
      createTextInput(
        `${pfx}-ch-${index}-az-angles`,
        data.azimuth_angle?.join(", ") ?? "-90, 90"
      ),
    ]),
    el("div", { className: "form-group" }, [
      el("label", { textContent: "AZIMUTH PATTERN (DB, COMMA-SEPARATED)" }),
      createTextInput(
        `${pfx}-ch-${index}-az-pattern`,
        data.azimuth_pattern?.join(", ") ?? "0, 0"
      ),
    ]),

    // Antenna Pattern (elevation)
    el("div", { className: "form-group" }, [
      el("label", { textContent: "ELEVATION ANGLES (°, COMMA-SEPARATED)" }),
      createTextInput(
        `${pfx}-ch-${index}-el-angles`,
        data.elevation_angle?.join(", ") ?? "-90, 90"
      ),
    ]),
    el("div", { className: "form-group" }, [
      el("label", { textContent: "ELEVATION PATTERN (DB, COMMA-SEPARATED)" }),
      createTextInput(
        `${pfx}-ch-${index}-el-pattern`,
        data.elevation_pattern?.join(", ") ?? "0, 0"
      ),
    ]),
  ]);

  if (isTx) {
    fields.appendChild(
      el("div", { className: "form-row" }, [
        el("div", { className: "form-group" }, [
          el("label", { textContent: "DELAY (NS)" }),
          createInput(`tx-ch-${index}-delay`, (data.delay ?? 0) * 1e9, 1),
        ]),
        el("div", { className: "form-group" }, [
          el("label", { textContent: "RAY GRID (°)" }),
          createInput(`tx-ch-${index}-grid`, data.grid ?? 1, 0.1),
        ]),
      ])
    );
  }

  // Build the pattern plots column
  const azPlotDiv = el("div", { className: "pattern-plot", id: `${pfx}-ch-${index}-az-plot` });
  const elPlotDiv = el("div", { className: "pattern-plot", id: `${pfx}-ch-${index}-el-plot` });

  const plots = el("div", { className: "channel-card-plots" }, [
    el("div", {}, [
      el("div", { className: "pattern-plot-label", textContent: "Azimuth Pattern" }),
      azPlotDiv,
    ]),
    el("div", {}, [
      el("div", { className: "pattern-plot-label", textContent: "Elevation Pattern" }),
      elPlotDiv,
    ]),
  ]);

  const card = el("div", { className: "channel-card" }, [
    el("div", { className: "channel-card-header" }, [
      el("span", { textContent: `${prefix} Channel ${index + 1}` }),
      el("button", { className: "btn-icon btn-danger", title: "Remove", onClick: () => removeChannel(prefix, index) }, [
        createSVG("trash"),
      ]),
    ]),
    el("div", { className: "channel-card-body" }, [
      fields,
      plots,
    ]),
  ]);

  return card;
}

function createInput(id, value, step) {
  const inp = el("input", { type: "number", id, value: String(value), step: String(step) });
  return inp;
}

function createTextInput(id, value) {
  return el("input", { type: "text", id, value });
}

function createSVG(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  if (name === "trash") {
    const p1 = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    p1.setAttribute("points", "3 6 5 6 21 6");
    const p2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p2.setAttribute("d", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2");
    svg.appendChild(p1);
    svg.appendChild(p2);
  }
  return svg;
}

function removeChannel(prefix, index) {
  if (prefix === "TX") {
    txChannels.splice(index, 1);
    renderTxChannels();
  } else {
    rxChannels.splice(index, 1);
    renderRxChannels();
  }
}

document.getElementById("btn-add-tx-ch").addEventListener("click", () => {
  txChannels.push({});
  renderTxChannels();
});

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

  // Azimuth plot
  const azPlot = document.getElementById(`${pfx}-ch-${index}-az-plot`);
  if (azPlot && azAngles.length > 0 && azPattern.length > 0) {
    Plotly.newPlot(azPlot, [{
      x: azAngles,
      y: azPattern,
      type: "scatter",
      mode: "lines+markers",
      line: { color: "#6C5CE7", width: 2 },
      marker: { size: 4, color: "#A29BFE" },
      fill: "tozeroy",
      fillcolor: "rgba(108, 92, 231, 0.08)",
    }], { ...patternPlotLayout }, patternPlotConfig);
  }

  // Elevation plot
  const elPlot = document.getElementById(`${pfx}-ch-${index}-el-plot`);
  if (elPlot && elAngles.length > 0 && elPattern.length > 0) {
    Plotly.newPlot(elPlot, [{
      x: elAngles,
      y: elPattern,
      type: "scatter",
      mode: "lines+markers",
      line: { color: "#00D2B4", width: 2 },
      marker: { size: 4, color: "#55EFC4" },
      fill: "tozeroy",
      fillcolor: "rgba(0, 210, 180, 0.08)",
    }], { ...patternPlotLayout }, patternPlotConfig);
  }
}

function attachPatternListeners(pfx, index) {
  ["az-angles", "az-pattern", "el-angles", "el-pattern"].forEach((field) => {
    const elem = document.getElementById(`${pfx}-ch-${index}-${field}`);
    if (elem) {
      elem.addEventListener("input", () => updateChannelPatternPlot(pfx, index));
    }
  });
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
    marker: { size: 8, color: "#6C5CE7", symbol: "diamond", line: { width: 1, color: "#A29BFE" } },
    textposition: "top center",
    textfont: { size: 10, color: "#A29BFE" },
  };

  const layout = {
    paper_bgcolor: "#12121a",
    plot_bgcolor: "#12121a",
    font: { color: "#e8e8f0", size: 10 },
    margin: { l: 0, r: 0, t: 20, b: 0 },
    scene: {
      xaxis: { title: "X (m)", gridcolor: "#2a2a3e", backgroundcolor: "#12121a", color: "#8888a0" },
      yaxis: { title: "Y (m)", gridcolor: "#2a2a3e", backgroundcolor: "#12121a", color: "#8888a0" },
      zaxis: { title: "Z (m)", gridcolor: "#2a2a3e", backgroundcolor: "#12121a", color: "#8888a0" },
      bgcolor: "#12121a",
    },
    showlegend: false,
  };

  Plotly.newPlot(container, [trace], layout, { responsive: true, displayModeBar: false });
}

function attachLocationListeners() {
  txChannels.forEach((_, i) => {
    ["loc-x", "loc-y", "loc-z"].forEach((field) => {
      const elem = document.getElementById(`tx-ch-${i}-${field}`);
      if (elem) {
        elem.addEventListener("input", () => updateTxLocationsPlot());
      }
    });
  });
}

// --- RX Channels ---
function renderRxChannels() {
  const container = document.getElementById("rx-channels-list");
  container.innerHTML = "";
  rxChannels.forEach((ch, i) => {
    container.appendChild(createChannelCard("RX", i, ch, false));
  });
}

document.getElementById("btn-add-rx-ch").addEventListener("click", () => {
  rxChannels.push({});
  renderRxChannels();
});

// --- Point Targets ---
function renderPointTargets() {
  const container = document.getElementById("point-targets-list");
  container.innerHTML = "";
  pointTargets.forEach((t, i) => {
    const card = el("div", { className: "target-card" }, [
      el("div", { className: "target-card-header" }, [
        el("span", { textContent: `Target ${i + 1}` }),
        el("button", {
          className: "btn-icon btn-danger",
          title: "Remove",
          onClick: () => {
            pointTargets.splice(i, 1);
            renderPointTargets();
          },
        }, [createSVG("trash")]),
      ]),
      el("div", { className: "form-group" }, [
        el("label", { textContent: "LOCATION (X, Y, Z) [M]" }),
        el("div", { className: "form-row triple" }, [
          createInput(`pt-${i}-loc-x`, t.location?.[0] ?? 50, 1),
          createInput(`pt-${i}-loc-y`, t.location?.[1] ?? 0, 1),
          createInput(`pt-${i}-loc-z`, t.location?.[2] ?? 0, 1),
        ]),
      ]),
      el("div", { className: "form-row" }, [
        el("div", { className: "form-group" }, [
          el("label", { textContent: "RCS (DBSM)" }),
          createInput(`pt-${i}-rcs`, t.rcs ?? 20, 1),
        ]),
        el("div", { className: "form-group" }, [
          el("label", { textContent: "PHASE (°)" }),
          createInput(`pt-${i}-phase`, t.phase ?? 0, 1),
        ]),
      ]),
      el("div", { className: "form-group" }, [
        el("label", { textContent: "SPEED (VX, VY, VZ) [M/S]" }),
        el("div", { className: "form-row triple" }, [
          createInput(`pt-${i}-spd-x`, t.speed?.[0] ?? 0, 1),
          createInput(`pt-${i}-spd-y`, t.speed?.[1] ?? 0, 1),
          createInput(`pt-${i}-spd-z`, t.speed?.[2] ?? 0, 1),
        ]),
      ]),
    ]);
    container.appendChild(card);
  });
}

document.getElementById("btn-add-point-target").addEventListener("click", () => {
  pointTargets.push({ location: [50, 0, 0], rcs: 20, speed: [0, 0, 0], phase: 0 });
  renderPointTargets();
});

// --- Mesh Targets ---
function renderMeshTargets() {
  const container = document.getElementById("mesh-targets-list");
  container.innerHTML = "";
  meshTargets.forEach((t, i) => {
    const card = el("div", { className: "target-card" }, [
      el("div", { className: "target-card-header" }, [
        el("span", { textContent: `Mesh ${i + 1}` }),
        el("button", {
          className: "btn-icon btn-danger",
          title: "Remove",
          onClick: () => {
            meshTargets.splice(i, 1);
            renderMeshTargets();
          },
        }, [createSVG("trash")]),
      ]),

      // Model path
      el("div", { className: "form-group" }, [
        el("label", { textContent: "3D MODEL FILE" }),
        el("div", { style: "display:flex;gap:8px" }, [
          (() => {
            const inp = el("input", {
              type: "text",
              id: `mesh-${i}-model`,
              value: t.model ?? "",
              placeholder: "Path to .stl / .obj / .ply",
              style: "flex:1",
            });
            return inp;
          })(),
          el("button", {
            className: "btn-secondary",
            textContent: "Browse",
            onClick: async () => {
              const f = await window.api.selectFile({
                filters: [{ name: "3D Models", extensions: ["stl", "obj", "ply"] }],
              });
              if (f) {
                document.getElementById(`mesh-${i}-model`).value = f;
                meshTargets[i].model = f;
              }
            },
          }),
        ]),
      ]),

      // Location
      el("div", { className: "form-group" }, [
        el("label", { textContent: "LOCATION (X, Y, Z) [M]" }),
        el("div", { className: "form-row triple" }, [
          createInput(`mesh-${i}-loc-x`, t.location?.[0] ?? 0, 1),
          createInput(`mesh-${i}-loc-y`, t.location?.[1] ?? 0, 1),
          createInput(`mesh-${i}-loc-z`, t.location?.[2] ?? 0, 1),
        ]),
      ]),

      // Speed
      el("div", { className: "form-group" }, [
        el("label", { textContent: "SPEED (VX, VY, VZ) [M/S]" }),
        el("div", { className: "form-row triple" }, [
          createInput(`mesh-${i}-spd-x`, t.speed?.[0] ?? 0, 1),
          createInput(`mesh-${i}-spd-y`, t.speed?.[1] ?? 0, 1),
          createInput(`mesh-${i}-spd-z`, t.speed?.[2] ?? 0, 1),
        ]),
      ]),

      // Rotation
      el("div", { className: "form-group" }, [
        el("label", { textContent: "ROTATION (YAW, PITCH, ROLL) [°]" }),
        el("div", { className: "form-row triple" }, [
          createInput(`mesh-${i}-rot-yaw`, t.rotation?.[0] ?? 0, 1),
          createInput(`mesh-${i}-rot-pitch`, t.rotation?.[1] ?? 0, 1),
          createInput(`mesh-${i}-rot-roll`, t.rotation?.[2] ?? 0, 1),
        ]),
      ]),

      // Rotation Rate
      el("div", { className: "form-group" }, [
        el("label", { textContent: "ROTATION RATE (°/S)" }),
        el("div", { className: "form-row triple" }, [
          createInput(`mesh-${i}-rr-yaw`, t.rotation_rate?.[0] ?? 0, 1),
          createInput(`mesh-${i}-rr-pitch`, t.rotation_rate?.[1] ?? 0, 1),
          createInput(`mesh-${i}-rr-roll`, t.rotation_rate?.[2] ?? 0, 1),
        ]),
      ]),

      // Unit
      el("div", { className: "form-row" }, [
        el("div", { className: "form-group" }, [
          el("label", { textContent: "MODEL UNIT" }),
          (() => {
            const sel = el("select", { id: `mesh-${i}-unit` });
            ["m", "cm", "mm"].forEach((u) => {
              const opt = el("option", { value: u, textContent: u });
              if (u === (t.unit ?? "m")) opt.selected = true;
              sel.appendChild(opt);
            });
            return sel;
          })(),
        ]),
        el("div", { className: "form-group" }, [
          el("label", { innerHTML: "PERMITTIVITY (ε<sub>r</sub>)" }),
          createInput(`mesh-${i}-perm`, t.permittivity ?? "", 0.1),
        ]),
      ]),
    ]);
    container.appendChild(card);
  });
}

document.getElementById("btn-add-mesh-target").addEventListener("click", () => {
  meshTargets.push({});
  renderMeshTargets();
});

// --- Collect Config from UI ---
function collectConfig() {
  // TX
  const fStart = parseNumber(document.getElementById("tx-f-start").value) * 1e9;
  const fEnd = parseNumber(document.getElementById("tx-f-end").value) * 1e9;
  const tStart = parseNumber(document.getElementById("tx-t-start").value) * 1e-6;
  const tEnd = parseNumber(document.getElementById("tx-t-end").value) * 1e-6;
  const waveformType = document.getElementById("tx-waveform-type").value;

  let f, t;
  if (waveformType === "single-tone") {
    f = fStart;
    t = tEnd - tStart;
  } else {
    f = [fStart, fEnd];
    t = [tStart, tEnd];
  }

  const txConfig = {
    f,
    t,
    tx_power: parseNumber(document.getElementById("tx-power").value),
    pulses: parseInt(document.getElementById("tx-pulses").value) || 1,
    prp: parseNumber(document.getElementById("tx-prp").value) * 1e-6,
  };

  if (document.getElementById("tx-pn-enable").checked) {
    const pnF = parseCSV(document.getElementById("tx-pn-f").value);
    const pnP = parseCSV(document.getElementById("tx-pn-power").value);
    if (pnF.length > 0 && pnP.length > 0) {
      txConfig.pn_f = pnF;
      txConfig.pn_power = pnP;
    }
  }

  // TX Channels
  txConfig.channels = txChannels.map((_, i) => {
    const ch = {};
    ch.location = [
      parseNumber(document.getElementById(`tx-ch-${i}-loc-x`)?.value),
      parseNumber(document.getElementById(`tx-ch-${i}-loc-y`)?.value),
      parseNumber(document.getElementById(`tx-ch-${i}-loc-z`)?.value),
    ];
    ch.polarization = [
      parseNumber(document.getElementById(`tx-ch-${i}-pol-x`)?.value),
      parseNumber(document.getElementById(`tx-ch-${i}-pol-y`)?.value),
      parseNumber(document.getElementById(`tx-ch-${i}-pol-z`)?.value, 1),
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
    ch.grid = parseNumber(document.getElementById(`tx-ch-${i}-grid`)?.value, 1);
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
      parseNumber(document.getElementById(`rx-ch-${i}-loc-x`)?.value),
      parseNumber(document.getElementById(`rx-ch-${i}-loc-y`)?.value),
      parseNumber(document.getElementById(`rx-ch-${i}-loc-z`)?.value),
    ];
    ch.polarization = [
      parseNumber(document.getElementById(`rx-ch-${i}-pol-x`)?.value),
      parseNumber(document.getElementById(`rx-ch-${i}-pol-y`)?.value),
      parseNumber(document.getElementById(`rx-ch-${i}-pol-z`)?.value, 1),
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
    device: document.getElementById("sim-device").value || "cpu",
  };

  // Processing
  const processing = {
    range_doppler: document.getElementById("proc-range-doppler").checked,
    range_profile: document.getElementById("proc-range-profile").checked,
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

// --- Run Simulation ---
document.getElementById("btn-run-sim").addEventListener("click", async () => {
  const btn = document.getElementById("btn-run-sim");
  const status = document.getElementById("sim-status");
  const progress = document.getElementById("sim-progress");

  btn.disabled = true;
  status.className = "status-msg running";
  status.textContent = "Running simulation...";
  progress.classList.remove("hidden");

  try {
    const config = collectConfig();

    if (config.targets.length === 0) {
      throw new Error("No targets defined. Add at least one point or mesh target.");
    }

    const result = await window.api.runSimulation(config);

    if (!result.success) {
      throw new Error(result.error);
    }

    lastSimResult = result.data;
    status.className = "status-msg success";
    status.textContent = `Simulation complete. Baseband shape: [${result.data.baseband_shape.join(" × ")}]`;
    document.getElementById("btn-export").disabled = false;

    // Plot results
    plotResults(result.data);

    // Switch to results panel
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    document.querySelector('[data-panel="results"]').classList.add("active");
    document.getElementById("panel-results").classList.add("active");
  } catch (err) {
    status.className = "status-msg error";
    status.textContent = "Error: " + err.message;
  } finally {
    btn.disabled = false;
    progress.classList.add("hidden");
  }
});

// --- Plot Results ---
function plotResults(data) {
  // Range-Doppler Map
  if (data.range_doppler) {
    const container = document.getElementById("plot-range-doppler");
    container.classList.add("has-data");
    const rdData = data.range_doppler;
    // Take first channel
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

  // Range Profile
  if (data.range_profile) {
    const container = document.getElementById("plot-range-profile");
    container.classList.add("has-data");
    const rpData = data.range_profile;
    // Take first channel, first pulse
    let rp;
    if (Array.isArray(rpData[0]?.[0])) {
      rp = rpData[0][0]; // [ch][pulse][sample]
    } else if (Array.isArray(rpData[0])) {
      rp = rpData[0];
    } else {
      rp = rpData;
    }
    const trace = {
      y: rp,
      type: "scatter",
      mode: "lines",
      line: { color: "#6C5CE7", width: 1.5 },
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

  // Baseband
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
      line: { color: "#A29BFE", width: 1 },
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

// --- RCS Simulation ---
document.getElementById("btn-run-rcs").addEventListener("click", async () => {
  const btn = document.getElementById("btn-run-rcs");
  const status = document.getElementById("rcs-status");

  btn.disabled = true;
  status.className = "status-msg running";
  status.textContent = "Running RCS analysis...";

  try {
    // Need mesh targets
    const rcsMeshTargets = [];
    meshTargets.forEach((_, i) => {
      const model = document.getElementById(`mesh-${i}-model`)?.value;
      if (!model) return;
      const mt = { model };
      mt.location = [
        parseNumber(document.getElementById(`mesh-${i}-loc-x`)?.value),
        parseNumber(document.getElementById(`mesh-${i}-loc-y`)?.value),
        parseNumber(document.getElementById(`mesh-${i}-loc-z`)?.value),
      ];
      mt.unit = document.getElementById(`mesh-${i}-unit`)?.value || "m";
      const perm = document.getElementById(`mesh-${i}-perm`)?.value;
      if (perm && perm.toString().trim()) mt.permittivity = parseFloat(perm);
      rcsMeshTargets.push(mt);
    });

    if (rcsMeshTargets.length === 0) {
      throw new Error("No mesh targets defined. Add mesh targets in the Targets panel.");
    }

    const phiStart = parseNumber(document.getElementById("rcs-phi-start").value);
    const phiEnd = parseNumber(document.getElementById("rcs-phi-end").value);
    const phiStep = parseNumber(document.getElementById("rcs-phi-step").value, 1);
    const phi = [];
    for (let a = phiStart; a <= phiEnd; a += phiStep) phi.push(a);

    const config = {
      targets: rcsMeshTargets,
      rcs: {
        frequency: parseNumber(document.getElementById("rcs-freq").value) * 1e9,
        density: parseNumber(document.getElementById("rcs-density").value, 1),
        inc_phi: phi,
        inc_theta: [parseNumber(document.getElementById("rcs-theta").value, 90)],
        inc_pol: [
          parseNumber(document.getElementById("rcs-pol-x").value),
          parseNumber(document.getElementById("rcs-pol-y").value),
          parseNumber(document.getElementById("rcs-pol-z").value, 1),
        ],
      },
    };

    const result = await window.api.runRcsSimulation(config);
    if (!result.success) throw new Error(result.error);

    status.className = "status-msg success";
    status.textContent = "RCS analysis complete.";

    // Plot RCS
    const container = document.getElementById("rcs-plot");
    container.classList.add("has-data");
    const trace = {
      x: result.data.inc_phi,
      y: result.data.rcs_dbsm,
      type: "scatter",
      mode: "lines",
      line: { color: "#6C5CE7", width: 2 },
      fill: "tozeroy",
      fillcolor: "rgba(108, 92, 231, 0.1)",
    };
    const layout = {
      ...plotlyLayout,
      title: "Radar Cross Section",
      xaxis: { ...plotlyLayout.xaxis, title: "Phi (°)" },
      yaxis: { ...plotlyLayout.yaxis, title: "RCS (dBsm)" },
    };
    Plotly.newPlot(container, [trace], layout, plotlyConfig);
  } catch (err) {
    status.className = "status-msg error";
    status.textContent = "Error: " + err.message;
  } finally {
    btn.disabled = false;
  }
});

// --- Export ---
document.getElementById("btn-export").addEventListener("click", async () => {
  if (!lastSimResult) return;
  await window.api.exportResults(lastSimResult);
});

// --- Check Environment ---
document.getElementById("btn-check-env").addEventListener("click", async () => {
  const status = document.getElementById("env-status");
  status.className = "env-status";
  status.textContent = "Checking...";
  try {
    const result = await window.api.checkPython();
    if (result.success && result.data) {
      const d = result.data;
      if (d.radarsimpy_available) {
        status.className = "env-status ok";
        status.innerHTML = `Python: ${d.python_version?.split(" ")[0]}<br>NumPy: ${d.numpy_version}<br>RadarSimPy: ${d.radarsimpy_version}`;
      } else {
        status.className = "env-status err";
        status.textContent = "radarsimpy not found in Python environment";
      }
    } else {
      status.className = "env-status err";
      status.textContent = result.error || "Failed to check environment";
    }
  } catch (err) {
    status.className = "env-status err";
    status.textContent = err.message;
  }
});

// --- Init ---
txChannels.push({});
rxChannels.push({});
pointTargets.push({ location: [50, 0, 0], rcs: 20, speed: [0, 0, 0], phase: 0 });
renderTxChannels();
renderRxChannels();
renderPointTargets();
updateTxInfo();
