// ===== RadarSimApp - Main Process =====
// Electron main process entry point. Responsible for creating the browser
// window, managing the Python bridge lifecycle, and handling all IPC calls
// from the renderer process.

const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const { PythonBridge } = require("./python/bridge");

/** @type {BrowserWindow|undefined} The single application window instance. */
let mainWindow;
/** @type {PythonBridge|undefined} Bridge to the Python backend process. */
let pythonBridge;

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
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    title: "RadarSimApp",
    icon: path.join(__dirname, "renderer", "assets", "logo.svg"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  // Open DevTools automatically when launched with the --dev flag.
  if (process.argv.includes("--dev")) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  // Initialise the Python bridge before the window opens so it is ready
  // to accept IPC calls as soon as the renderer loads.
  pythonBridge = new PythonBridge();

  createWindow();

  // macOS: re-create the window when the dock icon is clicked and no windows
  // are open (standard macOS behaviour).
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // Terminate the Python subprocess before quitting to avoid orphaned processes.
  if (pythonBridge) pythonBridge.kill();
  // On macOS apps conventionally stay running until the user quits explicitly.
  if (process.platform !== "darwin") app.quit();
});

// --- IPC Handlers ---
// All handlers follow the same pattern: delegate to the PythonBridge, wrap the
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
    const result = await pythonBridge.runSimulation(config);
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
    const result = await pythonBridge.runRcsSimulation(config);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
});

/**
 * Checks whether the Python environment has the required dependencies
 * (Python, NumPy, RadarSimPy) and returns their version strings.
 *
 * @returns {{ success: boolean, data?: Object, error?: string }}
 */
ipcMain.handle("check-python", async () => {
  try {
    const result = await pythonBridge.checkPython();
    return { success: true, data: result };
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
 * Supports JSON and CSV formats (the renderer determines which format to use
 * via the chosen file extension). The data is serialised to JSON regardless
 * of the chosen extension — post-processing for CSV is handled externally.
 *
 * @param {Object} data - Simulation result object to serialise and save.
 * @returns {string|null} The path the file was saved to, or null if cancelled.
 */
ipcMain.handle("export-results", async (_event, data) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [
      { name: "JSON", extensions: ["json"] },
      { name: "CSV", extensions: ["csv"] },
    ],
  });
  if (result.canceled) return null;
  const fs = require("fs");
  fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2));
  return result.filePath;
});
