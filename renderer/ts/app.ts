// ===== RadarSimApp - Main Renderer Script =====

import { createBusyAnimation } from "./busy.js";
import { renderRxChannels, renderTxChannels, saveRxChannelStates, saveTxChannelStates } from "./channels.js";
import { initColumnResize, place as placeColumnGrips } from "./colresize.js";
import { collectConfig } from "./config.js";
import { initOutline, type Selection, select, syncCoverageFocus } from "./outline.js";
import {
  markResultsOutdated,
  plotResults,
  redrawInspectorPlots,
  renderResultView,
  updateTxInfo,
  updateTxWaveformPlot,
} from "./plots.js";
import { formatLength, updateReadout } from "./readout.js";
import type { Pose } from "./scene.js";
import { setSceneSink, updateScene } from "./scene.js";
import {
  type CameraPreset,
  canRotate,
  type EditMode,
  type EditTarget,
  type SceneFraming,
  SceneView,
} from "./scene3d.js";
import { meshTargets, pointTargets, rxChannels, txChannels } from "./shared.js";
import {
  isResultView,
  layoutStage,
  pref,
  type StageView,
  setPref,
  setResultViewsAvailable,
  setStageView,
} from "./stage.js";
import { debouncedAutoSave, initApp, resetToDefault } from "./state.js";
import { renderMeshTargets, renderPointTargets, saveMeshTargetStates, savePointTargetStates } from "./targets.js";
import { byId, debounce, wrapNumberInput } from "./utils.js";

// --- App version ---
window.api.getAppVersion().then((v) => {
  const verEl = document.getElementById("app-version");
  if (verEl) verEl.textContent = `v${v}`;
});

// --- State ---
let lastSimResult: SimResult | null = null;

// --- 3D Scene ---
// The view needs WebGL. Without it the panels and the result plots still work.
let sceneView: SceneView | null = null;
/** The grid's cell (m): positions moved in the scene are kept to a hundredth of it. */
let sceneCell = 1;
try {
  const view = new SceneView(byId("scene-host"));
  sceneView = view;
  view.onScale = (cell) => {
    sceneCell = cell;
    byId("scene-scale").textContent = `Grid ${formatLength(cell)}`;
  };
  setSceneSink((model) => view.setModel(model));
  // What is clicked in the scene opens its fields, its panel unfolded if need
  // be, and takes the handle to be moved or turned right there
  view.onPick = (target) => {
    const panel = document.getElementById(_editPanel(target)) as HTMLDetailsElement | null;
    if (panel && !panel.open) panel.open = true;
    select({ kind: target.kind, index: target.index });
    view.setEditTarget(target);
  };
  view.onEdit = _writePose;
  view.onEditChange = _showEditBar;
} catch (err) {
  console.warn("[scene] 3D view unavailable:", err);
  byId("scene-host").textContent = "3D view unavailable";
}

// --- Editing in the scene ---
function _editPanel(t: EditTarget): string {
  return t.kind === "radar" ? "panel-radar" : "panel-targets";
}

/** The fields a pose is kept in: `${prefix}-loc-x` and so on, `${prefix}-rot-yaw` and so on. */
function _fieldPrefix(t: EditTarget): string {
  return t.kind === "radar" ? "radar" : t.kind === "point" ? `pt-${t.index ?? 0}` : `mesh-${t.index ?? 0}`;
}

/** Fields the handle has changed in the drag under way, told once it is let go. */
const _dragged = new Set<HTMLInputElement>();

/**
 * The handle moved something: the fields follow as it goes, and the scene
 * with them. Letting go tells everything else that watches the fields --
 * saving, the outdated results, the diagram -- once.
 */
