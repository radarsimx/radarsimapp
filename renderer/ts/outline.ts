// ===== RadarSimApp - Scene Outline =====
// The left of the window is a map of the scene and one set of properties. The
// radar is drawn as its architecture -- the transmit chain, the receive chain,
// their antennas, on the platform -- and the targets are listed under it.
// Picking a component shows that component's fields, and only those.

import { el } from './utils.js';
import { txChannels, rxChannels, pointTargets, meshTargets } from './shared.js';
import { pref, setPref } from './stage.js';
import { showSidePlot } from './plots.js';

/** What can be picked: the platform, a whole chain, one block of a chain, a channel or a target. */
export type NodeKind =
  | "radar" | "transmitter" | "receiver"
  | "waveform" | "pa" | "lna" | "mixer" | "baseband" | "adc"
  | "tx" | "rx" | "point" | "mesh";
type ItemKind = "tx" | "rx" | "point" | "mesh";

export interface Selection {
  kind: NodeKind;
  /** Which one, for the kinds there can be several of. */
  index?: number;
}

interface NodeSpec {
  title: string;
  path: string;
  /** The sets of fields (.insp[data-insp]) this node shows: a chain shows all of its blocks'. */
  sections: string[];
}

const NODES: Record<Exclude<NodeKind, ItemKind>, NodeSpec> = {
  radar: { title: "Platform", path: "Radar", sections: ["platform"] },
  transmitter: { title: "Transmitter", path: "Radar", sections: ["waveform", "pa"] },
  receiver: { title: "Receiver", path: "Radar", sections: ["lna", "mixer", "baseband", "adc"] },
  waveform: { title: "Waveform generator", path: "Radar › Transmitter", sections: ["waveform"] },
  pa: { title: "Power amplifier", path: "Radar › Transmitter", sections: ["pa"] },
  lna: { title: "Low-noise amplifier", path: "Radar › Receiver", sections: ["lna"] },
  mixer: { title: "Mixer", path: "Radar › Receiver", sections: ["mixer"] },
  baseband: { title: "Baseband amplifier", path: "Radar › Receiver", sections: ["baseband"] },
  adc: { title: "ADC", path: "Radar › Receiver", sections: ["adc"] },
};

interface ItemSpec {
  items: unknown[];
  /** Holds one card of fields per item (built by channels.ts / targets.ts). */
  listId: string;
  /** Holds the items' entries in the map: antennas in the diagram, rows in the target list. */
  entriesId: string;
  /** As the item is marked in the 3D scene. */
  label: (i: number) => string;
  title: (i: number) => string;
  path: string;
  /** Where the selection goes when the last item is removed. */
  parent: NodeKind;
}

const ITEMS: Record<ItemKind, ItemSpec> = {
  tx: {
    items: txChannels, listId: "tx-channels-list", entriesId: "ol-tx",
    label: (i) => `TX${i + 1}`, title: (i) => `TX channel ${i + 1}`,
    path: "Radar › Transmitter", parent: "transmitter",
  },
  rx: {
    items: rxChannels, listId: "rx-channels-list", entriesId: "ol-rx",
    label: (i) => `RX${i + 1}`, title: (i) => `RX channel ${i + 1}`,
    path: "Radar › Receiver", parent: "receiver",
  },
  point: {
    items: pointTargets, listId: "point-targets-list", entriesId: "ol-point",
    label: (i) => `T${i + 1}`, title: (i) => `Point target ${i + 1}`,
    path: "Targets", parent: "radar",
  },
  mesh: {
    items: meshTargets, listId: "mesh-targets-list", entriesId: "ol-mesh",
    label: (i) => `M${i + 1}`, title: (i) => `Mesh target ${i + 1}`,
    path: "Targets", parent: "radar",
  },
};

function _isItem(kind: NodeKind): kind is ItemKind {
  return kind in ITEMS;
}

let _selection: Selection = pref<Selection>("selection", { kind: "waveform" });

export function selection(): Selection {
  return _selection;
}

/** Pick a node: its fields come up, and the plot that goes with them. */
export function select(next: Selection): void {
  _selection = next;
  _apply();
  setPref("selection", _selection);
  const { kind, index } = _selection;
  if (kind === "waveform" || kind === "transmitter") showSidePlot("waveform");
  else if (kind === "tx" || kind === "rx") showSidePlot("pattern", { pfx: kind, index: index ?? 0 });
}

/** Rebuild the entries of the things there can be several of, after one is added or removed. */
export function renderOutline(): void {
  (Object.keys(ITEMS) as ItemKind[]).forEach((kind) => {
    const spec = ITEMS[kind];
    const entries = document.getElementById(spec.entriesId);
    if (!entries) return;
    // A channel is an antenna in the diagram; a target is a row in the list
    const antenna = kind === "tx" || kind === "rx";
    entries.replaceChildren(...spec.items.map((_, i) =>
      el(antenna ? "button" : "div", {
        className: antenna ? "ant" : "ol-row ol-item",
        ...(antenna ? { type: "button" } : { role: "treeitem", tabindex: "0" }),
        title: spec.title(i),
        "data-select": kind, "data-index": String(i),
      }, [
        el("i", { className: `mk-glyph mk-${kind}` }),
        // Its box already says which chain an antenna is on
        el("span", { className: "ol-name", textContent: antenna ? String(i + 1) : spec.label(i) }),
      ])
    ));
    // A branch with nothing in it has nothing to fold
    entries.closest(".ol-node")?.classList.toggle("ol-empty", spec.items.length === 0);
  });
  _apply();
}

