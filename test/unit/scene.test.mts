import { test, describe, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installAppDom, type DomHandle } from "../helpers/dom.mts";

// The 3D scene must not re-derive platform rotation or motion in JS: the
// channel positions and the boresight are whatever radarsimlib reports through
// getSceneState. These tests pin that by feeding a pose the config could not
// have produced by itself and checking the model handed to the view carries it.
//
// The view itself (scene3d.ts) needs WebGL and is not loaded here; the tests
// stand in for it as the scene's sink.

let handle: DomHandle;
let scene: any;
let shared: any;

/** The last model the scene handed to its view. */
let model: any;

let sceneResponse: any;

/** Wait out the scene-state debounce and the IPC round trip it guards. */
async function settleSceneState(): Promise<void> {
  await new Promise((r) => setTimeout(r, 600));
}

function poseNote(): HTMLElement {
  return document.getElementById("scene-pose-note") as HTMLElement;
}

before(async () => {
  handle = installAppDom();

  (globalThis as any).window.api = {
    getSceneState: async () => sceneResponse,
  };

  shared = await import("../../dist/renderer/js/shared.js");
  scene = await import("../../dist/renderer/js/scene.js");
  scene.setSceneSink((m: any) => { model = m; });
});

after(() => {
  handle.cleanup();
});

// scene.js caches the scene state against the config that produced it and skips
// the query when nothing moved, so each test needs a config of its own to get a
// fresh fetch. The platform's own height is the cheapest thing to vary.
let radarHeight = 0;

