// ===== RadarSimApp - Plot Functions =====

import { debounce, parseNumber, parseCSV } from './utils.js';
import { txChannels, rxChannels, pointTargets, meshTargets } from './shared.js';
import { collectConfig } from './config.js';

// --- TX Bandwidth / Sweep Info ---
export function updateTxInfo(): void {
  const fStart = parseFloat((document.getElementById("tx-f-start") as HTMLInputElement).value) || 0;
  const fEnd = parseFloat((document.getElementById("tx-f-end") as HTMLInputElement).value) || 0;
  const tStart = parseFloat((document.getElementById("tx-t-start") as HTMLInputElement).value) || 0;
  const tEnd = parseFloat((document.getElementById("tx-t-end") as HTMLInputElement).value) || 0;
  (document.getElementById("tx-bandwidth") as HTMLInputElement).value = ((fEnd - fStart) * 1000).toFixed(1);
  (document.getElementById("tx-pulse-length") as HTMLInputElement).value = (tEnd - tStart).toFixed(1);
  updateTxWaveformPlot();
}

// --- Plotly Theme ---
export const plotlyLayout: any = {
  paper_bgcolor: "#12121a",
  plot_bgcolor: "#12121a",
  font: { color: "#e8e8f0", size: 12 },
  margin: { l: 60, r: 20, t: 10, b: 50 },
  xaxis: {
    gridcolor: "#2a2a3e",
    zerolinecolor: "#2a2a3e",
  },
  yaxis: {
    gridcolor: "#2a2a3e",
    zerolinecolor: "#2a2a3e",
  },
  coloraxis: {
    colorscale: "Viridis",
  },
};

export const plotlyConfig: any = {
  responsive: true,
  displayModeBar: "hover",
  displaylogo: false,
};

const smallPlotLayout: any = {
  paper_bgcolor: "#12121a",
  plot_bgcolor: "#12121a",
  font: { color: "#e8e8f0", size: 10 },
  margin: { l: 0, r: 0, t: 20, b: 0 },
  scene: {
    xaxis: { title: "X (m)", gridcolor: "#2a2a3e", backgroundcolor: "#12121a", color: "#8888a0" },
    yaxis: { title: "Y (m)", gridcolor: "#2a2a3e", backgroundcolor: "#12121a", color: "#8888a0" },
    zaxis: { title: "Z (m)", gridcolor: "#2a2a3e", backgroundcolor: "#12121a", color: "#8888a0" },
    bgcolor: "#12121a",
    aspectmode: "data",
  },
  showlegend: false,
};

const smallPlotConfig: any = { responsive: true, displayModeBar: "hover", displaylogo: false };

// --- Antenna Pattern Plots ---
const patternPlotLayout: any = {
  paper_bgcolor: "#12121a",
  plot_bgcolor: "#12121a",
  font: { color: "#e8e8f0", size: 10 },
  margin: { l: 40, r: 10, t: 8, b: 32 },
  xaxis: { gridcolor: "#2a2a3e", zerolinecolor: "#3a3a4e", title: { text: "Angle (°)", font: { size: 10 } } },
  yaxis: { gridcolor: "#2a2a3e", zerolinecolor: "#3a3a4e", title: { text: "dB", font: { size: 10 } } },
  showlegend: false,
};

const patternPlotConfig: any = { responsive: true, displayModeBar: false };

