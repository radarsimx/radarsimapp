// ===== RadarSimApp - Main Renderer Script =====
// Entry point for the renderer process. Manages application state, navigation,
// event listeners, the RCS analysis modal, and the simulation run flow.

// --- Tooltip ---
const _appTooltip = document.createElement("div");
_appTooltip.id = "app-tooltip";
document.body.appendChild(_appTooltip);

function _showTooltip(el) {
  const text = el.getAttribute("data-tooltip");
  if (!text) return;
  const collapsed = document.getElementById("app").classList.contains("sidebar-collapsed");
  const isNavItem = el.classList.contains("nav-item") || el.classList.contains("nav-item-label");
  if (isNavItem && !collapsed) return;
  _appTooltip.textContent = text;
  _appTooltip.classList.add("visible");
  const r = el.getBoundingClientRect();
  _appTooltip.style.top = "-9999px";
  _appTooltip.style.left = "-9999px";
  const inSidebar = el.closest("#sidebar") !== null;
  requestAnimationFrame(() => {
    const tw = _appTooltip.offsetWidth;
    const th = _appTooltip.offsetHeight;
    let left, top;
    if (inSidebar && collapsed) {
      // Show to the right of the element
      left = r.right + 8;
      top = r.top + r.height / 2 - th / 2;
    } else {
      // Show above, centered
      left = r.left + r.width / 2 - tw / 2;
      top = r.top - th - 6;
    }
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - th - 8));
    _appTooltip.style.left = left + "px";
    _appTooltip.style.top = top + "px";
  });
}

function _hideTooltip() {
  _appTooltip.classList.remove("visible");
}

document.querySelectorAll("#sidebar [data-tooltip]")
  .forEach((el) => {
    el.addEventListener("mouseenter", () => _showTooltip(el));
    el.addEventListener("mouseleave", _hideTooltip);
    el.addEventListener("click", _hideTooltip);
  });

// --- Sidebar version ---
window.api.getAppVersion().then((v) => {
  const el = document.getElementById("sidebar-version");
  if (el) el.textContent = `v${v}`;
});

// --- State ---
/** @type {Object[]} Transmitter channel configurations collected from the UI. */
let txChannels = [];
/** @type {Object[]} Receiver channel configurations collected from the UI. */
let rxChannels = [];
/** @type {Object[]} Point target configurations collected from the UI. */
let pointTargets = [];
/** @type {Object[]} Mesh target configurations collected from the UI. */
let meshTargets = [];
/** @type {Object|null} Raw simulation output from the last successful run; null until first run. */
let lastSimResult = null;

// --- Navigation ---
// Attach click handlers to every sidebar nav item. Each click activates the
// corresponding panel and triggers the relevant plot update(s).
document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", (e) => {
    // Ignore bubbled clicks from a descendant nav-item so that clicking a
    // child item doesn't also fire on its parent (nav-item--has-sub).
    if (e.target.closest(".nav-item") !== item) return;

    // Skip nav items without a panel (e.g. About button)
    if (!item.dataset.panel) return;

    // Deactivate all nav items and panels before activating the selected one.
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    item.classList.add("active");

    const panelId = "panel-" + item.dataset.panel;
    const activePanel = document.getElementById(panelId);
    activePanel.classList.add("active");

    // Resize any Plotly charts that are now visible to fill their containers.
    activePanel.querySelectorAll(".js-plotly-plot").forEach((plot) => Plotly.Plots.resize(plot));

    // Refresh the plot(s) relevant to the newly active panel.
    const panel = item.dataset.panel;
    if (panel === "targets") updateTargetsPlot();
    else if (panel === "radar") updateRadarOverviewPlot();
    else if (panel === "transmitter") { updateTxLocationsPlot(); updateTxWaveformPlot(); }
    else if (panel === "receiver") updateRxLocationsPlot();
    else if (panel === "simulation") _updateAutoFftValues();
  });
});

// --- Resize all plots in the active panel on window resize ---
// Debounced to avoid excessive reflow during continuous window drag.
window.addEventListener("resize", debounce(() => {
  document.querySelectorAll(".panel.active .js-plotly-plot").forEach((plot) => Plotly.Plots.resize(plot));
}, 100));

// --- Sidebar Toggle ---
document.getElementById("btn-sidebar-toggle").addEventListener("click", () => {
  const app = document.getElementById("app");
  app.classList.toggle("sidebar-collapsed");
  // Resize visible plots after transition completes
  setTimeout(() => {
    document.querySelectorAll(".panel.active .js-plotly-plot").forEach((plot) => Plotly.Plots.resize(plot));
  }, 220);
});

