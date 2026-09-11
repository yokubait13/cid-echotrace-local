const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("echoTraceDesktop", Object.freeze({
  openDataDirectory: () => ipcRenderer.invoke("desktop:open-data-directory"),
  loadDrafts: () => ipcRenderer.invoke("desktop:load-drafts"),
  saveDrafts: (drafts) => ipcRenderer.invoke("desktop:save-drafts", drafts),
  onShowHelp: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("show-help", listener);
    return () => ipcRenderer.removeListener("show-help", listener);
  }
}));
