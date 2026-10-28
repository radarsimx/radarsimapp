// ===== RadarSimApp - Plot Functions =====

import { debounce, parseNumber, parseCSV } from './utils.js';
import { txChannels, rxChannels } from './shared.js';
import { updateReadout } from './readout.js';
import { updateScene } from './scene.js';
import { stageView, setResultViewsAvailable, type StageView } from './stage.js';

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
  signal: "#8bc34a",  // also --cut-az: the azimuth cut, here and in the scene
  signalSoft: "rgba(139,195,74,0.08)",
  tx: "#8bc34a",
  rx: "#4e9eff",
  second: "#2ec5d8",  // also --cut-el: the elevation cut
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

// --- Inspector Plots ---
// Each plot sits in the inspector beside the fields it shows: the waveform in
// the waveform generator's, a channel's antenna pattern in that channel's.
// Only the fields picked are laid out, and a plot is drawn only while it is:
// Plotly cannot size a hidden element.
function _visible(id: string): HTMLElement | null {
  const elem = document.getElementById(id);
  if (!elem || elem.offsetParent === null) return null;
  _fitToBox(elem);
  return elem;
}

// A plot keeps the width it was drawn at, and Plotly's own "responsive" only
// follows the window. The panel can change width under it (as it settles at
// start-up, or as the column does), so each plot follows its own box.
const _resized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver((entries) => {
  for (const { target, contentRect } of entries) {
    if (contentRect.width > 0 && (target as any)._fullLayout) Plotly.Plots.resize(target as HTMLElement);
  }
});
const _fitted = new WeakSet<Element>();

function _fitToBox(elem: HTMLElement): void {
  if (!_resized || _fitted.has(elem)) return;
  _fitted.add(elem);
  _resized.observe(elem);
}

/** Draw whichever inspector plots are in view, after the selection or the panel changes. */
export function redrawInspectorPlots(): void {
  updateTxWaveformPlot();
  txChannels.forEach((_, i) => updateChannelPatternPlot("tx", i));
  rxChannels.forEach((_, i) => updateChannelPatternPlot("rx", i));
}

// --- Antenna Pattern Plot ---
// Polar, the way antenna patterns are read: boresight up, gain outward.
const PATTERN_DEPTH_DB = 40;
const PATTERN_MIN_DEPTH_DB = 20;
const patternPlotConfig: any = { responsive: true, displayModeBar: false };

/**
 * A cut at every degree, linear in dB between the points given. Plotly joins
 * polar points with straight lines, so a pattern given at a few angles would
 * otherwise cut across the disc instead of following it round.
 */
function _resampleCut(angles: number[], gains: number[]): { angles: number[]; gains: number[] } {
  const pts = angles.map((a, i) => [a, gains[i]]).sort((p, q) => p[0] - q[0]);
  if (pts.length < 2) return { angles: pts.map((p) => p[0]), gains: pts.map((p) => p[1]) };
  const out = { angles: [] as number[], gains: [] as number[] };
  for (let i = 0; i < pts.length - 1; i++) {
    const [a0, g0] = pts[i], [a1, g1] = pts[i + 1];
    const steps = Math.min(360, Math.max(1, Math.ceil(a1 - a0)));
    for (let k = 0; k < steps; k++) {
      out.angles.push(a0 + (a1 - a0) * k / steps);
      out.gains.push(g0 + (g1 - g0) * k / steps);
    }
  }
  const last = pts[pts.length - 1];
  out.angles.push(last[0]);
  out.gains.push(last[1]);
  return out;
}

/** Redraw a channel's pattern, if its card is the one showing. */
export function updateChannelPatternPlot(pfx: string, index: number): void {
  const plotDiv = _visible(`${pfx}-ch-${index}-pattern-plot`);
  if (!plotDiv) return;

  const field = (name: string): number[] =>
    parseCSV((document.getElementById(`${pfx}-ch-${index}-${name}`) as HTMLTextAreaElement | null)?.value ?? "");
  const cuts = [
    { name: "Azimuth", angles: field("az-angles"), gains: field("az-pattern"), color: THEME.signal, fill: THEME.signalSoft },
    { name: "Elevation", angles: field("el-angles"), gains: field("el-pattern"), color: THEME.second, fill: THEME.secondSoft },
  ].filter((c) => c.angles.length > 0 && c.angles.length === c.gains.length);

  const gains = cuts.flatMap((c) => c.gains);
  const angles = cuts.flatMap((c) => c.angles);
  const peak = gains.length ? Math.max(...gains) : 0;
  // At least 20 dB deep, so a flat pattern reads as a full arc and not a dot
  const floor = Math.min(
    Math.max(gains.length ? Math.min(...gains) : peak, peak - PATTERN_DEPTH_DB),
    peak - PATTERN_MIN_DEPTH_DB);
  const range = [floor, peak];

  const traces = cuts.map((c) => {
    const { angles: theta, gains: dB } = _resampleCut(c.angles, c.gains);
    return {
      type: "scatterpolar", mode: "lines", name: c.name,
      theta,
      // Below the floor is drawn at the floor, not folded through the centre
      r: dB.map((g) => Math.max(g, floor)),
      customdata: dB,
      hovertemplate: `${c.name} %{theta:.0f}°: %{customdata:.1f} dB<extra></extra>`,
      line: { color: c.color, width: 2 },
      fill: "toself", fillcolor: c.fill,
    };
  });

  // A pattern over less than the full circle is drawn as that much of a disc
  let sector = [0, 360];
  if (angles.length) {
    const lo = Math.min(...angles), hi = Math.max(...angles);
    if (hi - lo < 360) sector = [lo + 90, hi + 90];
  }
  const full = sector[1] - sector[0] >= 360;
  // Signed angles, as the fields are written: −30° rather than 330°
  const ticks: number[] = [];
  for (let a = full ? -150 : -180; a <= 180; a += 30) ticks.push(a);

  const layout = {
    ...baseLayout(10),
    // A whole disc has labels at the top and bottom too
    margin: full ? { l: 28, r: 28, t: 24, b: 24 } : { l: 28, r: 28, t: 12, b: 12 },
    // The fields under the plot carry the colour key: no legend over the disc
    showlegend: false,
    polar: {
      bgcolor: THEME.clear,
      sector,
      angularaxis: {
        rotation: 90, direction: "counterclockwise", thetaunit: "degrees",
        gridcolor: THEME.grid, linecolor: THEME.grid, color: THEME.inkDim,
        tickmode: "array", tickvals: ticks.map((a) => (a + 360) % 360), ticktext: ticks.map((a) => `${a}°`),
      },
      radialaxis: {
        range, gridcolor: THEME.grid, linecolor: THEME.grid, color: THEME.inkFaint,
        ticksuffix: " dB", angle: sector[0], tickangle: sector[0], nticks: 3,
      },
    },
  };
  Plotly.react(plotDiv, traces, layout, patternPlotConfig);
}

export function attachPatternListeners(pfx: string, index: number): void {
  const debouncedUpdate = debounce(() => {
    updateChannelPatternPlot(pfx, index);
    // The patterns' angles set the spans drawn in the scene
    updateScene();
  });
  ["az-angles", "az-pattern", "el-angles", "el-pattern"].forEach((field) => {
    const elem = document.getElementById(`${pfx}-ch-${index}-${field}`);
    if (elem) {
      elem.addEventListener("input", debouncedUpdate);
    }
  });
}

// --- TX Waveform Preview Plot ---
export function updateTxWaveformPlot(): void {
  const container = _visible("plot-waveform");
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
