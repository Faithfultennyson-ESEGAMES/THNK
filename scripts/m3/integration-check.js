const assert = require("assert");
const crypto = require("crypto");
const { once } = require("events");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { evaluate, sendCommand } = require("../m1/inspect-runtime");

const repositoryRoot = path.resolve(__dirname, "../..");
const bundlePath = path.join(repositoryRoot, ".generated/m2/server-bundle");
const clientBuild = path.join(repositoryRoot, ".generated/m1/client/build");
const generatedRoot = path.join(repositoryRoot, ".generated/m3");
const chromePath =
  process.env.CHROME_BIN ||
  "C:/Program Files/Google/Chrome/Application/chrome.exe";
const controlToken = "m3-control-token-for-local-integration-only";
const webhookSecret = "m3-webhook-secret-for-local-integration-only";
const controlUrl = "http://127.0.0.1:9209";
const gameUrl = "http://127.0.0.1:9208/.wrtc/v2/connections";
const callbackPort = 9210;
const clientPort = 8080;
const clients = new Map();
const receivedAttempts = [];
const logicalEvents = new Map();
let retryInjected = false;

if (!fs.existsSync(path.join(bundlePath, "manifest.json")))
  throw new Error("Run yarn fixture:m2:export before the M3 check.");
if (!fs.existsSync(path.join(clientBuild, "index.html")))
  throw new Error("Run yarn fixture:m1:export-client before the M3 check.");
if (!fs.existsSync(chromePath))
  throw new Error(`Chrome executable not found: ${chromePath}`);

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const waitFor = async (read, predicate, description, timeout = 60_000) => {
  const deadline = Date.now() + timeout;
  let value;
  do {
    try {
      value = await read();
      if (predicate(value)) return value;
    } catch {}
    await delay(150);
  } while (Date.now() < deadline);
  throw new Error(
    `Timed out waiting for ${description}: ${JSON.stringify(value)}`
  );
};

const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" });
const signToken = ({
  playerId,
  tokenId,
  sessionId = "m3-session",
  issuedAt = Math.floor(Date.now() / 1000),
  expiresAt = issuedAt + 240,
}) => {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: "m3-key", typ: "JWT" })
  ).toString("base64url");
  const claims = Buffer.from(
    JSON.stringify({
      iss: "m3-stub-matchmaker",
      aud: "m3-fixture-server",
      sessionId,
      playerId,
      jti: tokenId,
      iat: issuedAt,
      exp: expiresAt,
    })
  ).toString("base64url");
  const message = `${header}.${claims}`;
  const signature = crypto
    .sign("RSA-SHA256", Buffer.from(message), keys.privateKey)
    .toString("base64url");
  return `${message}.${signature}`;
};

const readBody = (request) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });

const callbackServer = http.createServer(async (request, response) => {
  const body = await readBody(request);
  const signature = `sha256=${crypto
    .createHmac("sha256", webhookSecret)
    .update(body)
    .digest("hex")}`;
  if (
    request.method !== "POST" ||
    request.headers["x-thnk-signature"] !== signature
  ) {
    response.writeHead(401).end();
    return;
  }
  const event = JSON.parse(body.toString("utf8"));
  assert.strictEqual(request.headers["x-thnk-event-id"], event.eventId);
  const previous = logicalEvents.get(event.eventId);
  if (previous) assert.deepStrictEqual(previous, event);
  else logicalEvents.set(event.eventId, event);
  receivedAttempts.push(event);

  if (event.eventType === "player.joined" && !retryInjected) {
    retryInjected = true;
    response.writeHead(503).end();
  } else response.writeHead(204).end();
});

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".wasm": "application/wasm",
};
const clientTokens = new Map();
const clientServer = http.createServer((request, response) => {
  const parts = decodeURIComponent((request.url || "/").split("?")[0])
    .split("/")
    .filter(Boolean);
  const playerId = parts.shift();
  const token = clientTokens.get(playerId);
  if (!token) return response.writeHead(404).end();
  const relativePath = parts.length ? parts.join("/") : "index.html";
  const filePath = path.resolve(clientBuild, relativePath);
  if (!filePath.startsWith(`${clientBuild}${path.sep}`))
    return response.writeHead(403).end();
  fs.readFile(filePath, (error, contents) => {
    if (error)
      return response.writeHead(error.code === "ENOENT" ? 404 : 500).end();
    if (relativePath === "index.html") {
      const injection = `<script>window.THNK_ADMISSION_TOKEN=${JSON.stringify(
        token
      )};</script>`;
      contents = Buffer.from(
        contents.toString("utf8").replace("<head>", `<head>${injection}`)
      );
    }
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type":
        contentTypes[path.extname(filePath)] || "application/octet-stream",
    });
    response.end(contents);
  });
});

