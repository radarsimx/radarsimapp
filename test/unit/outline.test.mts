import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { installAppDom, type DomHandle } from "../helpers/dom.mts";

// The radar is drawn as its architecture and the targets are listed under it;
// picking a component shows that component's fields. Every component's fields
// stay in the page -- the configuration is read from all of them -- so what
// these tests pin is which sets are showing, and that the selection never
// points at something that is no longer there.

let handle: DomHandle;
let outline: any;
let channels: any;
let targets: any;
let shared: any;

function showing(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".insp.active")).map((s) => s.dataset.insp!);
}

function openCards(listId: string): number[] {
  return Array.from(document.getElementById(listId)!.children)
    .map((card, i) => (card.classList.contains("collapsed") ? -1 : i))
    .filter((i) => i >= 0);
}

function setField(id: string, value: string): void {
  (document.getElementById(id) as HTMLInputElement).value = value;
}

before(async () => {
  handle = installAppDom();

  const noop = () => Promise.resolve();
  (globalThis as any).Plotly = {
    newPlot: noop, react: noop, purge: () => { },
    Plots: { resize: () => { } },
  };
  (globalThis as any).window.Plotly = (globalThis as any).Plotly;
  (globalThis as any).window.api = {
    getSceneState: async () => ({ success: false, error: "stub" }),
  };

  shared = await import("../../dist/renderer/js/shared.js");
  channels = await import("../../dist/renderer/js/channels.js");
  targets = await import("../../dist/renderer/js/targets.js");
  outline = await import("../../dist/renderer/js/outline.js");
});

after(() => {
  delete (globalThis as any).Plotly;
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
  const names = (id: string): string[] =>
    Array.from(document.getElementById(id)!.children).map((r) => r.textContent!.trim());

  test("each chain has an antenna for each of its channels", () => {
    assert.deepEqual(names("ol-tx"), ["1"]);
    assert.deepEqual(names("ol-rx"), ["1", "2", "3"]);
  });

  test("each target has a row, named as in the scene", () => {
    assert.deepEqual(names("ol-point"), ["T1"]);
    assert.deepEqual(names("ol-mesh"), []);
  });

  test("the counts follow the lists", () => {
    assert.equal(document.getElementById("rx-ch-count")!.textContent, "3");
    assert.equal(document.getElementById("mesh-target-count")!.textContent, "0");
  });
});

describe("selection", () => {
  test("picking a block shows that block's fields and no others", () => {
    outline.select({ kind: "mixer" });
    assert.deepEqual(showing(), ["mixer"]);
    assert.equal(document.getElementById("insp-title")!.textContent, "Mixer");

    outline.select({ kind: "radar" });
    assert.deepEqual(showing(), ["platform"]);
  });

  test("picking a chain shows every block along it", () => {
    outline.select({ kind: "transmitter" });
    assert.deepEqual(showing(), ["waveform", "pa"]);

    outline.select({ kind: "receiver" });
    assert.deepEqual(showing(), ["lna", "mixer", "baseband", "adc"]);
  });

  test("one thing is marked as picked at a time", () => {
    outline.select({ kind: "lna" });
    outline.select({ kind: "adc" });
    const picked = Array.from(document.querySelectorAll<HTMLElement>(".hud-left .sel"));
    assert.deepEqual(picked.map((p) => p.dataset.select), ["adc"]);
  });

  test("picking an antenna shows that channel's card alone", () => {
    outline.select({ kind: "rx", index: 1 });
    assert.deepEqual(showing(), ["rx"]);
    assert.deepEqual(openCards("rx-channels-list"), [1]);
    assert.deepEqual(openCards("tx-channels-list"), []);
    assert.equal(document.getElementById("insp-title")!.textContent, "RX channel 2");
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

  test("unfolds the branch of the target list a selection is in", () => {
    const branch = document.querySelector('.ol-node[data-node="point"]')!;
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

    const reading = (id: string): string => document.getElementById(id)!.textContent!;
    assert.equal(reading("arch-waveform"), "76–77 GHz");
    assert.equal(reading("arch-pa"), "13 dBm");
    assert.equal(reading("arch-lna"), "NF 6.5");
    assert.equal(reading("arch-mixer"), "real");
    assert.equal(reading("arch-baseband"), "30 dB");
    assert.equal(reading("arch-adc"), "12.5 MHz");
  });
});
