const assert = require("assert");
const crypto = require("crypto");
const { once } = require("events");
const http = require("http");
const { createControlServer } = require("../m2/runtime/control-server.cjs");
const { SessionManager } = require("../m2/runtime/session-manager.cjs");
const {
  createStructuredLogger,
} = require("../m2/runtime/structured-logger.cjs");

const closeServer = async (server) => {
  const closed = once(server, "close");
  server.close();
  server.closeAllConnections?.();
  await closed;
};

const main = async () => {
  const logs = [];
  const logger = createStructuredLogger({ write: (line) => logs.push(line) });
  const callbackServer = http.createServer((_request, response) =>
    response.writeHead(204).end()
  );
  callbackServer.listen(0, "127.0.0.1");
  await once(callbackServer, "listening");
  const callbackPort = callbackServer.address().port;
  const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" });
  const runtimeIdentity = {
    gameId: "headless-game",
    authorityId: "duel",
    mapId: "arena",
    serverBuildId: `sha256:${"7".repeat(64)}`,
    compatibilityVersion: "m7-v1",
    clientBuildId: "m7-client-v1",
    protocolVersion: "thnk-flatbuffers-v1",
  };
  const controlToken = "headless-control-token-value-32-chars";
  const manager = new SessionManager({
    enabled: true,
    webhookSecret: "headless-webhook-secret-value-32-chars",
    allowInsecureCallbacks: true,
    runtimeIdentity,
    logger,
  });
  const controlServer = createControlServer({
    sessionManager: manager,
    controlToken,
    logger,
    onSessionStart: async () => manager.setGameReady(),
  });
  controlServer.listen(0, "127.0.0.1");
  await once(controlServer, "listening");
  const baseUrl = `http://127.0.0.1:${controlServer.address().port}`;
  try {
    const created = await fetch(`${baseUrl}/v1/session`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${controlToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sessionId: "headless-session",
        ...runtimeIdentity,
        players: ["alice", "bob"],
        callbackUrl: `http://127.0.0.1:${callbackPort}/events`,
        tokenVerification: {
          publicKey,
          keyId: "headless-key",
          issuer: "headless-matchmaker",
          audience: "headless-server",
        },
      }),
    });
    assert.equal(created.status, 201);
    assert.equal((await fetch(`${baseUrl}/health/ready`)).status, 200);
    const ended = await fetch(`${baseUrl}/v1/session/end`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${controlToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ reason: "headless_smoke_complete" }),
    });
    assert.equal(ended.status, 202);
    await manager.sessionDrain;
    const serializedLogs = logs.join("\n");
    assert(!serializedLogs.includes(controlToken));
    assert(
      logs.map(JSON.parse).some((entry) => entry.event === "session.ended")
    );
    console.log(
      JSON.stringify({
        sessionLifecycle: "passed",
        readiness: "passed",
        structuredLogs: logs.length,
        credentialsRedacted: true,
      })
    );
  } finally {
    await Promise.all([
      closeServer(controlServer),
      closeServer(callbackServer),
    ]);
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
