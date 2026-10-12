// ===== RadarSimApp - Stage Views, Layout and UI Preferences =====

// --- UI preferences ---
// Kept apart from the configuration state: which panels are folded and which
// view is up say nothing about the radar, and must not travel with a saved file.
const PREF_PREFIX = "radarsimapp_ui.";

export function pref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREF_PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

export function setPref(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREF_PREFIX + key, JSON.stringify(value));
  } catch (_) { }
}

// --- Stage views ---
// "scene" and "array" are two framings of the one 3D view; the rest are result
// plots, which take its place and exist only after a run.
export type StageView = "scene" | "array" | "baseband" | "range-profile" | "range-doppler";

export const RESULT_VIEWS: StageView[] = ["baseband", "range-profile", "range-doppler"];

let _view: StageView = "scene";

export function stageView(): StageView {
  return _view;
}

export function isResultView(view: StageView): boolean {
  return RESULT_VIEWS.includes(view);
}

function _viewButton(view: StageView): HTMLButtonElement | null {
  return document.querySelector(`button[data-view="${view}"]`);
}

export function setStageView(view: StageView): void {
  if (_viewButton(view)?.disabled) view = "scene";
  _view = view;

  const stage = document.getElementById("stage");
  if (stage) stage.dataset.view = view;
  document.querySelectorAll<HTMLElement>(".stage-view").forEach((v) => {
    v.classList.toggle("active", v.dataset.view === view);
  });
  document.querySelectorAll<HTMLElement>("button[data-view]").forEach((b) => {
    b.setAttribute("aria-checked", String(b.dataset.view === view));
  });

  if (!isResultView(view)) setPref("view", view);
  document.dispatchEvent(new CustomEvent("stageview", { detail: view }));
}

/** Enable the result views a run produced; leave one that no longer exists. */
export function setResultViewsAvailable(available: Partial<Record<StageView, boolean>>): void {
  RESULT_VIEWS.forEach((view) => {
    const btn = _viewButton(view);
    if (btn) btn.disabled = !available[view];
  });
  if (isResultView(_view) && !available[_view]) setStageView(pref<StageView>("view", "scene"));
}

// --- Layout ---
export interface StageInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * The panels lie over the stage. Measure how much of it each side covers, so
 * the 3D view can centre itself in what is left and the plots can sit there.
 */
export function layoutStage(): StageInsets {
  const stage = document.getElementById("stage");
  const width = stage?.clientWidth ?? 0;
  const left = document.querySelector<HTMLElement>(".hud-left");
  const right = document.querySelector<HTMLElement>(".hud-right");
  const insets: StageInsets = {
    left: left?.offsetWidth ? left.offsetLeft + left.offsetWidth : 0,
    right: right?.offsetWidth ? width - right.offsetLeft : 0,
    top: document.getElementById("titlebar")?.offsetHeight ?? 0,
    bottom: document.querySelector<HTMLElement>(".stage-bottom")?.offsetHeight ?? 0,
  };
  const root = document.documentElement.style;
  root.setProperty("--inset-l", insets.left + "px");
  root.setProperty("--inset-r", insets.right + "px");
  return insets;
}
