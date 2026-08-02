import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { installAppDom, type DomHandle } from "../helpers/dom.ts";

let handle: DomHandle;
let collectConfig: any;
let shared: any;

before(async () => {
  handle = installAppDom();
  shared = await import("../../dist/renderer/js/shared.js");
  ({ collectConfig } = await import("../../dist/renderer/js/config.js"));
});

after(() => handle.cleanup());

/** Set a form field by id. Throws if the id is not in index.html. */
function set(id: string, value: string): void {
  const elem = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
  if (!elem) throw new Error(`no such field in index.html: ${id}`);
  elem.value = value;
}

/**
 * Channel/target cards are rendered dynamically, so their inputs are not in
 * index.html. Inject the ids collectConfig will look for.
 */
function addField(id: string, value: string): void {
  const inp = document.createElement("input");
  inp.id = id;
  inp.value = value;
  document.body.appendChild(inp);
}

function resetDynamic(): void {
  document.querySelectorAll("body > input").forEach((n) => n.remove());
  shared.txChannels.length = 0;
  shared.rxChannels.length = 0;
  shared.pointTargets.length = 0;
  shared.meshTargets.length = 0;
}

beforeEach(resetDynamic);

describe("collectConfig - transmitter", () => {
  test("converts GHz to Hz and microseconds to seconds", () => {
    set("tx-f-start", "24");
    set("tx-f-end", "24.5");
    set("tx-t-start", "0");
    set("tx-t-end", "80");
    set("tx-prp", "100");
    const c = collectConfig();
    assert.deepEqual(c.transmitter.f, [24e9, 24.5e9]);
    assert.ok(Math.abs(c.transmitter.t[1] - 80e-6) < 1e-15);
    assert.ok(Math.abs(c.transmitter.prp - 100e-6) < 1e-15);
  });

  test("pulses is an integer with a floor of 1", () => {
    set("tx-pulses", "256");
    assert.equal(collectConfig().transmitter.pulses, 256);
    set("tx-pulses", "0");
    assert.equal(collectConfig().transmitter.pulses, 1, "0 pulses would break the sim");
    set("tx-pulses", "");
    assert.equal(collectConfig().transmitter.pulses, 1);
  });

  test("channels default to a single entry when none are configured", () => {
    assert.deepEqual(collectConfig().transmitter.channels, [{}]);
  });

  test("channel locations convert mm to m", () => {
    shared.txChannels.push({});
    addField("tx-ch-0-loc-x", "100");
    addField("tx-ch-0-loc-y", "-50");
    addField("tx-ch-0-loc-z", "0");
    const ch = collectConfig().transmitter.channels[0];
    assert.ok(Math.abs(ch.location[0] - 0.1) < 1e-12);
    assert.ok(Math.abs(ch.location[1] + 0.05) < 1e-12);
  });

  test("channel delay converts ns to s and is omitted when zero", () => {
    shared.txChannels.push({});
    addField("tx-ch-0-delay", "0");
    assert.equal(collectConfig().transmitter.channels[0].delay, undefined);

    resetDynamic();
    shared.txChannels.push({});
    addField("tx-ch-0-delay", "10");
    const ch = collectConfig().transmitter.channels[0];
    assert.ok(Math.abs(ch.delay - 10e-9) < 1e-18);
  });

  test("polarization defaults to z when the fields are absent", () => {
    shared.txChannels.push({});
    assert.deepEqual(collectConfig().transmitter.channels[0].polarization, ["0", "0", "1"]);
  });

  test("antenna pattern arrays are only emitted when populated", () => {
    shared.txChannels.push({});
    let ch = collectConfig().transmitter.channels[0];
    assert.equal(ch.azimuth_angle, undefined);

    addField("tx-ch-0-az-angles", "-90, 0, 90");
    addField("tx-ch-0-az-pattern", "-10, 0, -10");
    ch = collectConfig().transmitter.channels[0];
    assert.deepEqual(ch.azimuth_angle, [-90, 0, 90]);
    assert.deepEqual(ch.azimuth_pattern, [-10, 0, -10]);
  });
});

describe("collectConfig - receiver", () => {
  test("converts MHz to Hz", () => {
    set("rx-fs", "2");
    assert.equal(collectConfig().receiver.fs, 2e6);
    set("rx-fs", "0.5");
    assert.equal(collectConfig().receiver.fs, 0.5e6);
  });

  test("gate delay converts ns to s", () => {
    set("rx-gate-delay", "0");
    assert.equal(collectConfig().receiver.gate_delay, 0);
    set("rx-gate-delay", "500");
    assert.ok(Math.abs(collectConfig().receiver.gate_delay - 500e-9) < 1e-18);
  });

  test("passes gains and load resistor through unscaled", () => {
    set("rx-nf", "10");
    set("rx-rf-gain", "20");
    set("rx-bb-gain", "30");
    set("rx-load-r", "500");
    const rx = collectConfig().receiver;
    assert.equal(rx.noise_figure, 10);
    assert.equal(rx.rf_gain, 20);
    assert.equal(rx.baseband_gain, 30);
    assert.equal(rx.load_resistor, 500);
  });

  test("baseband type comes through as a string", () => {
    set("rx-bb-type", "real");
    assert.equal(collectConfig().receiver.bb_type, "real");
    set("rx-bb-type", "complex");
    assert.equal(collectConfig().receiver.bb_type, "complex");
  });
});

