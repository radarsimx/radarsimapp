/**
 * Generates renderer/assets/install.gif â€” the Squirrel installer loading animation.
 * Run with: node scripts/generate-install-gif.js
 * Requires:  npm install --save-dev @napi-rs/canvas gif-encoder-2
 *
 * Renders at 2Ã— then downsamples to output size for crisp edges.
 * Output: 628 Ã— 368 px GIF, dark-theme radar HUD, 60 frames @ 40 ms/frame.
 */

"use strict";

const { createCanvas } = require("@napi-rs/canvas");
const GIFEncoder = require("gif-encoder-2");
const fs = require("fs");
const path = require("path");

// â”€â”€ Config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const W = 628, H = 368;
const SCALE = 2;
const RW = W * SCALE, RH = H * SCALE;
const FRAMES = 60;
const DELAY = 40;

const C_BG       = "#0f0f14";
const C_RINGS    = "rgba(104,159,56,0.18)";
const C_SWEEP    = "#689f38";
const C_DOT      = "#8bc34a";
const C_TEXT_PRI = "#e8e8f0";

// Pre-computed accent RGB
function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}
const { r: SR, g: SG, b: SB } = hexToRgb(C_SWEEP);
const { r: DR, g: DG, b: DB } = hexToRgb(C_DOT);

// Radar geometry (render-space)
const CX = RW / 2, CY = RH / 2 - 8 * SCALE;
const R  = Math.min(RW, RH) * 0.38;

const BLIPS = [
  { a: 0.45, r: 0.55, s: 7 },
  { a: 1.20, r: 0.72, s: 5 },
  { a: 2.80, r: 0.40, s: 8 },
  { a: 4.10, r: 0.65, s: 6 },
  { a: 5.50, r: 0.50, s: 5 },
];

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function trailAlpha(sweepAngle, blipAngle) {
  const TRAIL = Math.PI * 0.9;
  const diff = ((sweepAngle - blipAngle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  if (diff > TRAIL) return 0;
  return 1 - diff / TRAIL;
}

function fillRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y,     x + w, y + r,     r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x,     y + h, x,     y + h - r, r);
  ctx.lineTo(x,     y + r);
  ctx.arcTo(x,     y,     x + r, y,         r);
  ctx.closePath();
  ctx.fill();
}

function clipRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y,     x + w, y + r,     r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x,     y + h, x,     y + h - r, r);
  ctx.lineTo(x,     y + r);
  ctx.arcTo(x,     y,     x + r, y,         r);
  ctx.closePath();
  ctx.clip();
}

// Animated telemetry rows â€” values vary per frame
function makeLeftRows(f) {
  const t = f / FRAMES;
  return [
    ["FREQ", `${(24.0 + Math.sin(t * Math.PI * 2) * 0.25).toFixed(2)}G`],
    ["PRF",  `${1000 + Math.round(Math.sin(t * Math.PI * 4) * 200)}Hz`],
    ["RNG",  `${(150 + Math.cos(t * Math.PI * 2) * 30).toFixed(0)}m`],
    ["SNR",  `${(18.4 + Math.sin(t * Math.PI * 6) * 3).toFixed(1)}dB`],
    ["TX",   "04 CH"],
  ];
}
function makeRightRows(f) {
  const t = f / FRAMES;
  const hdg = Math.round(((t * 360) % 360 + 360) % 360);
  const tgt = 2 + Math.floor(Math.abs(Math.sin(t * Math.PI * 3)) * 3);
  return [
    ["TGT",  String(tgt).padStart(2, "0")],
    ["BRG",  `${String(hdg).padStart(3, "0")}\u00b0`],
    ["ELV",  `${(5 + Math.sin(t * Math.PI * 5) * 5).toFixed(1)}\u00b0`],
    ["VEL",  `${(12.3 + Math.cos(t * Math.PI * 4) * 5).toFixed(1)}m/s`],
    ["MODE", f % 20 < 10 ? "ACTIVE" : "SCAN.."],
  ];
}

// â”€â”€ Encoder â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const encoder = new GIFEncoder(W, H, "neuquant", true, FRAMES);
encoder.setDelay(DELAY);
encoder.setRepeat(0);
encoder.setQuality(6);
encoder.start();

