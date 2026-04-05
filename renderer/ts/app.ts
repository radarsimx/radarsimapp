// ===== RadarSimApp - Main Renderer Script =====

import { debounce, wrapNumberInput, parseNumber, createInput, el, createSVG } from './utils.js';
import { txChannels, rxChannels, pointTargets, meshTargets } from './shared.js';
import { updateTxWaveformPlot, updateTxLocationsPlot, updateRxLocationsPlot, updateRadarOverviewPlot, updateTargetsPlot, plotResults, markResultsOutdated, updateTxInfo } from './plots.js';
import { saveTxChannelStates, saveRxChannelStates, renderTxChannels, renderRxChannels } from './channels.js';
import { savePointTargetStates, saveMeshTargetStates, renderPointTargets, renderMeshTargets } from './targets.js';
import { collectConfig } from './config.js';
import { debouncedAutoSave, resetToDefault, initApp } from './state.js';

// --- Tooltip ---
const _appTooltip = document.createElement("div");
_appTooltip.id = "app-tooltip";
document.body.appendChild(_appTooltip);

function _showTooltip(target: HTMLElement): void {
  const text = target.getAttribute("data-tooltip");
  if (!text) return;
  const collapsed = document.getElementById("app")!.classList.contains("sidebar-collapsed");
  const isNavItem = target.classList.contains("nav-item") || target.classList.contains("nav-item-label");
  if (isNavItem && !collapsed) return;
  _appTooltip.textContent = text;
  _appTooltip.classList.add("visible");
  const r = target.getBoundingClientRect();
  _appTooltip.style.top = "-9999px";
  _appTooltip.style.left = "-9999px";
  const inSidebar = target.closest("#sidebar") !== null;
  requestAnimationFrame(() => {
    const tw = _appTooltip.offsetWidth;
    const th = _appTooltip.offsetHeight;
    let left: number, top: number;
    if (inSidebar && collapsed) {
      left = r.right + 8;
      top = r.top + r.height / 2 - th / 2;
    } else {
      left = r.left + r.width / 2 - tw / 2;
      top = r.top - th - 6;
    }
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - th - 8));
    _appTooltip.style.left = left + "px";
    _appTooltip.style.top = top + "px";
  });
}

function _hideTooltip(): void {
  _appTooltip.classList.remove("visible");
}

document.querySelectorAll("#sidebar [data-tooltip]")
  .forEach((item) => {
    const elem = item as HTMLElement;
    elem.addEventListener("mouseenter", () => _showTooltip(elem));
    elem.addEventListener("mouseleave", _hideTooltip);
    elem.addEventListener("click", _hideTooltip);
  });

// --- Sidebar version ---
window.api.getAppVersion().then((v) => {
  const verEl = document.getElementById("sidebar-version");
  if (verEl) verEl.textContent = `v${v}`;
});

// --- State ---
let lastSimResult: any = null;

// --- Navigation ---
document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".nav-item") !== item) return;
    if (!(item as HTMLElement).dataset.panel) return;

    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    item.classList.add("active");

    const panelId = "panel-" + (item as HTMLElement).dataset.panel;
    const activePanel = document.getElementById(panelId)!;
    activePanel.classList.add("active");

    activePanel.querySelectorAll(".js-plotly-plot").forEach((plot) => Plotly.Plots.resize(plot as HTMLElement));

    const panel = (item as HTMLElement).dataset.panel;
    if (panel === "targets") updateTargetsPlot();
    else if (panel === "radar") updateRadarOverviewPlot();
    else if (panel === "transmitter") { updateTxLocationsPlot(); updateTxWaveformPlot(); }
    else if (panel === "receiver") updateRxLocationsPlot();
    else if (panel === "simulation") _updateAutoFftValues();
  });
});

// --- Resize all plots in the active panel on window resize ---
window.addEventListener("resize", debounce(() => {
  document.querySelectorAll(".panel.active .js-plotly-plot").forEach((plot) => Plotly.Plots.resize(plot as HTMLElement));
}, 100));

// --- Sidebar Toggle ---
document.getElementById("btn-sidebar-toggle")!.addEventListener("click", () => {
  const app = document.getElementById("app")!;
  app.classList.toggle("sidebar-collapsed");
  debouncedAutoSave();
  setTimeout(() => {
    document.querySelectorAll(".panel.active .js-plotly-plot").forEach((plot) => Plotly.Plots.resize(plot as HTMLElement));
  }, 220);
});

