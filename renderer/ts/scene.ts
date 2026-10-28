// ===== RadarSimApp - Scene Model =====
// What the 3D view shows: the radar platform, its channels, the boresight and
// the targets. This module gathers it; scene3d.ts draws it.

import { debounce, parseNumber, parseCSV, el } from './utils.js';
import { pointTargets, meshTargets } from './shared.js';
import { channelCoverage, type Coverage } from './beam.js';
import { collectConfig } from './config.js';

export type Vec3 = [number, number, number];

export interface SceneMarker {
  label: string;
  position: Vec3;
  /**
   * For a channel in focus (see setCoverageFocus): the angles its antenna
   * pattern spans (deg off boresight). Null for the rest, which draw no fans.
   */
  coverage?: Coverage | null;
}

/**
 * Whose coverage the scene shows, from what is picked on the radar: one
 * channel, a whole chain's channels, or (null) none.
 */
export type CoverageFocus =
  | { kind: "tx" | "rx"; index: number }
  | { kind: "transmitter" | "receiver" }
  | null;

export interface SceneModel {
  /** Platform origin, as configured (see _radarOrigin). */
  radar: Vec3;
  /** Global channel positions from the library; empty while it has no pose. */
  tx: SceneMarker[];
  rx: SceneMarker[];
  /** Unit vector from the library, or null when it could not supply one. */
  boresight: Vec3 | null;
  /** One channel's fans are outlined; a chain's are only shaded, so many of them stay quiet. */
  fanEdges: boolean;
  /**
   * Platform roll (deg), as configured: the library reports the boresight but
   * not the turn about it, which sets how the azimuth plane lies.
   */
  roll: number;
  pointTargets: SceneMarker[];
  /** Mesh geometry from the library, already placed in the scene. */
  meshes: SceneMesh[];
  /** Mesh targets the library returned no geometry for, at their configured origin. */
  meshMarkers: SceneMarker[];
  /** Why the library could not report the radar pose; null while it can. */
  poseError: string | null;
}

export const MESH_COLORS = ["#a29bfe", "#00cec9", "#fab1a0", "#74b9ff", "#ffeaa7"];

export function meshColor(index: number): string {
  return MESH_COLORS[index % MESH_COLORS.length];
}

export function meshLabel(m: SceneMesh): string {
  return m.cells < m.totalCells
    ? `M${m.index + 1} (${m.cells} of ${m.totalCells} tri)`
    : `M${m.index + 1} (${m.totalCells} tri)`;
}

// --- Native Scene State ---
// Every pose drawn in the 3D view -- the global Tx/Rx channel positions, the
// boresight, and the mesh geometry -- comes from the library (Get_Radar_State /
// Get_Target_Mesh_State) rather than being re-derived here, so the view shows
// the same platform rotation and motion the simulator applies, evaluated at
// SCENE_TIMESTAMP. The call crosses IPC and reloads the STL files, so it is
// debounced and cached against the inputs that can move something in the scene.
let _sceneState: SceneState | null = null;
let _sceneStateKey: string | null = null;
let _sceneStateInFlight = false;
let _poseError: string | null = null;

/** Scene time the view is drawn at (s). Poses are queried at this instant. */
const SCENE_TIMESTAMP = 0;

/** Matches the per-field warning the bridge attaches to a failed pose query. */
const POSE_WARNING_PREFIX = "Radar pose:";

function _sceneStateKeyOf(cfg: any): string {
  return JSON.stringify({
    radar: cfg.radar,
    tx: (cfg.transmitter?.channels || []).map((c: any) => c.location),
    rx: (cfg.receiver?.channels || []).map((c: any) => c.location),
    meshes: (cfg.targets || [])
      .filter((t: any) => t && t.model)
      // Speed and rotation rate move the mesh once SCENE_TIMESTAMP is nonzero,
      // so they invalidate the cached pose like the static fields do.
      .map((t: any) => [t.model, t.location, t.rotation, t.speed, t.rotation_rate, t.unit]),
  });
}

const _refreshSceneState = debounce(async () => {
  if (_sceneStateInFlight) {
    _refreshSceneState(); // re-arm; the config may have changed since this call started
    return;
  }

  let cfg: any;
  try {
    cfg = collectConfig();
  } catch (_) {
    return; // panels not built yet
  }

  const key = _sceneStateKeyOf(cfg);
  if (key === _sceneStateKey) return;

  _sceneStateInFlight = true;
  try {
    const res = await window.api.getSceneState({ ...cfg, timestamp: SCENE_TIMESTAMP });
    _sceneStateKey = key;
    if (res.success && res.data) {
      _sceneState = res.data;
      if (res.data.warnings.length > 0) {
        console.warn("[scene] " + res.data.warnings.join("; "));
      }
      // A pose failure is reported per-field, so the meshes can still be good.
      const posed = res.data.txLocations && res.data.rxLocations && res.data.boresight;
      const warning = res.data.warnings.find((w: string) => w.startsWith(POSE_WARNING_PREFIX));
      _poseError = posed ? null
        : warning ? warning.slice(POSE_WARNING_PREFIX.length).trim()
        : "radarsimlib reported no radar pose";
    } else {
      _sceneState = null;
      _poseError = res.error || "scene query failed";
      console.warn("[scene] getSceneState failed:", res.error);
    }
  } catch (err) {
    _sceneState = null;
    _poseError = (err as Error).message || String(err);
    console.warn("[scene] getSceneState threw:", err);
  } finally {
    _sceneStateInFlight = false;
  }
  _publish();
}, 400);

// --- Coverage focus ---
let _focus: CoverageFocus = null;

