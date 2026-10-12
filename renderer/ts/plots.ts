// ===== RadarSimApp - Plot Functions =====

import { debounce, parseNumber, parseCSV } from './utils.js';
import { txChannels, rxChannels } from './shared.js';
import { updateReadout } from './readout.js';
import { stageView, isResultView, setResultViewsAvailable, setPref, type StageView } from './stage.js';

// --- TX Bandwidth / Sweep Info ---
export function updateTxInfo(): void {
  updateReadout();
  updateTxWaveformPlot();
}

// --- Plotly Theme ---
// The plots are drawn clear, straight onto the panel or the stage behind them,
// so these have to agree with the palette in styles.css.
const THEME = {
  clear: "rgba(0,0,0,0)",
  ink: "#e7e4ef",
  inkDim: "#aca7ba",
  inkFaint: "#7b768a",
  grid: "rgba(184,163,230,0.14)",
  zero: "rgba(184,163,230,0.3)",
  accent: "#b8a3e6",
  signal: "#8bc34a",
  signalSoft: "rgba(139,195,74,0.08)",
  tx: "#8bc34a",
  rx: "#4e9eff",
  second: "#2ec5d8",
  secondSoft: "rgba(46,197,216,0.08)",
  imag: "#ff7b3a",
  panel: "#17131f",
  mono: 'ui-monospace, "SFMono-Regular", "Cascadia Mono", Consolas, Menlo, monospace',
};

function axis(title?: string, size: number = 11): any {
  return {
    gridcolor: THEME.grid,
    zerolinecolor: THEME.zero,
    linecolor: THEME.grid,
    color: THEME.inkDim,
    ...(title ? { title: { text: title, font: { size } } } : {}),
  };
}

function sceneAxis(title: string): any {
  return {
    title: { text: title }, gridcolor: THEME.grid, zerolinecolor: THEME.zero, showbackground: false,
    color: THEME.inkDim,
  };
}

function baseLayout(size: number): any {
  return {
    paper_bgcolor: THEME.clear,
    plot_bgcolor: THEME.clear,
    font: { family: THEME.mono, color: THEME.ink, size },
    hoverlabel: { bgcolor: THEME.panel, bordercolor: THEME.accent, font: { family: THEME.mono, color: THEME.ink } },
    modebar: { bgcolor: THEME.clear, color: THEME.inkFaint, activecolor: THEME.accent },
  };
}

const overlayLegend: any = {
  x: 1, xanchor: "right", y: 1, font: { size: 10 }, bgcolor: THEME.clear, borderwidth: 0,
};

export const plotlyLayout: any = {
  ...baseLayout(12),
  margin: { l: 64, r: 24, t: 16, b: 52 },
  xaxis: axis(),
  yaxis: axis(),
  legend: overlayLegend,
};

export const plotlyConfig: any = {
  responsive: true,
  displayModeBar: "hover",
  displaylogo: false,
};

const smallPlotConfig: any = { responsive: true, displayModeBar: "hover", displaylogo: false };

// --- Antenna Pattern Plots ---
const patternPlotLayout: any = {
  ...baseLayout(10),
  margin: { l: 40, r: 10, t: 8, b: 32 },
  xaxis: axis("Angle (°)", 10),
  yaxis: axis("dB", 10),
  showlegend: false,
};

const patternPlotConfig: any = { responsive: true, displayModeBar: false };

// --- Secondary Plot ---
// One small plot rides over the stage, beside the panels, and shows what is
// being edited: the waveform, a channel's antenna pattern, or where the
// channels sit on the platform.
export type SidePlot = "waveform" | "pattern" | "layout";

export interface PatternChannel {
  pfx: "tx" | "rx";
  index: number;
}

let _sidePlot: SidePlot = "waveform";
let _patternChannel: PatternChannel = { pfx: "tx", index: 0 };
/** What the plot's element holds now; a different kind is drawn from scratch. */
let _sideDrawn: SidePlot | null = null;

/** The element to draw a kind of plot into, or null while it is not the one showing. */
function _sideContainer(kind: SidePlot): HTMLElement | null {
  if (kind !== _sidePlot || isResultView(stageView())) return null;
  if (document.getElementById("side-plot")?.classList.contains("collapsed")) return null;
  const container = document.getElementById("side-plot-view");
  if (container && _sideDrawn !== kind) {
    Plotly.purge(container);
    _sideDrawn = kind;
  }
  return container;
}

/** Bring a plot up; for a pattern, of the channel given or the one last shown. */
export function showSidePlot(kind: SidePlot, channel?: PatternChannel): void {
  _sidePlot = kind;
  if (channel) _patternChannel = channel;
  setPref("sidePlot", kind);
  document.querySelectorAll<HTMLElement>("button[data-side]").forEach((b) => {
    b.setAttribute("aria-checked", String(b.dataset.side === kind));
  });
  redrawSidePlot();
}