// --- Custom Number Input Spinners ---
// Replace each bare <input type="number"> with a styled wrapper that includes
// increment/decrement buttons (provided by wrapNumberInput in utils.js).
document.querySelectorAll('input[type="number"]:not([readonly])').forEach((input) => {
  const parent = input.parentNode;
  const next = input.nextSibling;
  const wrapper = wrapNumberInput(input);
  parent.insertBefore(wrapper, next);
});

// --- TX Bandwidth / Sweep Info ---
/**
 * Recomputes the read-only bandwidth and pulse-length fields from the
 * start/end frequency and time sweep inputs, then refreshes the waveform plot.
 *
 * Bandwidth (MHz) = (f_end - f_start) * 1000
 * Pulse length (µs) = t_end - t_start
 */
function updateTxInfo() {
  const fStart = parseFloat(document.getElementById("tx-f-start").value) || 0;
  const fEnd = parseFloat(document.getElementById("tx-f-end").value) || 0;
  const tStart = parseFloat(document.getElementById("tx-t-start").value) || 0;
  const tEnd = parseFloat(document.getElementById("tx-t-end").value) || 0;
  document.getElementById("tx-bandwidth").value = ((fEnd - fStart) * 1000).toFixed(1);
  document.getElementById("tx-pulse-length").value = (tEnd - tStart).toFixed(1);
  updateTxWaveformPlot();
}

// Debounced variants used as event listeners to avoid redundant recalculations
// while the user is actively typing.
const debouncedUpdateTxInfo = debounce(updateTxInfo);
const debouncedUpdateTxWaveformPlot = debounce(updateTxWaveformPlot);

// Frequency and time sweep inputs all feed into the bandwidth / pulse-length display.
["tx-f-start", "tx-f-end", "tx-t-start", "tx-t-end"].forEach((id) =>
  document.getElementById(id).addEventListener("input", debouncedUpdateTxInfo)
);
// PRP only affects the waveform timeline, not the bandwidth summary.
document.getElementById("tx-prp").addEventListener("input", debouncedUpdateTxWaveformPlot);

// --- Radar Input Listeners ---
// When the radar platform position or orientation changes, both the radar
// overview plot and the targets scene need to be refreshed together.
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
// Each "Add" button first snapshots the current UI state into the corresponding
// array, appends a blank entry, then re-renders the list.

document.getElementById("btn-reset-config").addEventListener("click", () => {
  document.getElementById("reset-dialog-overlay").classList.remove("hidden");
});

["btn-reset-cancel", "btn-reset-cancel-x"].forEach((id) => {
  document.getElementById(id).addEventListener("click", () => {
    document.getElementById("reset-dialog-overlay").classList.add("hidden");
  });
});

document.getElementById("btn-reset-confirm").addEventListener("click", () => {
  document.getElementById("reset-dialog-overlay").classList.add("hidden");
  resetToDefault();
});

// Range Profile ↔ Range-Doppler dependency
document.getElementById("proc-range-doppler").addEventListener("change", (e) => {
  const rpCheckbox = document.getElementById("proc-range-profile");
  if (e.target.checked) {
    rpCheckbox.checked = true;
  }
  _syncProcSubOptions();
});
document.getElementById("proc-range-profile").addEventListener("change", (e) => {
  const rdCheckbox = document.getElementById("proc-range-doppler");
  if (!e.target.checked && rdCheckbox.checked) {
    rdCheckbox.checked = false;
  }
  _syncProcSubOptions();
});

function _isPow2(n) { return n > 0 && (n & (n - 1)) === 0; }

function _validateFftInput(inputEl, minVal, label) {
  const val = parseInt(inputEl.value, 10);
  let msg = '';
  if (!_isPow2(val)) msg = `${label} must be a power of 2`;
  else if (val < minVal) msg = `${label} must be \u2265 ${minVal} (next: ${_nextPow2UI(minVal)})`;
  const wrap = inputEl.closest('.proc-sub-input-wrap');
  inputEl.classList.toggle('is-invalid', !!msg);
  if (wrap) {
    if (msg) wrap.setAttribute('data-error', msg);
    else wrap.removeAttribute('data-error');
  }
  return !msg;
}

