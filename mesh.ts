"use strict";
// ===== RadarSimApp - Mesh loading and scene packing =====
//
// Pure geometry helpers shared by the native bridge. Kept out of bridge.ts so
// they can be imported (and tested) without koffi loading radarsimc.

import * as fs from "fs";

// ── Mesh (STL) loader ────────────────────────────────────────────────────────
export const UNIT_SCALE: Record<string, number> = { mm: 1e-3, cm: 1e-2, m: 1.0, in: 0.0254 };

export interface StlMesh {
  points: Float32Array;
  cells: Int32Array;
  cellSize: number;
}

export function loadStl(filePath: string, unit: string = "m"): StlMesh {
  const scale = UNIT_SCALE[unit] ?? 1.0;
  const buf = fs.readFileSync(filePath);

  const preview = buf.toString("ascii", 0, Math.min(buf.length, 256));
  if (preview.trimStart().startsWith("solid") && buf.toString("ascii").includes("facet normal")) {
    return loadAsciiStl(buf.toString("ascii"), scale);
  }

  const numTri = buf.readUInt32LE(80);
  const points = new Float32Array(numTri * 9);
  const cells = new Int32Array(numTri * 3);
  let offset = 84;
  for (let i = 0; i < numTri; i++) {
    offset += 12;
    for (let v = 0; v < 3; v++) {
      const b = i * 9 + v * 3;
      points[b] = buf.readFloatLE(offset) * scale;
      points[b + 1] = buf.readFloatLE(offset + 4) * scale;
      points[b + 2] = buf.readFloatLE(offset + 8) * scale;
      offset += 12;
    }
    cells[i * 3] = i * 3; cells[i * 3 + 1] = i * 3 + 1; cells[i * 3 + 2] = i * 3 + 2;
    offset += 2;
  }
  return { points, cells, cellSize: numTri };
}

export function loadAsciiStl(text: string, scale: number): StlMesh {
  const pts: number[] = [];
  const re = /vertex\s+([\d.e+\-]+)\s+([\d.e+\-]+)\s+([\d.e+\-]+)/gi;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = re.exec(text)) !== null) {
    pts.push(parseFloat(m[1]) * scale, parseFloat(m[2]) * scale, parseFloat(m[3]) * scale);
    idx++;
  }
  const cells = new Int32Array(idx);
  for (let i = 0; i < idx; i++) cells[i] = i;
  return { points: new Float32Array(pts), cells, cellSize: Math.floor(idx / 3) };
}

// ── Scene packing ────────────────────────────────────────────────────────────
/**
 * Upper bound on triangles sent to the renderer per mesh. Beyond this the mesh
 * is strided so the scene preview stays interactive; the full mesh is always
 * what the simulator uses.
 */
export const SCENE_MAX_CELLS = 150000;

export interface SceneMesh {
  /** Index into the mesh-target list (point targets are not counted). */
  index: number;
  /** Triangles in the source mesh. */
  totalCells: number;
  /** Triangles actually returned (< totalCells when strided). */
  cells: number;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  i: Int32Array;
  j: Int32Array;
  k: Int32Array;
  /** Axis-aligned bounds of the returned vertices: [minX,minY,minZ,maxX,maxY,maxZ]. */
  bounds: number[];
}

/**
 * Repack Get_Target_Mesh_State output ([cells][3 vertices][3 xyz], doubles)
 * into Plotly mesh3d vertex/index arrays. Vertices are per-triangle, not
 * de-duplicated, so the index arrays are simply 0,1,2 / 3,4,5 / ...
 */
export function packSceneMesh(index: number, totalCells: number, pts: Float64Array): SceneMesh {
  const stride = Math.max(1, Math.ceil(totalCells / SCENE_MAX_CELLS));
  const cells = Math.ceil(totalCells / stride);

  const x = new Float32Array(cells * 3);
  const y = new Float32Array(cells * 3);
  const z = new Float32Array(cells * 3);
  const i = new Int32Array(cells);
  const j = new Int32Array(cells);
  const k = new Int32Array(cells);

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  let tri = 0;
  for (let c = 0; c < totalCells; c += stride) {
    const src = c * 9;
    const dst = tri * 3;
    for (let v = 0; v < 3; v++) {
      const vx = pts[src + v * 3];
      const vy = pts[src + v * 3 + 1];
      const vz = pts[src + v * 3 + 2];
      x[dst + v] = vx;
      y[dst + v] = vy;
      z[dst + v] = vz;
      if (vx < minX) minX = vx;
      if (vy < minY) minY = vy;
      if (vz < minZ) minZ = vz;
      if (vx > maxX) maxX = vx;
      if (vy > maxY) maxY = vy;
      if (vz > maxZ) maxZ = vz;
    }
    i[tri] = dst;
    j[tri] = dst + 1;
    k[tri] = dst + 2;
    tri++;
  }

  return {
    index, totalCells, cells: tri, x, y, z, i, j, k,
    bounds: [minX, minY, minZ, maxX, maxY, maxZ],
  };
}
