// ===== RadarSimApp - Scene Outline =====
// The left of the window is two panels, each a map with the fields of what is
// picked on it underneath. The radar's map is its architecture -- the transmit
// chain, the receive chain, their antennas, on the platform; the targets' is a
// list. Picking a component shows that component's fields, and only those.

import { el } from './utils.js';
import { txChannels, rxChannels, pointTargets, meshTargets } from './shared.js';
import { pref, setPref } from './stage.js';
import { redrawInspectorPlots } from './plots.js';
import { setCoverageFocus } from './scene.js';

/** What can be picked on the radar: the platform, a whole chain, one block of a chain, a channel. */
export type RadarKind =
  | "radar" | "transmitter" | "receiver"
  | "waveform" | "pa" | "lna" | "mixer" | "baseband" | "adc"
  | "tx" | "rx";
/** What can be picked among the targets. */
export type TargetKind = "point" | "mesh";
export type NodeKind = RadarKind | TargetKind;
type ItemKind = "tx" | "rx" | TargetKind;

export interface Selection<K extends NodeKind = NodeKind> {
  kind: K;
  /** Which one, for the kinds there can be several of. */
  index?: number;
}

interface NodeSpec {
  title: string;
  path: string;
  /** The sets of fields (.insp[data-insp]) this node shows: a chain shows all of its blocks'. */
  sections: string[];
}

const NODES: Record<Exclude<RadarKind, ItemKind>, NodeSpec> = {
  radar: { title: "Platform", path: "Radar", sections: ["platform"] },
  transmitter: { title: "Transmitter", path: "Radar", sections: ["waveform", "pa"] },
  receiver: { title: "Receiver", path: "Radar", sections: ["lna", "mixer", "baseband", "adc"] },
  waveform: { title: "Waveform generator", path: "Transmitter", sections: ["waveform"] },
  pa: { title: "Power amplifier", path: "Transmitter", sections: ["pa"] },
  lna: { title: "Low-noise amplifier", path: "Receiver", sections: ["lna"] },
  mixer: { title: "Mixer", path: "Receiver", sections: ["mixer"] },
  baseband: { title: "Baseband amplifier", path: "Receiver", sections: ["baseband"] },
  adc: { title: "ADC", path: "Receiver", sections: ["adc"] },
};

interface ItemSpec {
  items: unknown[];
  /** Holds one card of fields per item (built by channels.ts / targets.ts). */
  listId: string;
  /** Holds the items' entries on the map: antennas in the diagram, rows in the target list. */
  entriesId: string;
  /** As the item is marked in the 3D scene. */
  label: (i: number) => string;
  title: (i: number) => string;
  path: string;
}

const ITEMS: Record<ItemKind, ItemSpec> = {
  tx: {
    items: txChannels, listId: "tx-channels-list", entriesId: "ol-tx",
    label: (i) => `TX${i + 1}`, title: (i) => `TX channel ${i + 1}`, path: "Transmitter",
  },
  rx: {
    items: rxChannels, listId: "rx-channels-list", entriesId: "ol-rx",
    label: (i) => `RX${i + 1}`, title: (i) => `RX channel ${i + 1}`, path: "Receiver",
  },
  point: {
    items: pointTargets, listId: "point-targets-list", entriesId: "ol-point",
    label: (i) => `T${i + 1}`, title: (i) => `Point target ${i + 1}`, path: "Point targets",
  },
  mesh: {
    items: meshTargets, listId: "mesh-targets-list", entriesId: "ol-mesh",
    label: (i) => `M${i + 1}`, title: (i) => `Mesh target ${i + 1}`, path: "Mesh targets",
  },
};

function _isItem(kind: NodeKind): kind is ItemKind {
  return kind in ITEMS;
}

function _isTarget(kind: NodeKind): kind is TargetKind {
  return kind === "point" || kind === "mesh";
}

/** Keep an item's index within what there is; null when there are none. */
function _within(kind: ItemKind, index: number | undefined): number | null {
  const count = ITEMS[kind].items.length;
  return count === 0 ? null : Math.min(Math.max(index ?? 0, 0), count - 1);
}

// Each panel has its own pick: one on the radar, and one among the targets
// for as long as there is a target to pick.
let _radar: Selection<RadarKind> = pref<Selection<RadarKind>>("selection", { kind: "waveform" });
let _target: Selection<TargetKind> | null = pref<Selection<TargetKind> | null>("selection.target", { kind: "point", index: 0 });

/** What is picked on the radar. */
export function selection(): Selection<RadarKind> {
  return _radar;
}

/** What is picked among the targets, if there are any. */
export function targetSelection(): Selection<TargetKind> | null {
  return _target;
}

