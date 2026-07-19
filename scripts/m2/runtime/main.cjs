const net = require("net");
const path = require("path");
const { app, BrowserWindow } = require("electron");
const remoteMain = require("@electron/remote/main");
const { loadBundleIdentity } = require("./bundle-identity.cjs");

const bundleRoot = path.resolve(__dirname, "..");
let identity;
try {
  identity = loadBundleIdentity({
    bundleRoot,
    requestedAuthorityId: process.env.THNK_AUTHORITY_ID,
    requestedMapId: process.env.THNK_MAP_ID,
    expectedServerBuildId: process.env.THNK_EXPECTED_SERVER_BUILD_ID,
  });
} catch (error) {
  console.error(`THNK_SERVER_PREFLIGHT_FAILED ${error.message}`);
  process.exit(1);
}

process.env.THNK_AUTHORITY_ID = identity.authorityId;
process.env.THNK_MAP_ID = identity.mapId;
process.env.THNK_AUTHORITY_BOOTSTRAP_SCENE = identity.bootstrapScene;
process.env.THNK_RUNTIME_GAME_ID = identity.gameId;
process.env.THNK_RUNTIME_SERVER_BUILD_ID = identity.serverBuildId;
process.env.THNK_RUNTIME_COMPATIBILITY_VERSION = identity.compatibilityVersion;
process.env.THNK_RUNTIME_CLIENT_BUILD_ID = identity.clientBuildId;
process.env.THNK_RUNTIME_PROTOCOL_VERSION = identity.protocolVersion;
process.env.THNK_GECKOS_BRIDGE_PATH = path.join(__dirname, "geckos-bridge.cjs");

const { createControlServer } = require("./control-server.cjs");
const { sessionManager } = require("./session-manager.cjs");

const manifest = identity.manifest;
const serverPort = manifest.runtime.port;
const startupTimeout = Number(
  process.env.THNK_SERVER_START_TIMEOUT_MS || 30_000
);
const controlPort = Number(
  process.env.THNK_CONTROL_PORT || manifest.control.defaultPort
);
const controlHost = process.env.THNK_CONTROL_HOST || "127.0.0.1";
const controlToken = process.env.THNK_CONTROL_TOKEN;

if (
  !Number.isInteger(startupTimeout) ||
  startupTimeout < 1_000 ||
  startupTimeout > 300_000
)
  throw new Error(
    "THNK_SERVER_START_TIMEOUT_MS must be an integer from 1000 to 300000."
  );
if (
  sessionManager.enabled &&
  (!Number.isInteger(controlPort) || controlPort < 1 || controlPort > 65_535)
)
  throw new Error("THNK_CONTROL_PORT must be an integer from 1 to 65535.");
if (
  sessionManager.enabled &&
  (typeof controlToken !== "string" || controlToken.length < 32)
)
  throw new Error(
    "THNK_CONTROL_TOKEN must contain at least 32 characters in bridge mode."
  );

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
remoteMain.initialize();

let serverWindow;
let serverStartPromise;
let controlServer;
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
  app.once("will-quit", () => clearTimeout(forceExit));
  controlServer?.close();
  if (serverWindow && !serverWindow.isDestroyed()) serverWindow.close();
  else app.quit();
};

const startAuthority = () => {
  if (serverStartPromise) return serverStartPromise;
  serverStartPromise = (async () => {
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
    serverWindow.webContents.on(
      "did-fail-load",
      (_event, code, description) => {
        console.error(`THNK_SERVER_LOAD_FAILED ${code} ${description}`);
        app.exit(1);
      }
    );
    serverWindow.webContents.on("render-process-gone", (_event, details) => {
      console.error(`THNK_SERVER_RENDERER_EXITED ${details.reason}`);
      app.exit(1);
    });
    serverWindow.on("closed", () => {
      serverWindow = undefined;
      app.quit();
    });

    await serverWindow.loadFile(path.join(bundleRoot, "server", "index.html"));
    await waitForPort();
    sessionManager.setGameReady();
    console.log(
      `THNK_SERVER_READY port=${serverPort} authority=${identity.authorityId} build=${identity.serverBuildId}`
    );
  })();
  return serverStartPromise;
};

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, shutdown);

app
  .whenReady()
  .then(async () => {
    if (sessionManager.enabled) {
      controlServer = createControlServer({
        sessionManager,
        controlToken,
        onSessionStart: startAuthority,
        onSessionEnd: (drain) => drain.finally(shutdown),
      });
      await new Promise((resolve, reject) => {
        controlServer.once("error", reject);
        controlServer.listen(controlPort, controlHost, () => {
          controlServer.off("error", reject);
          resolve();
        });
      });
      console.log(
        `THNK_CONTROL_READY host=${controlHost} port=${controlPort} authority=${identity.authorityId}`
      );
    } else await startAuthority();
  })
  .catch((error) => {
    console.error(`THNK_SERVER_START_FAILED ${error.message}`);
    app.exit(1);
  });

app.on("window-all-closed", () => {
  controlServer?.close();
  app.quit();
});