export function redrawSidePlot(): void {
  if (_sidePlot === "waveform") updateTxWaveformPlot();
  else if (_sidePlot === "pattern") _drawPattern();
  else updateLayoutPlot();

  const title = document.getElementById("side-plot-title");
  if (title) {
    title.textContent = _sidePlot === "waveform" ? "Frequency vs time"
      : _sidePlot === "layout" ? "Array face, along boresight"
      : `${_patternChannel.pfx.toUpperCase()} ${_patternChannel.index + 1} antenna pattern`;
  }
}

// --- Antenna Pattern Plot ---
function _drawPattern(): void {
  // The channel last shown may have been removed since
  const channels = _patternChannel.pfx === "tx" ? txChannels : rxChannels;
  if (_patternChannel.index >= channels.length) {
    _patternChannel = { ..._patternChannel, index: Math.max(0, channels.length - 1) };
  }
  const plotDiv = _sideContainer("pattern");
  if (!plotDiv) return;

  const { pfx, index } = _patternChannel;
  const field = (name: string): number[] =>
    parseCSV((document.getElementById(`${pfx}-ch-${index}-${name}`) as HTMLTextAreaElement | null)?.value ?? "");
  const azAngles = field("az-angles"), azPattern = field("az-pattern");
  const elAngles = field("el-angles"), elPattern = field("el-pattern");

  const traces: any[] = [];
  if (azAngles.length > 0 && azPattern.length > 0) {
    traces.push({
      x: azAngles, y: azPattern,
      type: "scatter", mode: "lines+markers", name: "Azimuth",
      line: { color: THEME.signal, width: 2 },
      marker: { size: 4, color: THEME.signal },
      fill: "tozeroy", fillcolor: THEME.signalSoft,
    });
  }
  if (elAngles.length > 0 && elPattern.length > 0) {
    traces.push({
      x: elAngles, y: elPattern,
      type: "scatter", mode: "lines+markers", name: "Elevation",
      line: { color: THEME.second, width: 2 },
      marker: { size: 4, color: THEME.second },
      fill: "tozeroy", fillcolor: THEME.secondSoft,
    });
  }

  const layout = {
    ...patternPlotLayout,
    showlegend: true,
    legend: overlayLegend,
  };
  Plotly.react(plotDiv, traces, layout, patternPlotConfig);
}

/** Redraw a channel's pattern, if that channel's is the one showing. */
export function updateChannelPatternPlot(pfx: string, index: number): void {
  if (pfx === _patternChannel.pfx && index === _patternChannel.index) _drawPattern();
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

// --- TX Waveform Preview Plot ---
export function updateTxWaveformPlot(): void {
  const container = _sideContainer("waveform");
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
        line: { color: THEME.signal, width: 1, dash: "dot" },
        showlegend: false,
      });
    }
    traces.push({
      x: [offset + tStart, offset + tEnd],
      y: [fStart, fEnd],
      type: "scatter", mode: "lines",
      line: { color: THEME.signal, width: 2.5 },
      showlegend: false,
    });
    if (prp > tEnd) {
      traces.push({
        x: [offset + tEnd, offset + prp],
        y: [fEnd, fStart],
        type: "scatter", mode: "lines",
        line: { color: THEME.signal, width: 1, dash: "dot" },
        showlegend: false,
      });
    }
  }

  const layout = {
    ...baseLayout(10),
    margin: { l: 52, r: 10, t: 10, b: 36 },
    xaxis: axis("Time (µs)", 10),
    yaxis: axis("Frequency (GHz)", 10),
    showlegend: false,
  };

  Plotly.react(container, traces, layout, smallPlotConfig);
}

// --- Channel Layout Plot ---
// Where the channels sit on the platform, in its own frame: what the location
// fields say, before the platform's position and rotation are applied. Drawn
// as the face of the array, seen from behind it looking along the boresight
// (+x), so +y is to the left and +z is up. The 3D scene has the rest.
function _channelTrace(pfx: string, count: number, color: string, symbol: string): any {
  const ys: number[] = [], zs: number[] = [], labels: string[] = [], hover: string[] = [];
  const field = (i: number, axis: string): number =>
    parseNumber((document.getElementById(`${pfx}-ch-${i}-loc-${axis}`) as HTMLInputElement | null)?.value);
  for (let i = 0; i < count; i++) {
    const x = field(i, "x"), y = field(i, "y"), z = field(i, "z");
    ys.push(y); zs.push(z);
    labels.push(`${pfx.toUpperCase()}${i + 1}`);
    hover.push(`${pfx.toUpperCase()} ${i + 1}<br>x ${x} mm<br>y ${y} mm<br>z ${z} mm`);
  }
  return {
    x: ys, y: zs,
    text: labels,
    hovertext: hover, hoverinfo: "text",
    type: "scatter",
    mode: "markers+text",
    name: pfx.toUpperCase(),
    marker: { size: 10, color, symbol, line: { width: 1, color: THEME.panel } },
    textposition: pfx === "tx" ? "top center" : "bottom center",
    textfont: { size: 10, color },
  };
}

