// ===== RadarSimApp - State Persistence =====
// The whole configuration as one object: kept in localStorage as it is edited,
// saved to and loaded from files, and put back into the form.

import { renderChannels, saveChannelStates } from "./channels.js";
import { clearResultPlots, updateTxInfo } from "./plots.js";
import { updateScene } from "./scene.js";
import { meshTargets, newPointTarget, pointTargets, rxChannels, txChannels } from "./shared.js";
import { renderMeshTargets, renderPointTargets, saveMeshTargetStates, savePointTargetStates } from "./targets.js";
import { byId, debounce } from "./utils.js";

const STATE_KEY = "radarsimapp_state";

export function defaultState(): AppState {
  return {
    fields: {
      "tx-f-start": "24",
      "tx-f-end": "24.5",
      "tx-t-start": "0",
      "tx-t-end": "80",
      "tx-pulses": "256",
      "tx-prp": "100",
      "tx-power": "0",
      "rx-fs": "2",
      "rx-bb-type": "complex",
      "rx-nf": "10",
      "rx-rf-gain": "0",
      "rx-bb-gain": "0",
      "rx-load-r": "500",
      "rx-gate-delay": "0",
      "radar-loc-x": "0",
      "radar-loc-y": "0",
      "radar-loc-z": "0",
      "radar-spd-x": "0",
      "radar-spd-y": "0",
      "radar-spd-z": "0",
      "radar-rot-yaw": "0",
      "radar-rot-pitch": "0",
      "radar-rot-roll": "0",
      "radar-rr-yaw": "0",
      "radar-rr-pitch": "0",
      "radar-rr-roll": "0",
      "sim-density": "1",
      "sim-level": "frame",
      "proc-noise": true,
      "proc-range-doppler": true,
      "proc-rd-range-fft-enable": false,
      "proc-rd-range-fft": "128",
      "proc-rd-doppler-fft-enable": false,
      "proc-rd-doppler-fft": "256",
    },
    txChannels: [{ location: [0, 0, 0] }],
    rxChannels: [{ location: [0, 0, 0] }],
    pointTargets: [newPointTarget()],
    meshTargets: [],
  };
}

export function resetToDefault(): void {
  localStorage.removeItem(STATE_KEY);
  applyState(defaultState());
  clearResultPlots();
}

/** The fixed fields whose value is saved: every one in the page that is not a checkbox. */
const STATIC_FIELDS: string[] = [
  "tx-f-start",
  "tx-f-end",
  "tx-t-start",
  "tx-t-end",
  "tx-pulses",
  "tx-prp",
  "tx-power",
  "rx-fs",
  "rx-bb-type",
  "rx-nf",
  "rx-rf-gain",
  "rx-bb-gain",
  "rx-load-r",
  "rx-gate-delay",
  "radar-loc-x",
  "radar-loc-y",
  "radar-loc-z",
  "radar-spd-x",
  "radar-spd-y",
  "radar-spd-z",
  "radar-rot-yaw",
  "radar-rot-pitch",
  "radar-rot-roll",
  "radar-rr-yaw",
  "radar-rr-pitch",
  "radar-rr-roll",
  "sim-density",
  "sim-level",
  "proc-rd-range-fft",
  "proc-rd-doppler-fft",
];

const CHECKBOX_FIELDS: string[] = [
  "proc-noise",
  "proc-range-doppler",
  "proc-range-profile",
  "proc-rd-range-fft-enable",
  "proc-rd-doppler-fft-enable",
];

export function captureState(): AppState {
  saveChannelStates("tx");
  saveChannelStates("rx");
  savePointTargetStates();
  saveMeshTargetStates();

  const fields: Record<string, string | boolean> = {};
  STATIC_FIELDS.forEach((id) => {
    const elem = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (elem) fields[id] = elem.value;
  });
  CHECKBOX_FIELDS.forEach((id) => {
    const elem = document.getElementById(id) as HTMLInputElement | null;
    if (elem) fields[id] = elem.checked;
  });

  // Copied through JSON, as the state will be written: unset values drop out
  return JSON.parse(JSON.stringify({ fields, txChannels, rxChannels, pointTargets, meshTargets }));
}