/** Show the coverage of what is picked on the radar, and only that. */
export function setCoverageFocus(focus: CoverageFocus): void {
  if (JSON.stringify(focus) === JSON.stringify(_focus)) return;
  _focus = focus;
  _publish();
}

function _inFocus(pfx: "tx" | "rx", index: number): boolean {
  if (!_focus) return false;
  if (_focus.kind === "transmitter") return pfx === "tx";
  if (_focus.kind === "receiver") return pfx === "rx";
  return _focus.kind === pfx && _focus.index === index;
}

/** Split the library's flat [n][3] global channel positions into markers. */
function _channelMarkers(locations: Float32Array | null | undefined, prefix: "TX" | "RX"): SceneMarker[] {
  const pfx = prefix.toLowerCase() as "tx" | "rx";
  const csv = (i: number, name: string): number[] =>
    parseCSV((document.getElementById(`${pfx}-ch-${i}-${name}`) as HTMLInputElement | null)?.value ?? "");
  const markers: SceneMarker[] = [];
  const n = locations ? Math.floor(locations.length / 3) : 0;
  for (let i = 0; i < n; i++) {
    markers.push({
      label: `${prefix}${i + 1}`,
      position: [locations![i * 3], locations![i * 3 + 1], locations![i * 3 + 2]],
      coverage: _inFocus(pfx, i) ? channelCoverage(csv(i, "az-angles"), csv(i, "el-angles")) : null,
    });
  }
  return markers;
}

function _fieldVec(prefix: string, fallbackX: number = 0): Vec3 {
  const g = (axis: string): string | undefined =>
    (document.getElementById(`${prefix}-loc-${axis}`) as HTMLInputElement | null)?.value;
  return [parseNumber(g("x"), fallbackX), parseNumber(g("y")), parseNumber(g("z"))];
}

// The platform origin. radarsimlib exposes no query for the platform position
// on its own -- only the channels hanging off it -- so this is the configured
// location, which is the platform's pose at SCENE_TIMESTAMP = 0. Drawing it at
// a nonzero scene time needs an origin from the library, not a JS
// extrapolation of the speed inputs.
function _radarOrigin(): Vec3 {
  return _fieldVec("radar");
}



export function buildSceneModel(): SceneModel {
  const meshes = _sceneState?.meshes ?? [];
  // Mesh targets: real geometry from the library when available, otherwise a
  // marker at the configured origin.
  const drawn = new Set<number>(meshes.map((m: SceneMesh) => m.index));
  const meshMarkers: SceneMarker[] = [];
  meshTargets.forEach((_: MeshTargetData, i: number) => {
    if (!drawn.has(i)) meshMarkers.push({ label: `M${i + 1}`, position: _fieldVec(`mesh-${i}`) });
  });

  // A scene missing its native pose is drawn without channels or boresight
  // rather than with a JS stand-in for them.
  const boresight = _sceneState?.boresight;
  return {
    radar: _radarOrigin(),
    tx: _channelMarkers(_sceneState?.txLocations, "TX"),
    rx: _channelMarkers(_sceneState?.rxLocations, "RX"),
    boresight: boresight ? [boresight[0], boresight[1], boresight[2]] : null,
    fanEdges: _focus?.kind === "tx" || _focus?.kind === "rx",
    roll: parseNumber((document.getElementById("radar-rot-roll") as HTMLInputElement | null)?.value),
    pointTargets: pointTargets.map((_: PointTargetData, i: number) => ({
      label: `T${i + 1}`,
      position: _fieldVec(`pt-${i}`, 10),
    })),
    meshes,
    meshMarkers,
    poseError: _poseError,
  };
}

// --- Publishing ---
let _sink: ((model: SceneModel) => void) | null = null;

/** Where each new model goes: the 3D view, once it exists. */
export function setSceneSink(sink: (model: SceneModel) => void): void {
  _sink = sink;
  _publish();
}

function _legendEntry(kind: string, text: string, color?: string): HTMLElement {
  const swatch = el("i", { className: `mk-glyph mk-${kind}` });
  if (color) swatch.style.setProperty("--mk", color);
  return el("span", { className: "legend-item" }, [swatch, text]);
}

function _renderLegend(model: SceneModel): void {
  const legend = document.getElementById("scene-legend");
  if (!legend) return;
  const items: HTMLElement[] = [_legendEntry("radar", "Radar")];
  if (model.tx.length > 0) items.push(_legendEntry("tx", "TX"));
  if (model.rx.length > 0) items.push(_legendEntry("rx", "RX"));
  if (model.boresight) {
    items.push(_legendEntry("boresight", "Boresight"));
    // The fans around it, in the antenna pattern plot's colours
    const channels = [...model.tx, ...model.rx];
    if (channels.some((c) => c.coverage?.az)) items.push(_legendEntry("cut-az", "Azimuth span"));
    if (channels.some((c) => c.coverage?.el)) items.push(_legendEntry("cut-el", "Elevation span"));
  }
  if (model.pointTargets.length > 0) items.push(_legendEntry("point", "Point target"));
  model.meshes.forEach((m) => items.push(_legendEntry("mesh", meshLabel(m), meshColor(m.index))));
  if (model.meshMarkers.length > 0) items.push(_legendEntry("mesh", "Mesh target"));
  legend.replaceChildren(...items);
}

function _publish(): void {
  const model = buildSceneModel();

  // Say why the channel markers and the arrow are absent.
  const note = document.getElementById("scene-pose-note");
  if (note) {
    note.textContent = model.poseError ? `Pose unavailable — ${model.poseError}` : "";
    note.classList.toggle("hidden", !model.poseError);
  }
  _renderLegend(model);
  _sink?.(model);
}

/** Redraw from the fields now, and from the library once it has answered. */
export function updateScene(): void {
  _publish();
  _refreshSceneState();
}
