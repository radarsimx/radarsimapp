const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const { PythonBridge } = require("./python/bridge");

let mainWindow;
let pythonBridge;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: "RadarSimApp",
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  if (process.argv.includes("--dev")) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  pythonBridge = new PythonBridge();

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (pythonBridge) pythonBridge.kill();
  if (process.platform !== "darwin") app.quit();
});

// --- IPC Handlers ---

ipcMain.handle("run-simulation", async (_event, config) => {
  try {
    const result = await pythonBridge.runSimulation(config);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
});

ipcMain.handle("run-rcs-simulation", async (_event, config) => {
  try {
    const result = await pythonBridge.runRcsSimulation(config);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
});

ipcMain.handle("check-python", async () => {
  try {
    const result = await pythonBridge.checkPython();
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
});

ipcMain.handle("select-file", async (_event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: options?.filters || [{ name: "All Files", extensions: ["*"] }],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

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
