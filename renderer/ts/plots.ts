// ===== RadarSimApp - Plot Functions =====

import { updateReadout } from "./readout.js";
import { updateScene } from "./scene.js";
import { rxChannels, txChannels } from "./shared.js";
import { type StageView, setResultViewsAvailable, stageView } from "./stage.js";
import { debounce, fieldCSV, fieldNumber, fieldValue } from "./utils.js";

/** Refresh what follows the waveform fields: the readout and the waveform plot. */
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
  signal: "#8bc34a", // also --cut-az: the azimuth cut, here and in the scene
  signalSoft: "rgba(139,195,74,0.08)",
  second: "#2ec5d8", // also --cut-el: the elevation cut
  secondSoft: "rgba(46,197,216,0.08)",
  imag: "#ff7b3a",
  panel: "#17131f",
  mono: 'ui-monospace, "SFMono-Regular", "Cascadia Mono", Consolas, Menlo, monospace',
};

function axis(title?: string, size: number = 11): PlotlyObject {
  return {
    gridcolor: THEME.grid,
    zerolinecolor: THEME.zero,
    linecolor: THEME.grid,
    color: THEME.inkDim,
    ...(title ? { title: { text: title, font: { size } } } : {}),
  };
}

function sceneAxis(title: string): PlotlyObject {
  return {
    title: { text: title },
    gridcolor: THEME.grid,
    zerolinecolor: THEME.zero,
    showbackground: false,
    color: THEME.inkDim,
  };
}

function baseLayout(size: number): PlotlyObject {
  return {
    paper_bgcolor: THEME.clear,
    plot_bgcolor: THEME.clear,
    font: { family: THEME.mono, color: THEME.ink, size },
    hoverlabel: { bgcolor: THEME.panel, bordercolor: THEME.accent, font: { family: THEME.mono, color: THEME.ink } },
    modebar: { bgcolor: THEME.clear, color: THEME.inkFaint, activecolor: THEME.accent },
  };
}

const overlayLegend: PlotlyObject = {
  x: 1,
  xanchor: "right",
  y: 1,
  font: { size: 10 },
  bgcolor: THEME.clear,
  borderwidth: 0,
};

const resultLayout: PlotlyObject = {
  ...baseLayout(12),
  margin: { l: 64, r: 24, t: 16, b: 52 },
  xaxis: axis(),
  yaxis: axis(),
  legend: overlayLegend,
};

const plotConfig: PlotlyObject = {
  responsive: true,
  displayModeBar: "hover",
  displaylogo: false,
};

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
const _resized =
  typeof ResizeObserver === "undefined"
    ? null
    : new ResizeObserver((entries) => {
        for (const { target, contentRect } of entries) {
          // Plotly marks an element it has drawn into with _fullLayout
          const drawn = (target as Element & { _fullLayout?: unknown })._fullLayout;
          if (contentRect.width > 0 && drawn) Plotly.Plots.resize(target as HTMLElement);
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
  txChannels.forEach((_, i) => {
    updateChannelPatternPlot("tx", i);
  });
  rxChannels.forEach((_, i) => {
    updateChannelPatternPlot("rx", i);
  });
}

// --- Antenna Pattern Plot ---
// Polar, the way antenna patterns are read: boresight up, gain outward.
const PATTERN_DEPTH_DB = 40;
const PATTERN_MIN_DEPTH_DB = 20;
const patternPlotConfig: PlotlyObject = { responsive: true, displayModeBar: false };

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
    const [a0, g0] = pts[i],
      [a1, g1] = pts[i + 1];
    const steps = Math.min(360, Math.max(1, Math.ceil(a1 - a0)));
    for (let k = 0; k < steps; k++) {
      out.angles.push(a0 + ((a1 - a0) * k) / steps);
      out.gains.push(g0 + ((g1 - g0) * k) / steps);
    }
  }
  const last = pts[pts.length - 1];
  out.angles.push(last[0]);
  out.gains.push(last[1]);
  return out;
}

