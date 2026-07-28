const net = require("net");
const path = require("path");
const { app, BrowserWindow } = require("electron");
const { consoleMethodForLevel } = require("./console-level.cjs");
const { resolveRendererVisible } = require("./renderer-window.cjs");
const remoteMain = require("@electron/remote/main");
const { loadBundleIdentity } = require("./bundle-identity.cjs");
const { structuredLogger } = require("./structured-logger.cjs");

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
  structuredLogger.error("server.preflight_failed", {
    errorMessage: error.message,
  });
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
const {
  DevAuthorityRegistration,
} = require("./dev-authority-registration.cjs");
const {
  DevEmptySessionController,
} = require("./dev-empty-session.cjs");
const authorityClient = sessionManager.authorityClient;

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
const outboundAuthorityEnabled = authorityClient.enabled;
const devAuthorityRegistration =
  process.env.THNK_DEV_AUTHORITY_REGISTER === "true";
const shutdownTimeout = Number(process.env.THNK_SHUTDOWN_TIMEOUT_MS || 30_000);
const devEmptySessionTimeout = Number(
  process.env.THNK_DEV_AUTO_END_EMPTY_MS || 0
);
// GDevelop drives its authoritative event loop with requestAnimationFrame.
// Keeping the renderer visible on the host's virtual display prevents Chromium
// from reducing that loop to roughly one frame per second.
const rendererVisible = resolveRendererVisible(
  process.env.THNK_AUTHORITY_RENDER_VISIBLE
);

if (
  !Number.isInteger(shutdownTimeout) ||
  shutdownTimeout < 5_000 ||
  shutdownTimeout > 60_000
)
  throw new Error(
    "THNK_SHUTDOWN_TIMEOUT_MS must be an integer from 5000 to 60000."
  );
if (
  !Number.isInteger(devEmptySessionTimeout) ||
  devEmptySessionTimeout < 0 ||
  (devEmptySessionTimeout > 0 &&
    (devEmptySessionTimeout < 1_000 || devEmptySessionTimeout > 300_000))
)
  throw new Error(
    "THNK_DEV_AUTO_END_EMPTY_MS must be 0 or an integer from 1000 to 300000."
  );
if (devEmptySessionTimeout > 0 && !devAuthorityRegistration)
  throw new Error(
    "THNK_DEV_AUTO_END_EMPTY_MS is allowed only for a registered development Authority."
  );
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
  !outboundAuthorityEnabled &&
  (typeof controlToken !== "string" || controlToken.length < 32)
)
  throw new Error(
    "THNK_CONTROL_TOKEN must contain at least 32 characters in bridge mode."
  );
if (outboundAuthorityEnabled && !sessionManager.enabled)
  throw new Error(
    "THNK_MATCHMAKING_URL requires THNK_BRIDGE_ENABLED=true."
  );
if (
  devAuthorityRegistration &&
  !/^https?:\/\//.test(process.env.THNK_GAME_SERVER_URL || "")
)
  throw new Error(
    "THNK_GAME_SERVER_URL is required when THNK_DEV_AUTHORITY_REGISTER=true."
  );

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
remoteMain.initialize();

let serverWindow;
let serverStartPromise;
let controlServer;
let shuttingDown = false;
let shutdownPromise;
let authorityHeartbeatTimer;
let devEmptySessionController;

const authorityIdentity = {
  gameId: identity.gameId,
  modeId: process.env.THNK_MODE_ID || identity.authorityId,
  authorityId: identity.authorityId,
  serverBuildId: identity.serverBuildId,
  compatibilityVersion: identity.compatibilityVersion,
  clientBuildId: identity.clientBuildId,
  protocolVersion: identity.protocolVersion,
};

const delay = (milliseconds) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
  });

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

const shutdown = (reason = "process_shutdown") => {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  structuredLogger.info("server.stopping", {
    sessionId: sessionManager.getPublicState()?.sessionId,
    reason,
  });
  const forceExit = setTimeout(() => {
    structuredLogger.error("server.shutdown_timeout", {
      sessionId: sessionManager.getPublicState()?.sessionId,
      reason,
      shutdownTimeout,
    });
    app.exit(1);
  }, shutdownTimeout);
  forceExit.unref();
  app.once("will-quit", () => clearTimeout(forceExit));
  controlServer?.close();
  clearInterval(authorityHeartbeatTimer);
  devEmptySessionController?.stop();
  shutdownPromise = Promise.resolve(sessionManager.shutdown(reason))
    .catch((error) =>
      structuredLogger.error("server.shutdown_drain_failed", {
        errorMessage: error?.message,
      })
    )
    .then(async () => {
      if (devAuthorityRegistration && authorityClient.enabled)
        await authorityClient.deregisterDev().catch((error) =>
          structuredLogger.warn("authority.deregister_failed", {
            errorCode: error?.code || "matchmaking_unavailable",
          })
        );
    })
    .finally(() => {
      if (serverWindow && !serverWindow.isDestroyed()) serverWindow.close();
      else app.quit();
    });
  return shutdownPromise;
};

