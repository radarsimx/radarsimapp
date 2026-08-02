import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { installAppDom, type DomHandle } from "../helpers/dom.ts";

let handle: DomHandle;
let state: any;
let shared: any;

before(async () => {
  handle = installAppDom();

  // The renderer draws through a Plotly global and talks to main over
  // window.api. Neither exists under jsdom, and neither is what these tests
  // are about, so stub both.
  const noop = () => Promise.resolve();
  (globalThis as any).Plotly = {
    newPlot: noop, react: noop, purge: () => { },
    Plots: { resize: () => { } },
  };
  (globalThis as any).window.Plotly = (globalThis as any).Plotly;
  (globalThis as any).window.api = {
    getSceneState: async () => ({ success: false, error: "stub" }),
    saveConfig: async () => true,
    loadConfig: async () => null,
  };

  shared = await import("../../dist/renderer/js/shared.js");
  state = await import("../../dist/renderer/js/state.js");
});

after(() => {
  delete (globalThis as any).Plotly;
  handle.cleanup();
});

beforeEach(() => {
  shared.txChannels.length = 0;
  shared.rxChannels.length = 0;
  shared.pointTargets.length = 0;
  shared.meshTargets.length = 0;
  globalThis.localStorage.clear();
});

describe("defaultState", () => {
  test("provides one TX channel, one RX channel and one point target", () => {
    const d = state.defaultState();
    assert.equal(d.txChannels.length, 1);
    assert.equal(d.rxChannels.length, 1);
    assert.equal(d.pointTargets.length, 1);
    assert.equal(d.meshTargets.length, 0);
  });

  test("includes a default for every static field the UI persists", () => {
    const d = state.defaultState();
    for (const id of ["tx-f-start", "rx-fs", "rx-gate-delay", "radar-rot-yaw", "sim-density"]) {
      assert.ok(id in d.fields, `missing default for ${id}`);
    }
  });

  test("returns a fresh object each call, so callers cannot corrupt it", () => {
    const a = state.defaultState();
    a.fields["tx-f-start"] = "999";
    a.pointTargets.push({});
    const b = state.defaultState();
    assert.equal(b.fields["tx-f-start"], "24");
    assert.equal(b.pointTargets.length, 1);
  });
});

