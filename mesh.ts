// ===== RadarSimApp - Mesh loading (STL, OBJ, PLY) and scene packing =====
//
// Pure geometry helpers shared by the native bridge. Kept out of bridge.ts so
// they can be imported (and tested) without koffi loading radarsimc.

import * as fs from "node:fs";
import * as path from "node:path";

// ── Mesh loaders ─────────────────────────────────────────────────────────────
// STL, OBJ and PLY, all read into one indexed triangle list: `points` holds
// the vertices (x, y, z each, in metres) and `cells` three vertex indices per
// triangle. Polygons with more than three corners are split into a fan of
// triangles from their first corner.

export const UNIT_SCALE: Record<string, number> = { mm: 1e-3, cm: 1e-2, m: 1.0, in: 0.0254 };

/** The model file types the loaders read, by extension. */
export const MESH_EXTENSIONS = ["stl", "obj", "ply"] as const;

export interface TriangleMesh {
  points: Float32Array;
  cells: Int32Array;
  /** Number of triangles. */
  cellSize: number;
}

/** Load a model, picking the loader by its file extension. `unit` is what the file's coordinates are in. */
export function loadMesh(filePath: string, unit: string = "m"): TriangleMesh {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  if (ext === "obj") return loadObj(fs.readFileSync(filePath, "utf8"), UNIT_SCALE[unit] ?? 1.0);
  if (ext === "ply") return loadPly(fs.readFileSync(filePath), UNIT_SCALE[unit] ?? 1.0);
  if (ext === "stl") return loadStl(filePath, unit);
  throw new Error(`Unsupported model file type ".${ext}" — use ${MESH_EXTENSIONS.map((e) => `.${e}`).join(", ")}`);
}

/** Builds an indexed mesh one vertex and one polygon at a time. */
class MeshBuilder {
  private points: number[] = [];
  private cells: number[] = [];

  constructor(private scale: number) {}

  get vertexCount(): number {
    return this.points.length / 3;
  }

  vertex(x: number, y: number, z: number): void {
    this.points.push(x * this.scale, y * this.scale, z * this.scale);
  }

  /** A polygon by its vertex indices (0-based), split into a triangle fan. */
  polygon(indices: number[]): void {
    for (const i of indices) {
      if (!Number.isInteger(i) || i < 0 || i >= this.vertexCount) {
        throw new Error(`A face refers to vertex ${i + 1}, but there are ${this.vertexCount} vertices`);
      }
    }
    for (let k = 1; k + 1 < indices.length; k++) this.cells.push(indices[0], indices[k], indices[k + 1]);
  }

  build(): TriangleMesh {
    return {
      points: new Float32Array(this.points),
      cells: new Int32Array(this.cells),
      cellSize: this.cells.length / 3,
    };
  }
}

// --- STL ---

export function loadStl(filePath: string, unit: string = "m"): TriangleMesh {
  const scale = UNIT_SCALE[unit] ?? 1.0;
  const buf = fs.readFileSync(filePath);

  const preview = buf.toString("ascii", 0, Math.min(buf.length, 256));
  if (preview.trimStart().startsWith("solid") && buf.toString("ascii").includes("facet normal")) {
    return loadAsciiStl(buf.toString("ascii"), scale);
  }

  // Binary: an 80-byte header, the triangle count, then 50 bytes a triangle
  // (normal, three vertices, attribute count). Vertices are not shared.
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
    cells[i * 3] = i * 3;
    cells[i * 3 + 1] = i * 3 + 1;
    cells[i * 3 + 2] = i * 3 + 2;
    offset += 2;
  }
  return { points, cells, cellSize: numTri };
}