const startAuthority = () => {
  if (serverStartPromise) return serverStartPromise;
  serverStartPromise = (async () => {
    serverWindow = new BrowserWindow({
      show: rendererVisible,
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
      const method = consoleMethodForLevel(level);
      structuredLogger[method]("game.console", { message });
    });
    serverWindow.webContents.on(
      "did-fail-load",
      (_event, code, description) => {
        structuredLogger.error("server.load_failed", {
          errorCode: code,
          errorMessage: description,
        });
        app.exit(1);
      }
    );
    serverWindow.webContents.on("render-process-gone", (_event, details) => {
      structuredLogger.error("server.renderer_exited", {
        reason: details.reason,
      });
      app.exit(1);
    });
    serverWindow.on("closed", () => {
      serverWindow = undefined;
      app.quit();
    });

    await serverWindow.loadFile(path.join(bundleRoot, "server", "index.html"));
    await waitForPort();
    sessionManager.setGameReady();
    structuredLogger.info("server.ready", {
      port: serverPort,
      authorityId: identity.authorityId,
      serverBuildId: identity.serverBuildId,
    });
  })();
  return serverStartPromise;
};

const startOutboundAuthority = async () => {
  if (devAuthorityRegistration) {
    const registration = new DevAuthorityRegistration({
      client: authorityClient,
      registration: {
        ...authorityIdentity,
        gameServerUrl: process.env.THNK_GAME_SERVER_URL,
      },
      logger: structuredLogger,
    });
    await registration.register();
    authorityHeartbeatTimer = setInterval(() => {
      void registration.heartbeat();
    }, 15_000);
    authorityHeartbeatTimer.unref?.();
  }
  structuredLogger.info("authority.pull_ready", {
    authorityId: identity.authorityId,
    modeId: authorityIdentity.modeId,
    routeKind: devAuthorityRegistration ? "dev" : "production",
  });
  while (!shuttingDown) {
    let session;
    try {
      session = await authorityClient.claim(authorityIdentity);
    } catch (error) {
      structuredLogger.warn("authority.claim_failed", {
        errorCode: error?.code || "matchmaking_unavailable",
      });
      await delay(1_000);
      continue;
    }
    if (!session) {
      await delay(250);
      continue;
    }
    await sessionManager.prepareSession(session);
    await startAuthority();
    await authorityClient.ready(session.sessionId);
    structuredLogger.info("authority.session_ready", {
      sessionId: session.sessionId,
      authorityId: identity.authorityId,
      routeKind: devAuthorityRegistration ? "dev" : "production",
    });
    return;
  }
};

for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => shutdown(`signal_${signal.toLowerCase()}`));

sessionManager.on("maximum-duration", () => shutdown("maximum_duration"));
devEmptySessionController = new DevEmptySessionController({
  enabled: devAuthorityRegistration && devEmptySessionTimeout > 0,
  timeoutMs: devEmptySessionTimeout,
  sessionManager,
  shutdown,
  logger: structuredLogger,
});
devEmptySessionController.start();

app
  .whenReady()
  .then(async () => {
    if (outboundAuthorityEnabled) {
      await startOutboundAuthority();
    } else if (sessionManager.enabled) {
      controlServer = createControlServer({
        sessionManager,
        controlToken,
        onSessionStart: startAuthority,
        onSessionEnd: (drain) => drain.finally(() => shutdown("session_ended")),
      });
      await new Promise((resolve, reject) => {
        controlServer.once("error", reject);
        controlServer.listen(controlPort, controlHost, () => {
          controlServer.off("error", reject);
          resolve();
        });
      });
      structuredLogger.info("control.ready", {
        host: controlHost,
        port: controlPort,
        authorityId: identity.authorityId,
      });
    } else await startAuthority();
  })
  .catch((error) => {
    structuredLogger.error("server.start_failed", {
      errorMessage: error.message,
    });
    app.exit(1);
  });

app.on("window-all-closed", () => {
  controlServer?.close();
  app.quit();
});
