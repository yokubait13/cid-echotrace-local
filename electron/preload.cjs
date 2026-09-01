const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("echoTraceDesktop", Object.freeze({
  onShowHelp: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("show-help", listener);
    return () => ipcRenderer.removeListener("show-help", listener);
  }
}));