/** Replace a list's entries in place: the other modules hold on to the array itself. */
function _replace<T>(list: T[], next: T[] | undefined): void {
  if (Array.isArray(next)) list.splice(0, list.length, ...next);
}

export function applyState(state: Partial<AppState> | null | undefined): void {
  if (!state) return;

  const fields = state.fields;
  if (fields) {
    STATIC_FIELDS.forEach((id) => {
      if (id in fields) {
        const elem = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
        if (elem) elem.value = fields[id] as string;
      }
    });
    CHECKBOX_FIELDS.forEach((id) => {
      if (id in fields) {
        const elem = document.getElementById(id) as HTMLInputElement | null;
        if (elem) elem.checked = !!fields[id];
      }
    });
  }

  _replace(txChannels, state.txChannels);
  _replace(rxChannels, state.rxChannels);
  _replace(pointTargets, state.pointTargets);
  _replace(meshTargets, state.meshTargets);

  renderChannels("tx");
  renderChannels("rx");
  renderPointTargets();
  renderMeshTargets();

  updateTxInfo();
  updateScene();
  // Fields were set without events; let whatever mirrors them catch up.
  document.dispatchEvent(new CustomEvent("configapplied"));
}

export const debouncedAutoSave = debounce(() => {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(captureState()));
  } catch (_) {}
}, 500);

export function validateState(input: unknown): asserts input is AppState {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("File does not contain a valid configuration object.");
  }
  const state = input as Record<string, unknown>;
  const required = ["fields", "txChannels", "rxChannels", "pointTargets", "meshTargets"];
  for (const key of required) {
    if (!(key in state)) {
      throw new Error(`Missing required section "${key}". This file may not be a RadarSimApp configuration.`);
    }
  }
  for (const key of ["txChannels", "rxChannels", "pointTargets", "meshTargets"]) {
    if (!Array.isArray(state[key])) {
      throw new Error(`Expected "${key}" to be an array, got ${typeof state[key]}.`);
    }
  }
  if (!state.fields || typeof state.fields !== "object" || Array.isArray(state.fields)) {
    throw new Error('Expected "fields" to be an object.');
  }
}

async function loadConfigFromFile(): Promise<boolean> {
  const raw = await window.api.loadConfig();
  if (!raw) return false;
  let state: unknown;
  try {
    state = JSON.parse(raw);
  } catch (e) {
    throw new Error(`File is not valid JSON: ${(e as Error).message}`);
  }
  validateState(state);
  applyState(state);
  debouncedAutoSave();
  return true;
}

/** Show a message by the Save and Load buttons for a while. */
function _flashStatus(text: string, kind: "ok" | "err", ms: number): void {
  const status = byId("config-status");
  status.textContent = text;
  status.className = `config-status ${kind}`;
  setTimeout(() => {
    status.textContent = "";
    status.className = "config-status";
  }, ms);
}

/** Run a Save/Load button's action with the button disabled until it is done. */
function _onButton(id: string, action: () => Promise<void>): void {
  const btn = byId<HTMLButtonElement>(id);
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      await action();
    } finally {
      btn.disabled = false;
    }
  });
}

// --- Application Init ---
export function initApp(): void {
  _onButton("btn-save-config", async () => {
    try {
      if (await window.api.saveConfig(JSON.stringify(captureState(), null, 2))) {
        _flashStatus("Config saved.", "ok", 3000);
      }
    } catch (_) {
      _flashStatus("Save failed.", "err", 3000);
    }
  });

  _onButton("btn-load-config", async () => {
    try {
      if (await loadConfigFromFile()) _flashStatus("Config loaded.", "ok", 3000);
    } catch (err) {
      _flashStatus((err as Error).message, "err", 6000);
    }
  });

  let restored = false;
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      applyState(JSON.parse(raw));
      restored = true;
    }
  } catch (_) {}
  if (!restored) applyState(defaultState());

  document.addEventListener("input", debouncedAutoSave);
  document.addEventListener("change", debouncedAutoSave);

  const startupOverlay = document.getElementById("startup-overlay");
  if (startupOverlay) {
    startupOverlay.classList.add("startup-fade-out");
    startupOverlay.addEventListener("transitionend", () => startupOverlay.remove(), { once: true });
  }
}
