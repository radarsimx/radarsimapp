// ===== RadarSimApp - Main Renderer Script =====

import { debounce, wrapNumberInput } from './utils.js';
import { txChannels, rxChannels, pointTargets, meshTargets } from './shared.js';
import { updateTxWaveformPlot, plotResults, renderResultView, markResultsOutdated, updateTxInfo, showSidePlot, redrawSidePlot, type SidePlot } from './plots.js';
import { saveTxChannelStates, saveRxChannelStates, renderTxChannels, renderRxChannels } from './channels.js';
import { savePointTargetStates, saveMeshTargetStates, renderPointTargets, renderMeshTargets } from './targets.js';
import { collectConfig } from './config.js';
import { debouncedAutoSave, resetToDefault, initApp } from './state.js';
import { updateScene, setSceneSink } from './scene.js';
import { SceneView, type SceneFraming, type CameraPreset } from './scene3d.js';
import { updateReadout, formatLength } from './readout.js';
import { initOutline, select } from './outline.js';
import { pref, setPref, setStageView, setResultViewsAvailable, isResultView, layoutStage, type StageView, type StageInsets } from './stage.js';

// --- App version ---
window.api.getAppVersion().then((v) => {
  const verEl = document.getElementById("app-version");
  if (verEl) verEl.textContent = `v${v}`;
});

// --- State ---
let lastSimResult: any = null;

// --- 3D Scene ---
// The view needs WebGL. Without it the panels and the result plots still work.
let sceneView: SceneView | null = null;
try {
  sceneView = new SceneView(document.getElementById("scene-host")!);
  sceneView.onScale = (cell) => {
    document.getElementById("scene-scale")!.textContent = `Grid ${formatLength(cell)}`;
  };
  setSceneSink((model) => sceneView!.setModel(model));
} catch (err) {
  console.warn("[scene] 3D view unavailable:", err);
  document.getElementById("scene-host")!.textContent = "3D view unavailable";
}

// --- Stage Views ---
function _resizePlots(root: ParentNode): void {
  root.querySelectorAll(".js-plotly-plot").forEach((plot) => Plotly.Plots.resize(plot as HTMLElement));
}

document.querySelectorAll<HTMLButtonElement>("button[data-view]").forEach((btn) => {
  btn.addEventListener("click", () => setStageView(btn.dataset.view as StageView));
});

document.addEventListener("stageview", (e) => {
  const view = (e as CustomEvent<StageView>).detail;
  if (isResultView(view)) {
    renderResultView();
    _resizePlots(document.querySelector(".stage-view.active")!);
  } else {
    sceneView?.setFraming(view as SceneFraming);
    // The secondary plot was put away while a result was up
    _placeSidePlot();
    redrawSidePlot();
  }
});

document.querySelectorAll<HTMLButtonElement>("button[data-cam]").forEach((btn) => {
  btn.addEventListener("click", () => sceneView?.setCamera(btn.dataset.cam as CameraPreset));
});
document.getElementById("btn-scene-fit")!.addEventListener("click", () => sceneView?.fit());

// --- Panels ---
// Panels fold away, and start as they were left.
document.querySelectorAll<HTMLDetailsElement>("details[data-panel]").forEach((panel) => {
  const name = panel.dataset.panel!;
  panel.open = pref(`panel.${name}`, panel.open);
  panel.addEventListener("toggle", () => setPref(`panel.${name}`, panel.open));
});

// --- Secondary Plot ---
// A small plot over the stage for what is being edited. It can be dragged by
// its bar, resized by its corner and folded, and it comes back as it was left.
const sidePlot = document.getElementById("side-plot")!;
let _insets: StageInsets = { left: 0, right: 0, top: 0, bottom: 0 };
/** From the right edge of the left panels, and from the top of the stage; null until it is first laid out. */
let _sidePlotAt = pref<{ x: number; y: number } | null>("sidePlotAt", null);

