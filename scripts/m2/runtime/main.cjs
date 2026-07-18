const fs = require("fs");
const net = require("net");
const path = require("path");
const { app, BrowserWindow } = require("electron");
const remoteMain = require("@electron/remote/main");

const bundleRoot = path.resolve(__dirname, "..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(bundleRoot, "manifest.json"), "utf8")
);
const serverPort = manifest.runtime.port;
const startupTimeout = Number(
  process.env.THNK_SERVER_START_TIMEOUT_MS || 30_000
);

process.env.THNK_GECKOS_BRIDGE_PATH = path.join(__dirname, "geckos-bridge.cjs");
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
remoteMain.initialize();

let serverWindow;
let shuttingDown = false;

const waitForPort = () =>
  new Promise((resolve, reject) => {
    const deadline = Date.now() + startupTimeout;
    const attempt = () => {
      const socket = net.createConnection({
        host: "127.0.0.1",
        port: serverPort,
      });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() >= deadline)
          reject(new Error(`Server did not listen on port ${serverPort}.`));
        else setTimeout(attempt, 100);
      });
    };
    attempt();
  });

const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("THNK_SERVER_STOPPING");
  const forceExit = setTimeout(() => app.exit(1), 5_000);
  forceExit.unref();
  if (serverWindow && !serverWindow.isDestroyed()) serverWindow.close();
  else app.quit();
};

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, shutdown);

app.whenReady().then(async () => {
  serverWindow = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: false,
      devTools: false,
      nodeIntegration: true,
      sandbox: false,
    },
  });
  remoteMain.enable(serverWindow.webContents);
  serverWindow.webContents.on("console-message", (_event, level, message) => {
    const method = level >= 2 ? "error" : level === 1 ? "warn" : "log";
    console[method](`[game] ${message}`);
  });
  serverWindow.webContents.on("did-fail-load", (_event, code, description) => {
    console.error(`THNK_SERVER_LOAD_FAILED ${code} ${description}`);
    app.exit(1);
  });
  serverWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(`THNK_SERVER_RENDERER_EXITED ${details.reason}`);
    app.exit(1);
  });
  serverWindow.on("closed", () => {
    serverWindow = undefined;
    app.quit();
  });

  await serverWindow.loadFile(path.join(bundleRoot, "server", "index.html"));
  try {
    await waitForPort();
    console.log(`THNK_SERVER_READY port=${serverPort}`);
  } catch (error) {
    console.error(`THNK_SERVER_START_FAILED ${error.message}`);
    app.exit(1);
  }
});

app.on("window-all-closed", () => app.quit());
