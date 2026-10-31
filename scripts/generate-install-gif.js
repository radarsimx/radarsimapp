/**
 * Generates renderer/assets/install.gif, the animation the Squirrel installer
 * shows while it installs.
 * Run with: npm run generate-gif
 *
 * Frames are drawn at 2x and scaled down, so edges stay smooth. All frames share
 * one palette and use ordered dithering, so gradients neither band nor flicker
 * from frame to frame.
 */

"use strict";

const { createCanvas } = require("@napi-rs/canvas");
const { GIFEncoder, quantize } = require("gifenc");
const fs = require("fs");
const path = require("path");

const pkg = require("../package.json");

// ── Output ───────────────────────────────────────────────────────────────────
const W = 628, H = 368;
const SCALE = 2;
const RW = W * SCALE, RH = H * SCALE;
const FRAMES = 96;          // one full turn of the beam
const DELAY = 30;           // ms per frame (GIF stores hundredths of a second)

// ── Colours (match renderer/css/styles.css) ──────────────────────────────────
const BG = "#0d0b12";
const PRIMARY = [78, 58, 114];     // --primary  #4e3a72
const ACCENT = [184, 163, 230];    // --accent   #b8a3e6
const INK = "#e7e4ef";             // --ink
const INK_2 = "#aca7ba";           // --ink-2
const INK_3 = "#7b768a";           // --ink-3
const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;

// ── Layout (output pixels; multiplied by SCALE when drawn) ───────────────────
const CX = 196, CY = H / 2, R = 132;   // radar scope
const TX = 372;                        // left edge of the text column
const BAR_W = 200, BAR_H = 4;

// Targets: bearing in degrees clockwise from north, range as a fraction of R
const BLIPS = [
  { brg: 38, rng: 0.62, s: 1.0 },
  { brg: 112, rng: 0.38, s: 0.8 },
  { brg: 205, rng: 0.74, s: 1.1 },
  { brg: 262, rng: 0.5, s: 0.8 },
  { brg: 318, rng: 0.82, s: 0.9 },
];
const TRAIL = 0.42;          // the trail covers this fraction of a full turn
const BLIP_FADE = 0.7;       // a target fades out over this fraction of a turn

// ── Drawing ──────────────────────────────────────────────────────────────────
const hi = createCanvas(RW, RH);
const ctx = hi.getContext("2d");
const out = createCanvas(W, H);
const octx = out.getContext("2d");
octx.imageSmoothingEnabled = true;
octx.imageSmoothingQuality = "high";