function _placeSidePlot(): void {
  const stage = document.getElementById("stage")!;
  // Kept in the clear part of the stage: off the panels, the title bar and
  // the view buttons. It starts in the lower left of it.
  const maxX = stage.clientWidth - _insets.left - _insets.right - sidePlot.offsetWidth - 12;
  const maxY = stage.clientHeight - _insets.bottom - sidePlot.offsetHeight - 16;
  const at = _sidePlotAt ?? { x: 12, y: maxY };
  sidePlot.style.setProperty("--side-x", Math.max(0, Math.min(at.x, maxX)) + "px");
  sidePlot.style.setProperty("--side-y", Math.max(_insets.top, Math.min(at.y, maxY)) + "px");
}

const _sidePlotSize = pref<{ width: number; height: number } | null>("sidePlotSize", null);
if (_sidePlotSize) {
  sidePlot.style.width = _sidePlotSize.width + "px";
  sidePlot.style.height = _sidePlotSize.height + "px";
}
sidePlot.classList.toggle("collapsed", pref("sidePlotFolded", false));

document.querySelectorAll<HTMLButtonElement>("button[data-side]").forEach((btn) => {
  btn.addEventListener("click", () => showSidePlot(btn.dataset.side as SidePlot));
});

document.getElementById("btn-side-plot-fold")!.addEventListener("click", (e) => {
  const folded = sidePlot.classList.toggle("collapsed");
  (e.currentTarget as HTMLElement).setAttribute("aria-expanded", String(!folded));
  setPref("sidePlotFolded", folded);
  redrawSidePlot();
  _placeSidePlot();
});

// Dragged by its bar, but not by the buttons on it
document.getElementById("side-plot-head")!.addEventListener("pointerdown", (down) => {
  if ((down.target as HTMLElement).closest("button")) return;
  const head = down.currentTarget as HTMLElement;
  const from = { x: sidePlot.offsetLeft - _insets.left, y: sidePlot.offsetTop };
  head.setPointerCapture(down.pointerId);
  const move = (e: PointerEvent): void => {
    _sidePlotAt = { x: from.x + e.clientX - down.clientX, y: from.y + e.clientY - down.clientY };
    _placeSidePlot();
  };
  const up = (): void => {
    head.removeEventListener("pointermove", move);
    head.removeEventListener("pointerup", up);
    if (_sidePlotAt) setPref("sidePlotAt", _sidePlotAt);
  };
  head.addEventListener("pointermove", move);
  head.addEventListener("pointerup", up);
});

const _sidePlotResized = debounce(() => {
  if (sidePlot.classList.contains("collapsed") || !sidePlot.offsetWidth) return;
  setPref("sidePlotSize", { width: sidePlot.offsetWidth, height: sidePlot.offsetHeight });
  _resizePlots(sidePlot);
}, 100);
new ResizeObserver(_sidePlotResized).observe(sidePlot);

// It follows the editing: the waveform's fields bring up the waveform, a
// channel's location the layout, the rest of a channel its antenna pattern
document.querySelector(".hud-left")!.addEventListener("focusin", (e) => {
  const id = (e.target as HTMLElement).id ?? "";
  const channel = id.match(/^(tx|rx)-ch-(\d+)-(.+)$/);
  if (channel) {
    if (channel[3].startsWith("loc-")) showSidePlot("layout");
    else showSidePlot("pattern", { pfx: channel[1] as "tx" | "rx", index: Number(channel[2]) });
  } else if (/^tx-(f|t|prp|pulses|power)/.test(id)) {
    showSidePlot("waveform");
  }
});

// --- Layout ---
// The panels lie over the stage: tell the 3D view how much of it they cover,
// and re-fit the plot between them when that changes.
const _resizeStagePlots = debounce(() => {
  const active = document.querySelector(".stage-view.active");
  if (active) _resizePlots(active);
}, 100);

function _layout(): void {
  _insets = layoutStage();
  sceneView?.setInsets(_insets);
  _placeSidePlot();
  _resizeStagePlots();
}

// On the next frame: laying out moves things the observer is watching
const _sizes = new ResizeObserver(() => requestAnimationFrame(_layout));
document.querySelectorAll("#stage, .hud-col, #titlebar, .stage-bottom").forEach((elem) => _sizes.observe(elem));

