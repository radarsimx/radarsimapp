// ===== RadarSimApp - Main Renderer Script =====
// The renderer's entry point: wires the stage, the panels and the Run button,
// and starts the modules that own the rest.

import { createBusyAnimation } from "./busy.js";
import { addChannel } from "./channels.js";
import { initColumnResize, place as placeColumnGrips } from "./colresize.js";
import { collectConfig } from "./config.js";
import { initLicense } from "./license.js";
import { initOutline, type Selection, select, syncCoverageFocus } from "./outline.js";
import { plotResults, redrawInspectorPlots, renderResultView, updateTxInfo, updateTxWaveformPlot } from "./plots.js";
import { initProcessing, processingIsValid } from "./processing.js";
import { formatLength, updateReadout } from "./readout.js";
import { initRunMenu } from "./runmenu.js";
import { type Pose, setSceneSink, updateScene } from "./scene.js";
import {
  type CameraPreset,
  canRotate,
  type EditMode,
  type EditTarget,
  type SceneFraming,
  SceneView,
} from "./scene3d.js";
import {
  isResultView,
  layoutStage,
  pref,
  type StageView,
  setPref,
  setResultViewsAvailable,
  setStageView,
} from "./stage.js";
import { initApp, resetToDefault } from "./state.js";
import { addMeshTarget, addPointTarget } from "./targets.js";
import { initTitlebar } from "./titlebar.js";
import { byId, debounce, wrapNumberInput, XYZ, YPR } from "./utils.js";

initTitlebar();

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
  XYZ.forEach((a, k) => {
    set(`${prefix}-loc-${a}`, pose.location[k], places);
  });
  if (canRotate(target)) {
    YPR.forEach((a, k) => {
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
function _resizeActivePlot(): void {
  document.querySelectorAll(".stage-view.active .js-plotly-plot").forEach((plot) => {
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
    _resizeActivePlot();
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
const _resizeStagePlots = debounce(_resizeActivePlot, 100);

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
    byId("btn-run-sim").click();
  }
});

// --- Custom Number Input Spinners ---
// The fields built later (channels, targets) are wrapped as they are made
document.querySelectorAll<HTMLInputElement>('input[type="number"]:not([readonly])').forEach((input) => {
  const parent = input.parentNode;
  if (!parent) return;
  const next = input.nextSibling;
  parent.insertBefore(wrapNumberInput(input), next);
});

// --- What follows the waveform fields ---
const debouncedUpdateTxInfo = debounce(updateTxInfo);
["tx-f-start", "tx-f-end", "tx-t-start", "tx-t-end"].forEach((id) => {
  byId(id).addEventListener("input", debouncedUpdateTxInfo);
});
byId("tx-prp").addEventListener("input", debounce(updateTxWaveformPlot));

const debouncedUpdateReadout = debounce(updateReadout);
["tx-prp", "tx-pulses", "rx-fs"].forEach((id) => {
  byId(id).addEventListener("input", debouncedUpdateReadout);
});

const debouncedUpdateScene = debounce(updateScene);
[...XYZ.map((a) => `radar-loc-${a}`), ...YPR.map((a) => `radar-rot-${a}`)].forEach((id) => {
  document.getElementById(id)?.addEventListener("input", debouncedUpdateScene);
});

// --- Dialogs ---
function _closeOnBackdrop(id: string): void {
  byId(id).addEventListener("click", (e) => {
    if (e.target === e.currentTarget) (e.currentTarget as HTMLElement).classList.add("hidden");
  });
}

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
_closeOnBackdrop("reset-dialog-overlay");
_closeOnBackdrop("about-dialog-overlay");

// --- Add Buttons ---
// What is added is picked in the outline, so its fields come up to be filled in.
byId("btn-add-tx-ch").addEventListener("click", () => addChannel("tx"));
byId("btn-add-rx-ch").addEventListener("click", () => addChannel("rx"));
byId("btn-add-point-target").addEventListener("click", addPointTarget);
byId("btn-add-mesh-target").addEventListener("click", addMeshTarget);

// --- Run Simulation ---
let lastSimResult: SimResult | null = null;
const busy = createBusyAnimation(byId<HTMLCanvasElement>("sim-canvas"));
/** The overlay comes up only for a run that lasts, so a quick one does not flash it. */
const OVERLAY_DELAY_MS = 400;
/** Just past the overlay's 0.25 s fade-out in styles.css. */
const OVERLAY_FADE_MS = 270;

byId("btn-run-sim").addEventListener("click", async () => {
  const btn = byId<HTMLButtonElement>("btn-run-sim");
  const status = byId("sim-status");

  if (!processingIsValid()) {
    status.className = "status-msg error";
    status.textContent = "Invalid FFT size. Fix the errors above before running.";
    return;
  }

  btn.disabled = true;
  status.className = "status-msg running";
  status.textContent = "Running simulation...";

  const overlay = byId("sim-overlay");
  byId("sim-overlay-sub").textContent = "";
  overlay.classList.remove("hidden", "sim-visible");
  const revealTimer = setTimeout(() => {
    overlay.classList.add("sim-visible");
    busy.start();
  }, OVERLAY_DELAY_MS);

  try {
    const config = collectConfig();
    if (config.targets.length === 0) {
      throw new Error("No targets defined. Add at least one point or mesh target.");
    }

    const result = await window.api.runSimulation(config);
    if (!result.success || !result.data) {
      throw new Error(result.error ?? "The simulation returned no result.");
    }

    const data = result.data;
    lastSimResult = data;
    status.className = "status-msg success";
    status.textContent = `Simulation complete. Baseband shape: [${data.baseband_shape.join(" × ")}]`;
    byId<HTMLButtonElement>("btn-export").disabled = false;

    // Bring up the most processed result the run produced
    setResultViewsAvailable({
      baseband: !!data.baseband,
      "range-profile": !!data.range_profile,
      "range-doppler": !!data.range_doppler,
    });
    setStageView(data.range_doppler ? "range-doppler" : data.range_profile ? "range-profile" : "baseband");
    setTimeout(() => plotResults(data), 0);
  } catch (err) {
    status.className = "status-msg error";
    status.textContent = `Error: ${(err as Error).message}`;
  } finally {
    btn.disabled = false;
    clearTimeout(revealTimer);
    const wasVisible = overlay.classList.contains("sim-visible");
    overlay.classList.remove("sim-visible");
    if (wasVisible) {
      setTimeout(() => {
        overlay.classList.add("hidden");
        busy.stop();
      }, OVERLAY_FADE_MS);
    } else {
      overlay.classList.add("hidden");
    }
  }
});

byId("btn-export").addEventListener("click", async () => {
  if (lastSimResult) await window.api.exportResults(lastSimResult);
});

// --- Initialize Application ---
initRunMenu();
initProcessing();
initLicense();
initOutline();
initApp();
setStageView(pref<StageView>("view", "scene"));
_layout();
redrawInspectorPlots();
