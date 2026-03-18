const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  runSimulation: (config) => ipcRenderer.invoke("run-simulation", config),
  runRcsSimulation: (config) =>
    ipcRenderer.invoke("run-rcs-simulation", config),
  checkPython: () => ipcRenderer.invoke("check-python"),
  selectFile: (options) => ipcRenderer.invoke("select-file", options),
  exportResults: (data) => ipcRenderer.invoke("export-results", data),
});
