import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  ERROR_MESSAGES, errorMsg, toF32, toF64, toI32, deg2rad,
  parseComplex, buildAntennaPattern,
} from "../../dist/convert.js";

describe("typed-array helpers", () => {
  test("convert plain arrays to the right typed array", () => {
    assert.ok(toF32([1, 2, 3]) instanceof Float32Array);
    assert.ok(toF64([1, 2, 3]) instanceof Float64Array);
    assert.ok(toI32([1, 2, 3]) instanceof Int32Array);
    assert.deepEqual(Array.from(toF64([1.5, -2.5])), [1.5, -2.5]);
  });

  test("pass through an already-correct typed array without copying", () => {
    const f32 = new Float32Array([1, 2]);
    assert.equal(toF32(f32), f32, "should be the same object, not a copy");
    const f64 = new Float64Array([1, 2]);
    assert.equal(toF64(f64), f64);
  });

  test("toI32 truncates toward zero", () => {
    assert.deepEqual(Array.from(toI32([1.9, -1.9])), [1, -1]);
  });
});

describe("deg2rad", () => {
  test("converts the cardinal angles", () => {
    const r = deg2rad([0, 90, 180, -90]);
    assert.ok(r instanceof Float32Array);
    assert.equal(r[0], 0);
    assert.ok(Math.abs(r[1] - Math.PI / 2) < 1e-6);
    assert.ok(Math.abs(r[2] - Math.PI) < 1e-6);
    assert.ok(Math.abs(r[3] + Math.PI / 2) < 1e-6);
  });

  // Regression: the radar's rotation was passed to Create_Radar in degrees,
  // so a 90 deg yaw was applied as 90 radians.
  test("90 degrees is not left as 90", () => {
    assert.notEqual(deg2rad([90])[0], 90);
  });

  test("empty input yields an empty array", () => {
    assert.equal(deg2rad([]).length, 0);
  });
});

describe("parseComplex", () => {
  test("plain number", () => {
    assert.deepEqual(parseComplex(3), { re: 3, im: 0 });
    assert.deepEqual(parseComplex(-2.5), { re: -2.5, im: 0 });
  });

  test("[re, im] array", () => {
    assert.deepEqual(parseComplex([1, 2]), { re: 1, im: 2 });
    assert.deepEqual(parseComplex([1]), { re: 1, im: 0 });
  });

  test("j/i suffixed strings", () => {
    assert.deepEqual(parseComplex("1+2j"), { re: 1, im: 2 });
    assert.deepEqual(parseComplex("1-2j"), { re: 1, im: -2 });
    assert.deepEqual(parseComplex("-1+2i"), { re: -1, im: 2 });
    assert.deepEqual(parseComplex("+3j"), { re: 0, im: 3 });
  });

  test("ignores whitespace", () => {
    assert.deepEqual(parseComplex(" 1 + 2j "), { re: 1, im: 2 });
  });

  test("real-only strings", () => {
    assert.deepEqual(parseComplex("5"), { re: 5, im: 0 });
    assert.deepEqual(parseComplex("-0.5"), { re: -0.5, im: 0 });
  });

  test("unparseable strings degrade to zero rather than NaN", () => {
    assert.deepEqual(parseComplex("abc"), { re: 0, im: 0 });
    assert.deepEqual(parseComplex(""), { re: 0, im: 0 });
  });
});

describe("errorMsg", () => {
  test("includes the library's description and the numeric code", () => {
    const m = errorMsg(1, "Add_Txchannel");
    assert.match(m, /^Add_Txchannel: /);
    assert.match(m, /Null pointer/);
    assert.match(m, /\(code 1\)/);
  });

  test("free-tier message points at the purchase page", () => {
    assert.match(errorMsg(4, "Add_Mesh_Target"), /radarsimx\.com/);
  });

  test("unknown codes still produce a usable message", () => {
    assert.match(errorMsg(9999, "Whatever"), /Unknown error \(code 9999\)/);
  });

  test("success is code 0", () => {
    assert.equal(ERROR_MESSAGES[0], "Success");
  });
});

describe("buildAntennaPattern", () => {
  test("defaults to an isotropic pattern with 0 dB gain", () => {
    const p = buildAntennaPattern(undefined, undefined, undefined, undefined);
    assert.equal(p.antennaGain, 0);
    assert.deepEqual(Array.from(p.phiPtn), [0, 0]);
    assert.deepEqual(Array.from(p.thetaPtn), [0, 0]);
    assert.ok(Math.abs(p.phi[0] + Math.PI / 2) < 1e-6);
    assert.ok(Math.abs(p.theta[1] - Math.PI) < 1e-6);
  });

  test("azimuth peak becomes the gain and is normalized out of the pattern", () => {
    const p = buildAntennaPattern([-90, 0, 90], [-10, 6, -10], undefined, undefined);
    assert.equal(p.antennaGain, 6);
    assert.deepEqual(Array.from(p.phiPtn), [-16, 0, -16]);
    assert.ok(Math.abs(p.phi[1]) < 1e-6, "0 deg maps to 0 rad");
  });

  test("elevation is converted to polar theta and reversed", () => {
    // elevation -30..30 -> theta 120..60, which must come out ascending.
    const p = buildAntennaPattern(undefined, undefined, [-30, 0, 30], [-3, 0, -6]);
    const deg = (Array.from(p.theta) as number[]).map((v) => (v * 180) / Math.PI);
    assert.ok(Math.abs(deg[0] - 60) < 1e-4);
    assert.ok(Math.abs(deg[1] - 90) < 1e-4);
    assert.ok(Math.abs(deg[2] - 120) < 1e-4);
    // pattern reversed alongside the angles, normalized to its own peak (0)
    assert.deepEqual(Array.from(p.thetaPtn), [-6, 0, -3]);
  });

  test("does not mutate the caller's arrays", () => {
    const elAngle = [-30, 0, 30];
    const elPattern = [-3, 0, -6];
    buildAntennaPattern(undefined, undefined, elAngle, elPattern);
    assert.deepEqual(elAngle, [-30, 0, 30]);
    assert.deepEqual(elPattern, [-3, 0, -6]);
  });

  test("rejects mismatched azimuth lengths", () => {
    assert.throws(
      () => buildAntennaPattern([0, 1], [0], undefined, undefined),
      /azimuth_angle and azimuth_pattern/
    );
  });

  test("rejects mismatched elevation lengths", () => {
    assert.throws(
      () => buildAntennaPattern(undefined, undefined, [0, 1], [0]),
      /elevation_angle and elevation_pattern/
    );
  });
});
