// ===== RadarSimApp - Main Renderer Script =====

// --- State ---
let txChannels = [];
let rxChannels = [];
let pointTargets = [];
let meshTargets = [];
let lastSimResult = null;

// --- Navigation ---
document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", (e) => {
    // Ignore bubbled clicks from a descendant nav-item
    if (e.target.closest(".nav-item") !== item) return;
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    item.classList.add("active");
    const panelId = "panel-" + item.dataset.panel;
    const activePanel = document.getElementById(panelId);
    activePanel.classList.add("active");
    activePanel.querySelectorAll(".js-plotly-plot").forEach((plot) => Plotly.Plots.resize(plot));
    const panel = item.dataset.panel;
    if (panel === "targets") updateTargetsPlot();
    else if (panel === "radar") updateRadarOverviewPlot();
    else if (panel === "transmitter") { updateTxLocationsPlot(); updateTxWaveformPlot(); }
    else if (panel === "receiver") updateRxLocationsPlot();
  });
});

// --- Resize all plots in the active panel on window resize ---
window.addEventListener("resize", debounce(() => {
  document.querySelectorAll(".panel.active .js-plotly-plot").forEach((plot) => Plotly.Plots.resize(plot));
}, 100));

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
const debouncedUpdateTxInfo = debounce(updateTxInfo);
const debouncedUpdateTxWaveformPlot = debounce(updateTxWaveformPlot);
["tx-f-start", "tx-f-end", "tx-t-start", "tx-t-end"].forEach((id) =>
  document.getElementById(id).addEventListener("input", debouncedUpdateTxInfo)
);
document.getElementById("tx-prp").addEventListener("input", debouncedUpdateTxWaveformPlot);

// --- Radar Input Listeners ---
const debouncedUpdateRadarPlots = debounce(() => {
  updateRadarOverviewPlot();
  updateTargetsPlot();
});
[
  "radar-loc-x", "radar-loc-y", "radar-loc-z",
  "radar-rot-yaw", "radar-rot-pitch", "radar-rot-roll",
].forEach((id) => {
  document.getElementById(id)?.addEventListener("input", debouncedUpdateRadarPlots);
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
  } catch (err) {
    status.className = "status-msg error";
    status.textContent = "Error: " + err.message;
  } finally {
    btn.disabled = false;
    progress.classList.add("hidden");
  }
});

