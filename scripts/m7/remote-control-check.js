const assert = require("assert");
const crypto = require("crypto");
const { once } = require("events");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const bundlePath = path.resolve(process.argv[2] || process.cwd());
const manifest = JSON.parse(
  fs.readFileSync(path.join(bundlePath, "manifest.json"), "utf8")
);
const controlUrl = "http://127.0.0.1:9209";
const profilePort = 9212;
const callbackPort = 9210;
const controlToken = "m7-linux-control-token-for-runtime-check";
const webhookSecret = "m7-linux-webhook-secret-for-runtime-check";
const profileToken = "m7-linux-profile-service-token-check";
const authorityId = "duel";
const players = ["alice", "bob"];
const documents = new Map(
  players.map((playerId) => [playerId, { progression: { xp: 7 } }])
);
const profileLoads = new Map();
const events = [];

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
  throw new Error(`Timed out waiting for ${description}.`);
};
const readBody = (request) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });

const profileServer = http.createServer(async (request, response) => {
  if (request.headers.authorization !== `Bearer ${profileToken}`)
    return response.writeHead(401).end();
  const url = new URL(request.url, `http://127.0.0.1:${profilePort}`);
  const match = /^\/internal\/players\/([^/]+)\/(blocked|document)$/.exec(
    url.pathname
  );
  if (!match) return response.writeHead(404).end();
  const playerId = decodeURIComponent(match[1]);
  if (match[2] === "blocked" && request.method === "GET") {
    response.writeHead(200, { "content-type": "application/json" });
    return response.end(
      JSON.stringify({ blocked: playerId === "blocked-player" })
    );
  }
  if (match[2] === "document" && request.method === "GET") {
    profileLoads.set(playerId, (profileLoads.get(playerId) || 0) + 1);
    response.writeHead(200, { "content-type": "application/json" });
    return response.end(
      JSON.stringify({ document: documents.get(playerId) || {} })
    );
  }
  if (match[2] === "document" && request.method === "PUT") {
    const body = JSON.parse((await readBody(request)).toString("utf8"));
    documents.set(playerId, body.document);
    return response.writeHead(204).end();
  }
  response.writeHead(405).end();
});

const callbackServer = http.createServer(async (request, response) => {
  const body = await readBody(request);
  const expected = `sha256=${crypto
    .createHmac("sha256", webhookSecret)
    .update(body)
    .digest("hex")}`;
  assert.strictEqual(request.headers["x-thnk-signature"], expected);
  events.push(JSON.parse(body.toString("utf8")));
  response.writeHead(204).end();
});