export function updateChannelPatternPlot(pfx: string, index: number): void {
  const azAnglesEl = document.getElementById(`${pfx}-ch-${index}-az-angles`) as HTMLTextAreaElement | null;
  const azPatternEl = document.getElementById(`${pfx}-ch-${index}-az-pattern`) as HTMLTextAreaElement | null;
  const elAnglesEl = document.getElementById(`${pfx}-ch-${index}-el-angles`) as HTMLTextAreaElement | null;
  const elPatternEl = document.getElementById(`${pfx}-ch-${index}-el-pattern`) as HTMLTextAreaElement | null;
  if (!azAnglesEl) return;

  const azAngles = parseCSV(azAnglesEl.value);
  const azPattern = parseCSV(azPatternEl!.value);
  const elAngles = parseCSV(elAnglesEl!.value);
  const elPattern = parseCSV(elPatternEl!.value);

  const plotDiv = document.getElementById(`${pfx}-ch-${index}-pattern-plot`);
  if (!plotDiv) return;

  const traces: any[] = [];
  if (azAngles.length > 0 && azPattern.length > 0) {
    traces.push({
      x: azAngles, y: azPattern,
      type: "scatter", mode: "lines+markers", name: "Azimuth",
      line: { color: "#689f38", width: 2 },
      marker: { size: 4, color: "#8bc34a" },
      fill: "tozeroy", fillcolor: "rgba(104, 159, 56, 0.08)",
    });
  }
  if (elAngles.length > 0 && elPattern.length > 0) {
    traces.push({
      x: elAngles, y: elPattern,
      type: "scatter", mode: "lines+markers", name: "Elevation",
      line: { color: "#00D2B4", width: 2 },
      marker: { size: 4, color: "#55EFC4" },
      fill: "tozeroy", fillcolor: "rgba(0, 210, 180, 0.08)",
    });
  }
  if (traces.length === 0) return;

  const layout = {
    ...patternPlotLayout,
    showlegend: true,
    legend: { x: 1, xanchor: "right", y: 1, font: { size: 10 }, bgcolor: "transparent", borderwidth: 0 },
  };
  Plotly.react(plotDiv, traces, layout, patternPlotConfig);
}

export function attachPatternListeners(pfx: string, index: number): void {
  const debouncedUpdate = debounce(() => updateChannelPatternPlot(pfx, index));
  ["az-angles", "az-pattern", "el-angles", "el-pattern"].forEach((field) => {
    const elem = document.getElementById(`${pfx}-ch-${index}-${field}`);
    if (elem) {
      elem.addEventListener("input", debouncedUpdate);
    }
  });
}

function preserveCamera(container: any): any {
  return container._fullLayout?.scene?.camera ?? {};
}

const _sceneCounts = new WeakMap<HTMLElement, number>();
function scenePlot(container: HTMLElement, traces: any[], layout: any, config: any): void {
  const cam = preserveCamera(container);
  if (layout.scene) layout.scene.camera = cam;
  const count = traces.reduce((n: number, t: any) => n + (t.x ? t.x.length : 0), 0);
  const prev = _sceneCounts.get(container);
  if (prev === count && (container as any).data) {
    Plotly.react(container, traces, layout, config);
  } else {
    _sceneCounts.set(container, count);
    Plotly.newPlot(container, traces, layout, config);
  }
}

function sceneArrowLen(xs: number[], ys: number[], zs: number[], minLen: number = 0.1): number {
  if (xs.length === 0) return minLen;
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  const spanZ = Math.max(...zs) - Math.min(...zs);
  return Math.max(Math.max(spanX, spanY, spanZ) * 0.2, minLen);
}

function boresightTraces(arrowLen: number, color: string, origin: number[] = [0, 0, 0], dir: number[] = [1, 0, 0]): any[] {
  const [ox, oy, oz] = origin;
  const [dx, dy, dz] = dir;

  const tipX = ox + dx * arrowLen;
  const tipY = oy + dy * arrowLen;
  const tipZ = oz + dz * arrowLen;

  let refX = 0, refY = 1, refZ = 0;
  if (Math.abs(dy) > 0.9) { refX = 0; refY = 0; refZ = 1; }
  const p1x = dy * refZ - dz * refY;
  const p1y = dz * refX - dx * refZ;
  const p1z = dx * refY - dy * refX;
  const p1len = Math.sqrt(p1x * p1x + p1y * p1y + p1z * p1z) || 1;
  const n1x = p1x / p1len, n1y = p1y / p1len, n1z = p1z / p1len;
  const n2x = dy * n1z - dz * n1y;
  const n2y = dz * n1x - dx * n1z;
  const n2z = dx * n1y - dy * n1x;

  const headLen = arrowLen * 0.12;
  const headW = arrowLen * 0.04;

  const barbs: number[][] = [
    [n1x, n1y, n1z],
    [-n1x, -n1y, -n1z],
    [n2x, n2y, n2z],
    [-n2x, -n2y, -n2z],
  ];

  const headXs: (number | null)[] = [], headYs: (number | null)[] = [], headZs: (number | null)[] = [];
  for (const [bx, by, bz] of barbs) {
    headXs.push(tipX, tipX - dx * headLen + bx * headW, null);
    headYs.push(tipY, tipY - dy * headLen + by * headW, null);
    headZs.push(tipZ, tipZ - dz * headLen + bz * headW, null);
  }

  const labelX = ox + dx * arrowLen * 1.15;
  const labelY = oy + dy * arrowLen * 1.15;
  const labelZ = oz + dz * arrowLen * 1.15;

  return [
    {
      x: [ox, tipX], y: [oy, tipY], z: [oz, tipZ],
      type: "scatter3d", mode: "lines",
      line: { color, width: 4 },
      showlegend: false, hoverinfo: "none", name: "",
    },
    {
      x: headXs, y: headYs, z: headZs,
      type: "scatter3d", mode: "lines",
      line: { color, width: 4 },
      showlegend: false, hoverinfo: "none", name: "",
    },
    {
      x: [labelX], y: [labelY], z: [labelZ],
      text: ["Boresight"],
      type: "scatter3d", mode: "text",
      textfont: { size: 9, color },
      showlegend: false, hoverinfo: "none", name: "",
    },
  ];
}