// --- RCS Analysis Modal ---
function openRcsModal(meshIndex) {
  // Close any existing modal
  document.querySelector(".rcs-modal-overlay")?.remove();

  saveMeshTargetStates();
  const t = meshTargets[meshIndex];
  if (!t?.model) {
    // Show a brief inline warning — no model set yet
    const cards = document.querySelectorAll("#mesh-targets-list .channel-card");
    if (cards[meshIndex]) {
      const warn = el("div", { className: "status-msg error", textContent: "Set a 3D model file before running RCS analysis.", style: "margin-top:8px" });
      cards[meshIndex].querySelector(".channel-card-body").appendChild(warn);
      setTimeout(() => warn.remove(), 3000);
    }
    return;
  }
  const modelName = t.model.split(/[\\/]/).pop();

  const statusEl = el("div", { className: "status-msg" });
  const runBtn = el("button", { className: "btn-primary" }, [
    el("span", { innerHTML: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>' }),
    " Run RCS Analysis",
  ]);

  const plotId = "rcs-modal-plot";

  runBtn.addEventListener("click", async () => {
    runBtn.disabled = true;
    statusEl.className = "status-msg running";
    statusEl.textContent = "Running...";

    try {
      const mt = { model: t.model, location: t.location ?? [0, 0, 0], unit: t.unit ?? "m" };
      if (t.permittivity) mt.permittivity = t.permittivity;

      const phiStart = parseNumber(document.getElementById("rcs-m-phi-start")?.value);
      const phiEnd = parseNumber(document.getElementById("rcs-m-phi-end")?.value, 360);
      const phiStep = parseNumber(document.getElementById("rcs-m-phi-step")?.value, 1);
      const phi = [];
      for (let a = phiStart; a <= phiEnd; a += phiStep) phi.push(a);

      const config = {
        targets: [mt],
        rcs: {
          frequency: parseNumber(document.getElementById("rcs-m-freq")?.value, 24) * 1e9,
          density: parseNumber(document.getElementById("rcs-m-density")?.value, 1),
          inc_phi: phi,
          inc_theta: [parseNumber(document.getElementById("rcs-m-theta")?.value, 90)],
          inc_pol: [
            parseNumber(document.getElementById("rcs-m-pol-x")?.value),
            parseNumber(document.getElementById("rcs-m-pol-y")?.value),
            parseNumber(document.getElementById("rcs-m-pol-z")?.value, 1),
          ],
        },
      };

      const result = await window.api.runRcsSimulation(config);
      if (!result.success) throw new Error(result.error);

      statusEl.className = "status-msg success";
      statusEl.textContent = "Done.";

      const container = document.getElementById(plotId);
      Plotly.newPlot(
        container,
        [{
          x: result.data.inc_phi,
          y: result.data.rcs_dbsm,
          type: "scatter", mode: "lines",
          line: { color: "#689f38", width: 2 },
          fill: "tozeroy", fillcolor: "rgba(104, 159, 56, 0.1)",
        }],
        {
          ...plotlyLayout,
          margin: { l: 60, r: 16, t: 16, b: 50 },
          xaxis: { ...plotlyLayout.xaxis, title: "Phi (°)" },
          yaxis: { ...plotlyLayout.yaxis, title: "RCS (dBsm)" },
        },
        plotlyConfig
      );
    } catch (err) {
      statusEl.className = "status-msg error";
      statusEl.textContent = "Error: " + err.message;
    } finally {
      runBtn.disabled = false;
    }
  });

  const overlay = el("div", { className: "rcs-modal-overlay" }, [
    el("div", { className: "rcs-modal" }, [
      // Header
      el("div", { className: "rcs-modal-header" }, [
        el("div", {}, [
          el("h2", { textContent: "RCS Analysis" }),
          el("p", { className: "rcs-modal-subtitle", textContent: modelName }),
        ]),
        el("button", { className: "btn-icon", title: "Close", onClick: () => overlay.remove() }, [
          createSVG("close"),
        ]),
      ]),
      // Body
      el("div", { className: "rcs-modal-body" }, [
        // Left: settings
        el("div", { className: "rcs-modal-left" }, [
          el("div", { className: "form-row" }, [
            el("div", { className: "form-group" }, [
              el("label", { textContent: "FREQUENCY (GHZ)" }),
              createInput("rcs-m-freq", 24, 0.1),
            ]),
            el("div", { className: "form-group" }, [
              el("label", { textContent: "RAY DENSITY" }),
              createInput("rcs-m-density", 1, 0.1),
            ]),
          ]),
          el("h4", { className: "subsection-label", textContent: "Incidence Angles" }),
          el("div", { className: "form-row" }, [
            el("div", { className: "form-group" }, [
              el("label", { textContent: "PHI START (°)" }),
              createInput("rcs-m-phi-start", 0, 1),
            ]),
            el("div", { className: "form-group" }, [
              el("label", { textContent: "PHI END (°)" }),
              createInput("rcs-m-phi-end", 360, 1),
            ]),
            el("div", { className: "form-group" }, [
              el("label", { textContent: "PHI STEP (°)" }),
              createInput("rcs-m-phi-step", 1, 1),
            ]),
          ]),
          el("div", { className: "form-group" }, [
            el("label", { textContent: "THETA (°)" }),
            createInput("rcs-m-theta", 90, 1),
          ]),
          el("h4", { className: "subsection-label", textContent: "Polarization" }),
          el("div", { className: "form-row triple" }, [
            el("div", { className: "form-group" }, [
              el("label", { textContent: "POL X" }),
              createInput("rcs-m-pol-x", 0, 0.1),
            ]),
            el("div", { className: "form-group" }, [
              el("label", { textContent: "POL Y" }),
              createInput("rcs-m-pol-y", 0, 0.1),
            ]),
            el("div", { className: "form-group" }, [
              el("label", { textContent: "POL Z" }),
              createInput("rcs-m-pol-z", 1, 0.1),
            ]),
          ]),
          el("div", { className: "run-controls", style: "margin-top:20px" }, [
            runBtn,
            statusEl,
          ]),
        ]),
        // Right: plot
        el("div", { className: "rcs-modal-right" }, [
          el("div", { id: plotId, className: "rcs-modal-plot" }),
        ]),
      ]),
    ]),
  ]);

  // Close on backdrop click
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

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
