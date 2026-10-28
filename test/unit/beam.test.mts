import { test, describe } from "node:test";
import assert from "node:assert/strict";

const beam: any = await import("../../dist/renderer/js/beam.js");

describe("angleSpan", () => {
  test("is the least and greatest angle, in any order", () => {
    assert.deepEqual(beam.angleSpan([30, -45, 0, 10]), { lo: -45, hi: 30 });
  });

  test("keeps a full turn as given", () => {
    assert.deepEqual(beam.angleSpan([-180, 0, 180]), { lo: -180, hi: 180 });
  });

  test("an empty or unreadable cut has no span", () => {
    assert.equal(beam.angleSpan([]), null);
    assert.equal(beam.angleSpan([NaN]), null);
  });
});

describe("channelCoverage", () => {
  test("is the span of each of the channel's cuts", () => {
    assert.deepEqual(beam.channelCoverage([-60, 0, 20], [-5, 40]),
      { az: { lo: -60, hi: 20 }, el: { lo: -5, hi: 40 } });
  });

  test("a cut with no angles has no span", () => {
    assert.deepEqual(beam.channelCoverage([-30, 30], []), { az: { lo: -30, hi: 30 }, el: null });
  });

  test("a channel with no angles in either cut covers nothing", () => {
    assert.equal(beam.channelCoverage([], []), null);
  });
});