const deg = (d) => (d * Math.PI) / 180;
// Canvas angles start at 3 o'clock; bearings start at 12 o'clock
const brgToAngle = (b) => deg(b - 90);

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawBackground() {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  // A soft brand glow behind the scope
  const g = ctx.createRadialGradient(CX, CY, 0, CX, CY, R * 1.9);
  g.addColorStop(0, rgba(PRIMARY, 0.42));
  g.addColorStop(0.55, rgba(PRIMARY, 0.12));
  g.addColorStop(1, rgba(PRIMARY, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function drawScopeFace() {
  // Face
  const face = ctx.createRadialGradient(CX, CY, 0, CX, CY, R);
  face.addColorStop(0, rgba(PRIMARY, 0.38));
  face.addColorStop(1, "rgba(13,11,18,0.75)");
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.arc(CX, CY, R, 0, Math.PI * 2);
  ctx.fill();

  // Range rings
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(ACCENT, 0.13);
  for (const f of [0.25, 0.5, 0.75]) {
    ctx.beginPath();
    ctx.arc(CX, CY, R * f, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Crosshair
  ctx.beginPath();
  ctx.moveTo(CX, CY - R); ctx.lineTo(CX, CY + R);
  ctx.moveTo(CX - R, CY); ctx.lineTo(CX + R, CY);
  ctx.stroke();

  // Bearing ticks round the rim: long every 30°, short every 10°
  for (let b = 0; b < 360; b += 10) {
    const a = brgToAngle(b);
    const len = b % 30 === 0 ? 7 : 3.5;
    ctx.strokeStyle = rgba(ACCENT, b % 30 === 0 ? 0.4 : 0.2);
    ctx.beginPath();
    ctx.moveTo(CX + Math.cos(a) * R, CY + Math.sin(a) * R);
    ctx.lineTo(CX + Math.cos(a) * (R - len), CY + Math.sin(a) * (R - len));
    ctx.stroke();
  }

  // Rim
  ctx.strokeStyle = rgba(ACCENT, 0.3);
  ctx.beginPath();
  ctx.arc(CX, CY, R - 0.5, 0, Math.PI * 2);
  ctx.stroke();
}

function drawSweep(beam) {
  const a = brgToAngle(beam);

  // Trail: a conic gradient that fades in towards the beam
  ctx.save();
  ctx.beginPath();
  ctx.arc(CX, CY, R - 1, 0, Math.PI * 2);
  ctx.clip();
  const start = a - TRAIL * Math.PI * 2;
  const trail = ctx.createConicGradient(start, CX, CY);
  trail.addColorStop(0, rgba(ACCENT, 0));
  trail.addColorStop(TRAIL * 0.4, rgba(ACCENT, 0.05));
  trail.addColorStop(TRAIL * 0.8, rgba(ACCENT, 0.17));
  trail.addColorStop(TRAIL, rgba(ACCENT, 0.4));
  trail.addColorStop(Math.min(TRAIL + 0.0001, 1), rgba(ACCENT, 0));
  trail.addColorStop(1, rgba(ACCENT, 0));
  ctx.fillStyle = trail;
  ctx.beginPath();
  ctx.moveTo(CX, CY);
  ctx.arc(CX, CY, R, start, a);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Beam line with a glow
  const ex = CX + Math.cos(a) * (R - 1), ey = CY + Math.sin(a) * (R - 1);
  const line = ctx.createLinearGradient(CX, CY, ex, ey);
  line.addColorStop(0, rgba(ACCENT, 0.15));
  line.addColorStop(1, rgba(ACCENT, 1));
  ctx.save();
  ctx.lineCap = "round";
  ctx.shadowColor = rgba(ACCENT, 0.7);
  ctx.shadowBlur = 8 * SCALE;
  ctx.strokeStyle = line;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(CX, CY);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.restore();

  // Hub
  ctx.fillStyle = rgba(ACCENT, 0.9);
  ctx.beginPath();
  ctx.arc(CX, CY, 2.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawBlips(beam) {
  for (const b of BLIPS) {
    // How far (as a fraction of a turn) the beam has passed this target
    const since = (((beam - b.brg) % 360) + 360) % 360 / 360;
    if (since > BLIP_FADE) continue;
    const life = since / BLIP_FADE;
    const alpha = Math.pow(1 - life, 1.6);
    const a = brgToAngle(b.brg);
    const x = CX + Math.cos(a) * R * b.rng;
    const y = CY + Math.sin(a) * R * b.rng;

    // Glow
    const gr = 9 * b.s;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, gr);
    glow.addColorStop(0, rgba(ACCENT, 0.55 * alpha));
    glow.addColorStop(1, rgba(ACCENT, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, gr, 0, Math.PI * 2);
    ctx.fill();

    // Echo ring that spreads out just after the beam passes
    if (life < 0.35) {
      const k = life / 0.35;
      ctx.strokeStyle = rgba(ACCENT, 0.5 * (1 - k));
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, (3 + k * 10) * b.s, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Core
    ctx.fillStyle = `rgba(240,234,255,${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, 2.2 * b.s, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawText(t, f) {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  ctx.font = "600 32px 'Segoe UI', Arial, sans-serif";
  ctx.fillStyle = INK;
  ctx.fillText("RadarSimApp", TX, CY - 14);

  const dots = ".".repeat(Math.floor(f / (FRAMES / 4)) % 4);
  ctx.font = "15px 'Segoe UI', Arial, sans-serif";
  ctx.fillStyle = INK_2;
  ctx.fillText(`Installing${dots}`, TX, CY + 14);

  // Indeterminate progress bar: a soft highlight that travels the track
  const by = CY + 34;
  ctx.fillStyle = rgba(ACCENT, 0.12);
  roundRect(TX, by, BAR_W, BAR_H, BAR_H / 2);
  ctx.fill();

  const sw = BAR_W * 0.45;
  const sx = TX - sw + t * (BAR_W + sw);
  const shine = ctx.createLinearGradient(sx, 0, sx + sw, 0);
  shine.addColorStop(0, rgba(ACCENT, 0));
  shine.addColorStop(0.5, rgba(ACCENT, 1));
  shine.addColorStop(1, rgba(ACCENT, 0));
  ctx.save();
  roundRect(TX, by, BAR_W, BAR_H, BAR_H / 2);
  ctx.clip();
  ctx.fillStyle = shine;
  ctx.fillRect(sx, by, sw, BAR_H);
  ctx.restore();

  ctx.font = "12px 'Segoe UI', Arial, sans-serif";
  ctx.fillStyle = INK_3;
  ctx.fillText(`Version ${pkg.version}`, TX, by + 30);
}

function renderFrame(f) {
  const t = f / FRAMES;
  const beam = t * 360;
  ctx.save();
  ctx.scale(SCALE, SCALE);
  drawBackground();
  drawScopeFace();
  drawBlips(beam);
  drawSweep(beam);
  drawText(t, f);
  ctx.restore();

  octx.clearRect(0, 0, W, H);
  octx.drawImage(hi, 0, 0, W, H);
  return octx.getImageData(0, 0, W, H).data;
}

// ── Render all frames ────────────────────────────────────────────────────────
const frames = [];
for (let f = 0; f < FRAMES; f++) frames.push(Uint8ClampedArray.from(renderFrame(f)));

// ── One palette for every frame ──────────────────────────────────────────────
// Sample every 4th pixel of every 3rd frame; that sees every colour the
// animation uses without making the quantiser slow.
const SAMPLE_STEP = 4;
const sampleFrames = frames.filter((_, i) => i % 3 === 0);
const pxPerFrame = Math.ceil((W * H) / SAMPLE_STEP);
const sample = new Uint8ClampedArray(sampleFrames.length * pxPerFrame * 4);
let o = 0;
for (const fr of sampleFrames) {
  for (let p = 0; p < W * H; p += SAMPLE_STEP) {
    sample[o++] = fr[p * 4];
    sample[o++] = fr[p * 4 + 1];
    sample[o++] = fr[p * 4 + 2];
    sample[o++] = 255;
  }
}
// 255 colours, plus one slot that marks a pixel as unchanged from the last frame
const palette = quantize(sample.subarray(0, o), 255, { format: "rgb565" });
const KEEP = palette.length;
palette.push([0, 0, 0]);

// Nearest palette entry, cached on 6 bits per channel
const cache = new Int16Array(1 << 18).fill(-1);
function nearest(r, g, b) {
  const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
  let idx = cache[key];
  if (idx >= 0) return idx;
  let best = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const dr = p[0] - r, dg = p[1] - g, db = p[2] - b;
    const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
    if (d < best) { best = d; idx = i; }
  }
  cache[key] = idx;
  return idx;
}

// Ordered (Bayer) dithering: the pattern is fixed in place, so unlike error
// diffusion it does not crawl from frame to frame
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const DITHER = 6;
function toIndexed(rgba) {
  const idx = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      const d = (BAYER[((y & 3) << 2) | (x & 3)] / 16 - 0.47) * DITHER;
      const r = Math.max(0, Math.min(255, rgba[p * 4] + d));
      const g = Math.max(0, Math.min(255, rgba[p * 4 + 1] + d));
      const b = Math.max(0, Math.min(255, rgba[p * 4 + 2] + d));
      idx[p] = nearest(r | 0, g | 0, b | 0);
    }
  }
  return idx;
}

// ── Encode ───────────────────────────────────────────────────────────────────
// Each frame after the first stores only the pixels that changed; the rest
// are transparent and show the previous frame through. Only the beam, the
// targets and the progress bar move, so this keeps the file small.
const gif = GIFEncoder();
let prev = null;
frames.forEach((fr, i) => {
  const idx = toIndexed(fr);
  const delta = prev ? idx.slice() : idx;
  if (prev) for (let p = 0; p < delta.length; p++) if (idx[p] === prev[p]) delta[p] = KEEP;
  gif.writeFrame(delta, W, H, {
    palette: i === 0 ? palette : undefined,
    delay: DELAY,
    repeat: 0,
    transparent: i > 0,
    transparentIndex: KEEP,
    dispose: 1,
  });
  prev = idx;
});
gif.finish();

const outPath = path.join(__dirname, "..", "renderer", "assets", "install.gif");
fs.writeFileSync(outPath, gif.bytes());
console.log(`Generated: ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(0)} KB)`);