function _validateFftInputs() {
  const tStart = parseFloat(document.getElementById('tx-t-start').value) || 0;
  const tEnd = parseFloat(document.getElementById('tx-t-end').value) || 0;
  const fs = (parseFloat(document.getElementById('rx-fs').value) || 2) * 1e6;
  const pulses = parseInt(document.getElementById('tx-pulses').value, 10) || 1;
  const spp = Math.ceil(Math.abs(tEnd - tStart) * 1e-6 * fs) || 1;
  if (document.getElementById('proc-rd-range-fft-enable').checked) {
    _validateFftInput(document.getElementById('proc-rd-range-fft'), spp, 'Range FFT');
  }
  if (document.getElementById('proc-rd-doppler-fft-enable').checked) {
    _validateFftInput(document.getElementById('proc-rd-doppler-fft'), pulses, 'Doppler FFT');
  }
}

// Custom FFT size toggles
["proc-rd-range-fft", "proc-rd-doppler-fft"].forEach((id) => {
  const enableCb = document.getElementById(id + "-enable");
  const input = document.getElementById(id);
  enableCb.addEventListener("change", () => {
    input.disabled = !enableCb.checked;
    if (!enableCb.checked) {
      input.classList.remove('is-invalid');
      const wrap = input.closest('.proc-sub-input-wrap');
      if (wrap) wrap.removeAttribute('data-error');
      _updateAutoFftValues();
    } else {
      _validateFftInputs();
    }
  });
  input.addEventListener('input', _validateFftInputs);
});

function _nextPow2UI(n) { let p = 1; while (p < n) p <<= 1; return p; }

function _updateAutoFftValues() {
  const tStart = parseFloat(document.getElementById("tx-t-start").value) || 0;
  const tEnd = parseFloat(document.getElementById("tx-t-end").value) || 0;
  const fs = (parseFloat(document.getElementById("rx-fs").value) || 2) * 1e6;
  const pulses = parseInt(document.getElementById("tx-pulses").value, 10) || 1;
  const spp = Math.ceil(Math.abs(tEnd - tStart) * 1e-6 * fs) || 1;

  const rangeFftInput = document.getElementById("proc-rd-range-fft");
  const dopplerFftInput = document.getElementById("proc-rd-doppler-fft");
  if (!document.getElementById("proc-rd-range-fft-enable").checked) {
    rangeFftInput.value = _nextPow2UI(spp);
  }
  if (!document.getElementById("proc-rd-doppler-fft-enable").checked) {
    dopplerFftInput.value = _nextPow2UI(pulses);
  }
}

// Update auto FFT values when relevant inputs change
["tx-t-start", "tx-t-end", "rx-fs", "tx-pulses"].forEach((id) => {
  document.getElementById(id)?.addEventListener("input", _updateAutoFftValues);
});

function _syncProcSubOptions() {
  const rpOn = document.getElementById("proc-range-profile").checked;
  const rdOn = document.getElementById("proc-range-doppler").checked;
  document.getElementById("proc-range-profile-opts").classList.toggle("disabled", !rpOn);
  document.getElementById("proc-range-doppler-opts").classList.toggle("disabled", !rdOn);
  if (!rpOn) {
    document.getElementById("proc-rd-range-fft-enable").checked = false;
    const rpFft = document.getElementById("proc-rd-range-fft");
    rpFft.disabled = true;
    rpFft.classList.remove('is-invalid');
    const rpWrap = rpFft.closest('.proc-sub-input-wrap');
    if (rpWrap) rpWrap.removeAttribute('data-error');
  }
  if (!rdOn) {
    document.getElementById("proc-rd-doppler-fft-enable").checked = false;
    const rdFft = document.getElementById("proc-rd-doppler-fft");
    rdFft.disabled = true;
    rdFft.classList.remove('is-invalid');
    const rdWrap = rdFft.closest('.proc-sub-input-wrap');
    if (rdWrap) rdWrap.removeAttribute('data-error');
  }
  _updateAutoFftValues();
}

// Set initial state
(function () {
  const rdCb = document.getElementById("proc-range-doppler");
  const rpCb = document.getElementById("proc-range-profile");
  if (rdCb.checked) { rpCb.checked = true; }
  _syncProcSubOptions();
})();

document.getElementById("btn-add-tx-ch").addEventListener("click", () => {
  saveTxChannelStates(); // persist existing card values before re-render
  txChannels.push({});
  renderTxChannels();
  debouncedAutoSave();
});

