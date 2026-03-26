/**
 * Generates renderer/assets/install.gif — the Squirrel installer loading animation.
 * Run with: node scripts/generate-install-gif.js
 * Requires:  npm install --save-dev @napi-rs/canvas gif-encoder-2
 *
 * Renders at 2× then downsamples to output size for crisp edges.
 * Output: 628 × 368 px GIF, dark-theme radar sweep, 60 frames @ 40 ms/frame.
 */

"use strict";

const { createCanvas } = require("@napi-rs/canvas");
const GIFEncoder = require("gif-encoder-2");
const fs = require("fs");
const path = require("path");

// ── Config ────────────────────────────────────────────────────────────────────
const W = 628, H = 368;           // output GIF dimensions (2× original)
const SCALE = 2;                   // render at SCALE× for subpixel quality
const RW = W * SCALE, RH = H * SCALE;
const FRAMES = 60;
const DELAY = 40;

// Theme colours (match styles.css)
const C_BG        = "#0f0f14";
const C_RINGS     = "rgba(104,159,56,0.18)";
const C_SWEEP     = "#689f38";
const C_DOT       = "#8bc34a";
const C_TEXT_PRI  = "#e8e8f0";
const C_TEXT_SEC  = "#8888a0";

// Radar centre & radius (in render-space coordinates)
const CX = RW / 2, CY = RH / 2 - 8 * SCALE;
const R  = Math.min(RW, RH) * 0.38;