// --- Custom Number Input Spinners ---
document.querySelectorAll('input[type="number"]:not([readonly])').forEach((input) => {
  const parent = input.parentNode!;
  const next = input.nextSibling;
  const wrapper = wrapNumberInput(input as HTMLInputElement);
  parent.insertBefore(wrapper, next);
});

// --- TX Bandwidth / Sweep Info ---
const debouncedUpdateTxInfo = debounce(updateTxInfo);
const debouncedUpdateTxWaveformPlot = debounce(updateTxWaveformPlot);

["tx-f-start", "tx-f-end", "tx-t-start", "tx-t-end"].forEach((id) =>
  document.getElementById(id)!.addEventListener("input", debouncedUpdateTxInfo)
);
document.getElementById("tx-prp")!.addEventListener("input", debouncedUpdateTxWaveformPlot);

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
document.getElementById("btn-reset-config")!.addEventListener("click", () => {
  document.getElementById("reset-dialog-overlay")!.classList.remove("hidden");
});

["btn-reset-cancel", "btn-reset-cancel-x"].forEach((id) => {
  document.getElementById(id)!.addEventListener("click", () => {
    document.getElementById("reset-dialog-overlay")!.classList.add("hidden");
  });
});

document.getElementById("btn-reset-confirm")!.addEventListener("click", () => {
  document.getElementById("reset-dialog-overlay")!.classList.add("hidden");
  resetToDefault();
});

// Range Profile ↔ Range-Doppler dependency
document.getElementById("proc-range-doppler")!.addEventListener("change", (e) => {
  const rpCheckbox = document.getElementById("proc-range-profile") as HTMLInputElement;
  if ((e.target as HTMLInputElement).checked) {
    rpCheckbox.checked = true;
  }
  _syncProcSubOptions();
});
document.getElementById("proc-range-profile")!.addEventListener("change", (e) => {
  const rdCheckbox = document.getElementById("proc-range-doppler") as HTMLInputElement;
  if (!(e.target as HTMLInputElement).checked && rdCheckbox.checked) {
    rdCheckbox.checked = false;
  }
  _syncProcSubOptions();
});

function _isPow2(n: number): boolean { return n > 0 && (n & (n - 1)) === 0; }

