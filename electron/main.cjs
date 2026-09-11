/*
 * CID EchoTrace Local desktop host.
 * The renderer is isolated from Node. It communicates with the private local
 * server over 127.0.0.1 and can request only these narrow desktop actions.
 */
const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let mainWindow;
let backend;
let isQuitting = false;
let closePending = false;
let draftWrites = Promise.resolve();

async function closeApplication() {
  if (closePending || isQuitting) return;
  closePending = true;
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      let timer;
      try {
        await Promise.race([
          mainWindow.webContents.executeJavaScript("window.echoTracePrepareClose ? window.echoTracePrepareClose() : Promise.resolve()"),
          new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error("The review window is not responding.")), 5000); })
        ]);
      } catch (error) {
        const choice = await dialog.showMessageBox(mainWindow, {
          type: "warning", title: "Close EchoTrace?", message: "The latest review draft could not be backed up.",
          detail: `${error.message}\n\nKeep the workspace open to recover your edits, or exit using the last successful local backup.`,
          buttons: ["Keep open", "Exit using last backup"], defaultId: 0, cancelId: 0
        });
        if (choice.response === 0) return;
      } finally { clearTimeout(timer); }
    }
    await draftWrites.catch(() => {});
    await backend?.shutdown();
    isQuitting = true;
    mainWindow?.destroy();
    app.quit();
  } catch (error) {
    dialog.showErrorBox("Unable to close safely", `Your workspace is still open. Save your corrections and try again.\n\n${error.message}`);
  } finally { closePending = false; }
}

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
        { label: "Exit", accelerator: "Alt+F4", click: () => void closeApplication() }
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
  mainWindow.on("close", (event) => {
    if (!isQuitting) { event.preventDefault(); void closeApplication(); }
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== `http://127.0.0.1:${port}/`) event.preventDefault();
  });
  void mainWindow.loadURL(`http://127.0.0.1:${port}/`);
}

ipcMain.handle("desktop:open-data-directory", async () => shell.openPath(app.getPath("userData")));
ipcMain.handle("desktop:load-drafts", async () => {
  try { return JSON.parse(await fs.readFile(path.join(app.getPath("userData"), "review-drafts.json"), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return {}; throw error; }
});
ipcMain.handle("desktop:save-drafts", async (_event, drafts) => {
  if (!drafts || typeof drafts !== "object" || Array.isArray(drafts)) throw new Error("Invalid review drafts");
  const contents = JSON.stringify(drafts);
  if (Buffer.byteLength(contents) > 16 * 1024 * 1024) throw new Error("Review drafts exceed the local storage limit");
  const file = path.join(app.getPath("userData"), "review-drafts.json");
  draftWrites = draftWrites.catch(() => {}).then(async () => {
    await fs.writeFile(file + ".tmp", contents, "utf8");
    await fs.rename(file + ".tmp", file);
  });
  await draftWrites;
});

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

app.on("before-quit", (event) => {
  if (!isQuitting && backend) { event.preventDefault(); void closeApplication(); }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && !isQuitting) app.quit();
});
