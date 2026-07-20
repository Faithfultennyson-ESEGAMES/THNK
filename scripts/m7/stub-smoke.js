const assert = require("assert");
const crypto = require("crypto");
const { once } = require("events");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const repositoryRoot = path.resolve(__dirname, "../..");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "thnk-m7-stub-"));
const manifestPath = path.join(temporaryRoot, "manifest.json");
fs.writeFileSync(
  manifestPath,
  JSON.stringify({
    formatVersion: 5,
    project: { gameId: "stub-game" },
    authorities: { duel: { bootstrapScene: "Bootstrap", gameScene: "Game" } },
    build: {
      serverBuildId: `sha256:${"7".repeat(64)}`,
      compatibilityVersion: "m7-v1",
      clientBuildId: "m7-client-v1",
      protocolVersion: "thnk-flatbuffers-v1",
    },
  })
);

const controlToken = "stub-smoke-control-token-value-32-chars";
const webhookSecret = "stub-smoke-webhook-secret-value-32-chars";
const profileToken = "stub-smoke-profile-token-value-32-chars";
let createdSession;
let ended = false;

const readBody = (request) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });

const controlServer = http.createServer(async (request, response) => {
  if (request.headers.authorization !== `Bearer ${controlToken}`)
    return response.writeHead(401).end('{"error":"unauthorized"}');
  if (request.method === "POST" && request.url === "/v1/session") {
    createdSession = JSON.parse((await readBody(request)).toString("utf8"));
    response.writeHead(201, { "content-type": "application/json" });
    return response.end(
      JSON.stringify({ session: { sessionId: createdSession.sessionId } })
    );
  }
  if (request.method === "POST" && request.url === "/v1/session/end") {
    ended = true;
    response.writeHead(202, { "content-type": "application/json" });
    return response.end('{"session":{"status":"ending"}}');
  }
  response.writeHead(404).end();
});

const waitFor = async (read, predicate, description, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (predicate(value)) return value;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${description}.`);
};

const closeServer = async (server) => {
  if (!server.listening) return;
  const closed = once(server, "close");
  server.close();
  server.closeAllConnections?.();
  await closed;
};

const main = async () => {
  controlServer.listen(0, "127.0.0.1");
  await once(controlServer, "listening");
  const controlPort = controlServer.address().port;
  const portProbe = http.createServer();
  portProbe.listen(0, "127.0.0.1");
  await once(portProbe, "listening");
  const stubPort = portProbe.address().port;
  await closeServer(portProbe);

  const stub = spawn(
    process.execPath,
    [
      path.join(repositoryRoot, "examples/stub-matchmaker/server.cjs"),
      manifestPath,
    ],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        THNK_STUB_PORT: String(stubPort),
        THNK_CONTROL_URL: `http://127.0.0.1:${controlPort}`,
        THNK_CONTROL_TOKEN: controlToken,
        THNK_WEBHOOK_SECRET: webhookSecret,
        THNK_PLAYER_PROFILE_TOKEN: profileToken,
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  const baseUrl = `http://127.0.0.1:${stubPort}`;
  try {
    await waitFor(
      () => fetch(`${baseUrl}/health/live`),
      (response) => response.status === 200,
      "stub liveness"
    );
    const started = await fetch(`${baseUrl}/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ players: ["alice", "bob"] }),
    });
    assert.equal(started.status, 201);
    const startedBody = await started.json();
    assert.equal(startedBody.join.length, 2);
    assert.deepEqual(
      createdSession.players.map((player) => player.playerId),
      ["alice", "bob"]
    );
    const joined = await fetch(`${baseUrl}/join?playerId=alice`);
    assert.equal(joined.status, 200);
    const join = await joined.json();
    assert.equal(join.playerId, "alice");
    assert.equal(join.admissionToken.split(".").length, 3);

    const document = await fetch(
      `${baseUrl}/internal/players/alice/document?gameId=stub-game`,
      { headers: { authorization: `Bearer ${profileToken}` } }
    );
    assert.equal(document.status, 200);
    assert.deepEqual((await document.json()).document, {
      progression: { xp: 0 },
    });

    const event = {
      version: 1,
      eventId: crypto.randomUUID(),
      eventType: "session.started",
      timestamp: new Date().toISOString(),
      sessionId: createdSession.sessionId,
    };
    const eventBody = JSON.stringify(event);
    const signature = crypto
      .createHmac("sha256", webhookSecret)
      .update(eventBody)
      .digest("hex");
    const delivered = await fetch(`${baseUrl}/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-thnk-event-id": event.eventId,
        "x-thnk-signature": `sha256=${signature}`,
      },
      body: eventBody,
    });
    assert.equal(delivered.status, 204);
    const state = await (await fetch(`${baseUrl}/state`)).json();
    assert.equal(state.lifecycleEvents.length, 1);
    assert.equal(
      (await fetch(`${baseUrl}/end`, { method: "POST" })).status,
      202
    );
    assert.equal(ended, true);
    console.log(
      JSON.stringify({
        sessionStart: "passed",
        admissionJwt: "passed",
        playerProfile: "passed",
        signedWebhook: "passed",
        sessionEnd: "passed",
      })
    );
  } finally {
    stub.kill("SIGTERM");
    await Promise.race([
      once(stub, "exit"),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
    await closeServer(controlServer);
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
