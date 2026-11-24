// ===== RadarSimApp - Targets =====
// The point and mesh target lists: one card of fields per target, built here
// and read back from the page.

import { renderOutline, select } from "./outline.js";
import { markResultsOutdated } from "./plots.js";
import { updateScene } from "./scene.js";
import { meshTargets, newPointTarget, pointTargets } from "./shared.js";
import { debouncedAutoSave } from "./state.js";
import {
  byId,
  confirmAsync,
  createInput,
  debounce,
  el,
  fieldNumber,
  fieldValue,
  fieldVector,
  formGroup,
  itemCard,
  setCount,
  vectorGroup,
  XYZ,
  YPR,
} from "./utils.js";

const VELOCITY_LABELS = ["v<sub>x</sub>", "v<sub>y</sub>", "v<sub>z</sub>"];

/** Re-render a list after one of its items is removed, and tell everything that follows it. */
async function _remove<T>(list: T[], index: number, what: string, save: () => void, render: () => void): Promise<void> {
  if (!(await confirmAsync(`Remove ${what} ${index + 1}?`))) return;
  save();
  list.splice(index, 1);
  render();
  updateScene();
  markResultsOutdated();
  debouncedAutoSave();
}

/**
 * The scene follows the fields that move a target, named by their id suffixes:
 * `inputs` report each keystroke, `selects` only a change.
 */
function _followInScene(prefix: (i: number) => string, count: number, inputs: string[], selects: string[] = []): void {
  requestAnimationFrame(() => {
    const debouncedUpdate = debounce(updateScene);
    for (let i = 0; i < count; i++) {
      for (const f of inputs) document.getElementById(`${prefix(i)}-${f}`)?.addEventListener("input", debouncedUpdate);
      for (const f of selects)
        document.getElementById(`${prefix(i)}-${f}`)?.addEventListener("change", debouncedUpdate);
    }
    updateScene();
  });
}

// --- Point Targets ---

/** A point target as its fields hold it. */
export function readPointTarget(i: number): Required<PointTargetData> {
  return {
    location: fieldVector(`pt-${i}-loc`, XYZ, [10]),
    rcs: fieldNumber(`pt-${i}-rcs`, 20),
    speed: fieldVector(`pt-${i}-spd`, XYZ),
    phase: fieldNumber(`pt-${i}-phase`),
  };
}

export function savePointTargetStates(): void {
  pointTargets.forEach((t, i) => {
    Object.assign(t, readPointTarget(i));
  });
}

export function renderPointTargets(): void {
  const container = byId("point-targets-list");
  setCount("point-target-count", pointTargets.length);
  container.replaceChildren(
    ...pointTargets.map((t, i) =>
      itemCard(
        [
          vectorGroup("Location (m)", `pt-${i}-loc`, XYZ, XYZ, (k) => t.location?.[k] ?? (k === 0 ? 10 : 0), 1),
          vectorGroup("Velocity (m/s)", `pt-${i}-spd`, XYZ, VELOCITY_LABELS, (k) => t.speed?.[k] ?? 0, 1),
          el("div", { className: "form-row" }, [
            formGroup("RCS (dBsm)", createInput(`pt-${i}-rcs`, t.rcs ?? 20, 1)),
            formGroup("Phase (°)", createInput(`pt-${i}-phase`, t.phase ?? 0, 1)),
          ]),
        ],
        "Remove Target",
        () => _remove(pointTargets, i, "Target", savePointTargetStates, renderPointTargets),
      ),
    ),
  );
  renderOutline();
  _followInScene(
    (i) => `pt-${i}`,
    pointTargets.length,
    XYZ.map((a) => `loc-${a}`),
  );
}

export function addPointTarget(): void {
  savePointTargetStates();
  pointTargets.push(newPointTarget());
  renderPointTargets();
  select({ kind: "point", index: pointTargets.length - 1 });
  markResultsOutdated();
  debouncedAutoSave();
}

// --- Mesh Targets ---

