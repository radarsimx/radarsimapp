/**
 * Generates renderer/assets/install.gif, the animation the Squirrel installer
 * shows while it installs.
 * Run with: npm run generate-gif
 *
 * The motion follows the hero section of radarsimx.com, in the app's purple
 * palette: a dark dot grid that a
 * thin line sweeps across from a new angle each pass, lighting up random dots
 * that then fade. The app logo, name and an indeterminate progress bar sit in
 * the middle.
 *
 * The sweeps come from a fixed seed and the GIF loops without a seam: dots lit
 * near the end of the loop keep fading into its start. Frames are drawn at 2x
 * and scaled down, so edges stay smooth. All frames share one palette and use
 * ordered dithering, so gradients neither band nor flicker between frames.
 */

"use strict";

const { createCanvas, loadImage } = require("@napi-rs/canvas");
const { GIFEncoder, quantize } = require("gifenc");
const fs = require("node:fs");
const path = require("node:path");

const ASSETS = path.join(__dirname, "..", "renderer", "assets");

// ── Output ───────────────────────────────────────────────────────────────────
const W = 628,
  H = 368;
const SCALE = 2;
const RW = W * SCALE,
  RH = H * SCALE;
const DELAY = 50; // ms per frame (GIF stores hundredths of a second)

// ── Sweeps (timings follow radarsimx.com, a little quicker) ──────────────────
const SWEEPS = 4; // sweeps per loop, each from a new angle
const SWEEP_MS = 2600; // time for the line to cross the frame
const PAUSE_MS = 900; // quiet time before the next sweep
const LOOP_MS = SWEEPS * (SWEEP_MS + PAUSE_MS);
const FRAMES = LOOP_MS / DELAY;
const TILE = 22; // dot grid spacing
const HIT = 0.05; // chance the line lights a dot it passes
const TRAIL = 140; // faint wash behind the line

// ── Colours (match renderer/css/styles.css) ──────────────────────────────────
const BG = "#0d0b12"; // --bg
const PRIMARY = "78,58,114"; // --primary       #4e3a72
const EDGE = "123,98,179"; // --primary-edge  #7b62b3
const ACCENT = "184,163,230"; // --accent        #b8a3e6
const MESH = "162,155,254"; // --mesh          #a29bfe
const LINE = "214,202,245"; // a lighter --accent for the sweep line
const DOT_COLORS = [ACCENT, ACCENT, EDGE, MESH];
const INK = "#e7e4ef"; // --ink
const INK_2 = "#aca7ba"; // --ink-2

// ── Layout (output pixels; multiplied by SCALE when drawn) ───────────────────
const CX = W / 2;
const LOGO = 72,
  LOGO_Y = 92;
const TITLE_Y = 216;
const STATUS_Y = 246;
const BAR_W = 220,
  BAR_H = 4,
  BAR_Y = 264;

// ── Seeded random numbers, so every run draws the same GIF ───────────────────
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0x5ad4a);

// ── Plan the sweeps and the dots they light ──────────────────────────────────
const easeInOut = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
const easeInOutInverse = (q) => (q < 0.5 ? Math.sqrt(q / 2) : 1 - Math.sqrt((1 - q) / 2));

const COLS = Math.floor(W / TILE),
  ROWS = Math.floor(H / TILE);
const sweeps = [];
const lit = [];
let angle = rand() * Math.PI * 2;
for (let i = 0; i < SWEEPS; i++) {
  angle = (angle + Math.PI / 3 + rand() * ((Math.PI * 4) / 3)) % (Math.PI * 2);
  const nx = Math.cos(angle),
    ny = Math.sin(angle);
  const proj = (x, y) => x * nx + y * ny;
  const corners = [proj(0, 0), proj(W, 0), proj(0, H), proj(W, H)];
  const sw = {
    start: i * (SWEEP_MS + PAUSE_MS),
    angle,
    nx,
    ny,
    from: Math.min(...corners) - TRAIL * 0.2,
    to: Math.max(...corners) + TRAIL * 0.2,
  };
  sweeps.push(sw);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (rand() >= HIT) continue;
      const x = c * TILE + TILE / 2,
        y = r * TILE + TILE / 2;
      // The moment the line reaches this dot
      const q = (proj(x, y) - sw.from) / (sw.to - sw.from);
      lit.push({
        x,
        y,
        born: sw.start + easeInOutInverse(q) * SWEEP_MS,
        life: 1600 + rand() * 2200,
        peak: 0.55 + rand() * 0.45,
        color: DOT_COLORS[Math.floor(rand() * DOT_COLORS.length)],
      });
    }
  }
}

