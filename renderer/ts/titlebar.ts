// ===== RadarSimApp - Title Bar =====
// The window buttons the app draws itself off macOS, and the macOS touches:
// the native traffic lights in their place, and the Command-key shortcut.

import { byId } from "./utils.js";

const MAXIMIZE_ICON =
  '<svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor"/></svg>';
const RESTORE_ICON =
  '<svg width="10" height="10" viewBox="0 0 10 10"><rect x="2.5" y="0.5" width="7" height="7" fill="none" stroke="currentColor"/><polyline points="0.5,2.5 0.5,9.5 7.5,9.5" fill="none" stroke="currentColor"/></svg>';

export function initTitlebar(): void {
  window.api.getAppVersion().then((v) => {
    const version = document.getElementById("app-version");
    if (version) version.textContent = `v${v}`;
  });

  if (window.api.platform === "darwin") {
    document.documentElement.classList.add("platform-darwin");
    const kbd = document.querySelector("#btn-run-sim kbd");
    if (kbd) kbd.innerHTML = "&#8984; &crarr;";
    byId("btn-run-sim").title = "Run the simulation (⌘↵)";
    // In full screen the traffic lights are hidden, so the bar takes back their room
    window.api.onFullscreenChanged((isFs) => document.documentElement.classList.toggle("is-fullscreen", isFs));
  }

  byId("btn-win-minimize").addEventListener("click", () => window.api.windowMinimize());
  byId("btn-win-close").addEventListener("click", () => window.api.windowClose());

  const btnMax = byId("btn-win-maximize");
  const showMaximized = (isMax: boolean): void => {
    btnMax.innerHTML = isMax ? RESTORE_ICON : MAXIMIZE_ICON;
    btnMax.title = isMax ? "Restore" : "Maximize";
  };
  btnMax.addEventListener("click", () => {
    window.api.windowMaximize();
    setTimeout(async () => showMaximized(await window.api.windowIsMaximized()), 50);
  });
  window.api.windowIsMaximized().then(showMaximized);
}