function _validateFftInput(inputEl: HTMLInputElement, minVal: number, label: string): boolean {
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

function _validateFftInputs(): void {
  const tStart = parseFloat((document.getElementById('tx-t-start') as HTMLInputElement).value) || 0;
  const tEnd = parseFloat((document.getElementById('tx-t-end') as HTMLInputElement).value) || 0;
  const fs = (parseFloat((document.getElementById('rx-fs') as HTMLInputElement).value) || 2) * 1e6;
  const pulses = parseInt((document.getElementById('tx-pulses') as HTMLInputElement).value, 10) || 1;
  const spp = Math.ceil(Math.abs(tEnd - tStart) * 1e-6 * fs) || 1;
  if ((document.getElementById('proc-rd-range-fft-enable') as HTMLInputElement).checked) {
    _validateFftInput(document.getElementById('proc-rd-range-fft') as HTMLInputElement, spp, 'Range FFT');
  }
  if ((document.getElementById('proc-rd-doppler-fft-enable') as HTMLInputElement).checked) {
    _validateFftInput(document.getElementById('proc-rd-doppler-fft') as HTMLInputElement, pulses, 'Doppler FFT');
  }
}

// Custom FFT size toggles
["proc-rd-range-fft", "proc-rd-doppler-fft"].forEach((id) => {
  const enableCb = document.getElementById(id + "-enable") as HTMLInputElement;
  const input = document.getElementById(id) as HTMLInputElement;
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

function _nextPow2UI(n: number): number { let p = 1; while (p < n) p <<= 1; return p; }

function _updateAutoFftValues(): void {
  const tStart = parseFloat((document.getElementById("tx-t-start") as HTMLInputElement).value) || 0;
  const tEnd = parseFloat((document.getElementById("tx-t-end") as HTMLInputElement).value) || 0;
  const fs = (parseFloat((document.getElementById("rx-fs") as HTMLInputElement).value) || 2) * 1e6;
  const pulses = parseInt((document.getElementById("tx-pulses") as HTMLInputElement).value, 10) || 1;
  const spp = Math.ceil(Math.abs(tEnd - tStart) * 1e-6 * fs) || 1;

  const rangeFftInput = document.getElementById("proc-rd-range-fft") as HTMLInputElement;
  const dopplerFftInput = document.getElementById("proc-rd-doppler-fft") as HTMLInputElement;
  if (!(document.getElementById("proc-rd-range-fft-enable") as HTMLInputElement).checked) {
    rangeFftInput.value = String(_nextPow2UI(spp));
  }
  if (!(document.getElementById("proc-rd-doppler-fft-enable") as HTMLInputElement).checked) {
    dopplerFftInput.value = String(_nextPow2UI(pulses));
  }
}

// Update auto FFT values when relevant inputs change
["tx-t-start", "tx-t-end", "rx-fs", "tx-pulses"].forEach((id) => {
  document.getElementById(id)?.addEventListener("input", _updateAutoFftValues);
});

function _syncProcSubOptions(): void {
  const rpOn = (document.getElementById("proc-range-profile") as HTMLInputElement).checked;
  const rdOn = (document.getElementById("proc-range-doppler") as HTMLInputElement).checked;
  document.getElementById("proc-range-profile-opts")!.classList.toggle("disabled", !rpOn);
  document.getElementById("proc-range-doppler-opts")!.classList.toggle("disabled", !rdOn);
  if (!rpOn) {
    (document.getElementById("proc-rd-range-fft-enable") as HTMLInputElement).checked = false;
    const rpFft = document.getElementById("proc-rd-range-fft") as HTMLInputElement;
    rpFft.disabled = true;
    rpFft.classList.remove('is-invalid');
    const rpWrap = rpFft.closest('.proc-sub-input-wrap');
    if (rpWrap) rpWrap.removeAttribute('data-error');
  }
  if (!rdOn) {
    (document.getElementById("proc-rd-doppler-fft-enable") as HTMLInputElement).checked = false;
    const rdFft = document.getElementById("proc-rd-doppler-fft") as HTMLInputElement;
    rdFft.disabled = true;
    rdFft.classList.remove('is-invalid');
    const rdWrap = rdFft.closest('.proc-sub-input-wrap');
    if (rdWrap) rdWrap.removeAttribute('data-error');
  }
  _updateAutoFftValues();
}

// Set initial state
(function () {
  const rdCb = document.getElementById("proc-range-doppler") as HTMLInputElement;
  const rpCb = document.getElementById("proc-range-profile") as HTMLInputElement;
  if (rdCb.checked) { rpCb.checked = true; }
  _syncProcSubOptions();
})();

document.getElementById("btn-add-tx-ch")!.addEventListener("click", () => {
  saveTxChannelStates();
  txChannels.push({});
  renderTxChannels();
  markResultsOutdated();
  debouncedAutoSave();
});

document.getElementById("btn-add-rx-ch")!.addEventListener("click", () => {
  saveRxChannelStates();
  rxChannels.push({});
  renderRxChannels();
  markResultsOutdated();
  debouncedAutoSave();
});

document.getElementById("btn-add-point-target")!.addEventListener("click", () => {
  savePointTargetStates();
  pointTargets.push({ location: [10, 0, 0], rcs: 20, speed: [0, 0, 0], phase: 0 });
  renderPointTargets();
  updateTargetsPlot();
  markResultsOutdated();
  debouncedAutoSave();
});

document.getElementById("btn-add-mesh-target")!.addEventListener("click", () => {
  saveMeshTargetStates();
  meshTargets.push({});
  renderMeshTargets();
  updateTargetsPlot();
  markResultsOutdated();
  debouncedAutoSave();
});

// --- Run Simulation ---
document.getElementById("btn-run-sim")!.addEventListener("click", async () => {
  const btn = document.getElementById("btn-run-sim") as HTMLButtonElement;
  const status = document.getElementById("sim-status")!;

  _validateFftInputs();
  if (document.querySelector('#proc-range-profile-opts .is-invalid, #proc-range-doppler-opts .is-invalid')) {
    status.className = "status-msg error";
    status.textContent = "Invalid FFT size. Fix the errors above before running.";
    return;
  }

  btn.disabled = true;
  status.className = "status-msg running";
  status.textContent = "Running simulation...";

  const overlay = document.getElementById("sim-overlay")!;
  const overlaySub = document.getElementById("sim-overlay-sub")!;
  overlaySub.textContent = "";

  overlay.classList.remove("hidden");
  overlay.classList.remove("sim-visible");
  const _overlayRevealTimer = setTimeout(() => overlay.classList.add("sim-visible"), 400);

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
    (document.getElementById("btn-export") as HTMLButtonElement).disabled = false;

    const _resultData = result.data;
    setTimeout(() => plotResults(_resultData), 0);
  } catch (err) {
    status.className = "status-msg error";
    status.textContent = "Error: " + (err as Error).message;
  } finally {
    btn.disabled = false;
    clearTimeout(_overlayRevealTimer);
    const wasVisible = overlay.classList.contains("sim-visible");
    overlay.classList.remove("sim-visible");
    if (wasVisible) {
      setTimeout(() => overlay.classList.add("hidden"), 270);
    } else {
      overlay.classList.add("hidden");
    }
  }
});

// --- Export ---
document.getElementById("btn-export")!.addEventListener("click", async () => {
  if (!lastSimResult) return;
  await window.api.exportResults(lastSimResult);
});

// --- Check Environment ---
document.getElementById("btn-check-env")!.addEventListener("click", async () => {
  const overlay = document.getElementById("about-dialog-overlay")!;
  const versionEl = document.getElementById("about-version")!;
  const licenseEl = document.getElementById("about-license")!;
  const yearEl = document.getElementById("about-year")!;
  yearEl.textContent = String(new Date().getFullYear());
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
        (licenseEl as HTMLElement).style.color = d.licensed ? "var(--success)" : "var(--error)";
        document.getElementById("btn-activate")!.classList.toggle("hidden", d.licensed);
      } else {
        versionEl.textContent = `RadarSimApp v${appVersion} — RadarSimLib not found`;
        licenseEl.textContent = "";
      }
    } else {
      versionEl.textContent = `RadarSimApp v${appVersion} — ${result.error || "Failed to check"}`;
    }
  } catch (err) {
    versionEl.textContent = (err as Error).message;
  }
});

