// Shared jsdom bootstrap for renderer tests.
//
// The renderer modules are plain ES modules that touch `document`/`window` only
// inside functions, so it is enough to install the globals before importing
// them. Import this module (and await `installDom()`) before any dynamic
// import of dist/renderer/js/*.

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const GLOBAL_KEYS = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "SVGElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "MouseEvent",
  "localStorage",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "ResizeObserver",
] as const;

export interface DomHandle {
  dom: JSDOM;
  cleanup(): void;
}

/**
 * Install a jsdom document as the process globals.
 *
 * @param html Markup for the document body/page. Defaults to an empty page.
 */
export function installDom(html: string = "<!doctype html><html><body></body></html>"): DomHandle {
  const dom = new JSDOM(html, { url: "http://localhost/", pretendToBeVisual: true });
  const w = dom.window;

  // jsdom does not implement ResizeObserver; createTextInput constructs one.
  if (!Reflect.has(w, "ResizeObserver")) {
    Reflect.set(
      w,
      "ResizeObserver",
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
  }

  // Some of these (navigator) are getter-only on globalThis in modern Node, so
  // install by descriptor rather than assignment and restore the originals.
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const key of GLOBAL_KEYS) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value: key === "window" ? w : Reflect.get(w, key),
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }

  return {
    dom,
    cleanup(): void {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
      dom.window.close();
    },
  };
}

/** The element with this id, failing the test when the page has none. */
export function byId(id: string): HTMLElement {
  const found = document.getElementById(id);
  assert.ok(found, `#${id} is missing`);
  return found;
}

/** A stand-in Plotly that draws nothing, on both globalThis and window. */
export function stubPlotly(): void {
  const noop = () => Promise.resolve();
  const plotly = { newPlot: noop, react: noop, purge: () => {}, Plots: { resize: () => {} } };
  Reflect.set(globalThis, "Plotly", plotly);
  Reflect.set(window, "Plotly", plotly);
}

/** Stand in for the preload API with just the calls a test needs. */
export function stubApi(api: Partial<ElectronAPI>): void {
  Reflect.set(window, "api", api);
}

/** Load the app's real index.html into jsdom, without running its scripts. */
export function installAppDom(): DomHandle {
  const html = fs.readFileSync(path.join(REPO_ROOT, "renderer", "index.html"), "utf8");
  // Strip <script> tags: the bundled renderer code and Plotly are loaded
  // explicitly by the tests that need them.
  const inert = html.replace(/<script\b[\s\S]*?<\/script>/gi, "");
  return installDom(inert);
}