/** Pick a node: its fields come up in its panel, with the plot that goes with them. */
export function select(next: Selection): void {
  if (_isTarget(next.kind)) _target = next as Selection<TargetKind>;
  else _radar = next as Selection<RadarKind>;
  _apply();
  setPref("selection", _radar);
  setPref("selection.target", _target);
  document.querySelector<HTMLElement>(`.hud-left [data-select="${next.kind}"].sel`)?.scrollIntoView?.({ block: "nearest" });

  // The fields just shown may carry a plot, which could not be drawn while hidden
  redrawInspectorPlots();
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

/** What was picked may have been removed since, or come from an older layout. */
function _settle(): void {
  if (_radar.kind === "tx" || _radar.kind === "rx") {
    const index = _within(_radar.kind, _radar.index);
    // With its last channel gone, a chain is what is left to show
    _radar = index === null
      ? { kind: _radar.kind === "tx" ? "transmitter" : "receiver" }
      : { kind: _radar.kind, index };
  } else if (!(_radar.kind in NODES)) {
    _radar = { kind: "waveform" };
  }

  // A target, of the kind picked if there is one, else of the other kind
  const kinds: TargetKind[] = _target?.kind === "mesh" ? ["mesh", "point"] : ["point", "mesh"];
  const wanted = _target?.index;
  _target = null;
  for (const kind of kinds) {
    const index = _within(kind, kind === kinds[0] ? wanted : 0);
    if (index !== null) {
      _target = { kind, index };
      break;
    }
  }
}

function _picked(entry: HTMLElement, sel: Selection | null): boolean {
  return !!sel && entry.dataset.select === sel.kind
    && (entry.dataset.index === undefined || Number(entry.dataset.index) === sel.index);
}

function _named(sel: Selection): NodeSpec {
  return _isItem(sel.kind)
    ? { title: ITEMS[sel.kind].title(sel.index ?? 0), path: ITEMS[sel.kind].path, sections: [sel.kind] }
    : NODES[sel.kind];
}

function _show(id: string, text: string): void {
  const elem = document.getElementById(id);
  if (!elem) return;
  elem.textContent = text;
  elem.title = text;  // a narrow block may have to cut it short
}

/** Bring the maps and the fields under them in line with what is picked. */
function _apply(): void {
  _settle();

  document.querySelectorAll<HTMLElement>(".hud-left [data-select]").forEach((entry) => {
    const selected = _picked(entry, _isTarget(entry.dataset.select as NodeKind) ? _target : _radar);
    entry.classList.toggle("sel", selected);
    entry.setAttribute("aria-pressed", String(selected));
    if (selected) {
      // A selection inside a folded branch would be out of sight
      entry.closest(".ol-node")?.classList.remove("folded");
    }
  });

  const radar = _named(_radar);
  const target = _target ? _named(_target) : null;
  const sections = [...radar.sections, ...(target?.sections ?? [])];
  document.querySelectorAll<HTMLElement>(".insp").forEach((section) => {
    section.classList.toggle("active", sections.includes(section.dataset.insp!));
  });
  // A whole chain shows its blocks one under another, each under its own name
  document.getElementById("panel-radar")?.classList.toggle("whole-chain", radar.sections.length > 1);
  // With no targets there is nothing to show under their list
  document.getElementById("target-properties")?.classList.toggle("empty", !target);

  (Object.keys(ITEMS) as ItemKind[]).forEach((kind) => {
    const sel = _isTarget(kind) ? _target : _radar;
    const cards = document.getElementById(ITEMS[kind].listId)?.children ?? [];
    Array.from(cards).forEach((card, i) => card.classList.toggle("collapsed", !(sel?.kind === kind && sel.index === i)));
  });

  syncCoverageFocus();

  _show("insp-title", radar.title);
  _show("insp-path", radar.path);
  _show("target-title", target?.title ?? "");
  _show("target-path", target?.path ?? "");
}

/**
 * The scene shows the coverage of the channel, or the chain, picked on the
 * radar -- while the Radar panel is open. Folded, nothing there is in hand,
 * and the fans go with it.
 */
export function syncCoverageFocus(): void {
  const panel = document.getElementById("panel-radar") as HTMLDetailsElement | null;
  const k = _radar.kind;
  setCoverageFocus(panel && !panel.open ? null
    : k === "tx" || k === "rx" ? { kind: k, index: _radar.index ?? 0 }
    : k === "transmitter" || k === "receiver" ? { kind: k } : null);
}

// --- Diagram readings ---
// Each block of the diagram carries the setting that most characterises it.
function _value(id: string): string {
  return (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "";
}

export function updateDiagram(): void {
  _show("arch-pose-loc", `${["x", "y", "z"].map((a) => _value(`radar-loc-${a}`) || "0").join(", ")} m`);
  _show("arch-pose-rot", `${["yaw", "pitch", "roll"].map((a) => _value(`radar-rot-${a}`) || "0").join("/")}°`);
  const v = ["x", "y", "z"].map((a) => Number(_value(`radar-spd-${a}`)) || 0);
  const spin = ["yaw", "pitch", "roll"].some((a) => (Number(_value(`radar-rr-${a}`)) || 0) !== 0);
  // How fast, and (on hover) which way; a turning platform says so
  _show("arch-pose-speed", `${Number(Math.hypot(...v).toPrecision(3))} m/s${spin ? " ⟳" : ""}`);
  const speed = document.getElementById("arch-pose-speed");
  if (speed) speed.title = `velocity (${v.join(", ")}) m/s${spin ? ", turning" : ""}`;
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

/** Wire the maps up. Their fixed parts are in index.html; the rest are built by renderOutline. */
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
  const radar = document.getElementById("panel-radar");
  radar?.addEventListener("input", updateDiagram);
  radar?.addEventListener("change", updateDiagram);
  document.addEventListener("configapplied", updateDiagram);

  updateDiagram();
  _apply();
}