// --- TX Waveform Preview Plot ---
export function updateTxWaveformPlot(): void {
  const container = document.getElementById("tx-waveform-plot");
  if (!container) return;

  const fStart = parseNumber((document.getElementById("tx-f-start") as HTMLInputElement).value);
  const fEnd = parseNumber((document.getElementById("tx-f-end") as HTMLInputElement).value);
  const tStart = parseNumber((document.getElementById("tx-t-start") as HTMLInputElement).value);
  const tEnd = parseNumber((document.getElementById("tx-t-end") as HTMLInputElement).value);
  const prp = parseNumber((document.getElementById("tx-prp") as HTMLInputElement).value, 100);

  const traces: any[] = [];
  const numCycles = 2;

  for (let i = 0; i < numCycles; i++) {
    const offset = i * prp;
    if (tStart > 0) {
      traces.push({
        x: [offset, offset + tStart],
        y: [fStart, fStart],
        type: "scatter", mode: "lines",
        line: { color: "#689f38", width: 1, dash: "dot" },
        showlegend: false,
      });
    }
    traces.push({
      x: [offset + tStart, offset + tEnd],
      y: [fStart, fEnd],
      type: "scatter", mode: "lines",
      line: { color: "#689f38", width: 2.5 },
      showlegend: false,
    });
    if (prp > tEnd) {
      traces.push({
        x: [offset + tEnd, offset + prp],
        y: [fEnd, fStart],
        type: "scatter", mode: "lines",
        line: { color: "#689f38", width: 1, dash: "dot" },
        showlegend: false,
      });
    }
  }

  const layout = {
    paper_bgcolor: "#12121a",
    plot_bgcolor: "#12121a",
    font: { color: "#e8e8f0", size: 10 },
    margin: { l: 56, r: 16, t: 16, b: 40 },
    xaxis: {
      title: { text: "Time (µs)", font: { size: 10 } },
      gridcolor: "#2a2a3e",
      zerolinecolor: "#3a3a4e",
      color: "#8888a0",
    },
    yaxis: {
      title: { text: "Frequency (GHz)", font: { size: 10 } },
      gridcolor: "#2a2a3e",
      zerolinecolor: "#3a3a4e",
      color: "#8888a0",
    },
    showlegend: false,
  };

  Plotly.react(container, traces, layout, smallPlotConfig);
}

// --- TX Channel Locations Plot ---
export function updateTxLocationsPlot(): void {
  const container = document.getElementById("tx-locations-plot");
  if (!container) return;

  const xs: number[] = [], ys: number[] = [], zs: number[] = [], labels: string[] = [];
  txChannels.forEach((_: ChannelData, i: number) => {
    const x = parseNumber((document.getElementById(`tx-ch-${i}-loc-x`) as HTMLInputElement | null)?.value);
    const y = parseNumber((document.getElementById(`tx-ch-${i}-loc-y`) as HTMLInputElement | null)?.value);
    const z = parseNumber((document.getElementById(`tx-ch-${i}-loc-z`) as HTMLInputElement | null)?.value);
    xs.push(x); ys.push(y); zs.push(z);
    labels.push(`TX ${i + 1}`);
  });

  const trace = {
    x: xs, y: ys, z: zs,
    text: labels,
    type: "scatter3d",
    mode: "markers+text",
    marker: { size: 8, color: "#689f38", symbol: "diamond", line: { width: 1, color: "#8bc34a" } },
    textposition: "top center",
    textfont: { size: 10, color: "#8bc34a" },
  };

  const arrow = boresightTraces(sceneArrowLen(xs, ys, zs), "#fd7e14");
  const mmScene = { ...smallPlotLayout.scene, xaxis: { ...smallPlotLayout.scene.xaxis, title: "X (mm)" }, yaxis: { ...smallPlotLayout.scene.yaxis, title: "Y (mm)" }, zaxis: { ...smallPlotLayout.scene.zaxis, title: "Z (mm)" } };
  scenePlot(container, [...arrow, trace], { ...smallPlotLayout, scene: mmScene }, smallPlotConfig);
}

