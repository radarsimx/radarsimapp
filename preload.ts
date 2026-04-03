import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  runSimulation: (config: unknown) => ipcRenderer.invoke("run-simulation", config),
  runRcsSimulation: (config: unknown) =>
    ipcRenderer.invoke("run-rcs-simulation", config),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  checkLibrary: () => ipcRenderer.invoke("check-library"),
  activateLicense: () => ipcRenderer.invoke("activate-license"),
  selectFile: (options?: unknown) => ipcRenderer.invoke("select-file", options),
  exportResults: (data: unknown) => ipcRenderer.invoke("export-results", data),
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),
  saveConfig: (jsonData: string) => ipcRenderer.invoke("save-config", jsonData),
  loadConfig: () => ipcRenderer.invoke("load-config"),
  windowMinimize: () => ipcRenderer.send("window-minimize"),
  windowMaximize: () => ipcRenderer.send("window-maximize"),
  windowClose: () => ipcRenderer.send("window-close"),
  windowIsMaximized: () => ipcRenderer.invoke("window-is-maximized"),
});