const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" });
const identity = {
  gameId: manifest.project.gameId,
  authorityId,
  serverBuildId: manifest.build.serverBuildId,
  compatibilityVersion: manifest.build.compatibilityVersion,
  clientBuildId: manifest.build.clientBuildId,
  protocolVersion: manifest.build.protocolVersion,
};
const voiceGrant = (playerId) => ({
  appId: "a".repeat(32),
  channel: "m7-linux-external",
  uid: `m7-${playerId}`,
  token: `m7-${playerId}-${"t".repeat(32)}`,
  expiresAt: new Date(Date.now() + 240_000).toISOString(),
  refreshUrl: `https://voice.invalid/${playerId}/refresh`,
  refreshCapability: crypto
    .createHash("sha256")
    .update(`m7-${playerId}`)
    .digest("base64url"),
  refreshOwner: "matchmaker",
});
const sessionInput = (roster) => ({
  sessionId: "m7-linux-session",
  ...identity,
  players: roster,
  voiceGrants: Object.fromEntries(
    roster.map((playerId) => [playerId, voiceGrant(playerId)])
  ),
  callbackUrl: `http://127.0.0.1:${callbackPort}/events`,
  tokenVerification: {
    publicKey,
    keyId: "m7-linux-key",
    issuer: "m7-linux-matchmaker",
    audience: "m7-linux-server",
    algorithm: "RS256",
  },
});
const signToken = (playerId, tokenId) => {
  const now = Math.floor(Date.now() / 1_000);
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: "m7-linux-key", typ: "JWT" })
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: "m7-linux-matchmaker",
      aud: "m7-linux-server",
      sessionId: "m7-linux-session",
      playerId,
      jti: tokenId,
      iat: now,
      exp: now + 120,
      tags: {},
      ...identity,
    })
  ).toString("base64url");
  const message = `${header}.${payload}`;
  return `${message}.${crypto
    .sign("RSA-SHA256", Buffer.from(message), keys.privateKey)
    .toString("base64url")}`;
};
const request = async (route, { method = "GET", body, authorized = true } = {}) => {
  const response = await fetch(`${controlUrl}${route}`, {
    method,
    headers: {
      ...(authorized ? { authorization: `Bearer ${controlToken}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

const environment = {
  ...process.env,
  THNK_BRIDGE_ENABLED: "true",
  THNK_CONTROL_HOST: "127.0.0.1",
  THNK_CONTROL_PORT: "9209",
  THNK_CONTROL_TOKEN: controlToken,
  THNK_CONTROL_RATE_LIMIT_PER_MINUTE: "80",
  THNK_WEBHOOK_SECRET: webhookSecret,
  THNK_ALLOW_INSECURE_CALLBACKS: "true",
  THNK_AUTHORITY_ID: authorityId,
  THNK_EXPECTED_SERVER_BUILD_ID: manifest.build.serverBuildId,
  THNK_VOICE_ENABLED: "true",
  THNK_PLAYER_PROFILE_URL: `http://127.0.0.1:${profilePort}/`,
  THNK_PLAYER_PROFILE_TOKEN: profileToken,
  THNK_ALLOW_INSECURE_PLAYER_PROFILE_URL: "true",
  THNK_LOG_LEVEL: "info",
};
delete environment.AGORA_APP_ID;
delete environment.AGORA_APP_CERTIFICATE;
delete environment.THNK_VOICE_TOKEN_URL;

const server = spawn(
  "xvfb-run",
  [
    "-a",
    "--server-args=-screen 0 1024x768x24",
    path.join(bundlePath, "node_modules/.bin/electron"),
    ".",
  ],
  { cwd: bundlePath, env: environment, stdio: ["ignore", "pipe", "pipe"] }
);
let output = "";
for (const stream of [server.stdout, server.stderr])
  stream.on("data", (chunk) => (output += chunk.toString()));

(async () => {
  profileServer.listen(profilePort, "127.0.0.1");
  callbackServer.listen(callbackPort, "127.0.0.1");
  await Promise.all([
    once(profileServer, "listening"),
    once(callbackServer, "listening"),
  ]);
  await waitFor(
    () => fetch(`${controlUrl}/health/live`),
    (response) => response.ok,
    "M7 Linux supervisor"
  );
  const waiting = await request("/health/ready", { authorized: false });
  assert.strictEqual(waiting.status, 503);
  assert.strictEqual(waiting.body.checks.session, "absent");

  const blocked = await request("/v1/session", {
    method: "POST",
    body: sessionInput(["blocked-player"]),
  });
  assert.deepStrictEqual(blocked, {
    status: 403,
    body: { error: "player_blocked" },
  });
  assert.ok(!output.includes("THNK_SERVER_READY"));

  const created = await request("/v1/session", {
    method: "POST",
    body: sessionInput(players),
  });
  assert.strictEqual(created.status, 201, JSON.stringify(created.body));
  await waitFor(
    () => request("/health/ready", { authorized: false }),
    (result) => result.status === 200 && result.body.checks.authority === "ready",
    "M7 Linux readiness checks"
  );

  for (const playerId of players) {
    const response = await fetch("http://127.0.0.1:9208/.wrtc/v2/connections", {
      method: "POST",
      headers: { authorization: `Bearer ${signToken(playerId, `${playerId}-1`)}` },
    });
    assert.strictEqual(response.status, 200);
  }
  assert.deepStrictEqual(Object.fromEntries(profileLoads), { alice: 1, bob: 1 });

  const oversized = await request("/v1/session", {
    method: "POST",
    body: { padding: "x".repeat(65 * 1024) },
  });
  assert.deepStrictEqual(oversized, {
    status: 413,
    body: { error: "request_too_large" },
  });

  const healthStatuses = await Promise.all(
    Array.from({ length: 82 }, async () =>
      (await fetch(`${controlUrl}/health/live`)).status
    )
  );
  assert.ok(healthStatuses.includes(429));

  const ended = await request("/v1/session/end", {
    method: "POST",
    body: { reason: "m7-linux-complete" },
  });
  assert.strictEqual(ended.status, 202);
  const [exitCode] = await once(server, "exit");
  assert.strictEqual(exitCode, 0, output);
  await waitFor(
    () => Promise.resolve(events),
    (items) => items.some((event) => event.eventType === "session.ended"),
    "M7 Linux final webhook"
  );

  assert.ok(!output.includes(controlToken));
  assert.ok(!output.includes(webhookSecret));
  assert.ok(!output.includes(profileToken));
  const records = output
    .split(/\r?\n/)
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));
  assert.ok(records.some((record) => record.event === "session.created"));
  assert.deepStrictEqual(
    new Set(
      records
        .filter((record) => record.event === "player.admission_authorized")
        .map((record) => record.playerId)
    ),
    new Set(players)
  );
  assert.ok(records.some((record) => record.eventId));

  console.log(
    JSON.stringify(
      {
        blockedBeforeGDevelop: true,
        admittedPlayers: players,
        readinessChecks: true,
        oversizedPayloadRejected: true,
        rateLimitObserved: true,
        structuredLogsRedacted: true,
        externalVoiceWithoutLocalCredentials: true,
        serverExitCode: exitCode,
        serverBuildId: manifest.build.serverBuildId,
      },
      null,
      2
    )
  );
  console.log("M7 Ubuntu/Xvfb operational gate passed.");
})()
  .catch((error) => {
    console.error(error);
    if (output) console.error(output);
    process.exitCode = 1;
  })
  .finally(() => {
    if (server.exitCode === null) server.kill();
    profileServer.close();
    callbackServer.close();
  });