export function updateLayoutPlot(): void {
  const container = _sideContainer("layout");
  if (!container) return;

  const layout = {
    ...baseLayout(10),
    margin: { l: 46, r: 10, t: 10, b: 36 },
    xaxis: { ...axis("Y (mm)", 10), autorange: "reversed" },
    // One scale on both axes: the array keeps its shape
    yaxis: { ...axis("Z (mm)", 10), scaleanchor: "x" },
    showlegend: true,
    legend: overlayLegend,
  };
  Plotly.react(container, [
    _channelTrace("tx", txChannels.length, THEME.tx, "diamond"),
    _channelTrace("rx", rxChannels.length, THEME.rx, "circle-open"),
  ], layout, smallPlotConfig);
}

// --- Plot Simulation Results ---
// One result is on the stage at a time. A plot is drawn when its view comes up,
// and again only once its data or the channel / pulse picked has changed.
const _stale = new Set<StageView>();

export function plotResults(data: any): void {
  document.getElementById("results-outdated-banner")?.classList.add("hidden");
  if (data.range_doppler) {
    _lastRangeDopplerData = data.range_doppler;
    _lastRdRangeAxis = data.rd_range_axis || null;
    _lastRdVelocityAxis = data.rd_doppler_axis || null;
    _stale.add("range-doppler");
  }

  if (data.range_profile) {
    _lastRangeProfileData = data.range_profile;
    _lastRangeAxis = data.rp_range_axis || null;
    _stale.add("range-profile");
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
    _stale.add("baseband");
  }

  renderResultView();
}

/** Draw the result view that is up, if it has anything new to show. */
export function renderResultView(): void {
  const view = stageView();
  if (!_stale.delete(view)) return;
  if (view === "baseband") _plotBaseband();
  else if (view === "range-profile") _plotRangeProfile();
  else if (view === "range-doppler") _plotRangeDoppler();
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
    colorbar: {
      title: { text: "dB" }, thickness: 12, len: 0.6, outlinewidth: 0, tickfont: { color: THEME.inkDim },
    },
    showscale: true,
  };
  if (_lastRdRangeAxis) trace.x = _lastRdRangeAxis;
  if (_lastRdVelocityAxis) trace.y = _lastRdVelocityAxis;

  const layout = {
    ...baseLayout(12),
    margin: { l: 0, r: 0, t: 0, b: 0 },
    scene: {
      xaxis: sceneAxis("Range Bin"),
      yaxis: sceneAxis("Doppler Bin"),
      zaxis: sceneAxis("dB"),
      bgcolor: THEME.clear,
      // Back far enough that the axis titles stay inside the plot
      camera: { eye: { x: 1.55, y: 1.55, z: 1.1 } },
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
    line: { color: THEME.signal, width: 1.5 },
  };
  if (_lastRangeAxis) trace.x = _lastRangeAxis;
  const layout = {
    ...plotlyLayout,
    xaxis: axis("Range Bin"),
    yaxis: axis("Magnitude (dB)"),
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
      line: { color: THEME.signal, width: 1 },
    },
  ];
  if (_lastBbType !== "real") {
    traces.push({
      y: chData.im,
      type: "scatter", mode: "lines", name: "Imag",
      line: { color: THEME.imag, width: 1 },
    });
  }
  const layout = {
    ...plotlyLayout,
    showlegend: true,
    xaxis: axis("Sample"),
    yaxis: axis("Amplitude"),
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
  _stale.clear();

  document.getElementById("results-outdated-banner")?.classList.add("hidden");

  const statusEl = document.getElementById("sim-status");
  if (statusEl) { statusEl.textContent = ""; statusEl.className = "status-msg"; }

  const exportBtn = document.getElementById("btn-export") as HTMLButtonElement | null;
  if (exportBtn) exportBtn.disabled = true;

  setResultViewsAvailable({});
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
    _stale.add("baseband").add("range-profile");
    renderResultView();
  });
  document.getElementById("bb-ch-idx")?.addEventListener("change", () => {
    _stale.add("baseband").add("range-profile").add("range-doppler");
    renderResultView();
  });

  const debouncedMarkOutdated = debounce(markResultsOutdated, 200);
  const configPanels = ["panel-radar", "panel-targets", "panel-simulation"];
  const handler = (e: Event): void => {
    if ((e.target as HTMLElement).matches("input, select")) debouncedMarkOutdated();
  };
  configPanels.forEach((panelId) => {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    panel.addEventListener("input", handler);
    panel.addEventListener("change", handler);
  });
});
