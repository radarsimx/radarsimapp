// ===== RadarSimApp - Antenna Channels =====
// The TX and RX channel lists: one card of fields per channel, built here and
// read back from the page. TX channels carry a delay; RX channels do not.

import { renderOutline, select } from "./outline.js";
import { attachPatternListeners, markResultsOutdated, redrawInspectorPlots } from "./plots.js";
import { updateScene } from "./scene.js";
import { rxChannels, txChannels } from "./shared.js";
import { debouncedAutoSave } from "./state.js";
import {
  byId,
  confirmAsync,
  createInput,
  createTextInput,
  debounce,
  el,
  fieldCSV,
  fieldNumber,
  fieldValue,
  fieldVector,
  formGroup,
  isValidComplex,
  itemCard,
  setCount,
  vectorGroup,
  XYZ,
} from "./utils.js";

export type Side = "tx" | "rx";

const SIDES: Record<Side, { channels: ChannelData[]; listId: string; countId: string; name: string }> = {
  tx: { channels: txChannels, listId: "tx-channels-list", countId: "tx-ch-count", name: "TX" },
  rx: { channels: rxChannels, listId: "rx-channels-list", countId: "rx-ch-count", name: "RX" },
};

/** Default polarization: vertical. */
const POLARIZATION_DEFAULT = ["0", "0", "1"];

/** Mark a polarization field whose text is not a complex number. */
function _flagInvalidComplex(e: Event): void {
  const input = e.target as HTMLInputElement;
  input.classList.toggle("is-invalid", !isValidComplex(input.value));
}

function _channelCard(side: Side, index: number, data: ChannelData): HTMLElement {
  const id = (name: string): string => `${side}-ch-${index}-${name}`;

  const fields = el("div", { className: "channel-card-fields" }, [
    vectorGroup("Location (mm)", id("loc"), XYZ, XYZ, (k) => (data.location?.[k] ?? 0) * 1000, 0.1),
    el("div", { className: "form-group" }, [
      el("label", {}, [
        el("span", { textContent: "Polarization" }),
        el(
          "i",
          {
            className: "info-icon",
            "data-tooltip": "Real: 1  or  -0.5\nImaginary: 1j  or  -j\nComplex: 1+2j  or  0.5-1.5j",
          },
          ["?"],
        ),
      ]),
      el(
        "div",
        { className: "form-row triple" },
        XYZ.map((a, k) =>
          formGroup(
            a,
            el("input", {
              type: "text",
              id: id(`pol-${a}`),
              value: String(data.polarization?.[k] ?? POLARIZATION_DEFAULT[k]),
              onInput: _flagInvalidComplex,
            }),
          ),
        ),
      ),
    ]),
  ]);

  if (side === "tx") {
    fields.appendChild(formGroup("Delay (ns)", createInput(id("delay"), (data.delay ?? 0) * 1e9, 1)));
  }

  // Antenna pattern: the plot of both cuts, then the azimuth and elevation fields
  const cut = (cls: string, label: string, name: string, value: number[] | undefined, fallback: string) =>
    el("div", { className: "form-group" }, [
      el("label", { className: `cut-key ${cls}`, textContent: label }),
      createTextInput(id(name), value?.join(", ") ?? fallback),
    ]);
  fields.append(
    el("div", { className: "insp-plot pattern-plot", id: id("pattern-plot") }),
    cut("cut-az", "Azimuth Angles (°)", "az-angles", data.azimuth_angle, "-90, 90"),
    cut("cut-az", "Azimuth Pattern (dB)", "az-pattern", data.azimuth_pattern, "0, 0"),
    cut("cut-el", "Elevation Angles (°)", "el-angles", data.elevation_angle, "-90, 90"),
    cut("cut-el", "Elevation Pattern (dB)", "el-pattern", data.elevation_pattern, "0, 0"),
  );

  // All channels' cards are in the page; the outline picks the one that shows
  return itemCard([fields], "Remove Channel", () => removeChannel(side, index));
}

export function renderChannels(side: Side): void {
  const { channels, listId, countId } = SIDES[side];
  const container = byId(listId);
  container.replaceChildren(...channels.map((ch, i) => _channelCard(side, i, ch)));
  setCount(countId, channels.length);
  renderOutline();

  requestAnimationFrame(() => {
    const debouncedUpdate = debounce(updateScene);
    channels.forEach((_, i) => {
      attachPatternListeners(side, i);
      XYZ.forEach((a) => {
        document.getElementById(`${side}-ch-${i}-loc-${a}`)?.addEventListener("input", debouncedUpdate);
      });
    });
    redrawInspectorPlots();
    updateScene();
  });
}

/** A channel as its fields hold it, in SI units. */
export function readChannel(side: Side, i: number): ChannelData {
  const id = (name: string): string => `${side}-ch-${i}-${name}`;
  const ch: ChannelData = {
    location: fieldVector(id("loc"), XYZ).map((v) => v * 1e-3),
    polarization: XYZ.map((a, k) => fieldValue(id(`pol-${a}`)) || POLARIZATION_DEFAULT[k]),
    azimuth_angle: fieldCSV(id("az-angles")),
    azimuth_pattern: fieldCSV(id("az-pattern")),
    elevation_angle: fieldCSV(id("el-angles")),
    elevation_pattern: fieldCSV(id("el-pattern")),
  };
  if (side === "tx") ch.delay = fieldNumber(id("delay")) * 1e-9;
  return ch;
}

/** Copy what the fields hold back into the channel list, before it is re-rendered or saved. */
export function saveChannelStates(side: Side): void {
  const { channels } = SIDES[side];
  channels.forEach((ch, i) => {
    Object.assign(ch, readChannel(side, i));
  });
}

export function addChannel(side: Side): void {
  const { channels } = SIDES[side];
  saveChannelStates(side);
  channels.push({});
  renderChannels(side);
  select({ kind: side, index: channels.length - 1 });
  markResultsOutdated();
  debouncedAutoSave();
}

async function removeChannel(side: Side, index: number): Promise<void> {
  const { channels, name } = SIDES[side];
  if (!(await confirmAsync(`Remove ${name} Channel ${index + 1}?`))) return;
  saveChannelStates(side);
  channels.splice(index, 1);
  renderChannels(side);
  markResultsOutdated();
  debouncedAutoSave();
}