/** Redraw a channel's pattern, if its card is the one showing. */
function updateChannelPatternPlot(pfx: string, index: number): void {
  const plotDiv = _visible(`${pfx}-ch-${index}-pattern-plot`);
  if (!plotDiv) return;

  const field = (name: string): number[] => fieldCSV(`${pfx}-ch-${index}-${name}`);
  const cuts = [
    {
      name: "Azimuth",
      angles: field("az-angles"),
      gains: field("az-pattern"),
      color: THEME.signal,
      fill: THEME.signalSoft,
    },
    {
      name: "Elevation",
      angles: field("el-angles"),
      gains: field("el-pattern"),
      color: THEME.second,
      fill: THEME.secondSoft,
    },
  ].filter((c) => c.angles.length > 0 && c.angles.length === c.gains.length);

  const gains = cuts.flatMap((c) => c.gains);
  const angles = cuts.flatMap((c) => c.angles);
  const peak = gains.length ? Math.max(...gains) : 0;
  // At least 20 dB deep, so a flat pattern reads as a full arc and not a dot
  const floor = Math.min(
    Math.max(gains.length ? Math.min(...gains) : peak, peak - PATTERN_DEPTH_DB),
    peak - PATTERN_MIN_DEPTH_DB,
  );
  const range = [floor, peak];

  const traces = cuts.flatMap((c) => {
    const { angles: theta, gains: dB } = _resampleCut(c.angles, c.gains);
    // Below the floor is drawn at the floor, not folded through the centre
    const r = dB.map((g) => Math.max(g, floor));
    // A cut over part of the circle is filled as a wedge back to the centre;
    // filling the line alone would close it with a chord across the disc
    const whole = theta[theta.length - 1] - theta[0] >= 360;
    const fill = {
      type: "scatterpolar",
      mode: "none",
      hoverinfo: "skip",
      theta: whole ? theta : [theta[0], ...theta, theta[theta.length - 1]],
      r: whole ? r : [floor, ...r, floor],
      fill: "toself",
      fillcolor: c.fill,
    };
    const line = {
      type: "scatterpolar",
      mode: "lines",
      name: c.name,
      theta,
      r,
      customdata: dB,
      hovertemplate: `${c.name} %{theta:.0f}°: %{customdata:.1f} dB<extra></extra>`,
      line: { color: c.color, width: 2 },
    };
    return [fill, line];
  });

  // A pattern over less than the full circle is drawn as that much of a disc
  const lo = angles.length ? Math.min(...angles) : -180;
  const hi = angles.length ? Math.max(...angles) : 180;
  const full = hi - lo >= 360;
  const sector = full ? [0, 360] : [lo + 90, hi + 90];
  // Signed angles, as the fields are written: −30° rather than 330°. Over part
  // of the circle Plotly keeps only ticks inside the span, in the fields' own
  // terms, so those are given signed too.
  const ticks: number[] = [];
  if (full) for (let a = -150; a <= 180; a += 30) ticks.push(a);
  else for (let a = Math.ceil(lo / 30) * 30; a <= hi; a += 30) ticks.push(a);

  const layout = {
    ...baseLayout(10),
    // Room for the angle labels round the rim and the dB labels at the centre
    margin: full ? { l: 28, r: 28, t: 24, b: 24 } : { l: 40, r: 40, t: 24, b: 24 },
    // The fields under the plot carry the colour key: no legend over the disc
    showlegend: false,
    polar: {
      bgcolor: THEME.clear,
      sector,
      angularaxis: {
        rotation: 90,
        direction: "counterclockwise",
        thetaunit: "degrees",
        gridcolor: THEME.grid,
        linecolor: THEME.grid,
        color: THEME.inkDim,
        tickmode: "array",
        tickvals: full ? ticks.map((a) => (a + 360) % 360) : ticks,
        ticktext: ticks.map((a) => `${a}°`),
      },
      radialaxis: {
        range,
        gridcolor: THEME.grid,
        linecolor: THEME.grid,
        color: THEME.inkFaint,
        ticksuffix: " dB",
        angle: sector[0],
        tickangle: sector[0],
        nticks: 3,
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
    document.getElementById(`${pfx}-ch-${index}-${field}`)?.addEventListener("input", debouncedUpdate);
  });
}

// --- TX Waveform Preview Plot ---
export function updateTxWaveformPlot(): void {
  const container = _visible("plot-waveform");
  if (!container) return;

  const fStart = fieldNumber("tx-f-start");
  const fEnd = fieldNumber("tx-f-end");
  const tStart = fieldNumber("tx-t-start");
  const tEnd = fieldNumber("tx-t-end");
  const prp = fieldNumber("tx-prp", 100);

  const traces: PlotlyObject[] = [];
  const numCycles = 2;

  for (let i = 0; i < numCycles; i++) {
    const offset = i * prp;
    if (tStart > 0) {
      traces.push({
        x: [offset, offset + tStart],
        y: [fStart, fStart],
        type: "scatter",
        mode: "lines",
        line: { color: THEME.signal, width: 1, dash: "dot" },
        showlegend: false,
      });
    }
    traces.push({
      x: [offset + tStart, offset + tEnd],
      y: [fStart, fEnd],
      type: "scatter",
      mode: "lines",
      line: { color: THEME.signal, width: 2.5 },
      showlegend: false,
    });
    if (prp > tEnd) {
      traces.push({
        x: [offset + tEnd, offset + prp],
        y: [fEnd, fStart],
        type: "scatter",
        mode: "lines",
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

  Plotly.react(container, traces, layout, plotConfig);
}

// --- Plot Simulation Results ---
// One result is on the stage at a time. A plot is drawn when its view comes up,
// and again only once its data or the channel / pulse picked has changed.
const _stale = new Set<StageView>();

/** The last run's results, kept to redraw from as the pulse or channel picked changes. */
const _result: {
  baseband: SimResult["baseband"] | null;
  bbType: string;
  rangeProfile: number[][][] | null;
  rangeAxis: number[] | null;
  rangeDoppler: number[][][] | null;
  rdRangeAxis: number[] | null;
  rdDopplerAxis: number[] | null;
} = {
  baseband: null,
  bbType: "complex",
  rangeProfile: null,
  rangeAxis: null,
  rangeDoppler: null,
  rdRangeAxis: null,
  rdDopplerAxis: null,
};

/** The pulse or channel picked for the result plots: never below 0. */
function _pickedIndex(id: "bb-pulse-idx" | "bb-ch-idx"): number {
  return Math.max(0, parseInt(fieldValue(id) ?? "", 10) || 0);
}

export function plotResults(data: SimResult): void {
  document.getElementById("results-outdated-banner")?.classList.add("hidden");
  if (data.range_doppler) {
    _result.rangeDoppler = data.range_doppler;
    _result.rdRangeAxis = data.rd_range_axis || null;
    _result.rdDopplerAxis = data.rd_doppler_axis || null;
    _stale.add("range-doppler");
  }

  if (data.range_profile) {
    _result.rangeProfile = data.range_profile;
    _result.rangeAxis = data.rp_range_axis || null;
    _stale.add("range-profile");
  }

  if (data.baseband) {
    _result.baseband = data.baseband;
    _result.bbType = data.bb_type || "complex";
    const numPulses = data.baseband.length;
    const numCh = data.baseband[0]?.length ?? 1;
    const pulseInput = document.getElementById("bb-pulse-idx") as HTMLInputElement;
    const chInput = document.getElementById("bb-ch-idx") as HTMLInputElement;
    pulseInput.max = String(numPulses - 1);
    chInput.max = String(numCh - 1);
    pulseInput.value = String(Math.min(parseInt(pulseInput.value, 10) || 0, numPulses - 1));
    chInput.value = String(Math.min(parseInt(chInput.value, 10) || 0, numCh - 1));
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

function _plotRangeDoppler(): void {
  const container = document.getElementById("plot-range-doppler");
  if (!_result.rangeDoppler || !container) return;
  const chIdx = _pickedIndex("bb-ch-idx");

  // One channel's map: [Doppler bin][range bin]
  const rd = _result.rangeDoppler.map((bin) => bin[Math.min(chIdx, bin.length - 1)]);

  container.classList.add("has-data");
  const trace: PlotlyObject = {
    z: rd,
    type: "surface",
    colorscale: "Viridis",
    colorbar: {
      title: { text: "dB" },
      thickness: 12,
      len: 0.6,
      outlinewidth: 0,
      tickfont: { color: THEME.inkDim },
    },
    showscale: true,
  };
  if (_result.rdRangeAxis) trace.x = _result.rdRangeAxis;
  if (_result.rdDopplerAxis) trace.y = _result.rdDopplerAxis;

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
  Plotly.newPlot(container, [trace], layout, plotConfig);
}

function _plotRangeProfile(): void {
  const container = document.getElementById("plot-range-profile");
  if (!_result.rangeProfile || !container) return;
  const pulseIdx = _pickedIndex("bb-pulse-idx");
  const chIdx = _pickedIndex("bb-ch-idx");

  const pulseData = _result.rangeProfile[Math.min(pulseIdx, _result.rangeProfile.length - 1)];
  const rp = pulseData ? pulseData[Math.min(chIdx, pulseData.length - 1)] : [];

  container.classList.add("has-data");
  const trace: PlotlyObject = {
    y: rp,
    type: "scatter",
    mode: "lines",
    line: { color: THEME.signal, width: 1.5 },
  };
  if (_result.rangeAxis) trace.x = _result.rangeAxis;
  const layout = {
    ...resultLayout,
    xaxis: axis("Range Bin"),
    yaxis: axis("Magnitude (dB)"),
  };
  Plotly.newPlot(container, [trace], layout, plotConfig);
}

function _plotBaseband(): void {
  const container = document.getElementById("plot-baseband");
  if (!_result.baseband || !container) return;
  const pulseIdx = _pickedIndex("bb-pulse-idx");
  const chIdx = _pickedIndex("bb-ch-idx");

  const pulseData = _result.baseband[Math.min(pulseIdx, _result.baseband.length - 1)];
  const chData = pulseData?.[Math.min(chIdx, pulseData.length - 1)];
  if (!chData) return;

  container.classList.add("has-data");
  const traces: PlotlyObject[] = [
    {
      y: chData.re,
      type: "scatter",
      mode: "lines",
      name: "Real",
      line: { color: THEME.signal, width: 1 },
    },
  ];
  if (_result.bbType !== "real") {
    traces.push({
      y: chData.im,
      type: "scatter",
      mode: "lines",
      name: "Imag",
      line: { color: THEME.imag, width: 1 },
    });
  }
  const layout = {
    ...resultLayout,
    showlegend: true,
    xaxis: axis("Sample"),
    yaxis: axis("Amplitude"),
  };
  Plotly.newPlot(container, traces, layout, plotConfig);
}

export function markResultsOutdated(): void {
  if (!_result.baseband && !_result.rangeProfile && !_result.rangeDoppler) return;
  document.getElementById("results-outdated-banner")?.classList.remove("hidden");
}

export function clearResultPlots(): void {
  _result.baseband = null;
  _result.rangeProfile = null;
  _result.rangeAxis = null;
  _result.rangeDoppler = null;
  _result.rdRangeAxis = null;
  _result.rdDopplerAxis = null;
  _stale.clear();

  document.getElementById("results-outdated-banner")?.classList.add("hidden");

  const statusEl = document.getElementById("sim-status");
  if (statusEl) {
    statusEl.textContent = "";
    statusEl.className = "status-msg";
  }

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