beforeEach(() => {
  model = null;
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

describe("radar pose", () => {
  test("puts TX and RX at the locations the library reports", async () => {
    scene.updateScene();
    await settleSceneState();

    assert.equal(model.tx.length, 1);
    assert.equal(model.tx[0].label, "TX1");
    assert.deepEqual(model.tx[0].position, [3, 4, 5]);

    assert.equal(model.rx.length, 2, "one marker per reported RX channel");
    assert.deepEqual(model.rx[1].position, [9, 10, 11]);
  });

  describe("coverage", () => {
    // The pattern fields as the channel cards would hold them
    let fields: HTMLElement[] = [];
    beforeEach(() => {
      const field = (id: string, value: string): void => {
        const input = document.createElement("input");
        input.id = id;
        input.value = value;
        document.body.append(input);
        fields.push(input);
      };
      field("tx-ch-0-az-angles", "-20, 0, 20");
      field("tx-ch-0-el-angles", "-10, 10");
      field("rx-ch-0-az-angles", "-45, 45");
      field("rx-ch-1-az-angles", "30, -60, 0");
    });
    afterEach(() => {
      fields.forEach((f) => f.remove());
      fields = [];
      scene.setCoverageFocus(null);
    });

    async function withFocus(focus: any): Promise<void> {
      scene.setCoverageFocus(focus);
      scene.updateScene();
      await settleSceneState();
    }

    test("one channel picked: only it has coverage, its own span, outlined", async () => {
      await withFocus({ kind: "rx", index: 1 });
      assert.deepEqual(model.rx[1].coverage, { az: { lo: -60, hi: 30 }, el: null });
      assert.equal(model.rx[0].coverage, null, "a channel not picked draws no fans");
      assert.equal(model.tx[0].coverage, null);
      assert.equal(model.fanEdges, true);
    });

    test("a chain picked: each of its channels with its own span, shaded only", async () => {
      await withFocus({ kind: "receiver" });
      assert.deepEqual(model.rx[0].coverage, { az: { lo: -45, hi: 45 }, el: null });
      assert.deepEqual(model.rx[1].coverage, { az: { lo: -60, hi: 30 }, el: null },
        "each channel keeps its own span, not one shared by all");
      assert.equal(model.tx[0].coverage, null, "the other chain draws no fans");
      assert.equal(model.fanEdges, false);
    });

    test("anything else picked: no fans at all", async () => {
      await withFocus(null);
      assert.ok([...model.tx, ...model.rx].every((c: any) => c.coverage === null));
    });
  });

  test("takes its boresight from the library, not from the rotation inputs", async () => {
    (document.getElementById("radar-rot-yaw") as HTMLInputElement).value = "45";

    scene.updateScene();
    await settleSceneState();

    assert.deepEqual(model.boresight, [0, 1, 0],
      "the boresight followed the yaw input instead of the library's vector");
  });

  test("keeps the platform marker where it is configured", async () => {
    scene.updateScene();
    await settleSceneState();

    assert.deepEqual(model.radar, [0, 0, radarHeight]);
  });

  test("omits channels and boresight, and says why, when the pose is unavailable", async () => {
    sceneResponse = { success: false, error: "free tier channel limit" };
    scene.updateScene();
    await settleSceneState();

    assert.deepEqual(model.tx, []);
    assert.deepEqual(model.rx, []);
    assert.equal(model.boresight, null, "no arrow rather than a guessed one");
    assert.match(model.poseError ?? "", /free tier channel limit/);

    assert.match(poseNote().textContent ?? "", /free tier channel limit/);
    assert.ok(!poseNote().classList.contains("hidden"), "the note should be showing");
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
    scene.updateScene();
    await settleSceneState();

    assert.match(model.poseError ?? "", /0 TX \/ 1 RX/);
  });

  test("clears the note once the pose is back", async () => {
    sceneResponse = { success: false, error: "stub" };
    scene.updateScene();
    await settleSceneState();
    assert.ok(!poseNote().classList.contains("hidden"));

    (document.getElementById("radar-loc-z") as HTMLInputElement).value = String(++radarHeight);
    sceneResponse = {
      success: true,
      data: {
        timestamp: 0,
        txLocations: new Float32Array([0, 0, 0]),
        rxLocations: new Float32Array([0, 0, 0]),
        boresight: new Float32Array([1, 0, 0]),
        meshes: [],
        warnings: [],
      },
    };
    scene.updateScene();
    await settleSceneState();

    assert.equal(model.poseError, null);
    assert.ok(poseNote().classList.contains("hidden"));
  });
});

describe("targets", () => {
  test("draws point targets from their fields before the library answers", () => {
    shared.pointTargets.push({});
    for (const [axis, value] of [["x", "25"], ["y", "-3"], ["z", "1.5"]]) {
      const input = document.createElement("input");
      input.id = `pt-0-loc-${axis}`;
      input.value = value;
      document.body.appendChild(input);
    }

    scene.updateScene();

    assert.deepEqual(model.pointTargets, [{ label: "T1", position: [25, -3, 1.5] }]);
    document.querySelectorAll("body > input").forEach((n) => n.remove());
  });

  test("marks a mesh target at its origin until the library returns its geometry", async () => {
    shared.meshTargets.push({});
    scene.updateScene();
    assert.equal(model.meshMarkers.length, 1);
    assert.equal(model.meshMarkers[0].label, "M1");

    const mesh = {
      index: 0, totalCells: 1, cells: 1,
      x: new Float32Array([0, 1, 0]), y: new Float32Array([0, 0, 1]), z: new Float32Array([0, 0, 0]),
      i: new Int32Array([0]), j: new Int32Array([1]), k: new Int32Array([2]),
      bounds: [0, 0, 0, 1, 1, 0],
    };
    sceneResponse.data.meshes = [mesh];
    await settleSceneState();

    assert.equal(model.meshes.length, 1);
    assert.deepEqual(model.meshMarkers, [], "the geometry replaces the stand-in marker");
  });
});

describe("mesh labels", () => {
  const mesh = (cells: number, totalCells: number): any => ({ index: 1, cells, totalCells });

  test("gives the triangle count of a mesh drawn whole", () => {
    assert.equal(scene.meshLabel(mesh(1200, 1200)), "M2 (1200 tri)");
  });

  test("says how much of a decimated mesh is drawn", () => {
    assert.equal(scene.meshLabel(mesh(50000, 900000)), "M2 (50000 of 900000 tri)");
  });
});
