// ===== RadarSimApp - Main Process =====
// Electron main process entry point. Responsible for creating the browser
// window, managing the bridge lifecycle, and handling all IPC calls
// from the renderer process.

// Handle Squirrel installer events on Windows (creates/removes shortcuts).
// Must run before any other code — quits immediately when an event is handled.
import squirrelStartup = require("electron-squirrel-startup");
if (squirrelStartup) {
  require("electron").app.quit();
}

import * as fs from "node:fs";
import * as path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from "electron";
import type { Group } from "h5wasm";
import { RadarSimBridge } from "./bridge";

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

/**
 * Creates and configures the main application window.
 */
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
  if (bridge) bridge.kill();
  if (process.platform !== "darwin") app.quit();
});

// --- IPC Handlers ---

ipcMain.handle("run-simulation", async (_event, config: SimConfig) => {
  try {
    const result = await requireBridge().runSimulation(config);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: (err as Error).message || String(err) };
  }
});

ipcMain.handle("get-scene-state", async (_event, config: SimConfig) => {
  try {
    const result = await requireBridge().getSceneState(config);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: (err as Error).message || String(err) };
  }
});

ipcMain.handle("get-app-version", () => app.getVersion());

ipcMain.handle("check-library", async () => {
  try {
    const result = await requireBridge().checkLibrary();
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: (err as Error).message || String(err) };
  }
});

ipcMain.handle("activate-license", async () => {
  try {
    const result = await dialog.showOpenDialog(requireWindow(), {
      title: "Select License File",
      properties: ["openFile"],
      filters: [{ name: "License Files", extensions: ["lic"] }],
    });
    if (result.canceled) return { success: false, cancelled: true };
    const data = await requireBridge().activateLicense(result.filePaths[0]);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: (err as Error).message || String(err) };
  }
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

  if (filePath.endsWith(".h5")) {
    const h5wasm = await import("h5wasm");
    const { FS } = await h5wasm.ready;
    const h5FileName = path.basename(filePath);
    const f = new h5wasm.File(h5FileName, "w");
    writeHdf5(f, data);
    f.flush();
    f.close();
    fs.writeFileSync(filePath, FS.readFile(h5FileName));
    FS.unlink(h5FileName);
  } else {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }
  return filePath;
});

/** A complex sample block as the simulator returns it: matching re/im arrays. */
interface ComplexBlock {
  re: ArrayLike<number>;
  im: ArrayLike<number>;
}

function isComplexBlock(v: unknown): v is ComplexBlock {
  return typeof v === "object" && v !== null && "re" in v && "im" in v;
}

/** The shape of a nested array, read down its first elements, and what sits at the bottom. */
function nestedShape(arr: unknown[]): { shape: number[]; leaf: unknown } {
  const shape: number[] = [];
  let cursor: unknown = arr;
  while (Array.isArray(cursor)) {
    shape.push(cursor.length);
    cursor = cursor[0];
  }
  return { shape, leaf: cursor };
}

/**
 * Recursively writes a JavaScript object to an HDF5 file/group.
 */
function writeHdf5(group: Group, obj: object): void {
  for (const [key, value] of Object.entries(obj)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      const cplx = flattenComplexArray(value);
      if (cplx) {
        const data = new Map([
          ["r", cplx.re],
          ["i", cplx.im],
        ]);
        group.create_dataset({
          name: key,
          data,
          shape: cplx.shape,
          dtype: [
            ["r", "<d"],
            ["i", "<d"],
          ],
        });
        continue;
      }
      const flat = flattenNumericArray(value);
      if (flat) {
        group.create_dataset({ name: key, data: flat.data, shape: flat.shape });
      }
    } else if (typeof value === "object") {
      const sub = group.create_group(key);
      writeHdf5(sub, value);
    } else if (typeof value === "number") {
      group.create_dataset({ name: key, data: new Float64Array([value]) });
    } else if (typeof value === "string") {
      group.create_dataset({ name: key, data: [value] });
    }
  }
}

function flattenComplexArray(arr: unknown[]): { re: Float64Array; im: Float64Array; shape: number[] } | null {
  const { shape, leaf } = nestedShape(arr);
  if (!isComplexBlock(leaf)) return null;

  shape.push(leaf.re.length);
  const total = shape.reduce((a, b) => a * b, 1);
  const re = new Float64Array(total);
  const im = new Float64Array(total);
  let idx = 0;
  function fill(a: unknown): void {
    if (Array.isArray(a)) {
      for (const el of a) fill(el);
    } else if (isComplexBlock(a)) {
      for (let s = 0; s < a.re.length; s++) {
        re[idx] = a.re[s];
        im[idx] = a.im[s];
        idx++;
      }
    }
  }
  fill(arr);
  return { re, im, shape };
}

function flattenNumericArray(arr: unknown[]): { data: Float64Array; shape: number[] } | null {
  const { shape, leaf } = nestedShape(arr);
  if (typeof leaf !== "number") return null;
  const flat = new Float64Array(shape.reduce((a, b) => a * b, 1));
  let idx = 0;
  function fill(a: unknown): void {
    if (Array.isArray(a)) {
      for (const el of a) fill(el);
    } else if (typeof a === "number") {
      flat[idx++] = a;
    }
  }
  fill(arr);
  return { data: flat, shape };
}

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

// --- Window control handlers ---
ipcMain.on("window-minimize", () => mainWindow?.minimize());
ipcMain.on("window-maximize", () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on("window-close", () => mainWindow?.close());
ipcMain.handle("window-is-maximized", () => mainWindow?.isMaximized() ?? false);