// --- RX Channel Locations Plot ---
export function updateRxLocationsPlot(): void {
  const container = document.getElementById("rx-locations-plot");
  if (!container) return;

  const xs: number[] = [], ys: number[] = [], zs: number[] = [], labels: string[] = [];
  rxChannels.forEach((_: ChannelData, i: number) => {
    const x = parseNumber((document.getElementById(`rx-ch-${i}-loc-x`) as HTMLInputElement | null)?.value);
    const y = parseNumber((document.getElementById(`rx-ch-${i}-loc-y`) as HTMLInputElement | null)?.value);
    const z = parseNumber((document.getElementById(`rx-ch-${i}-loc-z`) as HTMLInputElement | null)?.value);
    xs.push(x); ys.push(y); zs.push(z);
    labels.push(`RX ${i + 1}`);
  });

  const trace = {
    x: xs, y: ys, z: zs,
    text: labels,
    type: "scatter3d",
    mode: "markers+text",
    marker: { size: 8, color: "#6C5CE7", symbol: "circle", line: { width: 1, color: "#A29BFE" } },
    textposition: "top center",
    textfont: { size: 10, color: "#A29BFE" },
  };

  const arrow = boresightTraces(sceneArrowLen(xs, ys, zs), "#fd7e14");
  const mmScene = { ...smallPlotLayout.scene, xaxis: { ...smallPlotLayout.scene.xaxis, title: "X (mm)" }, yaxis: { ...smallPlotLayout.scene.yaxis, title: "Y (mm)" }, zaxis: { ...smallPlotLayout.scene.zaxis, title: "Z (mm)" } };
  scenePlot(container, [...arrow, trace], { ...smallPlotLayout, scene: mmScene }, smallPlotConfig);
}

// --- Native Scene State ---
// Every pose drawn in the 3D scenes -- the global Tx/Rx channel positions, the
// boresight, and the mesh geometry -- comes from the library (Get_Radar_State /
// Get_Target_Mesh_State) rather than being re-derived here, so the plots show
// the same platform rotation and motion the simulator applies, evaluated at
// SCENE_TIMESTAMP. The call crosses IPC and reloads the STL files, so it is
// debounced and cached against the inputs that can move something in the scene.
let _sceneState: SceneState | null = null;
let _sceneStateKey: string | null = null;
let _sceneStateInFlight = false;
/** Why the library could not report the radar pose; null while it can. */
let _poseError: string | null = null;

/** Scene time the plots are drawn at (s). Poses are queried at this instant. */
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
    return; // panel not built yet
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
  _renderRadarOverviewPlot();
  _renderTargetsPlot();
}, 400);

/** Split the library's flat [n][3] global channel positions into plot axes. */
function _channelPoints(locations: Float32Array | null | undefined, prefix: string) {
  const xs: number[] = [], ys: number[] = [], zs: number[] = [], labels: string[] = [];
  const n = locations ? Math.floor(locations.length / 3) : 0;
  for (let i = 0; i < n; i++) {
    xs.push(locations![i * 3]);
    ys.push(locations![i * 3 + 1]);
    zs.push(locations![i * 3 + 2]);
    labels.push(`${prefix}${i + 1}`);
  }
  return { xs, ys, zs, labels };
}