// --- Activate License (sidebar button) ---
document.getElementById("btn-activate")!.addEventListener("click", () => {
  document.getElementById("license-dialog-status")!.textContent = "";
  document.getElementById("license-dialog-overlay")!.classList.remove("hidden");
});

document.getElementById("btn-about-close")!.addEventListener("click", () => {
  document.getElementById("about-dialog-overlay")!.classList.add("hidden");
});

document.getElementById("reset-dialog-overlay")!.addEventListener("click", (e) => {
  if (e.target === e.currentTarget) (e.currentTarget as HTMLElement).classList.add("hidden");
});

document.getElementById("about-dialog-overlay")!.addEventListener("click", (e) => {
  if (e.target === e.currentTarget) (e.currentTarget as HTMLElement).classList.add("hidden");
});

// --- Check license on startup ---
(async () => {
  try {
    const result = await window.api.checkLibrary();
    if (result.success && result.data) {
      const licensed = result.data.licensed;
      document.getElementById("btn-activate")!.classList.toggle("hidden", licensed);
      if (!licensed) {
        document.getElementById("license-dialog-overlay")!.classList.remove("hidden");
      }
    }
  } catch (_) { /* ignore */ }
})();

// --- License dialog handlers ---
async function _doLicenseActivation(): Promise<void> {
  const statusEl = document.getElementById("license-dialog-status")!;
  const btn = document.getElementById("btn-license-select") as HTMLButtonElement;
  btn.disabled = true;
  statusEl.textContent = "Activating...";
  (statusEl as HTMLElement).style.color = "var(--text-secondary)";
  try {
    const result = await window.api.activateLicense();
    if (result.cancelled) {
      statusEl.textContent = "";
      return;
    }
    if (result.success && result.data?.licensed) {
      document.getElementById("license-dialog-overlay")!.classList.add("hidden");
      document.getElementById("btn-activate")!.classList.add("hidden");
      const licenseEl = document.getElementById("about-license");
      if (licenseEl) { licenseEl.textContent = "License: Active"; (licenseEl as HTMLElement).style.color = "var(--success)"; }
    } else {
      statusEl.textContent = result.error || "Activation failed. Please check the license file.";
      (statusEl as HTMLElement).style.color = "var(--error)";
    }
  } catch (err) {
    statusEl.textContent = "Error: " + (err as Error).message;
    (statusEl as HTMLElement).style.color = "var(--error)";
  } finally {
    btn.disabled = false;
  }
}

document.getElementById("btn-license-select")!.addEventListener("click", _doLicenseActivation);
document.getElementById("btn-license-cancel")!.addEventListener("click", () => {
  document.getElementById("license-dialog-overlay")!.classList.add("hidden");
});
document.getElementById("btn-license-close")!.addEventListener("click", () => {
  document.getElementById("license-dialog-overlay")!.classList.add("hidden");
});

// --- Initialize Application ---
initApp();
