/*
 * CID EchoTrace Local desktop host.
 * The renderer is isolated from Node. It communicates with the private local
 * server over 127.0.0.1 and can request only these narrow desktop actions.
 */
const { app, BrowserWindow, Menu, ipcMain, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let mainWindow;
let backend;
let isQuitting = false;

function appRoot() {
  return path.resolve(__dirname, "..");
}

async function prepareRuntimeDirectory() {
  const userData = app.getPath("userData");
  await fs.mkdir(userData, { recursive: true });
  return userData;
}

function createMenu() {
  const template = [
    {
      label: "CID EchoTrace Local",
      submenu: [
        { label: "Open data folder", click: () => void shell.openPath(app.getPath("userData")) },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [{ role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }]
    },
    {
      label: "Help",
      submenu: [{ label: "About CID EchoTrace Local", click: () => mainWindow?.webContents.send("show-help") }]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 850,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    autoHideMenuBar: false,
    backgroundColor: "#f6f7fc",
    title: "CID EchoTrace Local",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  mainWindow.setMenuBarVisibility(true);
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== `http://127.0.0.1:${port}/`) event.preventDefault();
  });
  void mainWindow.loadURL(`http://127.0.0.1:${port}/`);
}

ipcMain.handle("desktop:open-data-directory", async () => shell.openPath(app.getPath("userData")));

app.whenReady().then(async () => {
  const runtimeDir = await prepareRuntimeDirectory();
  process.env.ECHOSCRIBE_DATA_DIR = runtimeDir;
  if (app.isPackaged) {
    process.env.ECHOSCRIBE_ENGINE_DIR = path.join(process.resourcesPath, "engine");
    process.env.ECHOSCRIBE_MODEL_DIR = path.join(process.resourcesPath, "models");
  }
  const moduleUrl = pathToFileURL(path.join(appRoot(), "server.mjs")).href;
  const localService = await import(moduleUrl);
  backend = await localService.startServer({ port: 0 });
  createMenu();
  createWindow(backend.port);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(backend.port);
  });
}).catch((error) => {
  console.error("CID EchoTrace Local could not start:", error);
  app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
  if (backend?.server) backend.server.close();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && !isQuitting) app.quit();
});