// The platform origin marker, shared by both scenes. radarsimlib exposes no
// query for the platform position on its own -- only the channels hanging off
// it -- so this is the configured location, which is the platform's pose at
// SCENE_TIMESTAMP = 0. Drawing it at a nonzero scene time needs an origin from
// the library, not a JS extrapolation of the speed inputs.
function _radarOriginTrace(x: number, y: number, z: number): any {
  return {
    x: [x], y: [y], z: [z],
    text: ["Radar"],
    type: "scatter3d", mode: "markers",
    marker: { size: 5, color: "#e17055", symbol: "square", line: { width: 1, color: "#fab1a0" } },
    textposition: "top center",
    textfont: { size: 10, color: "#fab1a0" },
    name: "Radar Origin", showlegend: true,
  };
}

// A scene missing its native pose is drawn without channels or boresight rather
// than with a JS stand-in for them, so say why the markers are absent.
function _poseAnnotations(): any[] {
  if (!_poseError) return [];
  return [{
    text: `Pose unavailable — ${_poseError}`,
    xref: "paper", yref: "paper", x: 0, y: 0,
    xanchor: "left", yanchor: "bottom",
    showarrow: false,
    font: { size: 9, color: "#e17055" },
  }];
}

// --- Radar Array Overview Plot ---
export function updateRadarOverviewPlot(): void {
  _renderRadarOverviewPlot();
  _refreshSceneState();
}

function _renderRadarOverviewPlot(): void {
  const container = document.getElementById("radar-overview-plot");
  if (!container) return;

  const radarX = parseNumber((document.getElementById("radar-loc-x") as HTMLInputElement | null)?.value);
  const radarY = parseNumber((document.getElementById("radar-loc-y") as HTMLInputElement | null)?.value);
  const radarZ = parseNumber((document.getElementById("radar-loc-z") as HTMLInputElement | null)?.value);

  const traces: any[] = [_radarOriginTrace(radarX, radarY, radarZ)];

  const tx = _channelPoints(_sceneState?.txLocations, "TX");
  if (tx.xs.length > 0) {
    traces.push({
      x: tx.xs, y: tx.ys, z: tx.zs,
      text: tx.labels,
      type: "scatter3d", mode: "markers+text",
      marker: { size: 7, color: "#689f38", symbol: "diamond", line: { width: 1, color: "#8bc34a" } },
      textposition: "top center",
      textfont: { size: 9, color: "#8bc34a" },
      name: "TX", showlegend: true,
    });
  }

  const rx = _channelPoints(_sceneState?.rxLocations, "RX");
  if (rx.xs.length > 0) {
    traces.push({
      x: rx.xs, y: rx.ys, z: rx.zs,
      text: rx.labels,
      type: "scatter3d", mode: "markers+text",
      marker: { size: 7, color: "#6C5CE7", symbol: "circle", line: { width: 1, color: "#A29BFE" } },
      textposition: "top center",
      textfont: { size: 9, color: "#A29BFE" },
      name: "RX", showlegend: true,
    });
  }

  const boresight = _sceneState?.boresight;
  const arrow = boresight
    ? boresightTraces(
      sceneArrowLen([radarX, ...tx.xs, ...rx.xs], [radarY, ...tx.ys, ...rx.ys], [radarZ, ...tx.zs, ...rx.zs], 0.001),
      "#fd7e14", [radarX, radarY, radarZ], [boresight[0], boresight[1], boresight[2]]
    )
    : [];

  const layout = {
    ...smallPlotLayout,
    scene: { ...smallPlotLayout.scene },
    legend: { x: 1, xanchor: "right", y: 1, font: { size: 10 }, bgcolor: "transparent", borderwidth: 0 },
    showlegend: true,
    annotations: _poseAnnotations(),
  };

  scenePlot(container, [...arrow, ...traces], layout, smallPlotConfig);
}

const MESH_COLORS = ["#a29bfe", "#00cec9", "#fab1a0", "#74b9ff", "#ffeaa7"];

/** Min/max of one axis across the plotted meshes, for scene auto-scaling. */
function _meshSpan(axis: 0 | 1 | 2): number[] {
  const out: number[] = [];
  for (const m of _sceneState?.meshes ?? []) {
    if (m.bounds && isFinite(m.bounds[axis])) out.push(m.bounds[axis], m.bounds[axis + 3]);
  }
  return out;
}

