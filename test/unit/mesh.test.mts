import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  loadAsciiStl,
  loadMesh,
  loadObj,
  loadPly,
  loadStl,
  packSceneMesh,
  SCENE_MAX_CELLS,
  UNIT_SCALE,
} from "../../dist/mesh.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────
let tmp: string;

const ASCII_STL = `solid unit
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1000 0 0
    vertex 0 1000 0
  endloop
endfacet
facet normal 0 0 1
  outer loop
    vertex 1000 1000 0
    vertex 0 1000 0
    vertex 1000 0 0
  endloop
endfacet
endsolid unit
`;

/** Minimal binary STL: 80-byte header, uint32 count, then 50 bytes/triangle. */
function binaryStl(triangles: number[][][]): Buffer {
  const buf = Buffer.alloc(84 + triangles.length * 50);
  buf.write("binary stl fixture", 0, "ascii");
  buf.writeUInt32LE(triangles.length, 80);
  let off = 84;
  for (const tri of triangles) {
    off += 12; // normal, unused by the loader
    for (const [x, y, z] of tri) {
      buf.writeFloatLE(x, off);
      buf.writeFloatLE(y, off + 4);
      buf.writeFloatLE(z, off + 8);
      off += 12;
    }
    off += 2; // attribute byte count
  }
  return buf;
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "radarsimapp-mesh-"));
  fs.writeFileSync(path.join(tmp, "ascii.stl"), ASCII_STL);
  fs.writeFileSync(
    path.join(tmp, "binary.stl"),
    binaryStl([
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ],
      [
        [1, 1, 0],
        [0, 1, 0],
        [1, 0, 0],
      ],
    ]),
  );
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// ── Tests ────────────────────────────────────────────────────────────────────
describe("UNIT_SCALE", () => {
  test("covers the units the UI offers", () => {
    assert.equal(UNIT_SCALE.m, 1);
    assert.equal(UNIT_SCALE.cm, 1e-2);
    assert.equal(UNIT_SCALE.mm, 1e-3);
    assert.equal(UNIT_SCALE.in, 0.0254);
  });
});

