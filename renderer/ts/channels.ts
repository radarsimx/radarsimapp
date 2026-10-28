// ===== RadarSimApp - Channel Functions =====

import { el, createInput, createTextInput, createSVG, debounce, formatComplex, isValidComplex, parseNumber, parseCSV, confirmAsync, setCount } from './utils.js';
import { attachPatternListeners, redrawInspectorPlots, markResultsOutdated } from './plots.js';
import { renderOutline } from './outline.js';
import { updateScene } from './scene.js';
import { txChannels, rxChannels } from './shared.js';
import { debouncedAutoSave } from './state.js';

function createChannelCard(prefix: string, index: number, data: ChannelData, isTx: boolean): HTMLElement {
  const pfx = prefix.toLowerCase();

  // Build the fields column
  const fields = el("div", { className: "channel-card-fields" }, [
    // Location
    el("div", { className: "form-group" }, [
      el("label", { textContent: "Location (mm)" }),
      el("div", { className: "form-row triple" }, [
        el("div", { className: "form-group" }, [
          el("label", { textContent: "x" }),
          createInput(`${pfx}-ch-${index}-loc-x`, (data.location?.[0] ?? 0) * 1000, 0.1),
        ]),
        el("div", { className: "form-group" }, [
          el("label", { textContent: "y" }),
          createInput(`${pfx}-ch-${index}-loc-y`, (data.location?.[1] ?? 0) * 1000, 0.1),
        ]),
        el("div", { className: "form-group" }, [
          el("label", { textContent: "z" }),
          createInput(`${pfx}-ch-${index}-loc-z`, (data.location?.[2] ?? 0) * 1000, 0.1),
        ]),
      ]),
    ]),

    // Polarization
    el("div", { className: "form-group" }, [
      el("label", {}, [
        el("span", { textContent: "Polarization" }),
        el("i", { className: "info-icon", "data-tooltip": "Real: 1  or  -0.5\nImaginary: 1j  or  -j\nComplex: 1+2j  or  0.5-1.5j" }, ["?"]),
      ]),
      el("div", { className: "form-row triple" }, [
        el("div", { className: "form-group" }, [
          el("label", { textContent: "x" }),
          el("input", { type: "text", id: `${pfx}-ch-${index}-pol-x`, value: formatComplex(data.polarization?.[0] ?? 0), onInput: (e: any) => e.target.classList.toggle("is-invalid", !isValidComplex(e.target.value)) }),
        ]),
        el("div", { className: "form-group" }, [
          el("label", { textContent: "y" }),
          el("input", { type: "text", id: `${pfx}-ch-${index}-pol-y`, value: formatComplex(data.polarization?.[1] ?? 0), onInput: (e: any) => e.target.classList.toggle("is-invalid", !isValidComplex(e.target.value)) }),
        ]),
        el("div", { className: "form-group" }, [
          el("label", { textContent: "z" }),
          el("input", { type: "text", id: `${pfx}-ch-${index}-pol-z`, value: formatComplex(data.polarization?.[2] ?? 1), onInput: (e: any) => e.target.classList.toggle("is-invalid", !isValidComplex(e.target.value)) }),
        ]),
      ]),
    ]),
  ]);

  if (isTx) {
    fields.appendChild(
      el("div", { className: "form-group" }, [
        el("label", { textContent: "Delay (ns)" }),
        createInput(`tx-ch-${index}-delay`, (data.delay ?? 0) * 1e9, 1),
      ])
    );
  }

  // Antenna pattern: the plot of both cuts, then the azimuth and elevation fields
  fields.append(
    el("div", { className: "insp-plot pattern-plot", id: `${pfx}-ch-${index}-pattern-plot` }),
    el("div", { className: "form-group" }, [
      el("label", { className: "cut-key cut-az", textContent: "Azimuth Angles (°)" }),
      createTextInput(
        `${pfx}-ch-${index}-az-angles`,
        data.azimuth_angle?.join(", ") ?? "-90, 90"
      ),
    ]),
    el("div", { className: "form-group" }, [
      el("label", { className: "cut-key cut-az", textContent: "Azimuth Pattern (dB)" }),
      createTextInput(
        `${pfx}-ch-${index}-az-pattern`,
        data.azimuth_pattern?.join(", ") ?? "0, 0"
      ),
    ]),

    // Antenna Pattern (elevation)
    el("div", { className: "form-group" }, [
      el("label", { className: "cut-key cut-el", textContent: "Elevation Angles (°)" }),
      createTextInput(
        `${pfx}-ch-${index}-el-angles`,
        data.elevation_angle?.join(", ") ?? "-90, 90"
      ),
    ]),
    el("div", { className: "form-group" }, [
      el("label", { className: "cut-key cut-el", textContent: "Elevation Pattern (dB)" }),
      createTextInput(
        `${pfx}-ch-${index}-el-pattern`,
        data.elevation_pattern?.join(", ") ?? "0, 0"
      ),
    ]),
  );

  // A channel's fields, all of them in the page; the outline picks the one that shows
  const card = el("div", { className: "channel-card collapsed" }, [
    el("div", { className: "channel-card-body" }, [
      fields,
      el("div", { className: "card-actions" }, [
        el("button", { className: "btn-secondary btn-danger", title: "Remove", onClick: () => removeChannel(prefix, index) }, [
          createSVG("trash"),
          " Remove Channel",
        ]),
      ]),
    ]),
  ]);

  return card;
}