function _meshTraces(): any[] {
  if (!_sceneState || _sceneState.meshes.length === 0) return [];
  return _sceneState.meshes.map((m: SceneMesh) => {
    const color = MESH_COLORS[m.index % MESH_COLORS.length];
    const decimated = m.cells < m.totalCells;
    return {
      type: "mesh3d",
      x: m.x, y: m.y, z: m.z,
      i: m.i, j: m.j, k: m.k,
      color,
      opacity: 0.85,
      flatshading: true,
      hoverinfo: "name",
      lighting: { ambient: 0.55, diffuse: 0.8, specular: 0.15, roughness: 0.6 },
      lightposition: { x: 1e4, y: 1e4, z: 1e4 },
      name: decimated
        ? `M${m.index + 1} (${m.cells} of ${m.totalCells} tri)`
        : `M${m.index + 1} (${m.totalCells} tri)`,
      showlegend: true,
    };
  });
}

// --- Targets Scene Plot ---
export function updateTargetsPlot(): void {
  _renderTargetsPlot();
  _refreshSceneState();
}

function _renderTargetsPlot(): void {
  const container = document.getElementById("targets-scene-plot");
  if (!container) return;

  const radarX = parseNumber((document.getElementById("radar-loc-x") as HTMLInputElement | null)?.value);
  const radarY = parseNumber((document.getElementById("radar-loc-y") as HTMLInputElement | null)?.value);
  const radarZ = parseNumber((document.getElementById("radar-loc-z") as HTMLInputElement | null)?.value);

  const traces: any[] = [_radarOriginTrace(radarX, radarY, radarZ)];

  const ptXs: number[] = [], ptYs: number[] = [], ptZs: number[] = [], ptLabels: string[] = [];
  pointTargets.forEach((_: PointTargetData, i: number) => {
    ptXs.push(parseNumber((document.getElementById(`pt-${i}-loc-x`) as HTMLInputElement | null)?.value ?? 50));
    ptYs.push(parseNumber((document.getElementById(`pt-${i}-loc-y`) as HTMLInputElement | null)?.value));
    ptZs.push(parseNumber((document.getElementById(`pt-${i}-loc-z`) as HTMLInputElement | null)?.value));
    ptLabels.push(`T${i + 1}`);
  });
  if (ptXs.length > 0) {
    traces.push({
      x: ptXs, y: ptYs, z: ptZs,
      text: ptLabels,
      type: "scatter3d", mode: "markers+text",
      marker: { size: 7, color: "#fdcb6e", symbol: "circle", line: { width: 1, color: "#ffeaa7" } },
      textposition: "top center",
      textfont: { size: 9, color: "#ffeaa7" },
      name: "Point Target", showlegend: true,
    });
  }

  // Mesh targets: real geometry from the library when available, otherwise a
  // marker at the configured origin.
  const plottedMeshes = new Set<number>((_sceneState?.meshes ?? []).map((m: SceneMesh) => m.index));
  traces.push(..._meshTraces());

  const mxs: number[] = [], mys: number[] = [], mzs: number[] = [], mLabels: string[] = [];
  meshTargets.forEach((_: MeshTargetData, i: number) => {
    if (plottedMeshes.has(i)) return;
    mxs.push(parseNumber((document.getElementById(`mesh-${i}-loc-x`) as HTMLInputElement | null)?.value));
    mys.push(parseNumber((document.getElementById(`mesh-${i}-loc-y`) as HTMLInputElement | null)?.value));
    mzs.push(parseNumber((document.getElementById(`mesh-${i}-loc-z`) as HTMLInputElement | null)?.value));
    mLabels.push(`M${i + 1}`);
  });
  if (mxs.length > 0) {
    traces.push({
      x: mxs, y: mys, z: mzs,
      text: mLabels,
      type: "scatter3d", mode: "markers+text",
      marker: { size: 7, color: "#a29bfe", symbol: "diamond", line: { width: 1, color: "#dfe6e9" } },
      textposition: "top center",
      textfont: { size: 9, color: "#dfe6e9" },
      name: "Mesh Target", showlegend: true,
    });
  }

  // Boresight comes from the library's own platform rotation, so the arrow is
  // simply omitted when it could not supply one.
  const boresight = _sceneState?.boresight;
  const arrow = boresight
    ? boresightTraces(
      sceneArrowLen(
        [radarX, ...ptXs, ...mxs, ..._meshSpan(0)],
        [radarY, ...ptYs, ...mys, ..._meshSpan(1)],
        [radarZ, ...ptZs, ...mzs, ..._meshSpan(2)],
        1
      ),
      "#fd7e14", [radarX, radarY, radarZ], [boresight[0], boresight[1], boresight[2]]
    )
    : [];

  const layout = {
    ...smallPlotLayout,
    scene: { ...smallPlotLayout.scene },
    legend: { x: 1, xanchor: "right", y: 1, font: { size: 10 }, bgcolor: "transparent", borderwidth: 0 },
    showlegend: true,
    annotations: _poseAnnotations(),
  };

  scenePlot(container, [...arrow, ...traces], layout, smallPlotConfig);
}