// --- Keyboard ---
window.addEventListener("keydown", (e) => {
  const dialogs = document.querySelectorAll(".dialog-overlay:not(.hidden)");
  if (e.key === "Escape") {
    dialogs.forEach((d) => d.classList.add("hidden"));
  } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && dialogs.length === 0) {
    e.preventDefault();
    (document.getElementById("btn-run-sim") as HTMLButtonElement).click();
  }
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

const debouncedUpdateReadout = debounce(updateReadout);
["tx-prp", "tx-pulses", "rx-fs"].forEach((id) =>
  document.getElementById(id)!.addEventListener("input", debouncedUpdateReadout)
);

// --- Radar Input Listeners ---
const debouncedUpdateScene = debounce(updateScene);
[
  "radar-loc-x", "radar-loc-y", "radar-loc-z",
  "radar-rot-yaw", "radar-rot-pitch", "radar-rot-roll",
].forEach((id) => {
  document.getElementById(id)?.addEventListener("input", debouncedUpdateScene);
});

// --- Reset ---
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

// Bring the processing options in line with their checkboxes: at startup, and
// after a configuration is applied, which sets the fields without events.
function _syncProcessing(): void {
  const rdCb = document.getElementById("proc-range-doppler") as HTMLInputElement;
  const rpCb = document.getElementById("proc-range-profile") as HTMLInputElement;
  if (rdCb.checked) { rpCb.checked = true; }
  _syncProcSubOptions();
  ["proc-rd-range-fft", "proc-rd-doppler-fft"].forEach((id) => {
    const enabled = (document.getElementById(id + "-enable") as HTMLInputElement).checked;
    (document.getElementById(id) as HTMLInputElement).disabled = !enabled;
  });
}
_syncProcessing();
document.addEventListener("configapplied", _syncProcessing);

// --- Add Buttons ---
// What is added is picked in the outline, so its fields come up to be filled in.

document.getElementById("btn-add-tx-ch")!.addEventListener("click", () => {
  saveTxChannelStates();
  txChannels.push({});
  renderTxChannels();
  select({ kind: "tx", index: txChannels.length - 1 });
  markResultsOutdated();
  debouncedAutoSave();
});

document.getElementById("btn-add-rx-ch")!.addEventListener("click", () => {
  saveRxChannelStates();
  rxChannels.push({});
  renderRxChannels();
  select({ kind: "rx", index: rxChannels.length - 1 });
  markResultsOutdated();
  debouncedAutoSave();
});

document.getElementById("btn-add-point-target")!.addEventListener("click", () => {
  savePointTargetStates();
  pointTargets.push({ location: [10, 0, 0], rcs: 20, speed: [0, 0, 0], phase: 0 });
  renderPointTargets();
  select({ kind: "point", index: pointTargets.length - 1 });
  markResultsOutdated();
  debouncedAutoSave();
});

document.getElementById("btn-add-mesh-target")!.addEventListener("click", () => {
  saveMeshTargetStates();
  meshTargets.push({});
  renderMeshTargets();
  select({ kind: "mesh", index: meshTargets.length - 1 });
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

    // Bring up the most processed result the run produced
    const _resultData = result.data;
    setResultViewsAvailable({
      "baseband": !!_resultData.baseband,
      "range-profile": !!_resultData.range_profile,
      "range-doppler": !!_resultData.range_doppler,
    });
    setStageView(_resultData.range_doppler ? "range-doppler"
      : _resultData.range_profile ? "range-profile" : "baseband");
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

// --- About ---
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
        (licenseEl as HTMLElement).style.color = d.licensed ? "var(--ok)" : "var(--danger)";
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

// --- Activate License ---
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
  (statusEl as HTMLElement).style.color = "var(--ink-2)";
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
      if (licenseEl) { licenseEl.textContent = "License: Active"; (licenseEl as HTMLElement).style.color = "var(--ok)"; }
    } else {
      statusEl.textContent = result.error || "Activation failed. Please check the license file.";
      (statusEl as HTMLElement).style.color = "var(--danger)";
    }
  } catch (err) {
    statusEl.textContent = "Error: " + (err as Error).message;
    (statusEl as HTMLElement).style.color = "var(--danger)";
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
initOutline();
initApp();
setStageView(pref<StageView>("view", "scene"));
_layout();
showSidePlot(pref<SidePlot>("sidePlot", "waveform"));