// ── Drawing ──────────────────────────────────────────────────────────────────
const hi = createCanvas(RW, RH);
const ctx = hi.getContext("2d");
const out = createCanvas(W, H);
const octx = out.getContext("2d");
octx.imageSmoothingEnabled = true;
octx.imageSmoothingQuality = "high";

function radialWash(cx, cy, rx, ry, color, alpha) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(${color},${alpha})`);
  g.addColorStop(0.7, `rgba(${color},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(-cx, -cy * (rx / ry), W, H * (rx / ry));
  ctx.restore();
}

function drawBackground() {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  radialWash(W / 2, H, W * 0.55, H * 0.6, PRIMARY, 0.45);
  radialWash(0, 0, W * 0.45, H * 0.55, EDGE, 0.14);

  // Faint dot grid, fading out away from the upper middle
  const mx = W / 2,
    my = H * 0.35,
    rx = W * 0.7,
    ry = H * 0.6;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = c * TILE + TILE / 2,
        y = r * TILE + TILE / 2;
      const d = Math.hypot((x - mx) / rx, (y - my) / ry);
      if (d >= 1) continue;
      ctx.fillStyle = `rgba(255,255,255,${(0.1 * (1 - d)).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Bottom edge highlight
  const edge = ctx.createLinearGradient(0, 0, W, 0);
  edge.addColorStop(0, "rgba(0,0,0,0)");
  edge.addColorStop(0.3, `rgba(${EDGE},0.6)`);
  edge.addColorStop(0.7, `rgba(${ACCENT},0.45)`);
  edge.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = edge;
  ctx.fillRect(0, H - 1, W, 1);
}

function drawDots(t) {
  for (const d of lit) {
    // A dot lit late in the loop is still fading when the loop restarts
    for (const born of [d.born, d.born - LOOP_MS]) {
      const k = (t - born) / d.life;
      if (k < 0 || k >= 1) continue;
      const a = (k < 0.06 ? k / 0.06 : (1 - (k - 0.06) / 0.94) ** 1.6) * d.peak;
      const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, 10);
      g.addColorStop(0, `rgba(${d.color},${(a * 0.6).toFixed(3)})`);
      g.addColorStop(1, `rgba(${d.color},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(d.x - 10, d.y - 10, 20, 20);
      ctx.fillStyle = `rgba(${d.color},${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawSweep(t) {
  const sw = sweeps.find((s) => t >= s.start && t <= s.start + SWEEP_MS);
  if (!sw) return;
  const pos = sw.from + easeInOut((t - sw.start) / SWEEP_MS) * (sw.to - sw.from);
  const half = Math.hypot(W, H) / 2;
  const x = pos - ((W / 2) * sw.nx + (H / 2) * sw.ny);

  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(sw.angle);
  const trail = ctx.createLinearGradient(x - TRAIL, 0, x, 0);
  trail.addColorStop(0, `rgba(${ACCENT},0)`);
  trail.addColorStop(1, `rgba(${ACCENT},0.07)`);
  ctx.fillStyle = trail;
  ctx.fillRect(x - TRAIL, -half, TRAIL, half * 2);
  const line = ctx.createLinearGradient(0, -half, 0, half);
  line.addColorStop(0, `rgba(${LINE},0)`);
  line.addColorStop(0.35, `rgba(${LINE},0.55)`);
  line.addColorStop(0.65, `rgba(${LINE},0.55)`);
  line.addColorStop(1, `rgba(${LINE},0)`);
  ctx.fillStyle = line;
  ctx.fillRect(x - 0.75, -half, 1.5, half * 2);
  ctx.restore();
}

function drawForeground(logo, t, f) {
  ctx.drawImage(logo, CX - LOGO / 2, LOGO_Y, LOGO, LOGO);

  // "RadarSim" in white, "App" in a purple gradient
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.font = "600 34px 'IBM Plex Sans', 'Segoe UI', Arial, sans-serif";
  const a = ctx.measureText("RadarSim").width;
  const b = ctx.measureText("App").width;
  const tx = CX - (a + b) / 2;
  ctx.fillStyle = INK;
  ctx.fillText("RadarSim", tx, TITLE_Y);
  const grad = ctx.createLinearGradient(tx + a, 0, tx + a + b, 0);
  grad.addColorStop(0, `rgb(${EDGE})`);
  grad.addColorStop(0.5, `rgb(${ACCENT})`);
  grad.addColorStop(1, `rgb(${MESH})`);
  ctx.fillStyle = grad;
  ctx.fillText("App", tx + a, TITLE_Y);

  // Centre on the full "Installing..." so the text does not shift as dots appear
  const dots = ".".repeat(Math.floor(f / 8) % 4);
  ctx.font = "15px 'Segoe UI', Arial, sans-serif";
  ctx.fillStyle = INK_2;
  const label = "Installing";
  ctx.fillText(label + dots, CX - ctx.measureText(`${label}...`).width / 2, STATUS_Y);

  // Indeterminate progress bar: a purple highlight that travels the track
  const bx = CX - BAR_W / 2;
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath();
  ctx.roundRect(bx, BAR_Y, BAR_W, BAR_H, BAR_H / 2);
  ctx.fill();
  const p = ((t / LOOP_MS) * SWEEPS * 2) % 1; // two passes per sweep
  const sw = BAR_W * 0.45;
  const sx = bx - sw + p * (BAR_W + sw);
  const shine = ctx.createLinearGradient(sx, 0, sx + sw, 0);
  shine.addColorStop(0, `rgba(${EDGE},0)`);
  shine.addColorStop(0.5, `rgba(${ACCENT},1)`);
  shine.addColorStop(1, `rgba(${MESH},0)`);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(bx, BAR_Y, BAR_W, BAR_H, BAR_H / 2);
  ctx.clip();
  ctx.fillStyle = shine;
  ctx.fillRect(sx, BAR_Y, sw, BAR_H);
  ctx.restore();
}

function renderFrame(logo, f) {
  const t = f * DELAY;
  ctx.save();
  ctx.scale(SCALE, SCALE);
  drawBackground();
  drawDots(t);
  drawSweep(t);
  drawForeground(logo, t, f);
  ctx.restore();

  octx.clearRect(0, 0, W, H);
  octx.drawImage(hi, 0, 0, W, H);
  return octx.getImageData(0, 0, W, H).data;
}

// ── Palette, dithering and encoding ──────────────────────────────────────────
function buildPalette(frames) {
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
  return quantize(sample.subarray(0, o), 255, { format: "rgb565" });
}

function makeIndexer(palette) {
  // Nearest palette entry, cached on 6 bits per channel
  const cache = new Int16Array(1 << 18).fill(-1);
  function nearest(r, g, b) {
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    let idx = cache[key];
    if (idx >= 0) return idx;
    let best = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i];
      const dr = p[0] - r,
        dg = p[1] - g,
        db = p[2] - b;
      const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
      if (d < best) {
        best = d;
        idx = i;
      }
    }
    cache[key] = idx;
    return idx;
  }

  // Ordered (Bayer) dithering: the pattern is fixed in place, so unlike error
  // diffusion it does not crawl from frame to frame
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const DITHER = 6;
  return function toIndexed(rgba) {
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
  };
}

async function main() {
  const logoSvg = fs
    .readFileSync(path.join(ASSETS, "logo.svg"), "utf8")
    .replace(/(<svg\b[^>]*?)\swidth="\d+"\s+height="\d+"/, `$1 width="${LOGO * SCALE}" height="${LOGO * SCALE}"`);
  const logo = await loadImage(Buffer.from(logoSvg));

  const frames = [];
  for (let f = 0; f < FRAMES; f++) frames.push(Uint8ClampedArray.from(renderFrame(logo, f)));

  const palette = buildPalette(frames);
  const KEEP = palette.length;
  palette.push([0, 0, 0]);
  const toIndexed = makeIndexer(palette);

  // Each frame after the first stores only the pixels that changed; the rest
  // are transparent and show the previous frame through.
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

  const outPath = path.join(ASSETS, "install.gif");
  fs.writeFileSync(outPath, gif.bytes());
  console.log(`Generated: ${outPath} (${FRAMES} frames, ${(fs.statSync(outPath).size / 1024).toFixed(0)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