function _writePose(target: EditTarget, pose: Pose, done: boolean): void {
  const prefix = _fieldPrefix(target);
  const places = Math.min(6, Math.max(0, Math.ceil(-Math.log10(sceneCell / 100))));
  const set = (id: string, value: number, digits: number): void => {
    const input = document.getElementById(id) as HTMLInputElement | null;
    if (!input) return;
    const text = String(Number(value.toFixed(digits)) || 0); // no "-0"
    if (Number(input.value) === Number(text)) return;
    input.value = text;
    _dragged.add(input);
  };
  ["x", "y", "z"].forEach((a, k) => {
    set(`${prefix}-loc-${a}`, pose.location[k], places);
  });
  if (canRotate(target)) {
    ["yaw", "pitch", "roll"].forEach((a, k) => {
      set(`${prefix}-rot-${a}`, pose.rotation[k], 1);
    });
  }
  updateScene();
  if (!done) return;
  _dragged.forEach((input) => {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  _dragged.clear();
}

// Called as the scene is first drawn, so it finds its elements itself
function _showEditBar(target: EditTarget | null, mode: EditMode): void {
  const bar = byId("scene-edit");
  bar.classList.toggle("hidden", !target);
  if (!target) return;
  bar.dataset.kind = target.kind;
  const i = target.index ?? 0;
  byId("scene-edit-name").textContent =
    target.kind === "radar" ? "Radar" : target.kind === "point" ? `T${i + 1}` : `M${i + 1}`;
  bar.querySelectorAll<HTMLButtonElement>("[data-edit-mode]").forEach((btn) => {
    btn.setAttribute("aria-checked", String(btn.dataset.editMode === mode));
    btn.disabled = btn.dataset.editMode === "rotate" && !canRotate(target);
  });
}

document.querySelectorAll<HTMLButtonElement>("#scene-edit [data-edit-mode]").forEach((btn) => {
  btn.addEventListener("click", () => sceneView?.setEditMode(btn.dataset.editMode as EditMode));
});
byId("btn-scene-edit-done").addEventListener("click", () => sceneView?.setEditTarget(null));

// The handle follows what is picked in the panel it belongs to: onto another
// target or the platform, and away when something it cannot move is picked
document.addEventListener("outlineselect", (e) => {
  const current = sceneView?.getEditTarget();
  if (!current) return;
  const next = (e as CustomEvent<Selection>).detail;
  const onTargets = (k: string): boolean => k === "point" || k === "mesh";
  if (onTargets(next.kind) !== onTargets(current.kind)) return;
  sceneView?.setEditTarget(
    next.kind === "radar" || onTargets(next.kind) ? { kind: next.kind as EditTarget["kind"], index: next.index } : null,
  );
});

// --- Stage Views ---
function _resizePlots(root: ParentNode): void {
  root.querySelectorAll(".js-plotly-plot").forEach((plot) => {
    Plotly.Plots.resize(plot as HTMLElement);
  });
}

document.querySelectorAll<HTMLButtonElement>("button[data-view]").forEach((btn) => {
  btn.addEventListener("click", () => setStageView(btn.dataset.view as StageView));
});

document.addEventListener("stageview", (e) => {
  const view = (e as CustomEvent<StageView>).detail;
  if (isResultView(view)) {
    renderResultView();
    const active = document.querySelector(".stage-view.active");
    if (active) _resizePlots(active);
  } else {
    sceneView?.setFraming(view as SceneFraming);
  }
});

document.querySelectorAll<HTMLButtonElement>("button[data-cam]").forEach((btn) => {
  btn.addEventListener("click", () => sceneView?.setCamera(btn.dataset.cam as CameraPreset));
});
byId("btn-scene-fit").addEventListener("click", () => sceneView?.fit());

// --- Panels ---
// Panels fold away, and start as they were left.
// In a column marked as an accordion (the left one: Radar and Targets) one
// panel is open at a time: opening one folds the rest.
function _accordionSiblings(panel: HTMLDetailsElement): HTMLDetailsElement[] {
  const col = panel.closest<HTMLElement>(".hud-col[data-accordion]");
  return col
    ? Array.from(col.querySelectorAll<HTMLDetailsElement>(":scope > details[data-panel]")).filter((p) => p !== panel)
    : [];
}

document.querySelectorAll<HTMLDetailsElement>("details[data-panel]").forEach((panel) => {
  const name = panel.dataset.panel;
  if (!name) return;
  panel.open = pref(`panel.${name}`, panel.open);
  panel.addEventListener("toggle", () => {
    setPref(`panel.${name}`, panel.open);
    if (panel.open) {
      _accordionSiblings(panel).forEach((p) => {
        p.open = false;
      });
      // A folded panel had nothing to draw its plots into
      redrawInspectorPlots();
    }
    placeColumnGrips();
    // The coverage fans show only while the Radar panel is open
    if (panel.id === "panel-radar") syncCoverageFocus();
    // Nor does the handle stay on something whose fields have been folded away
    const editing = sceneView?.getEditTarget();
    if (!panel.open && editing && _editPanel(editing) === panel.id) sceneView?.setEditTarget(null);
  });
});
// Saved from before there was an accordion, two may start open: keep the first
document.querySelectorAll<HTMLElement>(".hud-col[data-accordion]").forEach((col) => {
  col.querySelectorAll<HTMLDetailsElement>(":scope > details[data-panel][open]").forEach((p, i) => {
    if (i > 0) p.open = false;
  });
});
initColumnResize();

// --- Layout ---
// The panels lie over the stage: tell the 3D view how much of it they cover,
// and re-fit the plot between them when that changes.
const _resizeStagePlots = debounce(() => {
  const active = document.querySelector(".stage-view.active");
  if (active) _resizePlots(active);
}, 100);

function _layout(): void {
  sceneView?.setInsets(layoutStage());
  placeColumnGrips();
  _resizeStagePlots();
}

// On the next frame: laying out moves things the observer is watching
const _sizes = new ResizeObserver(() => requestAnimationFrame(_layout));
document.querySelectorAll("#stage, .hud-col, #titlebar, .stage-bottom").forEach((elem) => {
  _sizes.observe(elem);
});

// --- Keyboard ---
window.addEventListener("keydown", (e) => {
  const dialogs = document.querySelectorAll(".dialog-overlay:not(.hidden)");
  if (e.key === "Escape") {
    dialogs.forEach((d) => {
      d.classList.add("hidden");
    });
  } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && dialogs.length === 0) {
    e.preventDefault();
    (document.getElementById("btn-run-sim") as HTMLButtonElement).click();
  }
});

// --- Custom Number Input Spinners ---
document.querySelectorAll('input[type="number"]:not([readonly])').forEach((input) => {
  const parent = input.parentNode;
  if (!parent) return;
  const next = input.nextSibling;
  const wrapper = wrapNumberInput(input as HTMLInputElement);
  parent.insertBefore(wrapper, next);
});

// --- TX Bandwidth / Sweep Info ---
const debouncedUpdateTxInfo = debounce(updateTxInfo);
const debouncedUpdateTxWaveformPlot = debounce(updateTxWaveformPlot);

["tx-f-start", "tx-f-end", "tx-t-start", "tx-t-end"].forEach((id) => {
  byId(id).addEventListener("input", debouncedUpdateTxInfo);
});
byId("tx-prp").addEventListener("input", debouncedUpdateTxWaveformPlot);

const debouncedUpdateReadout = debounce(updateReadout);
["tx-prp", "tx-pulses", "rx-fs"].forEach((id) => {
  byId(id).addEventListener("input", debouncedUpdateReadout);
});

// --- Radar Input Listeners ---
const debouncedUpdateScene = debounce(updateScene);
["radar-loc-x", "radar-loc-y", "radar-loc-z", "radar-rot-yaw", "radar-rot-pitch", "radar-rot-roll"].forEach((id) => {
  document.getElementById(id)?.addEventListener("input", debouncedUpdateScene);
});

// --- Run menu: Save, Load, Reset and About, dropped from the button beside Run ---
{
  const toggle = document.getElementById("btn-run-menu") as HTMLButtonElement;
  const menu = byId("run-menu");
  const items = () => [...menu.querySelectorAll<HTMLButtonElement>(".menu-item:not(:disabled)")];
  const isOpen = () => !menu.classList.contains("hidden");

  const open = (focusFirst: boolean) => {
    menu.classList.remove("hidden");
    toggle.setAttribute("aria-expanded", "true");
    if (focusFirst) items()[0]?.focus();
  };
  const close = (refocus: boolean) => {
    if (!isOpen()) return;
    menu.classList.add("hidden");
    toggle.setAttribute("aria-expanded", "false");
    if (refocus) toggle.focus();
  };

  // A keyboard press (detail 0) moves focus into the menu; a mouse click leaves it on the button
  toggle.addEventListener("click", (e) => (isOpen() ? close(false) : open(e.detail === 0)));
  toggle.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      open(false);
      const list = items();
      list[e.key === "ArrowDown" ? 0 : list.length - 1]?.focus();
    } else if (e.key === "Escape" && isOpen()) {
      e.stopPropagation();
      close(false);
    }
  });

  // Each item's own handler runs first; then the menu folds away
  menu.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".menu-item")) close(false);
  });
  menu.addEventListener("keydown", (e) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const go = (n: number) => {
      e.preventDefault();
      list[(n + list.length) % list.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(list.length - 1);
    else if (e.key === "Escape") {
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") close(false);
  });

  document.addEventListener("pointerdown", (e) => {
    if (isOpen() && !menu.contains(e.target as Node) && !toggle.contains(e.target as Node)) close(false);
  });
  window.addEventListener("blur", () => close(false));
  window.addEventListener("resize", () => close(false));
}

// --- Reset ---
byId("btn-reset-config").addEventListener("click", () => {
  byId("reset-dialog-overlay").classList.remove("hidden");
});

["btn-reset-cancel", "btn-reset-cancel-x"].forEach((id) => {
  byId(id).addEventListener("click", () => {
    byId("reset-dialog-overlay").classList.add("hidden");
  });
});

byId("btn-reset-confirm").addEventListener("click", () => {
  byId("reset-dialog-overlay").classList.add("hidden");
  resetToDefault();
});

// Range Profile ↔ Range-Doppler dependency
byId("proc-range-doppler").addEventListener("change", (e) => {
  const rpCheckbox = document.getElementById("proc-range-profile") as HTMLInputElement;
  if ((e.target as HTMLInputElement).checked) {
    rpCheckbox.checked = true;
  }
  _syncProcSubOptions();
});
byId("proc-range-profile").addEventListener("change", (e) => {
  const rdCheckbox = document.getElementById("proc-range-doppler") as HTMLInputElement;
  if (!(e.target as HTMLInputElement).checked && rdCheckbox.checked) {
    rdCheckbox.checked = false;
  }
  _syncProcSubOptions();
});

function _isPow2(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

function _validateFftInput(inputEl: HTMLInputElement, minVal: number, label: string): boolean {
  const val = parseInt(inputEl.value, 10);
  let msg = "";
  if (!_isPow2(val)) msg = `${label} must be a power of 2`;
  else if (val < minVal) msg = `${label} must be \u2265 ${minVal} (next: ${_nextPow2UI(minVal)})`;
  const wrap = inputEl.closest(".proc-sub-input-wrap");
  inputEl.classList.toggle("is-invalid", !!msg);
  if (wrap) {
    if (msg) wrap.setAttribute("data-error", msg);
    else wrap.removeAttribute("data-error");
  }
  return !msg;
}

function _validateFftInputs(): void {
  const tStart = parseFloat((document.getElementById("tx-t-start") as HTMLInputElement).value) || 0;
  const tEnd = parseFloat((document.getElementById("tx-t-end") as HTMLInputElement).value) || 0;
  const fs = (parseFloat((document.getElementById("rx-fs") as HTMLInputElement).value) || 2) * 1e6;
  const pulses = parseInt((document.getElementById("tx-pulses") as HTMLInputElement).value, 10) || 1;
  const spp = Math.ceil(Math.abs(tEnd - tStart) * 1e-6 * fs) || 1;
  if ((document.getElementById("proc-rd-range-fft-enable") as HTMLInputElement).checked) {
    _validateFftInput(document.getElementById("proc-rd-range-fft") as HTMLInputElement, spp, "Range FFT");
  }
  if ((document.getElementById("proc-rd-doppler-fft-enable") as HTMLInputElement).checked) {
    _validateFftInput(document.getElementById("proc-rd-doppler-fft") as HTMLInputElement, pulses, "Doppler FFT");
  }
}

// Custom FFT size toggles
["proc-rd-range-fft", "proc-rd-doppler-fft"].forEach((id) => {
  const enableCb = document.getElementById(`${id}-enable`) as HTMLInputElement;
  const input = document.getElementById(id) as HTMLInputElement;
  enableCb.addEventListener("change", () => {
    input.disabled = !enableCb.checked;
    if (!enableCb.checked) {
      input.classList.remove("is-invalid");
      const wrap = input.closest(".proc-sub-input-wrap");
      if (wrap) wrap.removeAttribute("data-error");
      _updateAutoFftValues();
    } else {
      _validateFftInputs();
    }
  });
  input.addEventListener("input", _validateFftInputs);
});

function _nextPow2UI(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

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
  byId("proc-range-profile-opts").classList.toggle("disabled", !rpOn);
  byId("proc-range-doppler-opts").classList.toggle("disabled", !rdOn);
  if (!rpOn) {
    (document.getElementById("proc-rd-range-fft-enable") as HTMLInputElement).checked = false;
    const rpFft = document.getElementById("proc-rd-range-fft") as HTMLInputElement;
    rpFft.disabled = true;
    rpFft.classList.remove("is-invalid");
    const rpWrap = rpFft.closest(".proc-sub-input-wrap");
    if (rpWrap) rpWrap.removeAttribute("data-error");
  }
  if (!rdOn) {
    (document.getElementById("proc-rd-doppler-fft-enable") as HTMLInputElement).checked = false;
    const rdFft = document.getElementById("proc-rd-doppler-fft") as HTMLInputElement;
    rdFft.disabled = true;
    rdFft.classList.remove("is-invalid");
    const rdWrap = rdFft.closest(".proc-sub-input-wrap");
    if (rdWrap) rdWrap.removeAttribute("data-error");
  }
  _updateAutoFftValues();
}

// Bring the processing options in line with their checkboxes: at startup, and
// after a configuration is applied, which sets the fields without events.
function _syncProcessing(): void {
  const rdCb = document.getElementById("proc-range-doppler") as HTMLInputElement;
  const rpCb = document.getElementById("proc-range-profile") as HTMLInputElement;
  if (rdCb.checked) {
    rpCb.checked = true;
  }
  _syncProcSubOptions();
  ["proc-rd-range-fft", "proc-rd-doppler-fft"].forEach((id) => {
    const enabled = (document.getElementById(`${id}-enable`) as HTMLInputElement).checked;
    (document.getElementById(id) as HTMLInputElement).disabled = !enabled;
  });
}
_syncProcessing();
document.addEventListener("configapplied", _syncProcessing);

// --- Add Buttons ---
// What is added is picked in the outline, so its fields come up to be filled in.

byId("btn-add-tx-ch").addEventListener("click", () => {
  saveTxChannelStates();
  txChannels.push({});
  renderTxChannels();
  select({ kind: "tx", index: txChannels.length - 1 });
  markResultsOutdated();
  debouncedAutoSave();
});

byId("btn-add-rx-ch").addEventListener("click", () => {
  saveRxChannelStates();
  rxChannels.push({});
  renderRxChannels();
  select({ kind: "rx", index: rxChannels.length - 1 });
  markResultsOutdated();
  debouncedAutoSave();
});

byId("btn-add-point-target").addEventListener("click", () => {
  savePointTargetStates();
  pointTargets.push({ location: [10, 0, 0], rcs: 20, speed: [0, 0, 0], phase: 0 });
  renderPointTargets();
  select({ kind: "point", index: pointTargets.length - 1 });
  markResultsOutdated();
  debouncedAutoSave();
});

byId("btn-add-mesh-target").addEventListener("click", () => {
  saveMeshTargetStates();
  meshTargets.push({});
  renderMeshTargets();
  select({ kind: "mesh", index: meshTargets.length - 1 });
  markResultsOutdated();
  debouncedAutoSave();
});

// --- Run Simulation ---
const busy = createBusyAnimation(document.getElementById("sim-canvas") as HTMLCanvasElement);

byId("btn-run-sim").addEventListener("click", async () => {
  const btn = document.getElementById("btn-run-sim") as HTMLButtonElement;
  const status = byId("sim-status");

  _validateFftInputs();
  if (document.querySelector("#proc-range-profile-opts .is-invalid, #proc-range-doppler-opts .is-invalid")) {
    status.className = "status-msg error";
    status.textContent = "Invalid FFT size. Fix the errors above before running.";
    return;
  }

  btn.disabled = true;
  status.className = "status-msg running";
  status.textContent = "Running simulation...";

  const overlay = byId("sim-overlay");
  const overlaySub = byId("sim-overlay-sub");
  overlaySub.textContent = "";

  overlay.classList.remove("hidden");
  overlay.classList.remove("sim-visible");
  const _overlayRevealTimer = setTimeout(() => {
    overlay.classList.add("sim-visible");
    busy.start();
  }, 400);

  try {
    const config = collectConfig();

    if (config.targets.length === 0) {
      throw new Error("No targets defined. Add at least one point or mesh target.");
    }

    const result = await window.api.runSimulation(config);

    if (!result.success || !result.data) {
      throw new Error(result.error ?? "The simulation returned no result.");
    }

    const _resultData = result.data;
    lastSimResult = _resultData;
    status.className = "status-msg success";
    status.textContent = `Simulation complete. Baseband shape: [${_resultData.baseband_shape.join(" × ")}]`;
    (document.getElementById("btn-export") as HTMLButtonElement).disabled = false;

    // Bring up the most processed result the run produced
    setResultViewsAvailable({
      baseband: !!_resultData.baseband,
      "range-profile": !!_resultData.range_profile,
      "range-doppler": !!_resultData.range_doppler,
    });
    setStageView(
      _resultData.range_doppler ? "range-doppler" : _resultData.range_profile ? "range-profile" : "baseband",
    );
    setTimeout(() => plotResults(_resultData), 0);
  } catch (err) {
    status.className = "status-msg error";
    status.textContent = `Error: ${(err as Error).message}`;
  } finally {
    btn.disabled = false;
    clearTimeout(_overlayRevealTimer);
    const wasVisible = overlay.classList.contains("sim-visible");
    overlay.classList.remove("sim-visible");
    if (wasVisible) {
      setTimeout(() => {
        overlay.classList.add("hidden");
        busy.stop();
      }, 270);
    } else {
      overlay.classList.add("hidden");
    }
  }
});

// --- Export ---
byId("btn-export").addEventListener("click", async () => {
  if (!lastSimResult) return;
  await window.api.exportResults(lastSimResult);
});

// --- About ---
// Fields from radarsimc's Get_License_Info, in display order, with our labels.
// "License Status" and "Current Platform" are left out: the status line above
// already says the first, and the second is just this machine.
const LICENSE_FIELDS: [key: string, label: string][] = [
  ["Licensed to", "Licensed to"],
  ["Organization", "Organization"],
  ["Email", "Email"],
  ["Product", "Product"],
  ["License Type", "Type"],
  ["License Platform", "Platform"],
];

function renderLicenseStatus(licensed: boolean, info: Record<string, string> = {}): void {
  const licenseEl = document.getElementById("about-license") as HTMLElement;
  const detailsEl = document.getElementById("about-license-details") as HTMLElement;
  licenseEl.textContent = licensed ? "License: Active" : "License: Unlicensed";
  licenseEl.style.color = licensed ? "var(--ok)" : "var(--danger)";

  detailsEl.replaceChildren();
  const rows: [string, string][] = [];
  for (const [key, label] of LICENSE_FIELDS) {
    const v = info[key];
    if (!v) continue;
    rows.push([label, key === "License Type" ? v.charAt(0).toUpperCase() + v.slice(1) : v]);
  }
  const days = Number(info["Days Remaining"]);
  // radarsimc gives whole days left, not a date; a date rebuilt from that
  // could be a day early, so show the count as given.
  if (info["Days Remaining"] && Number.isFinite(days)) {
    rows.push(["Expires", `in ${days} day${days === 1 ? "" : "s"}`]);
  }
  for (const [label, value] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    detailsEl.append(dt, dd);
  }
  // Details start collapsed behind a toggle; it only appears when there is
  // something to show.
  const toggleEl = document.getElementById("btn-license-details") as HTMLElement;
  toggleEl.classList.toggle("hidden", !licensed || rows.length === 0);
  setLicenseDetailsExpanded(false);
}

function setLicenseDetailsExpanded(expanded: boolean): void {
  const toggleEl = byId("btn-license-details");
  toggleEl.setAttribute("aria-expanded", String(expanded));
  toggleEl.textContent = expanded ? "Hide details" : "Show details";
  byId("about-license-details").classList.toggle("hidden", !expanded);
}

byId("btn-license-details").addEventListener("click", (e) => {
  const expanded = (e.currentTarget as HTMLElement).getAttribute("aria-expanded") === "true";
  setLicenseDetailsExpanded(!expanded);
});

byId("btn-check-env").addEventListener("click", async () => {
  const overlay = byId("about-dialog-overlay");
  const versionEl = byId("about-version");
  const licenseEl = byId("about-license");
  const yearEl = byId("about-year");
  yearEl.textContent = String(new Date().getFullYear());
  versionEl.textContent = "Checking...";
  licenseEl.textContent = "";
  byId("btn-license-details").classList.add("hidden");
  setLicenseDetailsExpanded(false);
  overlay.classList.remove("hidden");

  try {
    const [appVersion, result] = await Promise.all([window.api.getAppVersion(), window.api.checkLibrary()]);
    if (result.success && result.data) {
      const d = result.data;
      if (d.radarsimlib_available) {
        versionEl.textContent = `RadarSimApp v${appVersion} — RadarSimLib v${d.radarsimlib_version}`;
        renderLicenseStatus(d.licensed, d.license_info);
        byId("btn-activate").classList.toggle("hidden", d.licensed);
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
byId("btn-activate").addEventListener("click", () => {
  byId("license-dialog-status").textContent = "";
  byId("license-dialog-overlay").classList.remove("hidden");
});

byId("btn-about-close").addEventListener("click", () => {
  byId("about-dialog-overlay").classList.add("hidden");
});

byId("reset-dialog-overlay").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) (e.currentTarget as HTMLElement).classList.add("hidden");
});

byId("about-dialog-overlay").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) (e.currentTarget as HTMLElement).classList.add("hidden");
});

// --- Check license on startup ---
(async () => {
  try {
    const result = await window.api.checkLibrary();
    if (result.success && result.data) {
      const licensed = result.data.licensed;
      byId("btn-activate").classList.toggle("hidden", licensed);
      if (!licensed) {
        byId("license-dialog-overlay").classList.remove("hidden");
      }
    }
  } catch (_) {
    /* ignore */
  }
})();

// --- License dialog handlers ---
async function _doLicenseActivation(): Promise<void> {
  const statusEl = byId("license-dialog-status");
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
      byId("license-dialog-overlay").classList.add("hidden");
      byId("btn-activate").classList.add("hidden");
      const info = await window.api.checkLibrary().catch(() => null);
      renderLicenseStatus(true, info?.success ? info.data?.license_info : undefined);
    } else {
      statusEl.textContent = result.error || "Activation failed. Please check the license file.";
      (statusEl as HTMLElement).style.color = "var(--danger)";
    }
  } catch (err) {
    statusEl.textContent = `Error: ${(err as Error).message}`;
    (statusEl as HTMLElement).style.color = "var(--danger)";
  } finally {
    btn.disabled = false;
  }
}

byId("btn-license-select").addEventListener("click", _doLicenseActivation);
byId("btn-license-cancel").addEventListener("click", () => {
  byId("license-dialog-overlay").classList.add("hidden");
});
byId("btn-license-close").addEventListener("click", () => {
  byId("license-dialog-overlay").classList.add("hidden");
});

// --- Initialize Application ---
initOutline();
initApp();
setStageView(pref<StageView>("view", "scene"));
_layout();
redrawInspectorPlots();
