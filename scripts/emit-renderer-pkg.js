// The renderer is compiled to ES modules (tsconfig.renderer.json), but the
// project's root package.json has no "type" field, so Node treats .js as
// CommonJS and warns when it has to reparse each renderer file as ESM.
//
// A package.json scoping just the renderer output settles it. Electron loads
// these through <script type="module"> in a browser context and never consults
// this file; it exists only for Node, which is what runs the tests.
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "..", "dist", "renderer", "js");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(
  path.join(dir, "package.json"),
  JSON.stringify({ type: "module" }, null, 2) + "\n"
);
