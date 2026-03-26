const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  runSimulation: (config) => ipcRenderer.invoke("run-simulation", config),
  runRcsSimulation: (config) =>
    ipcRenderer.invoke("run-rcs-simulation", config),
  checkPython: () => ipcRenderer.invoke("check-python"),
  selectFile: (options) => ipcRenderer.invoke("select-file", options),
  exportResults: (data) => ipcRenderer.invoke("export-results", data),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  saveConfig: (jsonData) => ipcRenderer.invoke("save-config", jsonData),
  loadConfig: () => ipcRenderer.invoke("load-config"),
  windowMinimize: () => ipcRenderer.send("window-minimize"),
  windowMaximize: () => ipcRenderer.send("window-maximize"),
  windowClose: () => ipcRenderer.send("window-close"),
  windowIsMaximized: () => ipcRenderer.invoke("window-is-maximized"),
});
