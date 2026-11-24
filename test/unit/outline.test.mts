import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { loadBuilt } from "../helpers/built.mts";
import { byId, type DomHandle, installAppDom, stubApi, stubPlotly } from "../helpers/dom.mts";

// The radar is drawn as its architecture and the targets are listed in a panel
// of their own; picking a component shows that component's fields under its
// map. Every component's fields stay in the page -- the configuration is read
// from all of them -- so what these tests pin is which sets are showing, and
// that a pick never points at something that is no longer there.

let handle: DomHandle;
let outline: typeof import("../../renderer/ts/outline.ts");
let channels: typeof import("../../renderer/ts/channels.ts");
let targets: typeof import("../../renderer/ts/targets.ts");
let shared: typeof import("../../renderer/ts/shared.ts");

/** The sets of fields showing in a panel. */
function showing(panel: "radar" | "targets" = "radar"): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>(`#panel-${panel} .insp.active`)).map(
    (s) => s.dataset.insp ?? "",
  );
}

function openCards(listId: string): number[] {
  return Array.from(byId(listId).children)
    .map((card, i) => (card.classList.contains("collapsed") ? -1 : i))
    .filter((i) => i >= 0);
}

function setField(id: string, value: string): void {
  (document.getElementById(id) as HTMLInputElement).value = value;
}

before(async () => {
  handle = installAppDom();

  stubPlotly();
  stubApi({
    getSceneState: async () => ({ success: false, error: "stub" }),
  });

  shared = await loadBuilt<typeof import("../../renderer/ts/shared.ts")>("renderer/js/shared.js");
  channels = await loadBuilt<typeof import("../../renderer/ts/channels.ts")>("renderer/js/channels.js");
  targets = await loadBuilt<typeof import("../../renderer/ts/targets.ts")>("renderer/js/targets.js");
  outline = await loadBuilt<typeof import("../../renderer/ts/outline.ts")>("renderer/js/outline.js");
});

after(() => {
  Reflect.deleteProperty(globalThis, "Plotly");
  handle.cleanup();
});

beforeEach(() => {
  shared.txChannels.splice(0, Infinity, {});
  shared.rxChannels.splice(0, Infinity, {}, {}, {});
  shared.pointTargets.splice(0, Infinity, {});
  shared.meshTargets.splice(0, Infinity);
  channels.renderTxChannels();
  channels.renderRxChannels();
  targets.renderPointTargets();
  targets.renderMeshTargets();
});

describe("entries", () => {
  const names = (id: string): string[] => Array.from(byId(id).children).map((r) => (r.textContent ?? "").trim());

  test("each chain has an antenna for each of its channels", () => {
    assert.deepEqual(names("ol-tx"), ["1"]);
    assert.deepEqual(names("ol-rx"), ["1", "2", "3"]);
  });

  test("each target has a row, named as in the scene", () => {
    assert.deepEqual(names("ol-point"), ["T1"]);
    assert.deepEqual(names("ol-mesh"), []);
  });

  test("the counts follow the lists", () => {
    assert.equal(byId("rx-ch-count").textContent, "3");
    assert.equal(byId("mesh-target-count").textContent, "0");
  });
});

describe("selection", () => {
  test("picking a block shows that block's fields and no others", () => {
    outline.select({ kind: "mixer" });
    assert.deepEqual(showing(), ["mixer"]);
    assert.equal(byId("insp-title").textContent, "Mixer");

    outline.select({ kind: "radar" });
    assert.deepEqual(showing(), ["platform"]);
  });

  test("picking a chain shows every block along it", () => {
    outline.select({ kind: "transmitter" });
    assert.deepEqual(showing(), ["waveform", "pa"]);

    outline.select({ kind: "receiver" });
    assert.deepEqual(showing(), ["lna", "mixer", "baseband", "adc"]);
  });

  test("one thing on the radar is marked as picked at a time", () => {
    outline.select({ kind: "lna" });
    outline.select({ kind: "adc" });
    const picked = Array.from(document.querySelectorAll<HTMLElement>("#arch .sel"));
    assert.deepEqual(
      picked.map((p) => p.dataset.select),
      ["adc"],
    );
  });

  test("picking an antenna shows that channel's card alone", () => {
    outline.select({ kind: "rx", index: 1 });
    assert.deepEqual(showing(), ["rx"]);
    assert.deepEqual(openCards("rx-channels-list"), [1]);
    assert.deepEqual(openCards("tx-channels-list"), []);
    assert.equal(byId("insp-title").textContent, "RX channel 2");
  });

  test("the fields of what is not showing are still in the page", () => {
    outline.select({ kind: "radar" });
    for (const id of ["tx-f-start", "tx-power", "rx-fs", "rx-nf", "rx-bb-type", "rx-ch-2-loc-x", "pt-0-rcs"]) {
      assert.ok(document.getElementById(id), `${id} should still exist`);
    }
  });

  test("moves to the last one left when the selected channel is removed", () => {
    outline.select({ kind: "rx", index: 2 });
    shared.rxChannels.splice(2, 1);
    channels.renderRxChannels();

    assert.deepEqual(outline.selection(), { kind: "rx", index: 1 });
    assert.deepEqual(openCards("rx-channels-list"), [1]);
  });

  test("falls back to the chain when its last channel is removed", () => {
    outline.select({ kind: "tx", index: 0 });
    shared.txChannels.splice(0, 1);
    channels.renderTxChannels();

    assert.deepEqual(outline.selection(), { kind: "transmitter" });
    assert.deepEqual(showing(), ["waveform", "pa"]);
  });
});

