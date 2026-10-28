import { test, describe } from "node:test";
import assert from "node:assert/strict";

const cols: any = await import("../../dist/renderer/js/colresize.js");

describe("clampColumnWidth", () => {
  test("keeps a width that fits", () => {
    assert.equal(cols.clampColumnWidth(400, 1920), 400);
  });

  test("never narrower than the panels can lay out in", () => {
    assert.equal(cols.clampColumnWidth(100, 1920), cols.MIN_COL);
  });

  test("never takes more than its share of the window, so the stage keeps room", () => {
    assert.equal(cols.clampColumnWidth(5000, 1000), Math.floor(1000 * cols.MAX_COL_SHARE));
  });

  test("in a window too small for the share, the least width still holds", () => {
    assert.equal(cols.clampColumnWidth(500, 400), cols.MIN_COL);
  });

  test("whole pixels", () => {
    assert.equal(cols.clampColumnWidth(400.6, 1920), 401);
  });
});