/** Bring the map and the properties in line with the selection. */
function _apply(): void {
  // What was selected may have been removed since, or come from an older layout
  if (_isItem(_selection.kind)) {
    const spec = ITEMS[_selection.kind];
    const count = spec.items.length;
    if (count === 0) _selection = { kind: spec.parent };
    else _selection = { kind: _selection.kind, index: Math.min(Math.max(_selection.index ?? 0, 0), count - 1) };
  } else if (!(_selection.kind in NODES)) {
    _selection = { kind: "waveform" };
  }
  const { kind, index } = _selection;

  document.querySelectorAll<HTMLElement>(".hud-left [data-select]").forEach((entry) => {
    const selected = entry.dataset.select === kind
      && (entry.dataset.index === undefined || Number(entry.dataset.index) === index);
    entry.classList.toggle("sel", selected);
    entry.setAttribute("aria-pressed", String(selected));
    if (selected) {
      // A selection inside a folded branch would be out of sight
      entry.closest(".ol-node")?.classList.remove("folded");
      entry.scrollIntoView?.({ block: "nearest" });
    }
  });

  const named = _isItem(kind)
    ? { title: ITEMS[kind].title(index ?? 0), path: ITEMS[kind].path, sections: [kind as string] }
    : NODES[kind];
  document.querySelectorAll<HTMLElement>(".insp").forEach((section) => {
    section.classList.toggle("active", named.sections.includes(section.dataset.insp!));
  });
  // A whole chain shows its blocks one under another, each under its own name
  document.getElementById("panel-properties")?.classList.toggle("whole-chain", named.sections.length > 1);
  (Object.keys(ITEMS) as ItemKind[]).forEach((k) => {
    const cards = document.getElementById(ITEMS[k].listId)?.children ?? [];
    Array.from(cards).forEach((card, i) => card.classList.toggle("collapsed", !(k === kind && i === index)));
  });

  const title = document.getElementById("insp-title");
  const path = document.getElementById("insp-path");
  if (title) title.textContent = named.title;
  if (path) path.textContent = named.path;
}

// --- Diagram readings ---
// Each block of the diagram carries the setting that most characterises it.
function _value(id: string): string {
  return (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "";
}

function _show(id: string, text: string): void {
  const elem = document.getElementById(id);
  if (!elem) return;
  elem.textContent = text;
  elem.title = text;  // a narrow block may have to cut it short
}

export function updateDiagram(): void {
  _show("arch-platform", `${["x", "y", "z"].map((a) => _value(`radar-loc-${a}`) || "0").join(", ")} m`);
  _show("arch-waveform", `${_value("tx-f-start")}–${_value("tx-f-end")} GHz`);
  _show("arch-pa", `${_value("tx-power")} dBm`);
  _show("arch-lna", `NF ${_value("rx-nf")}`);
  _show("arch-mixer", _value("rx-bb-type") === "real" ? "real" : "I/Q");
  _show("arch-baseband", `${_value("rx-bb-gain")} dB`);
  _show("arch-adc", `${_value("rx-fs")} MHz`);
}

function _toggleFold(node: Element): void {
  const folded = node.classList.toggle("folded");
  setPref(`outline.folded.${(node as HTMLElement).dataset.node}`, folded);
}

/** Wire the map up. Its fixed parts are in index.html; the rest are built by renderOutline. */
export function initOutline(): void {
  const map = document.querySelector<HTMLElement>(".hud-left");
  if (!map) return;

  map.querySelectorAll<HTMLElement>(".ol-node[data-node]").forEach((node) => {
    node.classList.toggle("folded", pref(`outline.folded.${node.dataset.node}`, false));
  });

  const activate = (entry: HTMLElement): void => {
    if (entry.dataset.select) {
      select({
        kind: entry.dataset.select as NodeKind,
        index: entry.dataset.index === undefined ? undefined : Number(entry.dataset.index),
      });
    } else if (entry.classList.contains("ol-row")) {
      _toggleFold(entry.closest(".ol-node")!);  // a row that only groups others
    }
  };

  map.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest(".btn-icon")) return;  // an add button, handled where the lists are kept
    if (target.closest(".ol-fold")) {
      _toggleFold(target.closest(".ol-node")!);
      return;
    }
    const entry = target.closest<HTMLElement>("[data-select], .ol-row");
    if (entry) activate(entry);
  });

  // In the target list, up and down walk the rows in view; Enter or Space picks one
  map.addEventListener("keydown", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".ol-row");
    if (!row || (e.target as HTMLElement).closest("button")) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate(row);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const rows = Array.from(map.querySelectorAll<HTMLElement>(".ol-row")).filter((r) => r.offsetParent !== null);
      const next = rows[rows.indexOf(row) + (e.key === "ArrowDown" ? 1 : -1)];
      if (next) {
        next.focus();
        if (next.dataset.select) activate(next);
      }
    }
  });

  // The readings on the diagram follow the fields, however they come to change
  const properties = document.getElementById("panel-properties");
  properties?.addEventListener("input", updateDiagram);
  properties?.addEventListener("change", updateDiagram);
  document.addEventListener("configapplied", updateDiagram);

  updateDiagram();
  _apply();
}
