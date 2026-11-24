import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { loadBuilt } from "../helpers/built.mts";
import { type DomHandle, installAppDom, stubApi } from "../helpers/dom.mts";

// The 3D scene must not re-derive platform rotation or motion in JS: the
// channel positions and the boresight are whatever radarsimlib reports through
// getSceneState. These tests pin that by feeding a pose the config could not
// have produced by itself and checking the model handed to the view carries it.
//
// The view itself (scene3d.ts) needs WebGL and is not loaded here; the tests
// stand in for it as the scene's sink.

let handle: DomHandle;
type SceneModule = typeof import("../../renderer/ts/scene.ts");
type SceneModel = Parameters<Parameters<SceneModule["setSceneSink"]>[0]>[0];

let scene: SceneModule;
let shared: typeof import("../../renderer/ts/shared.ts");

/** The last model the scene handed to its view, or null before it hands one. */
let model: SceneModel | null = null;

/** The model the scene last drew, failing the test when it drew none. */
function drawn(): SceneModel {
  assert.ok(model, "the scene handed its view no model");
  return model;
}

let sceneResponse: IpcResult<SceneState>;

/** Wait out the scene-state debounce and the IPC round trip it guards. */
async function settleSceneState(): Promise<void> {
  await new Promise((r) => setTimeout(r, 600));
}

function poseNote(): HTMLElement {
  return document.getElementById("scene-pose-note") as HTMLElement;
}

before(async () => {
  handle = installAppDom();

  stubApi({
    getSceneState: async () => sceneResponse,
  });

  shared = await loadBuilt<typeof import("../../renderer/ts/shared.ts")>("renderer/js/shared.js");
  scene = await loadBuilt<typeof import("../../renderer/ts/scene.ts")>("renderer/js/scene.js");
  scene.setSceneSink((m) => {
    model = m;
  });
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

    assert.equal(drawn().tx.length, 1);
    assert.equal(drawn().tx[0].label, "TX1");
    assert.deepEqual(drawn().tx[0].position, [3, 4, 5]);

    assert.equal(drawn().rx.length, 2, "one marker per reported RX channel");
    assert.deepEqual(drawn().rx[1].position, [9, 10, 11]);
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
      fields.forEach((f) => {
        f.remove();
      });
      fields = [];
      scene.setCoverageFocus(null);
    });

    async function withFocus(focus: Parameters<SceneModule["setCoverageFocus"]>[0]): Promise<void> {
      scene.setCoverageFocus(focus);
      scene.updateScene();
      await settleSceneState();
    }

    test("one channel picked: only it has coverage, its own span, outlined", async () => {
      await withFocus({ kind: "rx", index: 1 });
      assert.deepEqual(drawn().rx[1].coverage, { az: { lo: -60, hi: 30 }, el: null });
      assert.equal(drawn().rx[0].coverage, null, "a channel not picked draws no fans");
      assert.equal(drawn().tx[0].coverage, null);
      assert.equal(drawn().fanEdges, true);
    });

    test("a chain picked: each of its channels with its own span, shaded only", async () => {
      await withFocus({ kind: "receiver" });
      assert.deepEqual(drawn().rx[0].coverage, { az: { lo: -45, hi: 45 }, el: null });
      assert.deepEqual(
        drawn().rx[1].coverage,
        { az: { lo: -60, hi: 30 }, el: null },
        "each channel keeps its own span, not one shared by all",
      );
      assert.equal(drawn().tx[0].coverage, null, "the other chain draws no fans");
      assert.equal(drawn().fanEdges, false);
    });

    test("anything else picked: no fans at all", async () => {
      await withFocus(null);
      assert.ok([...drawn().tx, ...drawn().rx].every((c) => c.coverage === null));
    });
  });

  test("takes its boresight from the library, not from the rotation inputs", async () => {
    (document.getElementById("radar-rot-yaw") as HTMLInputElement).value = "45";

    scene.updateScene();
    await settleSceneState();

    assert.deepEqual(
      drawn().boresight,
      [0, 1, 0],
      "the boresight followed the yaw input instead of the library's vector",
    );
  });

  test("keeps the platform marker where it is configured", async () => {
    scene.updateScene();
    await settleSceneState();

    assert.deepEqual(drawn().radar, [0, 0, radarHeight]);
  });

  test("omits channels and boresight, and says why, when the pose is unavailable", async () => {
    sceneResponse = { success: false, error: "free tier channel limit" };
    scene.updateScene();
    await settleSceneState();

    assert.deepEqual(drawn().tx, []);
    assert.deepEqual(drawn().rx, []);
    assert.equal(drawn().boresight, null, "no arrow rather than a guessed one");
    assert.match(drawn().poseError ?? "", /free tier channel limit/);

    assert.match(poseNote().textContent ?? "", /free tier channel limit/);
    assert.ok(!poseNote().classList.contains("hidden"), "the note should be showing");
  });

  test("reports a pose the library declined to compute for a good scene", async () => {
    sceneResponse = {
      success: true,
      data: {
        timestamp: 0,
        txLocations: null,
        rxLocations: null,
        boresight: null,
        meshes: [],
        warnings: ["Radar pose: radar reports 0 TX / 1 RX channels"],
      },
    };
    scene.updateScene();
    await settleSceneState();

    assert.match(drawn().poseError ?? "", /0 TX \/ 1 RX/);
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

    assert.equal(drawn().poseError, null);
    assert.ok(poseNote().classList.contains("hidden"));
  });
});

describe("targets", () => {
  test("draws point targets from their fields before the library answers", () => {
    shared.pointTargets.push({});
    for (const [axis, value] of [
      ["x", "25"],
      ["y", "-3"],
      ["z", "1.5"],
    ]) {
      const input = document.createElement("input");
      input.id = `pt-0-loc-${axis}`;
      input.value = value;
      document.body.appendChild(input);
    }

    scene.updateScene();

    assert.deepEqual(drawn().pointTargets, [{ label: "T1", index: 0, position: [25, -3, 1.5] }]);
    document.querySelectorAll("body > input").forEach((n) => {
      n.remove();
    });
  });

  test("marks a mesh target at its origin until the library returns its geometry", async () => {
    shared.meshTargets.push({});
    scene.updateScene();
    assert.equal(drawn().meshMarkers.length, 1);
    assert.equal(drawn().meshMarkers[0].label, "M1");

    const mesh = {
      index: 0,
      totalCells: 1,
      cells: 1,
      x: new Float32Array([0, 1, 0]),
      y: new Float32Array([0, 0, 1]),
      z: new Float32Array([0, 0, 0]),
      i: new Int32Array([0]),
      j: new Int32Array([1]),
      k: new Int32Array([2]),
      bounds: [0, 0, 0, 1, 1, 0],
    };
    assert.ok(sceneResponse.data);
    sceneResponse.data.meshes = [mesh];
    await settleSceneState();

    assert.equal(drawn().meshes.length, 1);
    assert.deepEqual(drawn().meshMarkers, [], "the geometry replaces the stand-in marker");
  });
});

describe("mesh labels", () => {
  const mesh = (cells: number, totalCells: number): Parameters<SceneModule["meshLabel"]>[0] => ({
    index: 1,
    cells,
    totalCells,
  });

  test("gives the triangle count of a mesh drawn whole", () => {
    assert.equal(scene.meshLabel(mesh(1200, 1200)), "M2 (1200 tri)");
  });

  test("says how much of a decimated mesh is drawn", () => {
    assert.equal(scene.meshLabel(mesh(50000, 900000)), "M2 (50000 of 900000 tri)");
  });
});
