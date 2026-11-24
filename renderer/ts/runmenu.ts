// ===== RadarSimApp - Run Menu =====
// Save, Load, Reset and About, dropped from the button beside Run. Behaves as
// a menu button: arrow keys walk the items, Escape closes it and gives focus
// back, and a click anywhere else folds it away.

import { byId } from "./utils.js";

export function initRunMenu(): void {
  const toggle = byId<HTMLButtonElement>("btn-run-menu");
  const menu = byId("run-menu");
  const items = () => [...menu.querySelectorAll<HTMLButtonElement>(".menu-item:not(:disabled)")];
  const isOpen = () => !menu.classList.contains("hidden");

  const open = (focusFirst: boolean) => {
    menu.classList.remove("hidden");
    toggle.setAttribute("aria-expanded", "true");
    if (focusFirst) items()[0]?.focus();
  };
  const close = (refocus: boolean) => {
    if (!isOpen()) return;
    menu.classList.add("hidden");
    toggle.setAttribute("aria-expanded", "false");
    if (refocus) toggle.focus();
  };

  // A keyboard press (detail 0) moves focus into the menu; a mouse click leaves it on the button
  toggle.addEventListener("click", (e) => (isOpen() ? close(false) : open(e.detail === 0)));
  toggle.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      open(false);
      const list = items();
      list[e.key === "ArrowDown" ? 0 : list.length - 1]?.focus();
    } else if (e.key === "Escape" && isOpen()) {
      e.stopPropagation();
      close(false);
    }
  });

  // Each item's own handler runs first; then the menu folds away
  menu.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".menu-item")) close(false);
  });
  menu.addEventListener("keydown", (e) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const go = (n: number) => {
      e.preventDefault();
      list[(n + list.length) % list.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(list.length - 1);
    else if (e.key === "Escape") {
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") close(false);
  });

  document.addEventListener("pointerdown", (e) => {
    if (isOpen() && !menu.contains(e.target as Node) && !toggle.contains(e.target as Node)) close(false);
  });
  window.addEventListener("blur", () => close(false));
  window.addEventListener("resize", () => close(false));
}
