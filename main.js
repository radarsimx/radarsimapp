// ===== RadarSimApp - Main Process =====
// Electron main process entry point. Responsible for creating the browser
// window, managing the bridge lifecycle, and handling all IPC calls
// from the renderer process.

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require("electron");
const path = require("path");
const { RadarSimBridge } = require("./radarsimlib/bridge");

/** @type {BrowserWindow|undefined} The single application window instance. */
let mainWindow;
/** @type {RadarSimBridge|undefined} */
let bridge;

/**
 * Creates and configures the main application window.
 *
 * Security settings:
 *  - contextIsolation: true  — renderer cannot access Node.js APIs directly.
 *  - nodeIntegration: false  — Node.js globals are not exposed in the renderer.
 *  - preload script          — exposes a narrow, explicit API via contextBridge.
 */
function createWindow() {
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
      "renderer",
      "assets",
      process.platform === "win32"
        ? "logo.ico"
        : process.platform === "darwin"
        ? "logo.png"
        : "logo.png"
    ),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });
}

const isDev = process.argv.includes("--dev");

app.whenReady().then(() => {
  if (!isDev) Menu.setApplicationMenu(null);
  bridge = new RadarSimBridge();

  createWindow();

  // macOS: re-create the window when the dock icon is clicked and no windows
  // are open (standard macOS behaviour).
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (bridge) bridge.kill();
  // On macOS apps conventionally stay running until the user quits explicitly.
  if (process.platform !== "darwin") app.quit();
});

// --- IPC Handlers ---
// All handlers follow the same pattern: delegate to the bridge, wrap the
// result in { success, data } on success, or { success, error } on failure, so
// the renderer always receives a consistent response shape.

/**
 * Runs the full radar simulation with the provided configuration.
 *
 * @param {Object} config - Radar and target configuration collected from the UI.
 * @returns {{ success: boolean, data?: Object, error?: string }}
 */
ipcMain.handle("run-simulation", async (_event, config) => {
  try {
    const result = await bridge.runSimulation(config);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
});

/**
 * Runs an RCS (Radar Cross-Section) sweep analysis for a mesh target.
 *
 * @param {Object} config - Target model path, incidence angles, and polarization.
 * @returns {{ success: boolean, data?: Object, error?: string }}
 */
ipcMain.handle("run-rcs-simulation", async (_event, config) => {
  try {
    const result = await bridge.runRcsSimulation(config);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
});

/**
 * Checks whether the native library is available and licensed.
 *
 * @returns {{ success: boolean, data?: Object, error?: string }}
 */
ipcMain.handle("get-app-version", () => app.getVersion());

ipcMain.handle("check-library", async () => {
  try {
    const result = await bridge.checkLibrary();
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
});

ipcMain.handle("activate-license", async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Select License File",
      properties: ["openFile"],
      filters: [{ name: "License Files", extensions: ["lic"] }],
    });
    if (result.canceled) return { success: false, cancelled: true };
    const data = await bridge.activateLicense(result.filePaths[0]);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
});

/**
 * Opens a URL in the system default browser.
 *
 * Only URLs whose hostname (with or without a leading "www.") appears in
 * allowedHosts are opened, preventing arbitrary URL redirection attacks.
 *
 * @param {string} url - The URL to open externally.
 */
ipcMain.handle("open-external", (_event, url) => {
  const allowedHosts = ["radarsimx.com"];
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (allowedHosts.includes(host)) shell.openExternal(url);
  } catch { } // Silently ignore malformed URLs.
});

/**
 * Opens a native file-picker dialog and returns the selected file path.
 *
 * @param {{ filters?: Array<{name: string, extensions: string[]}> }} options
 *   Optional file-type filters passed directly to Electron's dialog API.
 * @returns {string|null} The chosen file path, or null if the user cancelled.
 */
ipcMain.handle("select-file", async (_event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: options?.filters || [{ name: "All Files", extensions: ["*"] }],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

/**
 * Opens a native save dialog and writes the simulation result data to disk.
 *
 * Supports JSON and HDF5 formats. JSON serialises the full result object.
 * HDF5 writes each data field as a separate dataset using h5wasm.
 *
 * @param {Object} data - Simulation result object to serialise and save.
 * @returns {string|null} The path the file was saved to, or null if cancelled.
 */
ipcMain.handle("export-results", async (_event, data) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [
      { name: "HDF5", extensions: ["h5"] },
      { name: "JSON", extensions: ["json"] },
    ],
  });
  if (result.canceled) return null;
  const fs = require("fs");
  const filePath = result.filePath;

  if (filePath.endsWith(".h5")) {
    const h5wasm = await import("h5wasm");
    await h5wasm.ready;
    const h5FileName = require("path").basename(filePath);
    const f = new h5wasm.File(h5FileName, "w");
    writeHdf5(f, data);
    f.flush();
    f.close();
    const bytes = h5wasm.FS.readFile(h5FileName);
    fs.writeFileSync(filePath, bytes);
    h5wasm.FS.unlink(h5FileName);
  } else {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }
  return filePath;
});

/**
 * Recursively writes a JavaScript object to an HDF5 file/group.
 * Arrays of numbers become datasets; nested objects become groups.
 * Complex arrays ({re, im} leaves) are written as compound datasets.
 */
function writeHdf5(group, obj) {
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

/**
 * Flattens a nested array whose leaves are {re, im} objects into two
 * parallel Float64Arrays plus a shape array.
 * Returns { re: Float64Array, im: Float64Array, shape: number[] } or null.
 */
function flattenComplexArray(arr) {
  const shape = [];
  let cursor = arr;
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

  // Each leaf {re, im} contains arrays of samples
  const sampleLen = cursor.re.length;
  shape.push(sampleLen);
  const total = shape.reduce((a, b) => a * b, 1);
  const re = new Float64Array(total);
  const im = new Float64Array(total);
  let idx = 0;
  function fill(a) {
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

/**
 * Flattens a (possibly nested) numeric array into a typed array with shape.
 * Returns { data: Float64Array, shape: number[] } or null if not numeric.
 */
function flattenNumericArray(arr) {
  const shape = [];
  let cursor = arr;
  while (Array.isArray(cursor)) {
    shape.push(cursor.length);
    cursor = cursor[0];
  }
  if (typeof cursor !== "number") return null;
  const flat = new Float64Array(shape.reduce((a, b) => a * b, 1));
  let idx = 0;
  function fill(a) {
    if (Array.isArray(a)) {
      for (const el of a) fill(el);
    } else {
      flat[idx++] = a;
    }
  }
  fill(arr);
  return { data: flat, shape };
}

/**
 * Saves the current UI configuration to a user-chosen JSON file.
 *
 * @param {string} jsonData - Serialised configuration state.
 * @returns {boolean} true if saved successfully, false if cancelled.
 */
ipcMain.handle("save-config", async (_event, jsonData) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Save Configuration",
    defaultPath: "radar-config.json",
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (result.canceled) return false;
  const fs = require("fs");
  fs.writeFileSync(result.filePath, jsonData, "utf8");
  return true;
});

/**
 * Opens a JSON configuration file and returns its contents as a string.
 *
 * @returns {string|null} The raw JSON string, or null if the user cancelled.
 */
ipcMain.handle("load-config", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Load Configuration",
    properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (result.canceled) return null;
  const fs = require("fs");
  return fs.readFileSync(result.filePaths[0], "utf8");
});

// --- Window control handlers ---
ipcMain.on("window-minimize", () => mainWindow.minimize());
ipcMain.on("window-maximize", () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on("window-close", () => mainWindow.close());
ipcMain.handle("window-is-maximized", () => mainWindow.isMaximized());