// --- Plot Simulation Results ---
export function plotResults(data: any): void {
  document.getElementById("results-outdated-banner")?.classList.add("hidden");
  if (data.range_doppler) {
    _lastRangeDopplerData = data.range_doppler;
    _lastRdRangeAxis = data.rd_range_axis || null;
    _lastRdVelocityAxis = data.rd_doppler_axis || null;
    _plotRangeDoppler();
  }

  if (data.range_profile) {
    _lastRangeProfileData = data.range_profile;
    _lastRangeAxis = data.rp_range_axis || null;
    _plotRangeProfile();
  }

  if (data.baseband) {
    _lastBasebandData = data.baseband;
    _lastBbType = data.bb_type || "complex";
    const numPulses = data.baseband.length;
    const numCh = Array.isArray(data.baseband[0]) ? data.baseband[0].length : 1;
    const pulseInput = document.getElementById("bb-pulse-idx") as HTMLInputElement;
    const chInput = document.getElementById("bb-ch-idx") as HTMLInputElement;
    pulseInput.max = String(numPulses - 1);
    chInput.max = String(numCh - 1);
    pulseInput.value = String(Math.min(parseInt(pulseInput.value) || 0, numPulses - 1));
    chInput.value = String(Math.min(parseInt(chInput.value) || 0, numCh - 1));
    _plotBaseband();
  }
}

let _lastBasebandData: any = null;
let _lastBbType: string = "complex";
let _lastRangeProfileData: any = null;
let _lastRangeAxis: any = null;
let _lastRangeDopplerData: any = null;
let _lastRdRangeAxis: any = null;
let _lastRdVelocityAxis: any = null;

function _plotRangeDoppler(): void {
  const container = document.getElementById("plot-range-doppler");
  if (!_lastRangeDopplerData || !container) return;
  const chIdx = Math.max(0, parseInt((document.getElementById("bb-ch-idx") as HTMLInputElement).value) || 0);

  const rd: any[] = [];
  for (let p = 0; p < _lastRangeDopplerData.length; p++) {
    const pulseData = _lastRangeDopplerData[p];
    if (Array.isArray(pulseData?.[0])) {
      rd.push(pulseData[Math.min(chIdx, pulseData.length - 1)]);
    } else {
      rd.push(pulseData);
    }
  }

  container.classList.add("has-data");
  const trace: any = {
    z: rd,
    type: "surface",
    colorscale: "Viridis",
    colorbar: { title: "dB" },
    showscale: true,
  };
  if (_lastRdRangeAxis) trace.x = _lastRdRangeAxis;
  if (_lastRdVelocityAxis) trace.y = _lastRdVelocityAxis;

  const layout = {
    paper_bgcolor: "#12121a",
    font: { color: "#e8e8f0", size: 12 },
    margin: { l: 0, r: 0, t: 10, b: 0 },
    scene: {
      xaxis: { title: "Range Bin", gridcolor: "#2a2a3e", backgroundcolor: "#12121a", color: "#8888a0" },
      yaxis: { title: "Doppler Bin", gridcolor: "#2a2a3e", backgroundcolor: "#12121a", color: "#8888a0" },
      zaxis: { title: "dB", gridcolor: "#2a2a3e", backgroundcolor: "#12121a", color: "#8888a0" },
      bgcolor: "#12121a",
    },
  };
  Plotly.newPlot(container, [trace], layout, plotlyConfig);
}

