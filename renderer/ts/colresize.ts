// ===== RadarSimApp - Column Widths =====
// Each column of panels can be widened or narrowed by dragging its inner edge
// (or, focused, with the arrow keys). The width sticks, and a double-click on
// the edge puts it back. A column with every panel folded has nothing to size.

import { pref, setPref } from './stage.js';

export type Side = "left" | "right";

export const MIN_COL = 280;
/** Never more than this share of the window, so the stage keeps some room. */
export const MAX_COL_SHARE = 0.42;
const MAX_COL = 720;
const KEY_STEP = 16;

/** A width the column may take in a window this wide. */
export function clampColumnWidth(width: number, windowWidth: number): number {
  const max = Math.max(MIN_COL, Math.min(MAX_COL, Math.floor(windowWidth * MAX_COL_SHARE)));
  return Math.round(Math.min(max, Math.max(MIN_COL, width)));
}

/** The width the column's panels are drawn at: an open card's, which the column wraps with its scrollbar. */
function _cardWidth(col: HTMLElement): number {
  return col.querySelector<HTMLElement>(":scope > .card[open]")?.offsetWidth ?? col.offsetWidth;
}

interface Column {
  side: Side;
  col: HTMLElement;
  grip: HTMLElement;
  /** The width set, or null for the stylesheet's default. */
  width: number | null;
}

const _columns: Column[] = [];

function _apply(c: Column): void {
  const root = document.documentElement.style;
  const name = `--col-${c.side === "left" ? "l" : "r"}`;
  if (c.width === null) root.removeProperty(name);
  else root.setProperty(name, `${clampColumnWidth(c.width, window.innerWidth)}px`);
}

function _set(c: Column, width: number | null): void {
  c.width = width === null ? null : clampColumnWidth(width, window.innerWidth);
  _apply(c);
  setPref(`col.${c.side}`, c.width);
  place();
}

/** Keep each edge on its column: call whenever the columns may have moved or changed size. */
export function place(): void {
  for (const c of _columns) {
    const open = !!c.col.querySelector(":scope > .card[open]");
    c.grip.hidden = !open;
    if (!open) continue;
    const edge = c.side === "left" ? c.col.offsetLeft + c.col.offsetWidth : c.col.offsetLeft;
    c.grip.style.left = `${edge}px`;
    c.grip.style.top = `${c.col.offsetTop}px`;
    c.grip.style.height = `${c.col.offsetHeight}px`;
    c.grip.setAttribute("aria-valuenow", String(_cardWidth(c.col)));
  }
}

export function initColumnResize(): void {
  (["left", "right"] as Side[]).forEach((side) => {
    const col = document.querySelector<HTMLElement>(`.hud-${side}`);
    if (!col) return;
    const grip = document.createElement("div");
    grip.className = `col-grip col-grip-${side}`;
    grip.setAttribute("role", "separator");
    grip.setAttribute("aria-orientation", "vertical");
    grip.setAttribute("aria-label", `Resize the ${side} panels`);
    grip.setAttribute("aria-valuemin", String(MIN_COL));
    grip.tabIndex = 0;
    grip.title = "Drag to resize · double-click to reset";
    col.after(grip);

    const c: Column = { side, col, grip, width: pref<number | null>(`col.${side}`, null) };
    _columns.push(c);
    _apply(c);

    // Dragging toward the stage widens the column, from either side
    const outward = side === "left" ? 1 : -1;
    grip.addEventListener("pointerdown", (down) => {
      if (down.button !== 0) return;
      down.preventDefault();
      const from = _cardWidth(col);
      grip.setPointerCapture(down.pointerId);
      grip.classList.add("dragging");
      const move = (e: PointerEvent): void => _set(c, from + (e.clientX - down.clientX) * outward);
      const up = (): void => {
        grip.classList.remove("dragging");
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", up);
        grip.removeEventListener("pointercancel", up);
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
      grip.addEventListener("pointercancel", up);
    });
    grip.addEventListener("dblclick", () => _set(c, null));
    grip.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowRight" ? KEY_STEP : e.key === "ArrowLeft" ? -KEY_STEP : 0;
      if (step) {
        e.preventDefault();
        _set(c, _cardWidth(col) + step * outward);
      } else if (e.key === "Home" || e.key === "Escape") {
        e.preventDefault();
        _set(c, null);
      }
    });
  });

  // A narrower window may leave a width set before too wide to keep
  window.addEventListener("resize", () => { _columns.forEach(_apply); place(); });
  place();
}
