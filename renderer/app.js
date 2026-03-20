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

// --- Custom Number Input Spinners ---
document.querySelectorAll('input[type="number"]').forEach((input) => {
  const parent = input.parentNode;
  const next = input.nextSibling;
  const wrapper = wrapNumberInput(input);
  parent.insertBefore(wrapper, next);
});

// --- TX Bandwidth / Sweep Info ---
function updateTxInfo() {
  updateTxWaveformPlot();
}
["tx-f-start", "tx-f-end", "tx-t-start", "tx-t-end"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateTxInfo)
);
document.getElementById("tx-prp").addEventListener("input", updateTxWaveformPlot);

// --- Radar Input Listeners ---
[
  "radar-loc-x", "radar-loc-y", "radar-loc-z",
  "radar-rot-yaw", "radar-rot-pitch", "radar-rot-roll",
].forEach((id) => {
  document.getElementById(id)?.addEventListener("input", updateRadarOverviewPlot);
  document.getElementById(id)?.addEventListener("input", updateTargetsPlot);
});

// --- Add Buttons ---
document.getElementById("btn-add-tx-ch").addEventListener("click", () => {
  saveTxChannelStates();
  txChannels.push({});
  renderTxChannels();
});

document.getElementById("btn-add-rx-ch").addEventListener("click", () => {
  saveRxChannelStates();
  rxChannels.push({});
  renderRxChannels();
});

document.getElementById("btn-add-point-target").addEventListener("click", () => {
  savePointTargetStates();
  pointTargets.push({ location: [50, 0, 0], rcs: 20, speed: [0, 0, 0], phase: 0 });
  renderPointTargets();
  updateTargetsPlot();
});

document.getElementById("btn-add-mesh-target").addEventListener("click", () => {
  saveMeshTargetStates();
  meshTargets.push({});
  renderMeshTargets();
  updateTargetsPlot();
});

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

// --- RCS Simulation ---
document.getElementById("btn-run-rcs").addEventListener("click", async () => {
  const btn = document.getElementById("btn-run-rcs");
  const status = document.getElementById("rcs-status");

  btn.disabled = true;
  status.className = "status-msg running";
  status.textContent = "Running RCS analysis...";

  try {
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

    const container = document.getElementById("rcs-plot");
    container.classList.add("has-data");
    const trace = {
      x: result.data.inc_phi,
      y: result.data.rcs_dbsm,
      type: "scatter",
      mode: "lines",
      line: { color: "#689f38", width: 2 },
      fill: "tozeroy",
      fillcolor: "rgba(104, 159, 56, 0.1)",
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
