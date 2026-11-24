// ===== RadarSimApp - HDF5 export =====
//
// Writes a simulation result to an HDF5 file: nested objects become groups,
// numeric arrays become datasets of their own shape, and arrays of {re, im}
// sample blocks become compound complex datasets.

import * as fs from "node:fs";
import * as path from "node:path";
import type { Group } from "h5wasm";

/** A complex sample block as the simulator returns it: matching re/im arrays. */
interface ComplexBlock {
  re: ArrayLike<number>;
  im: ArrayLike<number>;
}

function isComplexBlock(v: unknown): v is ComplexBlock {
  return typeof v === "object" && v !== null && "re" in v && "im" in v;
}

/** The shape of a nested array, read down its first elements, and what sits at the bottom. */
function nestedShape(arr: unknown[]): { shape: number[]; leaf: unknown } {
  const shape: number[] = [];
  let cursor: unknown = arr;
  while (Array.isArray(cursor)) {
    shape.push(cursor.length);
    cursor = cursor[0];
  }
  return { shape, leaf: cursor };
}

/** Visit every leaf of a nested array, depth first. */
function forEachLeaf(a: unknown, visit: (leaf: unknown) => void): void {
  if (Array.isArray(a)) for (const el of a) forEachLeaf(el, visit);
  else visit(a);
}

function flattenComplexArray(arr: unknown[]): { re: Float64Array; im: Float64Array; shape: number[] } | null {
  const { shape, leaf } = nestedShape(arr);
  if (!isComplexBlock(leaf)) return null;

  shape.push(leaf.re.length);
  const total = shape.reduce((a, b) => a * b, 1);
  const re = new Float64Array(total);
  const im = new Float64Array(total);
  let idx = 0;
  forEachLeaf(arr, (block) => {
    if (!isComplexBlock(block)) return;
    for (let s = 0; s < block.re.length; s++) {
      re[idx] = block.re[s];
      im[idx] = block.im[s];
      idx++;
    }
  });
  return { re, im, shape };
}

function flattenNumericArray(arr: unknown[]): { data: Float64Array; shape: number[] } | null {
  const { shape, leaf } = nestedShape(arr);
  if (typeof leaf !== "number") return null;
  const data = new Float64Array(shape.reduce((a, b) => a * b, 1));
  let idx = 0;
  forEachLeaf(arr, (v) => {
    if (typeof v === "number") data[idx++] = v;
  });
  return { data, shape };
}

/** Recursively write a plain object into an HDF5 file or group. */
function writeGroup(group: Group, obj: object): void {
  for (const [key, value] of Object.entries(obj)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      const cplx = flattenComplexArray(value);
      if (cplx) {
        group.create_dataset({
          name: key,
          data: new Map([
            ["r", cplx.re],
            ["i", cplx.im],
          ]),
          shape: cplx.shape,
          dtype: [
            ["r", "<d"],
            ["i", "<d"],
          ],
        });
        continue;
      }
      const flat = flattenNumericArray(value);
      if (flat) group.create_dataset({ name: key, data: flat.data, shape: flat.shape });
    } else if (typeof value === "object") {
      writeGroup(group.create_group(key), value);
    } else if (typeof value === "number") {
      group.create_dataset({ name: key, data: new Float64Array([value]) });
    } else if (typeof value === "string") {
      group.create_dataset({ name: key, data: [value] });
    }
  }
}

/**
 * Write `data` to `filePath` as HDF5. h5wasm works in its own in-memory file
 * system, so the file is built there and then copied out to disk.
 */
export async function writeHdf5File(filePath: string, data: object): Promise<void> {
  const h5wasm = await import("h5wasm");
  const { FS } = await h5wasm.ready;
  const name = path.basename(filePath);
  const f = new h5wasm.File(name, "w");
  writeGroup(f, data);
  f.flush();
  f.close();
  fs.writeFileSync(filePath, FS.readFile(name));
  FS.unlink(name);
}
