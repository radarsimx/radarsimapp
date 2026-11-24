/**
 * Generates the app icons from the two SVG sources in renderer/assets:
 *   logo.svg       -> logo.png (512 px, Linux and the window icon)
 *                     logo.ico (16-256 px, Windows)
 *   logo-macos.svg -> logo-macos.png (1024 px, macOS; electron-builder makes the .icns)
 * Run with: npm run generate-icons
 *
 * Each size is rendered straight from the vector source rather than scaled
 * down from a large bitmap, so small icons stay sharp.
 */

"use strict";

const { createCanvas, loadImage } = require("@napi-rs/canvas");
const fs = require("node:fs");
const path = require("node:path");

const ASSETS = path.join(__dirname, "..", "renderer", "assets");
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

async function renderPng(svgFile, size) {
  const svg = fs
    .readFileSync(path.join(ASSETS, svgFile), "utf8")
    .replace(/(<svg\b[^>]*?)\swidth="\d+"\s+height="\d+"/, `$1 width="${size}" height="${size}"`);
  const img = await loadImage(Buffer.from(svg));
  const canvas = createCanvas(size, size);
  canvas.getContext("2d").drawImage(img, 0, 0, size, size);
  return canvas.toBuffer("image/png");
}

// ICO container with PNG-compressed entries (supported since Windows Vista).
function buildIco(entries) {
  const header = Buffer.alloc(6 + 16 * entries.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach(({ size, png }, i) => {
    const o = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, o);
    header.writeUInt8(size >= 256 ? 0 : size, o + 1);
    header.writeUInt8(0, o + 2);
    header.writeUInt8(0, o + 3);
    header.writeUInt16LE(1, o + 4);
    header.writeUInt16LE(32, o + 6);
    header.writeUInt32LE(png.length, o + 8);
    header.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...entries.map((e) => e.png)]);
}

async function main() {
  const write = (name, buf) => {
    fs.writeFileSync(path.join(ASSETS, name), buf);
    console.log(`wrote renderer/assets/${name} (${buf.length} bytes)`);
  };

  write("logo.png", await renderPng("logo.svg", 512));
  write("logo-macos.png", await renderPng("logo-macos.svg", 1024));

  const entries = [];
  for (const size of ICO_SIZES) entries.push({ size, png: await renderPng("logo.svg", size) });
  write("logo.ico", buildIco(entries));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