describe("loadStl - binary", () => {
  test("reads the triangle count and vertices", () => {
    const m = loadStl(path.join(tmp, "binary.stl"));
    assert.equal(m.cellSize, 2);
    assert.equal(m.points.length, 2 * 9);
    assert.deepEqual(Array.from(m.points.slice(0, 9)), [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });

  test("cells index vertices per-triangle, without de-duplication", () => {
    const m = loadStl(path.join(tmp, "binary.stl"));
    assert.deepEqual(Array.from(m.cells), [0, 1, 2, 3, 4, 5]);
  });

  test("applies the unit scale", () => {
    const m = loadStl(path.join(tmp, "binary.stl"), "mm");
    assert.ok(Math.abs(m.points[3] - 1e-3) < 1e-9, "1 mm should become 0.001 m");
  });

  test("an unknown unit falls back to metres rather than NaN", () => {
    const m = loadStl(path.join(tmp, "binary.stl"), "furlong");
    assert.equal(m.points[3], 1);
  });

  test("missing file throws", () => {
    assert.throws(() => loadStl(path.join(tmp, "nope.stl")), /ENOENT/);
  });
});

describe("loadStl - ASCII", () => {
  test("detects ASCII format and parses every vertex", () => {
    const m = loadStl(path.join(tmp, "ascii.stl"));
    assert.equal(m.cellSize, 2);
    assert.equal(m.points.length, 18);
  });

  test("applies the unit scale", () => {
    const m = loadStl(path.join(tmp, "ascii.stl"), "mm");
    assert.ok(Math.abs(m.points[3] - 1) < 1e-6, "1000 mm should become 1 m");
  });
});

describe("loadAsciiStl", () => {
  test("cellSize is the vertex count divided by three", () => {
    const m = loadAsciiStl(ASCII_STL, 1);
    assert.equal(m.cellSize, 2);
    assert.equal(m.cells.length, 6);
  });

  test("text with no vertices yields an empty mesh", () => {
    const m = loadAsciiStl("solid empty\nendsolid empty\n", 1);
    assert.equal(m.cellSize, 0);
    assert.equal(m.points.length, 0);
  });

  test("handles scientific notation and negatives", () => {
    const m = loadAsciiStl("vertex 1e2 -2.5 3.5e-1\n", 1);
    // points is a Float32Array, so values that are not exactly representable
    // in single precision (0.35) come back rounded.
    assert.equal(m.points.length, 3);
    assert.equal(m.points[0], 100);
    assert.equal(m.points[1], -2.5);
    assert.ok(Math.abs(m.points[2] - 0.35) < 1e-7);
  });

  test("vertices are stored at single precision", () => {
    const m = loadAsciiStl("vertex 0.1 0 0\n", 1);
    assert.ok(m.points instanceof Float32Array);
    assert.notEqual(m.points[0], 0.1, "0.1 is not representable in float32");
    assert.ok(Math.abs(m.points[0] - 0.1) < 1e-7);
  });
});

// ── OBJ ──────────────────────────────────────────────────────────────────────
/** A unit square in z = 0 as one quad, written with every corner style OBJ allows. */
const OBJ_QUAD = `# a unit square
o square
v 0 0 0
v 1000 0 0
v 1000 1000 0
v 0 1000 0
vt 0 0
vn 0 0 1
f 1/1/1 2//1 3/1 4
`;

describe("loadObj", () => {
  test("reads vertices and splits a quad into two triangles", () => {
    const m = loadObj(OBJ_QUAD, 1);
    assert.equal(m.points.length, 4 * 3);
    assert.equal(m.cellSize, 2);
    assert.deepEqual(Array.from(m.cells), [0, 1, 2, 0, 2, 3]);
  });

  test("applies the unit scale", () => {
    const m = loadObj(OBJ_QUAD, UNIT_SCALE.mm);
    assert.ok(Math.abs(m.points[3] - 1) < 1e-6, "1000 mm should become 1 m");
  });

  test("negative indices count back from the latest vertex", () => {
    const m = loadObj("v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1\n", 1);
    assert.deepEqual(Array.from(m.cells), [0, 1, 2]);
  });

  test("shares vertices between faces", () => {
    const m = loadObj("v 0 0 0\nv 1 0 0\nv 0 1 0\nv 1 1 0\nf 1 2 3\nf 2 4 3\n", 1);
    assert.equal(m.points.length, 4 * 3);
    assert.deepEqual(Array.from(m.cells), [0, 1, 2, 1, 3, 2]);
  });

  test("a face that refers to a missing vertex throws", () => {
    assert.throws(() => loadObj("v 0 0 0\nf 1 2 3\n", 1), /vertex 2/);
  });

  test("handles CRLF line endings", () => {
    const m = loadObj(OBJ_QUAD.replace(/\n/g, "\r\n"), 1);
    assert.equal(m.cellSize, 2);
  });
});

// ── PLY ──────────────────────────────────────────────────────────────────────
/** A unit square as one quad face, with extra properties the loader must read past. */
const PLY_HEADER = (format: string) => `ply
format ${format} 1.0
comment a unit square
element vertex 4
property float x
property float y
property float z
property uchar red
element face 1
property list uchar int vertex_indices
property uchar flags
end_header
`;
const PLY_VERTICES = [
  [0, 0, 0],
  [1000, 0, 0],
  [1000, 1000, 0],
  [0, 1000, 0],
];

function binaryPly(littleEndian: boolean): Buffer {
  const header = Buffer.from(PLY_HEADER(littleEndian ? "binary_little_endian" : "binary_big_endian"), "ascii");
  const body = Buffer.alloc(4 * (12 + 1) + (1 + 4 * 4 + 1));
  let off = 0;
  for (const v of PLY_VERTICES) {
    for (const c of v) {
      if (littleEndian) body.writeFloatLE(c, off);
      else body.writeFloatBE(c, off);
      off += 4;
    }
    body.writeUInt8(200, off++); // red
  }
  body.writeUInt8(4, off++);
  for (const i of [0, 1, 2, 3]) {
    if (littleEndian) body.writeInt32LE(i, off);
    else body.writeInt32BE(i, off);
    off += 4;
  }
  body.writeUInt8(7, off++); // flags
  return Buffer.concat([header, body]);
}

describe("loadPly", () => {
  const asciiPly = Buffer.from(
    `${PLY_HEADER("ascii")}${PLY_VERTICES.map((v) => `${v.join(" ")} 200`).join("\n")}\n4 0 1 2 3 7\n`,
    "ascii",
  );

  for (const [name, buf] of [
    ["ASCII", asciiPly],
    ["binary little-endian", binaryPly(true)],
    ["binary big-endian", binaryPly(false)],
  ] as const) {
    test(`${name}: reads the vertices and fans the quad into two triangles`, () => {
      const m = loadPly(buf, 1);
      assert.deepEqual(Array.from(m.points), PLY_VERTICES.flat());
      assert.equal(m.cellSize, 2);
      assert.deepEqual(Array.from(m.cells), [0, 1, 2, 0, 2, 3]);
    });
  }

  test("applies the unit scale", () => {
    const m = loadPly(binaryPly(true), UNIT_SCALE.mm);
    assert.ok(Math.abs(m.points[3] - 1) < 1e-6, "1000 mm should become 1 m");
  });

  test("handles a CRLF header", () => {
    const crlf = Buffer.from(asciiPly.toString("ascii").replace(/\n/g, "\r\n"), "ascii");
    assert.equal(loadPly(crlf, 1).cellSize, 2);
  });

  test("rejects a file that is not PLY", () => {
    assert.throws(() => loadPly(Buffer.from("solid nope\n"), 1), /Not a PLY file/);
  });

  test("a truncated body throws rather than reading garbage", () => {
    const buf = binaryPly(true);
    assert.throws(() => loadPly(buf.subarray(0, buf.length - 5), 1), /ends early/);
  });
});

// ── loadMesh ─────────────────────────────────────────────────────────────────
describe("loadMesh", () => {
  test("picks the loader by extension, in any case", () => {
    fs.writeFileSync(path.join(tmp, "square.OBJ"), OBJ_QUAD);
    fs.writeFileSync(path.join(tmp, "square.ply"), binaryPly(true));
    assert.equal(loadMesh(path.join(tmp, "square.OBJ")).cellSize, 2);
    assert.equal(loadMesh(path.join(tmp, "square.ply")).cellSize, 2);
    assert.equal(loadMesh(path.join(tmp, "binary.stl")).cellSize, 2);
  });

  test("passes the unit on", () => {
    const m = loadMesh(path.join(tmp, "square.OBJ"), "mm");
    assert.ok(Math.abs(m.points[3] - 1) < 1e-6);
  });

  test("an unsupported extension throws, naming the ones that work", () => {
    fs.writeFileSync(path.join(tmp, "model.fbx"), "");
    assert.throws(() => loadMesh(path.join(tmp, "model.fbx")), /\.stl, \.obj, \.ply/);
  });
});

// ── packSceneMesh ────────────────────────────────────────────────────────────
/** Build a Get_Target_Mesh_State-shaped buffer: [cells][3 verts][3 xyz]. */
function meshBuffer(cells: number, fn: (tri: number, vert: number) => [number, number, number]): Float64Array {
  const pts = new Float64Array(cells * 9);
  for (let c = 0; c < cells; c++) {
    for (let v = 0; v < 3; v++) {
      const [x, y, z] = fn(c, v);
      pts[c * 9 + v * 3] = x;
      pts[c * 9 + v * 3 + 1] = y;
      pts[c * 9 + v * 3 + 2] = z;
    }
  }
  return pts;
}

describe("packSceneMesh", () => {
  test("splits interleaved xyz into separate axis arrays", () => {
    const pts = meshBuffer(1, (_c, v) => [v, v * 10, v * 100]);
    const m = packSceneMesh(0, 1, pts);
    assert.deepEqual(Array.from(m.x), [0, 1, 2]);
    assert.deepEqual(Array.from(m.y), [0, 10, 20]);
    assert.deepEqual(Array.from(m.z), [0, 100, 200]);
  });

  test("index arrays are sequential triples", () => {
    const m = packSceneMesh(
      0,
      3,
      meshBuffer(3, () => [0, 0, 0]),
    );
    assert.deepEqual(Array.from(m.i), [0, 3, 6]);
    assert.deepEqual(Array.from(m.j), [1, 4, 7]);
    assert.deepEqual(Array.from(m.k), [2, 5, 8]);
  });

  test("every index stays inside the vertex arrays", () => {
    const cells = 500;
    const m = packSceneMesh(
      0,
      cells,
      meshBuffer(cells, () => [1, 2, 3]),
    );
    assert.equal(m.x.length, m.cells * 3);
    assert.ok(m.k[m.cells - 1] < m.x.length, "last index must be addressable");
  });

  test("computes axis-aligned bounds", () => {
    const pts = meshBuffer(2, (c, v) => [c * 10 + v, 1 - v, v === 2 ? 5 : 0]);
    const m = packSceneMesh(0, 2, pts);
    const [minX, minY, minZ, maxX, maxY, maxZ] = m.bounds;
    assert.equal(minX, 0);
    assert.equal(maxX, 12);
    assert.equal(minY, -1);
    assert.equal(maxY, 1);
    assert.equal(minZ, 0);
    assert.equal(maxZ, 5);
  });

  test("carries the caller's mesh index through", () => {
    assert.equal(
      packSceneMesh(
        7,
        1,
        meshBuffer(1, () => [0, 0, 0]),
      ).index,
      7,
    );
  });

  test("small meshes are returned whole", () => {
    const m = packSceneMesh(
      0,
      1000,
      meshBuffer(1000, () => [0, 0, 0]),
    );
    assert.equal(m.totalCells, 1000);
    assert.equal(m.cells, 1000, "no striding below the cap");
  });

  test("meshes at the cap are still returned whole", () => {
    // Only the counts matter here, so avoid allocating the full buffer.
    const cells = SCENE_MAX_CELLS;
    const m = packSceneMesh(0, cells, new Float64Array(cells * 9));
    assert.equal(m.cells, cells);
  });

  test("oversized meshes are strided down to at most the cap", () => {
    const cells = SCENE_MAX_CELLS * 2 + 1;
    const m = packSceneMesh(0, cells, new Float64Array(cells * 9));
    assert.equal(m.totalCells, cells, "reports the true source size");
    assert.ok(m.cells <= SCENE_MAX_CELLS, `${m.cells} should be <= ${SCENE_MAX_CELLS}`);
    assert.ok(m.cells > SCENE_MAX_CELLS / 2, "should not over-decimate");
    assert.equal(m.x.length, m.cells * 3, "arrays sized to what was actually kept");
    assert.equal(m.i.length, m.cells);
  });

  test("striding keeps whole triangles, never partial ones", () => {
    const cells = SCENE_MAX_CELLS + 10;
    // Tag each vertex with its triangle so we can check they stay grouped.
    const pts = meshBuffer(cells, (c) => [c, c, c]);
    const m = packSceneMesh(0, cells, pts);
    for (let t = 0; t < m.cells; t++) {
      const a = m.x[t * 3],
        b = m.x[t * 3 + 1],
        c = m.x[t * 3 + 2];
      assert.equal(a, b);
      assert.equal(b, c);
    }
  });

  test("zero cells produces an empty, non-crashing result", () => {
    const m = packSceneMesh(0, 0, new Float64Array(0));
    assert.equal(m.cells, 0);
    assert.equal(m.x.length, 0);
    assert.ok(!Number.isFinite(m.bounds[0]), "no vertices means no real bounds");
  });
});