describe("coverage in the scene", () => {
  test("follows what is picked on the radar, and only while its panel is open", async () => {
    const scene = await loadBuilt<typeof import("../../renderer/ts/scene.ts")>("renderer/js/scene.js");
    const panel = document.getElementById("panel-radar") as HTMLDetailsElement;
    panel.open = true;

    outline.select({ kind: "transmitter" });
    assert.deepEqual(scene.coverageFocus(), { kind: "transmitter" });

    panel.open = false;
    outline.syncCoverageFocus();
    assert.equal(scene.coverageFocus(), null, "the fans stayed up with the Radar panel folded");

    panel.open = true;
    outline.syncCoverageFocus();
    assert.deepEqual(scene.coverageFocus(), { kind: "transmitter" }, "unfolding brings them back");

    outline.select({ kind: "waveform" });
    assert.equal(scene.coverageFocus(), null, "a block with no antennas has no coverage to show");
  });
});

describe("targets", () => {
  test("a target's fields show under the target list, beside whatever is picked on the radar", () => {
    outline.select({ kind: "mixer" });
    outline.select({ kind: "point", index: 0 });

    assert.deepEqual(showing("targets"), ["point"]);
    assert.deepEqual(openCards("point-targets-list"), [0]);
    assert.equal(byId("target-title").textContent, "Point target 1");
    assert.deepEqual(showing("radar"), ["mixer"], "the radar keeps its own pick");
  });

  test("picking on the radar leaves the target picked", () => {
    outline.select({ kind: "point", index: 0 });
    outline.select({ kind: "adc" });
    assert.deepEqual(outline.targetSelection(), { kind: "point", index: 0 });
  });

  test("moves to a target of the other kind when the last of one kind is removed", () => {
    shared.meshTargets.push({});
    targets.renderMeshTargets();
    outline.select({ kind: "point", index: 0 });

    shared.pointTargets.splice(0, 1);
    targets.renderPointTargets();

    assert.deepEqual(outline.targetSelection(), { kind: "mesh", index: 0 });
    assert.deepEqual(showing("targets"), ["mesh"]);
  });

  test("shows nothing under the list once there are no targets", () => {
    shared.pointTargets.splice(0, 1);
    targets.renderPointTargets();

    assert.equal(outline.targetSelection(), null);
    assert.deepEqual(showing("targets"), []);
    assert.ok(byId("target-properties").classList.contains("empty"));
  });

  test("unfolds the branch of the list a pick is in", () => {
    const branch = document.querySelector('.ol-node[data-node="point"]');
    assert.ok(branch);
    branch.classList.add("folded");
    outline.select({ kind: "point", index: 0 });
    assert.ok(!branch.classList.contains("folded"));
  });
});

describe("diagram readings", () => {
  test("each block carries the setting that characterises it", () => {
    setField("tx-f-start", "76");
    setField("tx-f-end", "77");
    setField("tx-power", "13");
    setField("rx-nf", "6.5");
    setField("rx-bb-gain", "30");
    setField("rx-fs", "12.5");
    (document.getElementById("rx-bb-type") as HTMLSelectElement).value = "real";
    outline.updateDiagram();

    const reading = (id: string): string => byId(id).textContent ?? "";
    assert.equal(reading("arch-waveform"), "76–77 GHz");
    assert.equal(reading("arch-pa"), "13 dBm");
    assert.equal(reading("arch-lna"), "NF 6.5");
    assert.equal(reading("arch-mixer"), "real");
    assert.equal(reading("arch-baseband"), "30 dB");
    assert.equal(reading("arch-adc"), "12.5 MHz");
  });
});