export function loadAsciiStl(text: string, scale: number): TriangleMesh {
  const pts: number[] = [];
  const re = /vertex\s+([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)/gi;
  let idx = 0;
  for (const m of text.matchAll(re)) {
    pts.push(parseFloat(m[1]) * scale, parseFloat(m[2]) * scale, parseFloat(m[3]) * scale);
    idx++;
  }
  const cells = new Int32Array(idx);
  for (let i = 0; i < idx; i++) cells[i] = i;
  return { points: new Float32Array(pts), cells, cellSize: Math.floor(idx / 3) };
}

// --- OBJ ---

/**
 * Wavefront OBJ: `v x y z` vertices and `f` faces. A face corner may be
 * written `v`, `v/vt`, `v//vn` or `v/vt/vn`; only the vertex counts.
 * Indices start at 1, and a negative one counts back from the latest vertex.
 * Everything else (normals, texture coordinates, groups, materials) is skipped.
 */
export function loadObj(text: string, scale: number): TriangleMesh {
  const mesh = new MeshBuilder(scale);
  // A trailing backslash continues a statement on the next line
  for (const raw of text.replace(/\\\r?\n/g, " ").split(/\r?\n/)) {
    const tokens = raw.trim().split(/\s+/);
    if (tokens[0] === "v") {
      const [x, y, z] = tokens.slice(1, 4).map(Number);
      if (![x, y, z].every(Number.isFinite)) throw new Error(`Bad OBJ vertex: "${raw.trim()}"`);
      mesh.vertex(x, y, z);
    } else if (tokens[0] === "f") {
      const n = mesh.vertexCount;
      mesh.polygon(
        tokens.slice(1).map((corner) => {
          const i = parseInt(corner.split("/")[0], 10);
          return i < 0 ? n + i : i - 1;
        }),
      );
    }
  }
  return mesh.build();
}

// --- PLY ---

type PlyScalar = "int8" | "uint8" | "int16" | "uint16" | "int32" | "uint32" | "float32" | "float64";

/** PLY type names, old and new spellings, and their byte sizes. */
const PLY_TYPES: Record<string, [PlyScalar, number]> = {
  char: ["int8", 1],
  int8: ["int8", 1],
  uchar: ["uint8", 1],
  uint8: ["uint8", 1],
  short: ["int16", 2],
  int16: ["int16", 2],
  ushort: ["uint16", 2],
  uint16: ["uint16", 2],
  int: ["int32", 4],
  int32: ["int32", 4],
  uint: ["uint32", 4],
  uint32: ["uint32", 4],
  float: ["float32", 4],
  float32: ["float32", 4],
  double: ["float64", 8],
  float64: ["float64", 8],
};

interface PlyProperty {
  name: string;
  type: PlyScalar;
  /** For a list property: the type of its leading count. */
  countType?: PlyScalar;
}

interface PlyElement {
  name: string;
  count: number;
  properties: PlyProperty[];
}

function plyType(name: string): PlyScalar {
  const t = PLY_TYPES[name];
  if (!t) throw new Error(`Unknown PLY property type "${name}"`);
  return t[0];
}

/**
 * Stanford PLY, ASCII or binary (either byte order). Reads the `vertex`
 * element's x, y, z and the `face` element's vertex_indices (or
 * vertex_index) lists; any other element or property is read past.
 */
export function loadPly(buf: Buffer, scale: number): TriangleMesh {
  // The header is ASCII text up to and including the "end_header" line
  const end = buf.indexOf("end_header");
  if (buf.toString("ascii", 0, 3) !== "ply" || end < 0) throw new Error("Not a PLY file: no ply header");
  let bodyStart = buf.indexOf("\n", end) + 1;
  if (bodyStart === 0) bodyStart = buf.length;

  let format = "";
  const elements: PlyElement[] = [];
  for (const line of buf.toString("ascii", 0, end).split(/\r?\n/)) {
    const t = line.trim().split(/\s+/);
    if (t[0] === "format") format = t[1];
    else if (t[0] === "element") elements.push({ name: t[1], count: parseInt(t[2], 10), properties: [] });
    else if (t[0] === "property") {
      const el = elements[elements.length - 1];
      if (!el) throw new Error("PLY property before any element");
      el.properties.push(
        t[1] === "list"
          ? { name: t[4], countType: plyType(t[2]), type: plyType(t[3]) }
          : { name: t[2], type: plyType(t[1]) },
      );
    }
  }
  if (format !== "ascii" && format !== "binary_little_endian" && format !== "binary_big_endian") {
    throw new Error(`Unsupported PLY format "${format}"`);
  }

  // One reader for both encodings: the next number, of a given type
  let next: (type: PlyScalar) => number;
  if (format === "ascii") {
    const tokens = buf.toString("ascii", bodyStart).trim().split(/\s+/);
    let i = 0;
    next = () => {
      if (i >= tokens.length) throw new Error("PLY file ends early");
      return Number(tokens[i++]);
    };
  } else {
    const view = new DataView(buf.buffer, buf.byteOffset + bodyStart, buf.length - bodyStart);
    const little = format === "binary_little_endian";
    let off = 0;
    next = (type) => {
      const size = PLY_TYPES[type][1];
      if (off + size > view.byteLength) throw new Error("PLY file ends early");
      let v: number;
      switch (type) {
        case "int8":
          v = view.getInt8(off);
          break;
        case "uint8":
          v = view.getUint8(off);
          break;
        case "int16":
          v = view.getInt16(off, little);
          break;
        case "uint16":
          v = view.getUint16(off, little);
          break;
        case "int32":
          v = view.getInt32(off, little);
          break;
        case "uint32":
          v = view.getUint32(off, little);
          break;
        case "float32":
          v = view.getFloat32(off, little);
          break;
        case "float64":
          v = view.getFloat64(off, little);
          break;
      }
      off += size;
      return v;
    };
  }

  const mesh = new MeshBuilder(scale);
  for (const el of elements) {
    const xyz = ["x", "y", "z"].map((a) => el.properties.findIndex((p) => p.name === a));
    const isVertex = el.name === "vertex";
    if (isVertex && xyz.some((k) => k < 0)) throw new Error("PLY vertex element has no x, y, z");
    const faceProp = el.properties.findIndex(
      (p) => p.countType && (p.name === "vertex_indices" || p.name === "vertex_index"),
    );
    const isFace = el.name === "face";
    if (isFace && faceProp < 0) throw new Error("PLY face element has no vertex_indices list");

    for (let n = 0; n < el.count; n++) {
      const scalars: number[] = [];
      let corners: number[] = [];
      el.properties.forEach((p, k) => {
        if (p.countType) {
          const count = next(p.countType);
          const items: number[] = [];
          for (let c = 0; c < count; c++) items.push(next(p.type));
          if (k === faceProp) corners = items;
        } else {
          scalars[k] = next(p.type);
        }
      });
      if (isVertex) mesh.vertex(scalars[xyz[0]], scalars[xyz[1]], scalars[xyz[2]]);
      else if (isFace) mesh.polygon(corners);
    }
  }
  return mesh.build();
}

// ── Scene packing ────────────────────────────────────────────────────────────
/**
 * Upper bound on triangles sent to the renderer per mesh. Beyond this the mesh
 * is strided so the scene preview stays interactive; the full mesh is always
 * what the simulator uses.
 */
export const SCENE_MAX_CELLS = 1000000;

/**
 * Repack Get_Target_Mesh_State output ([cells][3 vertices][3 xyz], doubles)
 * into per-axis vertex arrays plus triangle indices for the scene view.
 * Vertices are per-triangle, not de-duplicated, so the index arrays are simply
 * 0,1,2 / 3,4,5 / ...
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

  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;

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
    index,
    totalCells,
    cells: tri,
    x,
    y,
    z,
    i,
    j,
    k,
    bounds: [minX, minY, minZ, maxX, maxY, maxZ],
  };
}
