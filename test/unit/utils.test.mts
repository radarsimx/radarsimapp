import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { installDom, type DomHandle } from "../helpers/dom.mts";

let handle: DomHandle;
let utils: any;

before(async () => {
  handle = installDom();
  utils = await import("../../dist/renderer/js/utils.js");
});

after(() => handle.cleanup());

describe("parseNumber", () => {
  test("parses numeric strings", () => {
    assert.equal(utils.parseNumber("42"), 42);
    assert.equal(utils.parseNumber("-1.5"), -1.5);
    assert.equal(utils.parseNumber("2e3"), 2000);
  });

  test("falls back for junk, empty and nullish input", () => {
    assert.equal(utils.parseNumber("abc"), 0);
    assert.equal(utils.parseNumber(""), 0);
    assert.equal(utils.parseNumber(null), 0);
    assert.equal(utils.parseNumber(undefined), 0);
  });

  test("honours a custom fallback", () => {
    assert.equal(utils.parseNumber("", 20), 20);
    assert.equal(utils.parseNumber("abc", -1), -1);
  });

  test("a real 0 is kept, not replaced by the fallback", () => {
    assert.equal(utils.parseNumber("0", 20), 0);
  });

  test("parses the leading number of a trailing-garbage string", () => {
    assert.equal(utils.parseNumber("12px"), 12);
  });
});

describe("parseCSV", () => {
  test("splits and trims", () => {
    assert.deepEqual(utils.parseCSV("1, 2 ,3"), [1, 2, 3]);
  });

  test("drops empty entries and trailing commas", () => {
    assert.deepEqual(utils.parseCSV("1,,2,"), [1, 2]);
    assert.deepEqual(utils.parseCSV(""), []);
    assert.deepEqual(utils.parseCSV("   "), []);
  });

  test("drops non-numeric entries rather than emitting NaN", () => {
    assert.deepEqual(utils.parseCSV("1,abc,3"), [1, 3]);
  });

  test("handles negatives and decimals", () => {
    assert.deepEqual(utils.parseCSV("-90, -3.5, 0"), [-90, -3.5, 0]);
  });
});

describe("isValidComplex", () => {
  test("accepts reals", () => {
    for (const s of ["1", "-1", "0.5", ".5", "1.", "1e3", "-2.5E-3"]) {
      assert.ok(utils.isValidComplex(s), `${s} should be valid`);
    }
  });

  test("accepts complex forms", () => {
    for (const s of ["1+2j", "1-2j", "-1+2J", "3j", "-3j", "j", "-j"]) {
      assert.ok(utils.isValidComplex(s), `${s} should be valid`);
    }
  });

  test("rejects junk and empties", () => {
    for (const s of ["", "   ", "abc", "1+2", "1++2j", "j2"]) {
      assert.ok(!utils.isValidComplex(s), `${s} should be invalid`);
    }
  });

  test("tolerates nullish input", () => {
    assert.equal(utils.isValidComplex(undefined), false);
    assert.equal(utils.isValidComplex(null), false);
  });
});

describe("formatComplex", () => {
  test("passes strings through and stringifies numbers", () => {
    assert.equal(utils.formatComplex("1+2j"), "1+2j");
    assert.equal(utils.formatComplex(3), "3");
    assert.equal(utils.formatComplex(-0.5), "-0.5");
  });
});

describe("debounce", () => {
  test("fires once after the quiet period, with the last arguments", async () => {
    const seen: number[] = [];
    const fn = utils.debounce((v: number) => seen.push(v), 20);
    fn(1); fn(2); fn(3);
    assert.deepEqual(seen, [], "nothing runs synchronously");
    await new Promise((r) => setTimeout(r, 60));
    assert.deepEqual(seen, [3], "only the final call lands");
  });

  test("separate debounced functions do not share a timer", async () => {
    const seen: string[] = [];
    const a = utils.debounce(() => seen.push("a"), 10);
    const b = utils.debounce(() => seen.push("b"), 10);
    a(); b();
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(seen.sort(), ["a", "b"]);
  });

  test("calls spaced beyond the delay each fire", async () => {
    let n = 0;
    const fn = utils.debounce(() => n++, 10);
    fn();
    await new Promise((r) => setTimeout(r, 40));
    fn();
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(n, 2);
  });
});

describe("el", () => {
  test("sets className, textContent and arbitrary attributes", () => {
    const node = utils.el("div", { className: "card", textContent: "hi", "data-x": "1" });
    assert.equal(node.tagName, "DIV");
    assert.equal(node.className, "card");
    assert.equal(node.textContent, "hi");
    assert.equal(node.getAttribute("data-x"), "1");
  });

  test("wires on* handlers as listeners", () => {
    let clicked = 0;
    const node = utils.el("button", { onClick: () => clicked++ });
    node.dispatchEvent(new (globalThis as any).Event("click"));
    assert.equal(clicked, 1);
  });

  test("appends element and string children, skipping nulls", () => {
    const child = utils.el("span", { textContent: "x" });
    const node = utils.el("div", {}, [child, " and text", null]);
    assert.equal(node.childNodes.length, 2);
    assert.equal(node.textContent, "x and text");
  });

  test("innerHTML attribute is applied as markup", () => {
    const node = utils.el("div", { innerHTML: "<b>bold</b>" });
    assert.equal(node.querySelector("b")?.textContent, "bold");
  });
});

describe("createInput", () => {
  test("produces a wrapped number input with id, value and step", () => {
    const wrapper = utils.createInput("test-id", 5, 0.1);
    assert.equal(wrapper.className, "number-input-wrapper");
    const input = wrapper.querySelector("input") as HTMLInputElement;
    assert.equal(input.id, "test-id");
    assert.equal(input.type, "number");
    assert.equal(input.value, "5");
    assert.equal(input.getAttribute("step"), "0.1");
  });

  test("includes up/down spin buttons that do not submit forms", () => {
    const wrapper = utils.createInput("t", 0, 1);
    const btns = wrapper.querySelectorAll("button.spin-btn");
    assert.equal(btns.length, 2);
    assert.equal((btns[0] as HTMLButtonElement).type, "button");
    assert.equal((btns[0] as HTMLButtonElement).tabIndex, -1);
  });

  test("stringifies non-numeric values (empty permittivity)", () => {
    const input = utils.createInput("t", "", 0.1).querySelector("input") as HTMLInputElement;
    assert.equal(input.value, "");
  });
});

describe("createSVG", () => {
  test("returns an SVG element for known icons", () => {
    for (const name of ["trash", "chevron", "close"]) {
      const svg = utils.createSVG(name);
      assert.equal(svg.tagName.toLowerCase(), "svg");
      assert.ok(svg.childNodes.length > 0, `${name} should draw something`);
    }
  });

  test("the removed rcs icon no longer draws anything", () => {
    const svg = utils.createSVG("rcs");
    assert.equal(svg.childNodes.length, 0);
  });

  test("unknown names produce an empty svg rather than throwing", () => {
    assert.equal(utils.createSVG("does-not-exist").childNodes.length, 0);
  });
});
