// ===== RadarSimApp - State Persistence =====

const STATE_KEY = "radarsimapp_state";

function defaultState(): AppState {
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
    pointTargets: [{ location: [10, 0, 0], rcs: 20, speed: [0, 0, 0], phase: 0 }],
    meshTargets: [],
  };
}

function resetToDefault(): void {
  localStorage.removeItem(STATE_KEY);
  applyState(defaultState());
  clearResultPlots();
}

const STATIC_FIELDS: string[] = [
  "tx-f-start", "tx-f-end", "tx-t-start", "tx-t-end",
  "tx-pulses", "tx-prp", "tx-power",
  "rx-fs", "rx-bb-type", "rx-nf", "rx-rf-gain", "rx-bb-gain", "rx-load-r",
  "radar-loc-x", "radar-loc-y", "radar-loc-z",
  "radar-spd-x", "radar-spd-y", "radar-spd-z",
  "radar-rot-yaw", "radar-rot-pitch", "radar-rot-roll",
  "radar-rr-yaw", "radar-rr-pitch", "radar-rr-roll",
  "sim-density", "sim-level",
  "proc-rd-range-fft", "proc-rd-doppler-fft",
];

const CHECKBOX_FIELDS: string[] = ["proc-noise", "proc-range-doppler", "proc-range-profile", "proc-rd-range-fft-enable", "proc-rd-doppler-fft-enable"];

function captureState(): AppState {
  saveTxChannelStates();
  saveRxChannelStates();
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

  return {
    fields,
    sidebarCollapsed: document.getElementById("app")!.classList.contains("sidebar-collapsed"),
    txChannels: JSON.parse(JSON.stringify(txChannels)),
    rxChannels: JSON.parse(JSON.stringify(rxChannels)),
    pointTargets: JSON.parse(JSON.stringify(pointTargets)),
    meshTargets: JSON.parse(JSON.stringify(meshTargets)),
  };
}

function applyState(state: AppState): void {
  if (!state) return;

  if (state.fields) {
    STATIC_FIELDS.forEach((id) => {
      if (id in state.fields) {
        const elem = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
        if (elem) elem.value = state.fields[id] as string;
      }
    });
    CHECKBOX_FIELDS.forEach((id) => {
      if (id in state.fields) {
        const elem = document.getElementById(id) as HTMLInputElement | null;
        if (elem) elem.checked = !!state.fields[id];
      }
    });
  }

  document.getElementById("app")!.classList.toggle("sidebar-collapsed", !!state.sidebarCollapsed);

  if (Array.isArray(state.txChannels)) txChannels.splice(0, txChannels.length, ...state.txChannels);
  if (Array.isArray(state.rxChannels)) rxChannels.splice(0, rxChannels.length, ...state.rxChannels);
  if (Array.isArray(state.pointTargets)) pointTargets.splice(0, pointTargets.length, ...state.pointTargets);
  if (Array.isArray(state.meshTargets)) meshTargets.splice(0, meshTargets.length, ...state.meshTargets);

  renderTxChannels();
  renderRxChannels();
  renderPointTargets();
  renderMeshTargets();

  updateTxInfo();
  updateRadarOverviewPlot();
}

const debouncedAutoSave = debounce(() => {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(captureState()));
  } catch (_) { }
}, 500);

function attachAutoSave(): void {
  document.addEventListener("input", debouncedAutoSave);
  document.addEventListener("change", debouncedAutoSave);
}

async function saveConfigToFile(): Promise<boolean> {
  const state = captureState();
  return window.api.saveConfig(JSON.stringify(state, null, 2));
}

function validateState(state: any): void {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("File does not contain a valid configuration object.");
  }
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
  if (typeof state.fields !== "object" || Array.isArray(state.fields)) {
    throw new Error('Expected "fields" to be an object.');
  }
}

async function loadConfigFromFile(): Promise<boolean> {
  const raw = await window.api.loadConfig();
  if (!raw) return false;
  let state: any;
  try {
    state = JSON.parse(raw);
  } catch (e) {
    throw new Error("File is not valid JSON: " + (e as Error).message);
  }
  validateState(state);
  applyState(state);
  debouncedAutoSave();
  return true;
}

// --- Config button event listeners ---
document.getElementById("btn-save-config")!.addEventListener("click", async () => {
  const btn = document.getElementById("btn-save-config") as HTMLButtonElement;
  const status = document.getElementById("config-status")!;
  btn.disabled = true;
  try {
    const saved = await saveConfigToFile();
    if (saved) {
      status.textContent = "Config saved.";
      status.className = "config-status ok";
    }
  } catch (_) {
    status.textContent = "Save failed.";
    status.className = "config-status err";
  } finally {
    btn.disabled = false;
    setTimeout(() => { status.textContent = ""; status.className = "config-status"; }, 3000);
  }
});

document.getElementById("btn-load-config")!.addEventListener("click", async () => {
  const btn = document.getElementById("btn-load-config") as HTMLButtonElement;
  const status = document.getElementById("config-status")!;
  btn.disabled = true;
  try {
    const loaded = await loadConfigFromFile();
    if (loaded) {
      status.textContent = "Config loaded.";
      status.className = "config-status ok";
      setTimeout(() => { status.textContent = ""; status.className = "config-status"; }, 3000);
    }
  } catch (err) {
    status.textContent = (err as Error).message;
    status.className = "config-status err";
  } finally {
    btn.disabled = false;
  }
});

// --- Application Init ---
(function init() {
  let restored = false;
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      applyState(JSON.parse(raw));
      restored = true;
    }
  } catch (_) { }

  if (!restored) {
    txChannels.push({});
    rxChannels.push({});
    pointTargets.push({ location: [10, 0, 0], rcs: 20, speed: [0, 0, 0], phase: 0 });
    renderTxChannels();
    renderRxChannels();
    renderPointTargets();
    updateTxInfo();
    updateRadarOverviewPlot();
  }

  attachAutoSave();

  const startupOverlay = document.getElementById("startup-overlay");
  if (startupOverlay) {
    startupOverlay.classList.add("startup-fade-out");
    startupOverlay.addEventListener("transitionend", () => startupOverlay.remove(), { once: true });
  }
})();