// Simulated blips (angle in radians, radial fraction 0-1, size in render px)
const BLIPS = [
  { a: 0.45, r: 0.55, s: 7 },
  { a: 1.20, r: 0.72, s: 5 },
  { a: 2.80, r: 0.40, s: 8 },
  { a: 4.10, r: 0.65, s: 6 },
  { a: 5.50, r: 0.50, s: 5 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

function trailAlpha(sweepAngle, blipAngle) {
  const TRAIL = Math.PI * 0.9;
  let diff = ((sweepAngle - blipAngle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  if (diff < 0 || diff > TRAIL) return 0;
  return 1 - diff / TRAIL;
}

// ── Encoder (output dimensions) ───────────────────────────────────────────────
const encoder = new GIFEncoder(W, H, "neuquant", true, FRAMES);
encoder.setDelay(DELAY);
encoder.setRepeat(0);
encoder.setQuality(6);
encoder.start();

// High-res render canvas
const hiCanvas = createCanvas(RW, RH);
const hiCtx    = hiCanvas.getContext("2d");

// Output canvas (downsampled)
const outCanvas = createCanvas(W, H);
const outCtx    = outCanvas.getContext("2d");

// ── Rounded-rect fill helper ─────────────────────────────────────────────────
function fillRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
  ctx.fill();
}

for (let f = 0; f < FRAMES; f++) {
  const sweepAngle = (f / FRAMES) * Math.PI * 2 - Math.PI / 2;

  // ── Background ──────────────────────────────────────────────────────────────
  hiCtx.fillStyle = C_BG;
  hiCtx.fillRect(0, 0, RW, RH);

  // ── Concentric range rings ──────────────────────────────────────────────────
  hiCtx.strokeStyle = C_RINGS;
  hiCtx.lineWidth = SCALE;
  for (let i = 1; i <= 4; i++) {
    hiCtx.beginPath();
    hiCtx.arc(CX, CY, R * (i / 4), 0, Math.PI * 2);
    hiCtx.stroke();
  }

  // ── Cross-hair lines ────────────────────────────────────────────────────────
  hiCtx.strokeStyle = C_RINGS;
  hiCtx.lineWidth = SCALE * 0.8;
  hiCtx.setLineDash([8, 12]);
  hiCtx.beginPath(); hiCtx.moveTo(CX, CY - R); hiCtx.lineTo(CX, CY + R); hiCtx.stroke();
  hiCtx.beginPath(); hiCtx.moveTo(CX - R, CY); hiCtx.lineTo(CX + R, CY); hiCtx.stroke();
  hiCtx.setLineDash([]);

  // ── Sweep arc (trailing fade) ───────────────────────────────────────────────
  const TRAIL_ARC = Math.PI * 0.9;
  const { r: sr, g: sg, b: sb } = hexToRgb(C_SWEEP);
  const SLICES = 60;
  for (let s = 0; s < SLICES; s++) {
    const t  = s / SLICES;
    const a0 = sweepAngle - TRAIL_ARC * ((s + 1) / SLICES);
    const a1 = sweepAngle - TRAIL_ARC * (s / SLICES);
    const alpha = (1 - t) * 0.55;
    hiCtx.beginPath();
    hiCtx.moveTo(CX, CY);
    hiCtx.arc(CX, CY, R, a0, a1);
    hiCtx.closePath();
    hiCtx.fillStyle = `rgba(${sr},${sg},${sb},${alpha.toFixed(3)})`;
    hiCtx.fill();
  }

  // ── Sweep leading line ──────────────────────────────────────────────────────
  const lx = CX + Math.cos(sweepAngle) * R;
  const ly = CY + Math.sin(sweepAngle) * R;
  const grad = hiCtx.createLinearGradient(CX, CY, lx, ly);
  grad.addColorStop(0,   `rgba(${sr},${sg},${sb},0)`);
  grad.addColorStop(0.5, `rgba(${sr},${sg},${sb},0.6)`);
  grad.addColorStop(1,   C_SWEEP);
  hiCtx.strokeStyle = grad;
  hiCtx.lineWidth = 3 * SCALE;
  hiCtx.beginPath();
  hiCtx.moveTo(CX, CY);
  hiCtx.lineTo(lx, ly);
  hiCtx.stroke();

  // ── Blips ───────────────────────────────────────────────────────────────────
  const { r: dr, g: dg, b: db } = hexToRgb(C_DOT);
  for (const blip of BLIPS) {
    const alpha = trailAlpha(sweepAngle + Math.PI / 2, blip.a);
    if (alpha <= 0) continue;
    const bx = CX + Math.cos(blip.a - Math.PI / 2) * R * blip.r;
    const by = CY + Math.sin(blip.a - Math.PI / 2) * R * blip.r;
    const glow = hiCtx.createRadialGradient(bx, by, 0, bx, by, blip.s * 3.5);
    glow.addColorStop(0, `rgba(${dr},${dg},${db},${(alpha * 0.9).toFixed(3)})`);
    glow.addColorStop(1, `rgba(${dr},${dg},${db},0)`);
    hiCtx.beginPath();
    hiCtx.arc(bx, by, blip.s * 3.5, 0, Math.PI * 2);
    hiCtx.fillStyle = glow;
    hiCtx.fill();
    hiCtx.beginPath();
    hiCtx.arc(bx, by, blip.s * 0.9, 0, Math.PI * 2);
    hiCtx.fillStyle = `rgba(${dr},${dg},${db},${Math.min(alpha * 1.2, 1).toFixed(3)})`;
    hiCtx.fill();
  }

  // ── Centre dot ──────────────────────────────────────────────────────────────
  hiCtx.beginPath();
  hiCtx.arc(CX, CY, 5 * SCALE, 0, Math.PI * 2);
  hiCtx.fillStyle = C_SWEEP;
  hiCtx.fill();

  // ── Title & progress bar ──────────────────────────────────────────────────
  const { r: sr2, g: sg2, b: sb2 } = hexToRgb(C_SWEEP);

  // Title — large bold, centered
  const titleY = RH - 52 * SCALE;
  hiCtx.textAlign = "center";
  hiCtx.font = `bold ${17 * SCALE}px 'Segoe UI', Arial, sans-serif`;
  hiCtx.fillStyle = C_TEXT_PRI;
  hiCtx.fillText("RadarSimApp", CX, titleY);

  // Progress bar track
  const BAR_W = R * 1.6;
  const BAR_H = 5 * SCALE;
  const BAR_R = BAR_H / 2;
  const BAR_X = CX - BAR_W / 2;
  const BAR_Y = RH - 26 * SCALE;

  hiCtx.fillStyle = `rgba(${sr2},${sg2},${sb2},0.15)`;
  fillRoundRect(hiCtx, BAR_X, BAR_Y, BAR_W, BAR_H, BAR_R);

  // Shimmer highlight: sweeps left → right over 1 full loop
  const shimmerW = BAR_W * 0.32;
  const t = f / FRAMES;
  const shimmerCX = BAR_X + BAR_W * (-0.15 + t * 1.30);

  const shimGrad = hiCtx.createLinearGradient(shimmerCX, 0, shimmerCX + shimmerW, 0);
  shimGrad.addColorStop(0,    `rgba(${sr2},${sg2},${sb2},0)`);
  shimGrad.addColorStop(0.35, `rgba(${sr2},${sg2},${sb2},0.6)`);
  shimGrad.addColorStop(0.5,  `rgba(${sr2},${sg2},${sb2},1)`);
  shimGrad.addColorStop(0.65, `rgba(${sr2},${sg2},${sb2},0.6)`);
  shimGrad.addColorStop(1,    `rgba(${sr2},${sg2},${sb2},0)`);

  // Clip to bar shape and draw shimmer
  hiCtx.save();
  hiCtx.beginPath();
  hiCtx.moveTo(BAR_X + BAR_R, BAR_Y);
  hiCtx.lineTo(BAR_X + BAR_W - BAR_R, BAR_Y);
  hiCtx.arcTo(BAR_X + BAR_W, BAR_Y, BAR_X + BAR_W, BAR_Y + BAR_R, BAR_R);
  hiCtx.lineTo(BAR_X + BAR_W, BAR_Y + BAR_H - BAR_R);
  hiCtx.arcTo(BAR_X + BAR_W, BAR_Y + BAR_H, BAR_X + BAR_W - BAR_R, BAR_Y + BAR_H, BAR_R);
  hiCtx.lineTo(BAR_X + BAR_R, BAR_Y + BAR_H);
  hiCtx.arcTo(BAR_X, BAR_Y + BAR_H, BAR_X, BAR_Y + BAR_H - BAR_R, BAR_R);
  hiCtx.lineTo(BAR_X, BAR_Y + BAR_R);
  hiCtx.arcTo(BAR_X, BAR_Y, BAR_X + BAR_R, BAR_Y, BAR_R);
  hiCtx.closePath();
  hiCtx.clip();
  hiCtx.fillStyle = shimGrad;
  hiCtx.fillRect(shimmerCX, BAR_Y, shimmerW, BAR_H);
  hiCtx.restore();

  // ── Downsample hi-res canvas → output canvas ─────────────────────────────
  outCtx.clearRect(0, 0, W, H);
  outCtx.drawImage(hiCanvas, 0, 0, W, H);

  encoder.addFrame(outCtx);
}

encoder.finish();
const outPath = path.join(__dirname, "..", "renderer", "assets", "install.gif");
fs.writeFileSync(outPath, encoder.out.getData());
console.log("Generated:", outPath);
console.log("Generated:", outPath);