function _plotRangeProfile(): void {
  const container = document.getElementById("plot-range-profile");
  if (!_lastRangeProfileData || !container) return;
  const pulseIdx = Math.max(0, parseInt((document.getElementById("bb-pulse-idx") as HTMLInputElement).value) || 0);
  const chIdx = Math.max(0, parseInt((document.getElementById("bb-ch-idx") as HTMLInputElement).value) || 0);

  const pulseData = _lastRangeProfileData[Math.min(pulseIdx, _lastRangeProfileData.length - 1)];
  const rp = Array.isArray(pulseData?.[0])
    ? pulseData[Math.min(chIdx, pulseData.length - 1)]
    : Array.isArray(pulseData) ? pulseData : _lastRangeProfileData;

  container.classList.add("has-data");
  const trace: any = {
    y: rp,
    type: "scatter", mode: "lines",
    line: { color: "#689f38", width: 1.5 },
  };
  if (_lastRangeAxis) trace.x = _lastRangeAxis;
  const layout = {
    ...plotlyLayout,
    xaxis: { ...plotlyLayout.xaxis, title: "Range Bin" },
    yaxis: { ...plotlyLayout.yaxis, title: "Magnitude (dB)" },
  };
  Plotly.newPlot(container, [trace], layout, plotlyConfig);
}

function _plotBaseband(): void {
  const container = document.getElementById("plot-baseband");
  if (!_lastBasebandData || !container) return;
  const pulseIdx = Math.max(0, parseInt((document.getElementById("bb-pulse-idx") as HTMLInputElement).value) || 0);
  const chIdx = Math.max(0, parseInt((document.getElementById("bb-ch-idx") as HTMLInputElement).value) || 0);

  const pulseData = _lastBasebandData[Math.min(pulseIdx, _lastBasebandData.length - 1)];
  const chData = Array.isArray(pulseData)
    ? pulseData[Math.min(chIdx, pulseData.length - 1)]
    : pulseData;

  container.classList.add("has-data");
  const traces: any[] = [
    {
      y: chData.re,
      type: "scatter", mode: "lines", name: "Real",
      line: { color: "#8bc34a", width: 1 },
    },
  ];
  if (_lastBbType !== "real") {
    traces.push({
      y: chData.im,
      type: "scatter", mode: "lines", name: "Imag",
      line: { color: "#e17055", width: 1 },
    });
  }
  const layout = {
    ...plotlyLayout,
    showlegend: true,
    xaxis: { ...plotlyLayout.xaxis, title: "Sample" },
    yaxis: { ...plotlyLayout.yaxis, title: "Amplitude" },
  };
  Plotly.newPlot(container, traces, layout, plotlyConfig);
}

export function markResultsOutdated(): void {
  if (!_lastBasebandData && !_lastRangeProfileData && !_lastRangeDopplerData) return;
  document.getElementById("results-outdated-banner")?.classList.remove("hidden");
}

export function clearResultPlots(): void {
  _lastBasebandData = null;
  _lastRangeProfileData = null;
  _lastRangeAxis = null;
  _lastRangeDopplerData = null;
  _lastRdRangeAxis = null;
  _lastRdVelocityAxis = null;

  document.getElementById("results-outdated-banner")?.classList.add("hidden");

  const statusEl = document.getElementById("sim-status");
  if (statusEl) { statusEl.textContent = ""; statusEl.className = "status-msg"; }

  const exportBtn = document.getElementById("btn-export") as HTMLButtonElement | null;
  if (exportBtn) exportBtn.disabled = true;

  ["plot-baseband", "plot-range-profile", "plot-range-doppler"].forEach((id) => {
    const plotEl = document.getElementById(id);
    if (plotEl) {
      plotEl.classList.remove("has-data");
      Plotly.purge(plotEl);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("bb-pulse-idx")?.addEventListener("change", () => {
    _plotBaseband();
    _plotRangeProfile();
  });
  document.getElementById("bb-ch-idx")?.addEventListener("change", () => {
    _plotBaseband();
    _plotRangeProfile();
    _plotRangeDoppler();
  });

  const debouncedMarkOutdated = debounce(markResultsOutdated, 200);
  const configPanels = ["panel-transmitter", "panel-receiver", "panel-radar", "panel-targets"];
  const handler = (e: Event): void => {
    if ((e.target as HTMLElement).matches("input, select")) debouncedMarkOutdated();
  };
  configPanels.forEach((panelId) => {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    panel.addEventListener("input", handler);
    panel.addEventListener("change", handler);
  });
  const simConfigArea = document.querySelector("#panel-simulation .panel-split-left");
  if (simConfigArea) {
    simConfigArea.addEventListener("input", handler);
    simConfigArea.addEventListener("change", handler);
  }
});