/** Where a mesh target is and how it moves, as its fields hold it. */
export function readMeshMotion(
  i: number,
): Required<Pick<MeshTargetData, "location" | "speed" | "rotation" | "rotation_rate">> {
  return {
    location: fieldVector(`mesh-${i}-loc`, XYZ),
    speed: fieldVector(`mesh-${i}-spd`, XYZ),
    rotation: fieldVector(`mesh-${i}-rot`, YPR),
    rotation_rate: fieldVector(`mesh-${i}-rr`, YPR),
  };
}

export function saveMeshTargetStates(): void {
  meshTargets.forEach((t, i) => {
    t.model = fieldValue(`mesh-${i}-model`) ?? t.model ?? "";
    Object.assign(t, readMeshMotion(i));
    t.unit = fieldValue(`mesh-${i}-unit`) ?? t.unit ?? "m";
    const permVal = fieldValue(`mesh-${i}-perm`);
    t.permittivity = permVal !== undefined && permVal !== "" ? fieldNumber(`mesh-${i}-perm`) : (t.permittivity ?? "");
  });
}

function _meshCard(t: MeshTargetData, i: number): HTMLElement {
  const modelInput = el("input", {
    type: "text",
    id: `mesh-${i}-model`,
    value: t.model ?? "",
    placeholder: "Path to .stl / .obj / .ply",
  }) as HTMLInputElement;
  const browse = el("button", {
    className: "btn-secondary",
    textContent: "Browse",
    onClick: async () => {
      const f = await window.api.selectFile({
        filters: [{ name: "3D Models", extensions: ["stl", "obj", "ply"] }],
      });
      if (!f) return;
      modelInput.value = f;
      meshTargets[i].model = f;
      // Assigning .value does not fire an input event, so dispatch one to
      // drive the scene refresh and autosave listeners.
      modelInput.dispatchEvent(new Event("input", { bubbles: true }));
    },
  });

  const unit = el("select", { id: `mesh-${i}-unit` });
  for (const u of ["m", "cm", "mm"]) {
    const opt = el("option", { value: u, textContent: u }) as HTMLOptionElement;
    opt.selected = u === (t.unit ?? "m");
    unit.appendChild(opt);
  }

  return itemCard(
    [
      formGroup("3D Model File", el("div", { className: "file-row" }, [modelInput, browse])),
      vectorGroup("Location (m)", `mesh-${i}-loc`, XYZ, XYZ, (k) => t.location?.[k] ?? 0, 1),
      vectorGroup("Velocity (m/s)", `mesh-${i}-spd`, XYZ, VELOCITY_LABELS, (k) => t.speed?.[k] ?? 0, 1),
      vectorGroup("Rotation (°)", `mesh-${i}-rot`, YPR, YPR, (k) => t.rotation?.[k] ?? 0, 1),
      vectorGroup(
        "Rotation Rate (°/s)",
        `mesh-${i}-rr`,
        YPR,
        YPR.map((a) => `${a} rate`),
        (k) => t.rotation_rate?.[k] ?? 0,
        1,
      ),
      el("div", { className: "form-row" }, [
        formGroup("Model Unit", unit),
        // An empty permittivity is a perfect conductor
        formGroup("Permittivity (ε<sub>r</sub>)", createInput(`mesh-${i}-perm`, t.permittivity ?? "", 0.1)),
      ]),
    ],
    "Remove Mesh",
    () => _remove(meshTargets, i, "Mesh", saveMeshTargetStates, renderMeshTargets),
  );
}

export function renderMeshTargets(): void {
  const container = byId("mesh-targets-list");
  setCount("mesh-target-count", meshTargets.length);
  container.replaceChildren(...meshTargets.map(_meshCard));
  renderOutline();
  // Everything that changes the geometry the scene view gets back from the
  // library: which model, where it sits, how it is oriented and scaled.
  _followInScene(
    (i) => `mesh-${i}`,
    meshTargets.length,
    ["model", ...XYZ.map((a) => `loc-${a}`), ...YPR.map((a) => `rot-${a}`)],
    ["unit"],
  );
}

export function addMeshTarget(): void {
  saveMeshTargetStates();
  meshTargets.push({});
  renderMeshTargets();
  select({ kind: "mesh", index: meshTargets.length - 1 });
  markResultsOutdated();
  debouncedAutoSave();
}