document.getElementById("btn-add-rx-ch").addEventListener("click", () => {
  saveRxChannelStates();
  rxChannels.push({});
  renderRxChannels();
  debouncedAutoSave();
});

document.getElementById("btn-add-point-target").addEventListener("click", () => {
  savePointTargetStates();
  // Default point target: 10 m ahead on the X axis, 20 dBsm, stationary.
  pointTargets.push({ location: [10, 0, 0], rcs: 20, speed: [0, 0, 0], phase: 0 });
  renderPointTargets();
  updateTargetsPlot();
  debouncedAutoSave();
});

document.getElementById("btn-add-mesh-target").addEventListener("click", () => {
  saveMeshTargetStates();
  meshTargets.push({});
  renderMeshTargets();
  updateTargetsPlot();
  debouncedAutoSave();
});

// --- Run Simulation ---
/**
 * Handles the "Run Simulation" button click.
 *
 * Flow:
 *  1. Disables the button and shows a progress indicator.
 *  2. Collects the full radar/target configuration from the UI via collectConfig().
 *  3. Validates that at least one target is defined.
 *  4. Sends the config to the main process via the preload API bridge.
 *  5. On success: stores the result, updates the status bar, enables export,
 *     and renders result plots.
 *  6. On failure: displays the error message in the status bar.
 *  7. Always re-enables the button and hides the progress bar.
 */
document.getElementById("btn-run-sim").addEventListener("click", async () => {
  const btn = document.getElementById("btn-run-sim");
  const status = document.getElementById("sim-status");

  // Validate custom FFT sizes before running
  _validateFftInputs();
  if (document.querySelector('#proc-range-profile-opts .is-invalid, #proc-range-doppler-opts .is-invalid')) {
    status.className = "status-msg error";
    status.textContent = "Invalid FFT size. Fix the errors above before running.";
    return;
  }

  btn.disabled = true;
  status.className = "status-msg running";
  status.textContent = "Running simulation...";

  const overlay = document.getElementById("sim-overlay");
  const overlaySub = document.getElementById("sim-overlay-sub");
  overlaySub.textContent = "";
  overlay.classList.remove("hidden");

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
    // baseband_shape reports [rx_channels × tx_channels × pulses × samples].
    status.textContent = `Simulation complete. Baseband shape: [${result.data.baseband_shape.join(" × ")}]`;
    document.getElementById("btn-export").disabled = false;

    // Defer plot rendering until after the overlay has hidden and the browser
    // has had a chance to paint, so the loading animation closes cleanly.
    const _resultData = result.data;
    setTimeout(() => plotResults(_resultData), 0);
  } catch (err) {
    status.className = "status-msg error";
    status.textContent = "Error: " + err.message;
  } finally {
    btn.disabled = false;
    document.getElementById("sim-overlay").classList.add("hidden");
  }
});

// --- RCS Analysis Modal ---
/**
 * Opens the RCS (Radar Cross-Section) analysis modal for a mesh target.
 *
 * The modal allows the user to configure incidence angles and polarization,
 * run a sweep via the main-process RCS backend, and view the result as a
 * RCS vs. Phi plot.
 *
 * @param {number} meshIndex - Index into the meshTargets array for the target
 *   to analyse. The target must have a model path set.
 */