describe("collectConfig - radar", () => {
  test("location and speed are plain metres, rotation stays in degrees", () => {
    set("radar-loc-x", "1"); set("radar-loc-y", "2"); set("radar-loc-z", "3");
    set("radar-spd-x", "10"); set("radar-spd-y", "0"); set("radar-spd-z", "0");
    set("radar-rot-yaw", "90"); set("radar-rot-pitch", "0"); set("radar-rot-roll", "0");
    const r = collectConfig().radar;
    assert.deepEqual(r.location, [1, 2, 3]);
    assert.deepEqual(r.speed, [10, 0, 0]);
    // The bridge converts to radians; the config layer must not double-convert.
    assert.deepEqual(r.rotation, [90, 0, 0]);
  });
});

describe("collectConfig - targets", () => {
  test("point targets carry location, rcs, speed and phase", () => {
    shared.pointTargets.push({});
    addField("pt-0-loc-x", "10");
    addField("pt-0-loc-y", "0");
    addField("pt-0-loc-z", "0");
    addField("pt-0-rcs", "20");
    addField("pt-0-phase", "45");
    const t = collectConfig().targets[0];
    assert.deepEqual(t.location, [10, 0, 0]);
    assert.equal(t.rcs, 20);
    assert.equal(t.phase, 45);
  });

  test("point target location is metres, not millimetres", () => {
    shared.pointTargets.push({});
    addField("pt-0-loc-x", "10");
    assert.equal(collectConfig().targets[0].location[0], 10);
  });

  test("mesh targets without a model path are dropped", () => {
    shared.meshTargets.push({});
    addField("mesh-0-model", "");
    assert.equal(collectConfig().targets.length, 0);
  });

  test("mesh targets keep model, unit and rotation in degrees", () => {
    shared.meshTargets.push({});
    addField("mesh-0-model", "C:/models/car.stl");
    addField("mesh-0-loc-x", "20");
    addField("mesh-0-rot-yaw", "45");
    const unit = document.createElement("select");
    unit.id = "mesh-0-unit";
    for (const u of ["m", "cm", "mm"]) {
      const o = document.createElement("option");
      o.value = u; o.textContent = u;
      unit.appendChild(o);
    }
    unit.value = "mm";
    document.body.appendChild(unit);

    const t = collectConfig().targets[0];
    assert.equal(t.model, "C:/models/car.stl");
    assert.equal(t.unit, "mm");
    assert.equal(t.location[0], 20);
    assert.deepEqual(t.rotation, [45, 0, 0]);
    unit.remove();
  });

  test("point targets come before mesh targets, which keeps mesh indices aligned", () => {
    shared.pointTargets.push({});
    shared.meshTargets.push({});
    addField("pt-0-loc-x", "5");
    addField("mesh-0-model", "a.stl");
    const targets = collectConfig().targets;
    assert.equal(targets.length, 2);
    assert.equal(targets[0].model, undefined, "point target first");
    assert.equal(targets[1].model, "a.stl");
  });
});

describe("collectConfig - processing", () => {
  test("range profile is forced on when range-doppler is enabled", () => {
    (document.getElementById("proc-range-doppler") as HTMLInputElement).checked = true;
    (document.getElementById("proc-range-profile") as HTMLInputElement).checked = false;
    const p = collectConfig().processing;
    assert.equal(p.range_doppler, true);
    assert.equal(p.range_profile, true, "range-doppler needs the range FFT");
  });

  test("FFT sizes are null unless their enable checkbox is ticked", () => {
    (document.getElementById("proc-rd-range-fft-enable") as HTMLInputElement).checked = false;
    set("proc-rd-range-fft", "512");
    assert.equal(collectConfig().processing.rd_range_fft, null);

    (document.getElementById("proc-rd-range-fft-enable") as HTMLInputElement).checked = true;
    assert.equal(collectConfig().processing.rd_range_fft, 512);
  });
});

describe("collectConfig - shape", () => {
  test("returns the sections the bridge expects", () => {
    const c = collectConfig();
    for (const key of ["transmitter", "receiver", "radar", "targets", "simulation", "processing"]) {
      assert.ok(key in c, `missing section: ${key}`);
    }
    assert.ok(Array.isArray(c.targets));
  });

  test("is JSON-serialisable, so it survives IPC", () => {
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(collectConfig())));
  });
});
