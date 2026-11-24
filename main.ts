// ===== RadarSimApp - Main Process =====
// Electron main process entry point: creates the window, owns the native
// bridge, and answers the renderer's IPC calls.

// Handle Squirrel installer events on Windows (creates/removes shortcuts).
// Must run before any other code — quits immediately when an event is handled.
import squirrelStartup = require("electron-squirrel-startup");
if (squirrelStartup) {
  require("electron").app.quit();
}

import * as fs from "node:fs";
import * as path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from "electron";
import { RadarSimBridge } from "./bridge";
import { writeHdf5File } from "./hdf5";

let mainWindow: BrowserWindow | undefined;
let bridge: RadarSimBridge | undefined;

/** The main window, which every dialog is parented to. */
function requireWindow(): BrowserWindow {
  if (!mainWindow) throw new Error("The main window is not open");
  return mainWindow;
}

/** The bridge, which is created once the app is ready. */
function requireBridge(): RadarSimBridge {
  if (!bridge) throw new Error("The simulation bridge is not ready");
  return bridge;
}

const isDev: boolean = process.argv.includes("--dev");
const isMac: boolean = process.platform === "darwin";

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: "RadarSimApp",
    // macOS keeps its native traffic lights over the custom title bar; the
    // other platforms draw their own window buttons in the renderer.
    ...(isDev
      ? {}
      : isMac
        ? { titleBarStyle: "hidden" as const, trafficLightPosition: { x: 18, y: 23 } }
        : { frame: false }),
    show: false,
    backgroundColor: "#0d0b12",
    icon: path.join(__dirname, "..", "renderer", "assets", process.platform === "win32" ? "logo.ico" : "logo.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow = win;

  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  win.once("ready-to-show", () => {
    win.show();
  });

  // In full screen macOS hides the traffic lights, so the bar can take back their room
  win.on("enter-full-screen", () => win.webContents.send("fullscreen-changed", true));
  win.on("leave-full-screen", () => win.webContents.send("fullscreen-changed", false));
}

// Pin the App User Model ID so Windows uses the embedded icon.
if (process.platform === "win32") {
  app.setAppUserModelId("com.radarsimx.radarsimapp");
}

app.whenReady().then(() => {
  // The UI is dark only: keep native chrome (traffic lights, dialogs, dev frame) dark too
  nativeTheme.themeSource = "dark";
  if (!isDev) Menu.setApplicationMenu(null);
  bridge = new RadarSimBridge();

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});

// --- IPC Handlers ---

/** What a fallible handler hands the renderer: its data, or why it failed. */
type IpcResult<T> = { success: true; data: T } | { success: false; error: string };

async function asIpcResult<T>(work: () => T | Promise<T>): Promise<IpcResult<T>> {
  try {
    return { success: true, data: await work() };
  } catch (err) {
    return { success: false, error: (err as Error).message || String(err) };
  }
}

ipcMain.handle("run-simulation", (_event, config: SimConfig) =>
  asIpcResult(() => requireBridge().runSimulation(config)),
);

ipcMain.handle("get-scene-state", (_event, config: SimConfig) =>
  asIpcResult(() => requireBridge().getSceneState(config)),
);

ipcMain.handle("get-app-version", () => app.getVersion());

ipcMain.handle("check-library", () => asIpcResult(() => requireBridge().checkLibrary()));

ipcMain.handle("activate-license", async () => {
  const picked = await dialog.showOpenDialog(requireWindow(), {
    title: "Select License File",
    properties: ["openFile"],
    filters: [{ name: "License Files", extensions: ["lic"] }],
  });
  if (picked.canceled) return { success: false, cancelled: true };
  return asIpcResult(() => requireBridge().activateLicense(picked.filePaths[0]));
});

ipcMain.handle("open-external", (_event, url: string) => {
  const allowedHosts = ["radarsimx.com"];
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (allowedHosts.includes(host)) shell.openExternal(url);
  } catch {
    /* Silently ignore malformed URLs. */
  }
});

ipcMain.handle("select-file", async (_event, options?: { filters?: Array<{ name: string; extensions: string[] }> }) => {
  const result = await dialog.showOpenDialog(requireWindow(), {
    properties: ["openFile"],
    filters: options?.filters || [{ name: "All Files", extensions: ["*"] }],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle("export-results", async (_event, data: SimResult) => {
  const result = await dialog.showSaveDialog(requireWindow(), {
    filters: [
      { name: "HDF5", extensions: ["h5"] },
      { name: "JSON", extensions: ["json"] },
    ],
  });
  if (result.canceled) return null;
  const filePath = result.filePath;
  if (filePath.endsWith(".h5")) await writeHdf5File(filePath, data);
  else fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return filePath;
});

ipcMain.handle("save-config", async (_event, jsonData: string) => {
  const result = await dialog.showSaveDialog(requireWindow(), {
    title: "Save Configuration",
    defaultPath: "radar-config.json",
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (result.canceled) return false;
  fs.writeFileSync(result.filePath, jsonData, "utf8");
  return true;
});

ipcMain.handle("load-config", async () => {
  const result = await dialog.showOpenDialog(requireWindow(), {
    title: "Load Configuration",
    properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (result.canceled) return null;
  return fs.readFileSync(result.filePaths[0], "utf8");
});

// --- Window controls (the renderer draws its own off macOS) ---
ipcMain.on("window-minimize", () => mainWindow?.minimize());
ipcMain.on("window-maximize", () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on("window-close", () => mainWindow?.close());
ipcMain.handle("window-is-maximized", () => mainWindow?.isMaximized() ?? false);
