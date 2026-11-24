// Load the app's built output (dist/), which is what the tests exercise.
//
// dist/ is emitted without declarations, so a plain import of it gets whatever
// types tsc can infer from the JavaScript. Each built module is compiled from a
// source file of the same name, so the caller names that source's type instead:
//
//   const utils = await loadBuilt<typeof import("../../renderer/ts/utils.ts")>("renderer/js/utils.js");

import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "dist");

/** Import `dist/<file>`, typed as the source module it was built from. */
export async function loadBuilt<T>(file: string): Promise<T> {
  return import(pathToFileURL(path.join(DIST, file)).href);
}