const hiCanvas  = createCanvas(RW, RH);
const hiCtx     = hiCanvas.getContext("2d");
const outCanvas = createCanvas(W, H);
const outCtx    = outCanvas.getContext("2d");

// â”€â”€ Main loop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
for (let f = 0; f < FRAMES; f++) {
  const sweepAngle = (f / FRAMES) * Math.PI * 2 - Math.PI / 2;
  const t = f / FRAMES;

  // â”€â”€ Background â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  hiCtx.fillStyle = C_BG;
  hiCtx.fillRect(0, 0, RW, RH);

  // Subtle scan lines (CRT feel)
  hiCtx.fillStyle = "rgba(0,0,0,0.10)";
  for (let y = 0; y < RH; y += 4 * SCALE) hiCtx.fillRect(0, y, RW, SCALE);

  // â”€â”€ Header bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const HDR_Y = 16 * SCALE;
  hiCtx.font = `${9 * SCALE}px 'Courier New', monospace`;
  hiCtx.fillStyle = `rgba(${SR},${SG},${SB},0.6)`;
  hiCtx.textAlign = "left";
  hiCtx.fillText("RADARSIMX", 14 * SCALE, HDR_Y);
  hiCtx.textAlign = "right";
  hiCtx.fillText("v1.0.0", RW - 14 * SCALE, HDR_Y);
  hiCtx.strokeStyle = `rgba(${SR},${SG},${SB},0.18)`;
  hiCtx.lineWidth = SCALE;
  hiCtx.setLineDash([]);
  hiCtx.beginPath();
  hiCtx.moveTo(14 * SCALE, 22 * SCALE);
  hiCtx.lineTo(RW - 14 * SCALE, 22 * SCALE);
  hiCtx.stroke();

  // â”€â”€ Corner HUD brackets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const BRKT = 18 * SCALE, BM = 10 * SCALE;
  hiCtx.strokeStyle = `rgba(${SR},${SG},${SB},0.55)`;
  hiCtx.lineWidth = 1.5 * SCALE;
  for (const [bx, by, dx, dy] of [
    [BM, BM, 1, 1], [RW - BM, BM, -1, 1],
    [BM, RH - BM, 1, -1], [RW - BM, RH - BM, -1, -1],
  ]) {
    hiCtx.beginPath();
    hiCtx.moveTo(bx + dx * BRKT, by);
    hiCtx.lineTo(bx, by);
    hiCtx.lineTo(bx, by + dy * BRKT);
    hiCtx.stroke();
  }

  // â”€â”€ Left data panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const leftRows  = makeLeftRows(f);
  const rightRows = makeRightRows(f);
  const LP_X   = 14 * SCALE;
  const LP_W   = 136 * SCALE;
  const RP_X2  = RW - 14 * SCALE;
  const RP_X1  = RP_X2 - LP_W;
  const ROW_H  = 26 * SCALE;
  const ROWS_Y = 38 * SCALE;

  hiCtx.font = `${9 * SCALE}px 'Courier New', monospace`;

  for (let i = 0; i < leftRows.length; i++) {
    const ry = ROWS_Y + i * ROW_H;
    // Separator line between rows
    if (i > 0) {
      hiCtx.strokeStyle = `rgba(${SR},${SG},${SB},0.08)`;
      hiCtx.lineWidth = SCALE * 0.5;
      hiCtx.beginPath();
      hiCtx.moveTo(LP_X, ry - ROW_H * 0.25);
      hiCtx.lineTo(LP_X + LP_W, ry - ROW_H * 0.25);
      hiCtx.stroke();
    }
    hiCtx.textAlign = "left";
    hiCtx.fillStyle = `rgba(${SR},${SG},${SB},0.50)`;
    hiCtx.fillText(leftRows[i][0], LP_X, ry);
    hiCtx.textAlign = "right";
    hiCtx.fillStyle = `rgba(${SR},${SG},${SB},0.95)`;
    hiCtx.fillText(leftRows[i][1], LP_X + LP_W, ry);
  }

  // Right data panel
  for (let i = 0; i < rightRows.length; i++) {
    const ry = ROWS_Y + i * ROW_H;
    if (i > 0) {
      hiCtx.strokeStyle = `rgba(${SR},${SG},${SB},0.08)`;
      hiCtx.lineWidth = SCALE * 0.5;
      hiCtx.beginPath();
      hiCtx.moveTo(RP_X1, ry - ROW_H * 0.25);
      hiCtx.lineTo(RP_X2, ry - ROW_H * 0.25);
      hiCtx.stroke();
    }
    hiCtx.textAlign = "left";
    hiCtx.fillStyle = `rgba(${SR},${SG},${SB},0.50)`;
    hiCtx.fillText(rightRows[i][0], RP_X1, ry);
    hiCtx.textAlign = "right";
    // Pulse "MODE" row when ACTIVE
    const isActive = rightRows[i][0] === "MODE" && rightRows[i][1] === "ACTIVE";
    hiCtx.fillStyle = isActive
      ? `rgba(${DR},${DG},${DB},${0.7 + Math.sin(t * Math.PI * 8) * 0.3})`
      : `rgba(${SR},${SG},${SB},0.95)`;
    hiCtx.fillText(rightRows[i][1], RP_X2, ry);
  }

  // â”€â”€ Vertical panel dividers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const DIVX_L = LP_X + LP_W + 10 * SCALE;
  const DIVX_R = RP_X1 - 10 * SCALE;
  const DIV_Y1 = 28 * SCALE, DIV_Y2 = RH - 30 * SCALE;
  for (const dx of [DIVX_L, DIVX_R]) {
    hiCtx.strokeStyle = `rgba(${SR},${SG},${SB},0.12)`;
    hiCtx.lineWidth = SCALE;
    hiCtx.setLineDash([6 * SCALE, 8 * SCALE]);
    hiCtx.beginPath();
    hiCtx.moveTo(dx, DIV_Y1);
    hiCtx.lineTo(dx, DIV_Y2);
    hiCtx.stroke();
    hiCtx.setLineDash([]);
  }

  // â”€â”€ Concentric range rings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  hiCtx.strokeStyle = C_RINGS;
  hiCtx.lineWidth = SCALE;
  for (let i = 1; i <= 4; i++) {
    hiCtx.beginPath();
    hiCtx.arc(CX, CY, R * (i / 4), 0, Math.PI * 2);
    hiCtx.stroke();
  }

  // Range ring distance labels (at 3 o'clock)
  hiCtx.font = `${7 * SCALE}px 'Courier New', monospace`;
  hiCtx.fillStyle = `rgba(${SR},${SG},${SB},0.40)`;
  hiCtx.textAlign = "left";
  for (let i = 1; i <= 4; i++) {
    const lx = CX + R * (i / 4) + 4 * SCALE;
    const ly = CY + 8 * SCALE;
    hiCtx.fillText(`${i * 50}m`, lx, ly);
  }

  // â”€â”€ Cross-hair lines â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  hiCtx.strokeStyle = C_RINGS;
  hiCtx.lineWidth = SCALE * 0.8;
  hiCtx.setLineDash([8, 12]);
  hiCtx.beginPath(); hiCtx.moveTo(CX, CY - R); hiCtx.lineTo(CX, CY + R); hiCtx.stroke();
  hiCtx.beginPath(); hiCtx.moveTo(CX - R, CY); hiCtx.lineTo(CX + R, CY); hiCtx.stroke();
  hiCtx.setLineDash([]);

  // â”€â”€ Sweep arc (trailing fade) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const TRAIL_ARC = Math.PI * 0.9;
  const SLICES = 60;
  for (let s = 0; s < SLICES; s++) {
    const a0    = sweepAngle - TRAIL_ARC * ((s + 1) / SLICES);
    const a1    = sweepAngle - TRAIL_ARC * (s / SLICES);
    const alpha = (1 - s / SLICES) * 0.55;
    hiCtx.beginPath();
    hiCtx.moveTo(CX, CY);
    hiCtx.arc(CX, CY, R, a0, a1);
    hiCtx.closePath();
    hiCtx.fillStyle = `rgba(${SR},${SG},${SB},${alpha.toFixed(3)})`;
    hiCtx.fill();
  }

  // â”€â”€ Sweep leading line â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const lx = CX + Math.cos(sweepAngle) * R;
  const ly = CY + Math.sin(sweepAngle) * R;
  const sweepGrad = hiCtx.createLinearGradient(CX, CY, lx, ly);
  sweepGrad.addColorStop(0,   `rgba(${SR},${SG},${SB},0)`);
  sweepGrad.addColorStop(0.5, `rgba(${SR},${SG},${SB},0.6)`);
  sweepGrad.addColorStop(1,    C_SWEEP);
  hiCtx.strokeStyle = sweepGrad;
  hiCtx.lineWidth = 3 * SCALE;
  hiCtx.beginPath();
  hiCtx.moveTo(CX, CY);
  hiCtx.lineTo(lx, ly);
  hiCtx.stroke();

  // â”€â”€ Blips â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  for (const blip of BLIPS) {
    const alpha = trailAlpha(sweepAngle + Math.PI / 2, blip.a);
    if (alpha <= 0) continue;
    const bx = CX + Math.cos(blip.a - Math.PI / 2) * R * blip.r;
    const by = CY + Math.sin(blip.a - Math.PI / 2) * R * blip.r;
    const glow = hiCtx.createRadialGradient(bx, by, 0, bx, by, blip.s * 3.5);
    glow.addColorStop(0, `rgba(${DR},${DG},${DB},${(alpha * 0.9).toFixed(3)})`);
    glow.addColorStop(1, `rgba(${DR},${DG},${DB},0)`);
    hiCtx.beginPath();
    hiCtx.arc(bx, by, blip.s * 3.5, 0, Math.PI * 2);
    hiCtx.fillStyle = glow;
    hiCtx.fill();
    hiCtx.beginPath();
    hiCtx.arc(bx, by, blip.s * 0.85, 0, Math.PI * 2);
    hiCtx.fillStyle = `rgba(${DR},${DG},${DB},${Math.min(alpha * 1.2, 1).toFixed(3)})`;
    hiCtx.fill();
  }

  // â”€â”€ Centre dot â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  hiCtx.beginPath();
  hiCtx.arc(CX, CY, 5 * SCALE, 0, Math.PI * 2);
  hiCtx.fillStyle = C_SWEEP;
  hiCtx.fill();

  // â”€â”€ Title â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const titleY = RH - 54 * SCALE;
  hiCtx.textAlign = "center";
  hiCtx.font = `bold ${17 * SCALE}px 'Segoe UI', Arial, sans-serif`;
  hiCtx.fillStyle = C_TEXT_PRI;
  hiCtx.fillText("RadarSimApp", CX, titleY);

  // â”€â”€ Progress bar with shimmer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const BAR_W = R * 1.6;
  const BAR_H = 5 * SCALE;
  const BAR_R = BAR_H / 2;
  const BAR_X = CX - BAR_W / 2;
  const BAR_Y = RH - 28 * SCALE;

  hiCtx.fillStyle = `rgba(${SR},${SG},${SB},0.15)`;
  fillRoundRect(hiCtx, BAR_X, BAR_Y, BAR_W, BAR_H, BAR_R);

  const shimmerW  = BAR_W * 0.32;
  const shimmerCX = BAR_X + BAR_W * (-0.15 + t * 1.30);
  const shimGrad  = hiCtx.createLinearGradient(shimmerCX, 0, shimmerCX + shimmerW, 0);
  shimGrad.addColorStop(0,    `rgba(${SR},${SG},${SB},0)`);
  shimGrad.addColorStop(0.35, `rgba(${SR},${SG},${SB},0.6)`);
  shimGrad.addColorStop(0.5,  `rgba(${SR},${SG},${SB},1)`);
  shimGrad.addColorStop(0.65, `rgba(${SR},${SG},${SB},0.6)`);
  shimGrad.addColorStop(1,    `rgba(${SR},${SG},${SB},0)`);
  hiCtx.save();
  clipRoundRect(hiCtx, BAR_X, BAR_Y, BAR_W, BAR_H, BAR_R);
  hiCtx.fillStyle = shimGrad;
  hiCtx.fillRect(shimmerCX, BAR_Y, shimmerW, BAR_H);
  hiCtx.restore();

  // â”€â”€ Downsample â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  outCtx.clearRect(0, 0, W, H);
  outCtx.drawImage(hiCanvas, 0, 0, W, H);
  encoder.addFrame(outCtx);
}

encoder.finish();
const outPath = path.join(__dirname, "..", "renderer", "assets", "install.gif");
fs.writeFileSync(outPath, encoder.out.getData());
console.log("Generated:", outPath);

