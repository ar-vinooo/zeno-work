const http = require("node:http");
const path = require("node:path");
const { app, BrowserWindow, dialog, session, utilityProcess } = require("electron");

app.setName("ZenoWork");

let mainWindow = null;
let nextApp = null;
let nextProcess = null;
let nextProcessExitCode = null;
let localServer = null;
let appUrl = process.env.ELECTRON_START_URL || null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

async function availablePort() {
  const probe = http.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  if (!address || typeof address === "string")
    throw new Error("Server lokal tidak memperoleh port.");
  await new Promise((resolve) => probe.close(resolve));
  return address.port;
}

async function waitUntilReady(url) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (nextProcessExitCode !== null)
      throw new Error(`Server lokal berhenti dengan kode ${nextProcessExitCode}.`);
    const ready = await new Promise((resolve) => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve(true);
      });
      request.on("error", () => resolve(false));
      request.setTimeout(500, () => {
        request.destroy();
        resolve(false);
      });
    });
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Server lokal tidak siap dalam 30 detik.");
}

async function startPackagedServer() {
  const runtimeDir = path.join(process.resourcesPath, "standalone");
  const port = await availablePort();
  const url = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
  };

  nextProcessExitCode = null;
  nextProcess = utilityProcess.fork(path.join(runtimeDir, "server.js"), [], {
    cwd: runtimeDir,
    env,
    stdio: "pipe",
    serviceName: "ZenoWork Server",
  });
  nextProcess.on("exit", (code) => {
    nextProcessExitCode = code;
  });
  nextProcess.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  nextProcess.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  await waitUntilReady(url);
  return url;
}

async function startProductionServer() {
  // Data tidak boleh berada di dalam .app/.asar karena lokasi itu read-only
  // dan akan ditimpa saat upgrade aplikasi.
  process.env.NODE_ENV = "production";
  process.env.ZENO_DATA_DIR = path.join(app.getPath("userData"), "data");

  if (app.isPackaged) return startPackagedServer();

  const runtimeDir = app.getAppPath();
  const next = require(path.join(runtimeDir, "node_modules", "next"));
  nextApp = next({ dev: false, dir: runtimeDir });
  await nextApp.prepare();
  const handle = nextApp.getRequestHandler();

  localServer = http.createServer((request, response) => {
    void handle(request, response);
  });

  await new Promise((resolve, reject) => {
    localServer.once("error", reject);
    localServer.listen(0, "127.0.0.1", resolve);
  });

  const address = localServer.address();
  if (!address || typeof address === "string")
    throw new Error("Server lokal tidak memperoleh port.");
  return `http://127.0.0.1:${address.port}`;
}

function createWindow() {
  if (!appUrl) throw new Error("Alamat aplikasi belum siap.");

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1050,
    minHeight: 650,
    title: "ZenoWork",
    backgroundColor: "#faf9f7",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const ownOrigin = new URL(appUrl).origin;
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== ownOrigin) event.preventDefault();
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  void mainWindow.loadURL(appUrl);
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });

  try {
    if (!appUrl) appUrl = await startProductionServer();
    createWindow();
  } catch (error) {
    dialog.showErrorBox(
      "ZenoWork gagal dibuka",
      error instanceof Error ? error.stack || error.message : String(error),
    );
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && appUrl) createWindow();
});

app.on("window-all-closed", () => app.quit());

app.on("will-quit", () => {
  nextProcess?.kill();
  localServer?.close();
  void nextApp?.close();
});