const controlRequest = async (route, { method = "GET", body } = {}) => {
  const response = await fetch(`${controlUrl}${route}`, {
    method,
    headers: {
      authorization: `Bearer ${controlToken}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
};

const admissionStatus = async (token) =>
  (
    await fetch(gameUrl, {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
  ).status;

const snapshot = (debugPort) =>
  evaluate(
    debugPort,
    `(() => {
      const scene = window.__thnkRuntimeScene;
      return {
        admissionTokenCleared: !("THNK_ADMISSION_TOKEN" in window),
        connection: window.THNK?.client?.getConnectionState?.(),
        score: scene?.getVariables().get("State").getChild("Score").getAsNumber(),
        players: (scene?.getObjects("Player") || []).map(player => ({
          id: player.thnkID,
          x: player.getX()
        })).sort((left, right) => left.id - right.id)
      };
    })()`
  );

const launchClient = async (playerId, debugPort, generation, token) => {
  clientTokens.set(playerId, token);
  const profile = path.join(
    generatedRoot,
    `${playerId}-${debugPort}-${generation}`
  );
  const child = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--disable-background-networking",
      "--no-first-run",
      "--remote-allow-origins=*",
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${debugPort}`,
      `http://127.0.0.1:${clientPort}/${playerId}/`,
    ],
    { stdio: "ignore" }
  );
  clients.set(debugPort, child);
  await waitFor(
    () => fetch(`http://127.0.0.1:${debugPort}/json/version`),
    (response) => response.ok,
    `${playerId} Chrome process`
  );
  await waitFor(
    () =>
      evaluate(
        debugPort,
        "typeof gdjs?.registerRuntimeScenePreEventsCallback === 'function'"
      ),
    Boolean,
    `${playerId} GDevelop runtime`
  );
  await evaluate(
    debugPort,
    `window.__thnkInspectionInstalled || (
      gdjs.registerRuntimeScenePreEventsCallback(
        runtimeScene => window.__thnkRuntimeScene = runtimeScene
      ),
      window.__thnkInspectionInstalled = true
    )`
  );
};

const closeClient = async (debugPort) => {
  if (!clients.has(debugPort)) return;
  try {
    await sendCommand(debugPort, "Browser.close");
  } catch {}
  await waitFor(
    async () => {
      try {
        await fetch(`http://127.0.0.1:${debugPort}/json/version`);
        return false;
      } catch {
        return true;
      }
    },
    Boolean,
    `Chrome ${debugPort} to close`,
    20_000
  );
  clients.delete(debugPort);
};

const setKey = (debugPort, isPressed, keyCode) =>
  evaluate(
    debugPort,
    `window.__thnkRuntimeScene.getGame().getInputManager().${
      isPressed ? "onKeyPressed" : "onKeyReleased"
    }(${keyCode})`
  );

const serverEnvironment = { ...process.env };
delete serverEnvironment.ELECTRON_RUN_AS_NODE;
Object.assign(serverEnvironment, {
  THNK_BRIDGE_ENABLED: "true",
  THNK_CONTROL_HOST: "127.0.0.1",
  THNK_CONTROL_PORT: "9209",
  THNK_CONTROL_TOKEN: controlToken,
  THNK_WEBHOOK_SECRET: webhookSecret,
  THNK_ALLOW_INSECURE_CALLBACKS: "true",
});
const electronPath = require("electron");
const gameServer = spawn(electronPath, [bundlePath], {
  cwd: bundlePath,
  env: serverEnvironment,
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "";
for (const stream of [gameServer.stdout, gameServer.stderr])
  stream.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });

(async () => {
  fs.mkdirSync(generatedRoot, { recursive: true });
  callbackServer.listen(callbackPort, "127.0.0.1");
  clientServer.listen(clientPort, "127.0.0.1");
  await Promise.all([
    once(callbackServer, "listening"),
    once(clientServer, "listening"),
  ]);

  await waitFor(
    () => fetch(`${controlUrl}/health/live`),
    (response) => response.ok,
    "M3 control API"
  );
  const session = await controlRequest("/v1/session", {
    method: "POST",
    body: {
      sessionId: "m3-session",
      players: ["alice", "bob", "probe"],
      callbackUrl: `http://127.0.0.1:${callbackPort}/events`,
      reconnectPolicy: "fresh-token",
      metadata: { fixture: "m3" },
      tokenVerification: {
        publicKey,
        keyId: "m3-key",
        issuer: "m3-stub-matchmaker",
        audience: "m3-fixture-server",
        algorithm: "RS256",
      },
    },
  });
  assert.strictEqual(session.status, 201);
  await waitFor(
    () => fetch(`${controlUrl}/health/ready`),
    (response) => response.status === 200,
    "M3 game readiness"
  );

  assert.strictEqual(await admissionStatus(), 401);
  const now = Math.floor(Date.now() / 1000);
  assert.strictEqual(
    await admissionStatus(
      signToken({
        playerId: "alice",
        tokenId: "expired",
        issuedAt: now - 120,
        expiresAt: now - 60,
      })
    ),
    401
  );
  assert.strictEqual(
    await admissionStatus(
      signToken({
        playerId: "alice",
        tokenId: "wrong-session",
        sessionId: "other-session",
      })
    ),
    403
  );
  assert.strictEqual(
    await admissionStatus(
      signToken({ playerId: "mallory", tokenId: "wrong-player" })
    ),
    403
  );
  const replayToken = signToken({ playerId: "probe", tokenId: "replay" });
  assert.strictEqual(await admissionStatus(replayToken), 200);
  assert.strictEqual(await admissionStatus(replayToken), 409);

  const aliceToken = signToken({ playerId: "alice", tokenId: "alice-1" });
  const bobToken = signToken({ playerId: "bob", tokenId: "bob-1" });
  await Promise.all([
    launchClient("alice", 9422, 0, aliceToken),
    launchClient("bob", 9423, 0, bobToken),
  ]);
  const joined = await waitFor(
    () => Promise.all([snapshot(9422), snapshot(9423)]),
    (values) =>
      values.every(
        (value) =>
          value.connection === "connected" &&
          value.score === 2 &&
          value.players.length === 2 &&
          value.admissionTokenCleared
      ),
    "two admitted clients to converge"
  );
  assert.deepStrictEqual(joined[0], joined[1]);
  assert.deepStrictEqual(
    (await controlRequest("/v1/session")).body.session.connectedPlayers.sort(),
    ["alice", "bob"]
  );
  await setKey(9422, true, 39);
  await delay(250);
  await setKey(9422, false, 39);
  await waitFor(
    () => Promise.all([snapshot(9422), snapshot(9423)]),
    (values) =>
      JSON.stringify(values[0]) === JSON.stringify(values[1]) &&
      values[0].players.filter(
        (player, index) => player.x !== joined[0].players[index].x
      ).length === 1,
    "canonical player ownership and authoritative movement"
  );

  await closeClient(9423);
  await waitFor(
    async () =>
      (
        await controlRequest("/v1/session")
      ).body.session.connectedPlayers,
    (players) => players.length === 1 && players[0] === "alice",
    "bob disconnect identity cleanup"
  );
  assert.strictEqual(await admissionStatus(bobToken), 409);
  await launchClient(
    "bob",
    9423,
    1,
    signToken({ playerId: "bob", tokenId: "bob-2" })
  );
  await waitFor(
    () => Promise.all([snapshot(9422), snapshot(9423)]),
    (values) =>
      values.every(
        (value) => value.connection === "connected" && value.score === 2
      ),
    "fresh-token reconnect without identity mixing"
  );

  const ended = await controlRequest("/v1/session/end", {
    method: "POST",
    body: { reason: "integration-complete" },
  });
  assert.strictEqual(ended.status, 202);
  const [exitCode] = await once(gameServer, "exit");
  assert.strictEqual(exitCode, 0, serverOutput);

  await waitFor(
    () => Promise.resolve([...logicalEvents.values()]),
    (events) => events.some((event) => event.eventType === "session.ended"),
    "final lifecycle webhook"
  );
  const eventTypes = [...logicalEvents.values()].map(
    (event) => event.eventType
  );
  assert.strictEqual(
    eventTypes.filter((type) => type === "session.started").length,
    1
  );
  assert.strictEqual(
    eventTypes.filter((type) => type === "player.joined").length,
    3
  );
  assert.strictEqual(
    eventTypes.filter((type) => type === "player.left").length,
    3
  );
  assert.strictEqual(
    eventTypes.filter((type) => type === "session.ended").length,
    1
  );
  assert.strictEqual(
    [...logicalEvents.values()].find(
      (event) => event.eventType === "session.ended"
    ).data.playersDrained,
    true
  );
  assert.ok(
    receivedAttempts.length > logicalEvents.size,
    "The injected callback outage did not produce an at-least-once retry."
  );
  assert.ok(retryInjected);

  console.log(
    JSON.stringify(
      {
        admittedPlayers: ["alice", "bob"],
        reconnectPlayer: "bob",
        rejectedAttempts: [
          "missing",
          "expired",
          "wrong-session",
          "wrong-player",
          "replay",
        ],
        webhookAttempts: receivedAttempts.length,
        logicalEvents: logicalEvents.size,
        serverExitCode: exitCode,
      },
      null,
      2
    )
  );
  console.log("M3 authenticated matchmaking bridge check passed.");
})()
  .catch((error) => {
    console.error(error);
    if (serverOutput) console.error(serverOutput);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all([...clients.keys()].map(closeClient));
    if (!gameServer.killed) gameServer.kill();
    callbackServer.close();
    clientServer.close();
  });
