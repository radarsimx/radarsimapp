// Shared jsdom bootstrap for renderer tests.
//
// The renderer modules are plain ES modules that touch `document`/`window` only
// inside functions, so it is enough to install the globals before importing
// them. Import this module (and await `installDom()`) before any dynamic
// import of dist/renderer/js/*.

import { JSDOM } from "jsdom";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const GLOBAL_KEYS = [
  "window", "document", "navigator", "HTMLElement", "SVGElement", "Element",
  "Node", "Event", "CustomEvent", "MouseEvent", "localStorage", "getComputedStyle",
  "requestAnimationFrame", "cancelAnimationFrame", "ResizeObserver",
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
  const w = dom.window as any;

  // jsdom does not implement ResizeObserver; createTextInput constructs one.
  if (!w.ResizeObserver) {
    w.ResizeObserver = class {
      observe(): void { }
      unobserve(): void { }
      disconnect(): void { }
    };
  }

  // Some of these (navigator) are getter-only on globalThis in modern Node, so
  // install by descriptor rather than assignment and restore the originals.
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const key of GLOBAL_KEYS) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value: key === "window" ? w : w[key],
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
        else delete (globalThis as any)[key];
      }
      dom.window.close();
    },
  };
}

/** Load the app's real index.html into jsdom, without running its scripts. */
export function installAppDom(): DomHandle {
  const html = fs.readFileSync(path.join(REPO_ROOT, "renderer", "index.html"), "utf8");
  // Strip <script> tags: the bundled renderer code and Plotly are loaded
  // explicitly by the tests that need them.
  const inert = html.replace(/<script\b[\s\S]*?<\/script>/gi, "");
  return installDom(inert);
}
