import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { installAppDom, type DomHandle } from "../helpers/dom.mts";

// The 3D scenes must not re-derive platform rotation or motion in JS: the
// channel positions and the boresight are whatever radarsimlib reports through
// getSceneState. These tests pin that by feeding a pose the config could not
// have produced by itself and checking the plot draws it.

let handle: DomHandle;
let plots: any;
let shared: any;

/** Traces of the last Plotly draw, keyed by container id. */
const drawn = new Map<string, any[]>();
/** Layout of the last Plotly draw, keyed by container id. */
const layouts = new Map<string, any>();

let sceneResponse: any;

/** Wait out the scene-state debounce and the IPC round trip it guards. */
async function settleSceneState(): Promise<void> {
  await new Promise((r) => setTimeout(r, 600));
}

function traceNamed(containerId: string, name: string): any {
  return (drawn.get(containerId) ?? []).find((t: any) => t.name === name);
}

before(async () => {
  handle = installAppDom();

  const record = (root: any, data: any[], layout: any) => {
    const id = typeof root === "string" ? root : root.id;
    drawn.set(id, data);
    layouts.set(id, layout);
    return Promise.resolve();
  };
  (globalThis as any).Plotly = {
    newPlot: record, react: record, purge: () => { },
    Plots: { resize: () => { } },
  };
  (globalThis as any).window.Plotly = (globalThis as any).Plotly;
  (globalThis as any).window.api = {
    getSceneState: async () => sceneResponse,
  };

  shared = await import("../../dist/renderer/js/shared.js");
  plots = await import("../../dist/renderer/js/plots.js");
});

after(() => {
  delete (globalThis as any).Plotly;
  handle.cleanup();
});

// plots.js caches the scene state against the config that produced it and skips
// the query when nothing moved, so each test needs a config of its own to get a
// fresh fetch. The platform's own height is the cheapest thing to vary.
let radarHeight = 0;

beforeEach(() => {
  drawn.clear();
  layouts.clear();
  (document.getElementById("radar-loc-z") as HTMLInputElement).value = String(++radarHeight);
  shared.txChannels.length = 0;
  shared.rxChannels.length = 0;
  shared.pointTargets.length = 0;
  shared.meshTargets.length = 0;
  // A pose no JS transform of the config could yield, so a stale re-derivation
  // would be obvious. The radar itself sits at the origin in index.html.
  sceneResponse = {
    success: true,
    data: {
      timestamp: 0,
      txLocations: new Float32Array([3, 4, 5]),
      rxLocations: new Float32Array([6, 7, 8, 9, 10, 11]),
      boresight: new Float32Array([0, 1, 0]),
      meshes: [],
      warnings: [],
    },
  };
});

describe("radar overview scene", () => {
  test("draws TX and RX at the locations the library reports", async () => {
    plots.updateRadarOverviewPlot();
    await settleSceneState();

    const tx = traceNamed("radar-overview-plot", "TX");
    assert.ok(tx, "no TX trace was drawn");
    assert.deepEqual([tx.x[0], tx.y[0], tx.z[0]], [3, 4, 5]);

    const rx = traceNamed("radar-overview-plot", "RX");
    assert.ok(rx, "no RX trace was drawn");
    assert.equal(rx.x.length, 2, "one marker per reported RX channel");
    assert.deepEqual([rx.x[1], rx.y[1], rx.z[1]], [9, 10, 11]);
  });

  test("points the boresight arrow along the library's vector", async () => {
    plots.updateRadarOverviewPlot();
    await settleSceneState();

    // The arrow is the first trace: a line from the platform origin to the tip.
    const shaft = (drawn.get("radar-overview-plot") ?? [])[0];
    assert.ok(shaft, "no boresight arrow was drawn");
    const len = Math.hypot(shaft.x[1] - shaft.x[0], shaft.y[1] - shaft.y[0], shaft.z[1] - shaft.z[0]);
    assert.ok(Math.abs((shaft.y[1] - shaft.y[0]) / len - 1) < 1e-6,
      `arrow should follow +y, got ${[shaft.x[1], shaft.y[1], shaft.z[1]]}`);
  });

  test("omits channels and boresight, and says why, when the pose is unavailable", async () => {
    sceneResponse = { success: false, error: "free tier channel limit" };
    plots.updateRadarOverviewPlot();
    await settleSceneState();

    assert.equal(traceNamed("radar-overview-plot", "TX"), undefined);
    assert.equal(traceNamed("radar-overview-plot", "RX"), undefined);
    assert.ok(traceNamed("radar-overview-plot", "Radar Origin"), "the platform marker should remain");

    const note = (layouts.get("radar-overview-plot")?.annotations ?? [])[0];
    assert.match(note?.text ?? "", /free tier channel limit/);
  });

  test("reports a pose the library declined to compute for a good scene", async () => {
    sceneResponse = {
      success: true,
      data: {
        timestamp: 0,
        txLocations: null, rxLocations: null, boresight: null,
        meshes: [],
        warnings: ["Radar pose: radar reports 0 TX / 1 RX channels"],
      },
    };
    plots.updateRadarOverviewPlot();
    await settleSceneState();

    const note = (layouts.get("radar-overview-plot")?.annotations ?? [])[0];
    assert.match(note?.text ?? "", /0 TX \/ 1 RX/);
  });
});

describe("targets scene", () => {
  test("takes its boresight from the library, not from the rotation inputs", async () => {
    (document.getElementById("radar-rot-yaw") as HTMLInputElement).value = "45";

    plots.updateTargetsPlot();
    await settleSceneState();

    const shaft = (drawn.get("targets-scene-plot") ?? [])[0];
    assert.ok(shaft, "no boresight arrow was drawn");
    const len = Math.hypot(shaft.x[1] - shaft.x[0], shaft.y[1] - shaft.y[0], shaft.z[1] - shaft.z[0]);
    assert.ok(Math.abs((shaft.y[1] - shaft.y[0]) / len - 1) < 1e-6,
      "the arrow followed the yaw input instead of the library's boresight");
  });

  test("drops the arrow rather than guessing when there is no native pose", async () => {
    sceneResponse = { success: false, error: "stub" };
    plots.updateTargetsPlot();
    await settleSceneState();

    const first = (drawn.get("targets-scene-plot") ?? [])[0];
    assert.equal(first?.name, "Radar Origin", "expected the scene to start with the platform marker");
  });
});