describe("captureState / applyState round-trip", () => {
  test("static field values survive a round-trip", () => {
    state.applyState(state.defaultState());
    (document.getElementById("tx-f-start") as HTMLInputElement).value = "77";
    (document.getElementById("rx-fs") as HTMLInputElement).value = "10";
    (document.getElementById("rx-gate-delay") as HTMLInputElement).value = "250";

    const captured = state.captureState();
    assert.equal(captured.fields["tx-f-start"], "77");
    assert.equal(captured.fields["rx-gate-delay"], "250");

    // Scribble over the form, then restore.
    (document.getElementById("tx-f-start") as HTMLInputElement).value = "1";
    (document.getElementById("rx-gate-delay") as HTMLInputElement).value = "1";
    state.applyState(captured);
    assert.equal((document.getElementById("tx-f-start") as HTMLInputElement).value, "77");
    assert.equal((document.getElementById("rx-gate-delay") as HTMLInputElement).value, "250");
  });

  test("checkbox state survives a round-trip", () => {
    const noise = document.getElementById("proc-noise") as HTMLInputElement;
    noise.checked = false;
    const captured = state.captureState();
    assert.equal(captured.fields["proc-noise"], false);
    noise.checked = true;
    state.applyState(captured);
    assert.equal(noise.checked, false);
  });

  test("select values survive a round-trip", () => {
    const bb = document.getElementById("rx-bb-type") as HTMLSelectElement;
    bb.value = "real";
    const captured = state.captureState();
    bb.value = "complex";
    state.applyState(captured);
    assert.equal(bb.value, "real");
  });

  test("applyState replaces the shared arrays in place", () => {
    const before = shared.pointTargets;
    state.applyState(state.defaultState());
    assert.equal(shared.pointTargets, before, "same array identity, so importers stay bound");
    assert.equal(shared.pointTargets.length, 1);
  });

  test("mesh targets round-trip with their model path and unit", () => {
    const s = state.defaultState();
    s.meshTargets = [{
      model: "C:/models/car.stl", location: [20, 5, 0], speed: [0, 0, 0],
      rotation: [45, 0, 0], rotation_rate: [0, 0, 0], unit: "mm",
    }];
    state.applyState(s);
    assert.equal(shared.meshTargets.length, 1);
    assert.equal(shared.meshTargets[0].model, "C:/models/car.stl");
    assert.equal(shared.meshTargets[0].unit, "mm");
    assert.deepEqual(shared.meshTargets[0].rotation, [45, 0, 0]);
  });

  // captureState deep-copies via JSON, but applyState only splices the arrays
  // in, so the entries are shared with whatever was passed. Every caller today
  // hands it a fresh object (defaultState(), or JSON.parse of a saved config),
  // so this is safe -- but it is a contract worth pinning down: do not pass
  // applyState a state object you intend to keep mutating.
  test("applyState takes ownership of the entries it is given", () => {
    const s = state.defaultState();
    s.pointTargets = [{ location: [1, 2, 3], rcs: 5, speed: [0, 0, 0], phase: 0 }];
    state.applyState(s);
    s.pointTargets[0].location[0] = 999;
    assert.equal(shared.pointTargets[0].location[0], 999, "entries are shared, not copied");
  });

  test("captureState, by contrast, returns a detached snapshot", () => {
    state.applyState(state.defaultState());
    const snap = state.captureState();
    shared.pointTargets[0].location[0] = 42;
    assert.notEqual(snap.pointTargets[0].location[0], 42);
  });

  test("applyState tolerates a partial state", () => {
    assert.doesNotThrow(() => state.applyState({ fields: {} } as any));
    assert.doesNotThrow(() => state.applyState({} as any));
  });

  test("applyState ignores null", () => {
    assert.doesNotThrow(() => state.applyState(null as any));
  });

  test("survives JSON serialisation, which is how configs are saved", () => {
    state.applyState(state.defaultState());
    (document.getElementById("tx-pulses") as HTMLInputElement).value = "512";
    const json = JSON.stringify(state.captureState());
    (document.getElementById("tx-pulses") as HTMLInputElement).value = "1";
    state.applyState(JSON.parse(json));
    assert.equal((document.getElementById("tx-pulses") as HTMLInputElement).value, "512");
  });
});

describe("validateState", () => {
  const good = () => ({
    fields: {}, txChannels: [], rxChannels: [], pointTargets: [], meshTargets: [],
  });

  test("accepts a well-formed state", () => {
    assert.doesNotThrow(() => state.validateState(good()));
  });

  test("rejects non-objects", () => {
    for (const bad of [null, undefined, 42, "text", []]) {
      assert.throws(() => state.validateState(bad), /valid configuration object/);
    }
  });

  test("names the missing section", () => {
    for (const key of ["fields", "txChannels", "rxChannels", "pointTargets", "meshTargets"]) {
      const s: any = good();
      delete s[key];
      assert.throws(() => state.validateState(s), new RegExp(key));
    }
  });

  test("rejects sections of the wrong type", () => {
    const s: any = good();
    s.txChannels = "nope";
    assert.throws(() => state.validateState(s), /Expected "txChannels" to be an array/);

    const s2: any = good();
    s2.fields = [];
    assert.throws(() => state.validateState(s2), /"fields" to be an object/);
  });
});

describe("localStorage persistence", () => {
  test("debouncedAutoSave writes a state that validates and re-applies", async () => {
    state.applyState(state.defaultState());
    (document.getElementById("tx-power") as HTMLInputElement).value = "13";

    state.debouncedAutoSave();
    await new Promise((r) => setTimeout(r, 700));

    const raw = globalThis.localStorage.getItem("radarsimapp_state");
    assert.ok(raw, "autosave should have written something");
    const parsed = JSON.parse(raw!);
    assert.doesNotThrow(() => state.validateState(parsed));
    assert.equal(parsed.fields["tx-power"], "13");
  });
});