function openRcsModal(meshIndex) {
  // Close any existing modal to avoid stacking overlays.
  document.querySelector(".rcs-modal-overlay")?.remove();

  saveMeshTargetStates();
  const t = meshTargets[meshIndex];
  if (!t?.model) {
    // No model file set — show a transient inline warning on the target card.
    const cards = document.querySelectorAll("#mesh-targets-list .channel-card");
    if (cards[meshIndex]) {
      const warn = el("div", { className: "status-msg error", textContent: "Set a 3D model file before running RCS analysis.", style: "margin-top:8px" });
      cards[meshIndex].querySelector(".channel-card-body").appendChild(warn);
      setTimeout(() => warn.remove(), 3000);
    }
    return;
  }
  // Display only the filename, not the full path, in the modal subtitle.
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
      // Build the minimal target descriptor required by the RCS backend.
      const mt = { model: t.model, location: t.location ?? [0, 0, 0], unit: t.unit ?? "m" };
      if (t.permittivity) mt.permittivity = t.permittivity;

      // Build the phi sweep array from start/end/step inputs.
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
// Sends the last simulation result to the main process for file export.
// The button is disabled until a successful simulation has been run.
document.getElementById("btn-export").addEventListener("click", async () => {
  if (!lastSimResult) return;
  await window.api.exportResults(lastSimResult);
});

// --- Check Environment ---
/**
 * Checks whether the native RadarSimLib is available and licensed by invoking
 * the main-process check-library IPC handler.
 *
 * Displays version and license info on success, or an error message on failure.
 */
document.getElementById("btn-check-env").addEventListener("click", async () => {
  const overlay = document.getElementById("about-dialog-overlay");
  const versionEl = document.getElementById("about-version");
  const licenseEl = document.getElementById("about-license");
  const yearEl = document.getElementById("about-year");
  yearEl.textContent = new Date().getFullYear();
  versionEl.textContent = "Checking...";
  licenseEl.textContent = "";
  overlay.classList.remove("hidden");

  try {
    const [appVersion, result] = await Promise.all([
      window.api.getAppVersion(),
      window.api.checkLibrary(),
    ]);
    if (result.success && result.data) {
      const d = result.data;
      if (d.radarsimlib_available) {
        versionEl.textContent = `RadarSimApp v${appVersion} — RadarSimLib v${d.radarsimlib_version}`;
        licenseEl.textContent = d.licensed ? "License: Active" : "License: Unlicensed";
        licenseEl.style.color = d.licensed ? "var(--success)" : "var(--error)";
        // Show/hide the activate button based on license status
        document.getElementById("btn-activate").classList.toggle("hidden", d.licensed);
      } else {
        versionEl.textContent = `RadarSimApp v${appVersion} — RadarSimLib not found`;
        licenseEl.textContent = "";
      }
    } else {
      versionEl.textContent = `RadarSimApp v${appVersion} — ${result.error || "Failed to check"}`;
    }
  } catch (err) {
    versionEl.textContent = err.message;
  }
});

// --- Activate License (sidebar button) ---
document.getElementById("btn-activate").addEventListener("click", () => {
  document.getElementById("license-dialog-status").textContent = "";
  document.getElementById("license-dialog-overlay").classList.remove("hidden");
});

document.getElementById("btn-about-close").addEventListener("click", () => {
  document.getElementById("about-dialog-overlay").classList.add("hidden");
});

document.getElementById("reset-dialog-overlay").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) e.currentTarget.classList.add("hidden");
});

document.getElementById("about-dialog-overlay").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) e.currentTarget.classList.add("hidden");
});

// --- Check license on startup ---
(async () => {
  try {
    const result = await window.api.checkLibrary();
    if (result.success && result.data) {
      const licensed = result.data.licensed;
      document.getElementById("btn-activate").classList.toggle("hidden", licensed);
      if (!licensed) {
        document.getElementById("license-dialog-overlay").classList.remove("hidden");
      }
    }
  } catch (_) { /* ignore */ }
})();

// --- License dialog handlers ---
async function _doLicenseActivation() {
  const statusEl = document.getElementById("license-dialog-status");
  const btn = document.getElementById("btn-license-select");
  btn.disabled = true;
  statusEl.textContent = "Activating...";
  statusEl.style.color = "var(--text-secondary)";
  try {
    const result = await window.api.activateLicense();
    if (result.cancelled) {
      statusEl.textContent = "";
      return;
    }
    if (result.success && result.data?.licensed) {
      document.getElementById("license-dialog-overlay").classList.add("hidden");
      document.getElementById("btn-activate").classList.add("hidden");
      const licenseEl = document.getElementById("about-license");
      if (licenseEl) { licenseEl.textContent = "License: Active"; licenseEl.style.color = "var(--success)"; }
    } else {
      statusEl.textContent = result.error || "Activation failed. Please check the license file.";
      statusEl.style.color = "var(--error)";
    }
  } catch (err) {
    statusEl.textContent = "Error: " + err.message;
    statusEl.style.color = "var(--error)";
  } finally {
    btn.disabled = false;
  }
}

document.getElementById("btn-license-select").addEventListener("click", _doLicenseActivation);
document.getElementById("btn-license-cancel").addEventListener("click", () => {
  document.getElementById("license-dialog-overlay").classList.add("hidden");
});
document.getElementById("btn-license-close").addEventListener("click", () => {
  document.getElementById("license-dialog-overlay").classList.add("hidden");
});

// --- Init ---
// Initialization is handled by state.js (loaded after this script), which
// restores a previously saved session from localStorage or falls back to
// defaults when no saved state exists.