export function renderTxChannels(): void {
  const container = document.getElementById("tx-channels-list")!;
  container.innerHTML = "";
  txChannels.forEach((ch, i) => {
    container.appendChild(createChannelCard("TX", i, ch, true));
  });
  setCount("tx-ch-count", txChannels.length);
  renderOutline();

  requestAnimationFrame(() => {
    txChannels.forEach((_, i) => attachPatternListeners("tx", i));
    redrawInspectorPlots();
    attachLocationListeners();
    updateScene();
  });
}

export function renderRxChannels(): void {
  const container = document.getElementById("rx-channels-list")!;
  container.innerHTML = "";
  rxChannels.forEach((ch, i) => {
    container.appendChild(createChannelCard("RX", i, ch, false));
  });
  setCount("rx-ch-count", rxChannels.length);
  renderOutline();

  requestAnimationFrame(() => {
    rxChannels.forEach((_, i) => attachPatternListeners("rx", i));
    redrawInspectorPlots();
    attachRxLocationListeners();
    updateScene();
  });
}

export function saveTxChannelStates(): void {
  txChannels.forEach((ch, i) => {
    const g = (id: string): string | undefined => (document.getElementById(id) as HTMLInputElement | null)?.value;
    ch.location = [
      parseNumber(g(`tx-ch-${i}-loc-x`)) * 1e-3,
      parseNumber(g(`tx-ch-${i}-loc-y`)) * 1e-3,
      parseNumber(g(`tx-ch-${i}-loc-z`)) * 1e-3,
    ];
    ch.polarization = [
      g(`tx-ch-${i}-pol-x`) || "0",
      g(`tx-ch-${i}-pol-y`) || "0",
      g(`tx-ch-${i}-pol-z`) || "1",
    ];
    ch.azimuth_angle = parseCSV(g(`tx-ch-${i}-az-angles`) || "");
    ch.azimuth_pattern = parseCSV(g(`tx-ch-${i}-az-pattern`) || "");
    ch.elevation_angle = parseCSV(g(`tx-ch-${i}-el-angles`) || "");
    ch.elevation_pattern = parseCSV(g(`tx-ch-${i}-el-pattern`) || "");
    ch.delay = parseNumber(g(`tx-ch-${i}-delay`)) * 1e-9;
  });
}

export function saveRxChannelStates(): void {
  rxChannels.forEach((ch, i) => {
    const g = (id: string): string | undefined => (document.getElementById(id) as HTMLInputElement | null)?.value;
    ch.location = [
      parseNumber(g(`rx-ch-${i}-loc-x`)) * 1e-3,
      parseNumber(g(`rx-ch-${i}-loc-y`)) * 1e-3,
      parseNumber(g(`rx-ch-${i}-loc-z`)) * 1e-3,
    ];
    ch.polarization = [
      g(`rx-ch-${i}-pol-x`) || "0",
      g(`rx-ch-${i}-pol-y`) || "0",
      g(`rx-ch-${i}-pol-z`) || "1",
    ];
    ch.azimuth_angle = parseCSV(g(`rx-ch-${i}-az-angles`) || "");
    ch.azimuth_pattern = parseCSV(g(`rx-ch-${i}-az-pattern`) || "");
    ch.elevation_angle = parseCSV(g(`rx-ch-${i}-el-angles`) || "");
    ch.elevation_pattern = parseCSV(g(`rx-ch-${i}-el-pattern`) || "");
  });
}

async function removeChannel(prefix: string, index: number): Promise<void> {
  if (!(await confirmAsync(`Remove ${prefix} Channel ${index + 1}?`))) return;
  if (prefix === "TX") {
    saveTxChannelStates();
    txChannels.splice(index, 1);
    renderTxChannels();
  } else {
    saveRxChannelStates();
    rxChannels.splice(index, 1);
    renderRxChannels();
  }
  markResultsOutdated();
  debouncedAutoSave();
}

function attachLocationListeners(): void {
  txChannels.forEach((_, i) => {
    const debouncedUpdate = debounce(updateScene);
    ["loc-x", "loc-y", "loc-z"].forEach((field) => {
      const elem = document.getElementById(`tx-ch-${i}-${field}`);
      if (elem) {
        elem.addEventListener("input", debouncedUpdate);
      }
    });
  });
}

function attachRxLocationListeners(): void {
  rxChannels.forEach((_, i) => {
    const debouncedUpdate = debounce(updateScene);
    ["loc-x", "loc-y", "loc-z"].forEach((field) => {
      const elem = document.getElementById(`rx-ch-${i}-${field}`);
      if (elem) {
        elem.addEventListener("input", debouncedUpdate);
      }
    });
  });
}
