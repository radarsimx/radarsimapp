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

import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from "electron";
import * as path from "path";
import * as fs from "fs";
import { RadarSimBridge } from "./bridge";

let mainWindow: BrowserWindow | undefined;
let bridge: RadarSimBridge | undefined;

const isDev: boolean = process.argv.includes("--dev");

/**
 * Creates and configures the main application window.
 */
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    title: "RadarSimApp",
    frame: isDev,
    show: false,
    backgroundColor: "#0f0f14",
    icon: path.join(
      __dirname,
      "..",
      "renderer",
      "assets",
      process.platform === "win32" ? "logo.ico" : "logo.png"
    ),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  mainWindow.once("ready-to-show", () => {
    mainWindow!.show();
  });
}

// Pin the App User Model ID so Windows uses the embedded icon.
if (process.platform === "win32") {
  app.setAppUserModelId("com.radarsimx.radarsimapp");
}

app.whenReady().then(() => {
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

ipcMain.handle("run-simulation", async (_event, config: Record<string, unknown>) => {
  try {
    const result = await bridge!.runSimulation(config);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: (err as Error).message || String(err) };
  }
});

ipcMain.handle("run-rcs-simulation", async (_event, config: Record<string, unknown>) => {
  try {
    const result = await bridge!.runRcsSimulation(config);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: (err as Error).message || String(err) };
  }
});

ipcMain.handle("get-app-version", () => app.getVersion());

ipcMain.handle("check-library", async () => {
  try {
    const result = await bridge!.checkLibrary();
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: (err as Error).message || String(err) };
  }
});

ipcMain.handle("activate-license", async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Select License File",
      properties: ["openFile"],
      filters: [{ name: "License Files", extensions: ["lic"] }],
    });
    if (result.canceled) return { success: false, cancelled: true };
    const data = await bridge!.activateLicense(result.filePaths[0]);
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
  } catch { /* Silently ignore malformed URLs. */ }
});

ipcMain.handle("select-file", async (_event, options?: { filters?: Array<{ name: string; extensions: string[] }> }) => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ["openFile"],
    filters: options?.filters || [{ name: "All Files", extensions: ["*"] }],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle("export-results", async (_event, data: Record<string, unknown>) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    filters: [
      { name: "HDF5", extensions: ["h5"] },
      { name: "JSON", extensions: ["json"] },
    ],
  });
  if (result.canceled) return null;
  const filePath = result.filePath!;

  if (filePath.endsWith(".h5")) {
    const h5wasm = await import("h5wasm");
    await h5wasm.ready;
    const h5FileName = path.basename(filePath);
    const f = new h5wasm.File(h5FileName, "w");
    writeHdf5(f as any, data);
    f.flush();
    f.close();
    const bytes = (h5wasm as any).FS.readFile(h5FileName);
    fs.writeFileSync(filePath, bytes);
    (h5wasm as any).FS.unlink(h5FileName);
  } else {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }
  return filePath;
});

/**
 * Recursively writes a JavaScript object to an HDF5 file/group.
 */
function writeHdf5(group: any, obj: Record<string, any>): void {
  for (const [key, value] of Object.entries(obj)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      const cplx = flattenComplexArray(value);
      if (cplx) {
        const data = new Map([["r", cplx.re], ["i", cplx.im]]);
        group.create_dataset({
          name: key,
          data,
          shape: cplx.shape,
          dtype: [["r", "<d"], ["i", "<d"]],
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

function flattenComplexArray(arr: any[]): { re: Float64Array; im: Float64Array; shape: number[] } | null {
  const shape: number[] = [];
  let cursor: any = arr;
  while (Array.isArray(cursor)) {
    shape.push(cursor.length);
    cursor = cursor[0];
  }
  if (
    typeof cursor !== "object" ||
    cursor === null ||
    !("re" in cursor) ||
    !("im" in cursor)
  )
    return null;

  const sampleLen = cursor.re.length;
  shape.push(sampleLen);
  const total = shape.reduce((a: number, b: number) => a * b, 1);
  const re = new Float64Array(total);
  const im = new Float64Array(total);
  let idx = 0;
  function fill(a: any): void {
    if (Array.isArray(a)) {
      for (const el of a) fill(el);
    } else {
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

function flattenNumericArray(arr: any[]): { data: Float64Array; shape: number[] } | null {
  const shape: number[] = [];
  let cursor: any = arr;
  while (Array.isArray(cursor)) {
    shape.push(cursor.length);
    cursor = cursor[0];
  }
  if (typeof cursor !== "number") return null;
  const flat = new Float64Array(shape.reduce((a: number, b: number) => a * b, 1));
  let idx = 0;
  function fill(a: any): void {
    if (Array.isArray(a)) {
      for (const el of a) fill(el);
    } else {
      flat[idx++] = a;
    }
  }
  fill(arr);
  return { data: flat, shape };
}

ipcMain.handle("save-config", async (_event, jsonData: string) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: "Save Configuration",
    defaultPath: "radar-config.json",
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (result.canceled) return false;
  fs.writeFileSync(result.filePath!, jsonData, "utf8");
  return true;
});

ipcMain.handle("load-config", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: "Load Configuration",
    properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (result.canceled) return null;
  return fs.readFileSync(result.filePaths[0], "utf8");
});

// --- Window control handlers ---
ipcMain.on("window-minimize", () => mainWindow!.minimize());
ipcMain.on("window-maximize", () => {
  if (mainWindow!.isMaximized()) mainWindow!.unmaximize();
  else mainWindow!.maximize();
});
ipcMain.on("window-close", () => mainWindow!.close());
ipcMain.handle("window-is-maximized", () => mainWindow!.isMaximized());
