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
const controlToken = "m6-linux-control-token-for-runtime-check";
const webhookSecret = "m6-linux-webhook-secret-for-runtime-check";
const profileToken = "m6-linux-profile-service-token-check";
const authorityId = "duel";
const documents = new Map([["alice", { progression: { xp: 7 } }]]);
let profileLoads = 0;
const events = [];

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const waitFor = async (read, predicate, description, timeout = 45_000) => {
  const deadline = Date.now() + timeout;
  let value;
  do {
    try {
      value = await read();
      if (predicate(value)) return value;
    } catch {}
    await delay(150);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${description}: ${String(value)}`);
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
    profileLoads++;
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
  channel: "m6-linux-external",
  uid: `m6-${playerId}`,
  token: `m6-${playerId}-${"t".repeat(32)}`,
  expiresAt: new Date(Date.now() + 240_000).toISOString(),
  refreshUrl: `https://voice.invalid/${playerId}/refresh`,
  refreshCapability: crypto
    .createHash("sha256")
    .update(`m6-${playerId}`)
    .digest("base64url"),
  refreshOwner: "matchmaker",
});
const sessionInput = (playerId) => ({
  sessionId: "m6-linux-session",
  ...identity,
  players: [playerId],
  voiceGrants: { [playerId]: voiceGrant(playerId) },
  callbackUrl: `http://127.0.0.1:${callbackPort}/events`,
  tokenVerification: {
    publicKey,
    keyId: "m6-linux-key",
    issuer: "m6-linux-matchmaker",
    audience: "m6-linux-server",
    algorithm: "RS256",
  },
});
const signToken = () => {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: "m6-linux-key", typ: "JWT" })
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: "m6-linux-matchmaker",
      aud: "m6-linux-server",
      sessionId: "m6-linux-session",
      playerId: "alice",
      jti: "m6-linux-token",
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
const controlRequest = async (route, body) => {
  const response = await fetch(`${controlUrl}${route}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${controlToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

const environment = {
  ...process.env,
  THNK_BRIDGE_ENABLED: "true",
  THNK_CONTROL_HOST: "127.0.0.1",
  THNK_CONTROL_PORT: "9209",
  THNK_CONTROL_TOKEN: controlToken,
  THNK_WEBHOOK_SECRET: webhookSecret,
  THNK_ALLOW_INSECURE_CALLBACKS: "true",
  THNK_AUTHORITY_ID: authorityId,
  THNK_EXPECTED_SERVER_BUILD_ID: manifest.build.serverBuildId,
  THNK_VOICE_ENABLED: "true",
  THNK_PLAYER_PROFILE_URL: `http://127.0.0.1:${profilePort}/`,
  THNK_PLAYER_PROFILE_TOKEN: profileToken,
  THNK_ALLOW_INSECURE_PLAYER_PROFILE_URL: "true",
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
    "Linux M6 supervisor"
  );
  const blocked = await controlRequest(
    "/v1/session",
    sessionInput("blocked-player")
  );
  assert.deepStrictEqual(blocked, {
    status: 403,
    body: { error: "player_blocked" },
  });
  assert.ok(!output.includes("THNK_SERVER_READY"));
  assert.ok(!output.includes("THNK_AUTHORITY_SCENE_STARTED"));

  const created = await controlRequest("/v1/session", sessionInput("alice"));
  assert.strictEqual(created.status, 201, JSON.stringify(created.body));
  assert.ok(!JSON.stringify(created.body).includes(voiceGrant("alice").token));
  await waitFor(
    () => Promise.resolve(output),
    (value) =>
      value.includes("THNK_SERVER_READY") &&
      value.includes("THNK_AUTHORITY_SCENE_STARTED duel"),
    "Linux M6 Duel authority"
  );
  const admission = await fetch("http://127.0.0.1:9208/.wrtc/v2/connections", {
    method: "POST",
    headers: { authorization: `Bearer ${signToken()}` },
  });
  assert.strictEqual(admission.status, 200);
  assert.strictEqual(profileLoads, 1);

  const ended = await controlRequest("/v1/session/end", {
    reason: "m6-linux-complete",
  });
  assert.strictEqual(ended.status, 202);
  const [exitCode] = await once(server, "exit");
  assert.strictEqual(exitCode, 0, output);
  await waitFor(
    () => Promise.resolve(events),
    (items) => items.some((event) => event.eventType === "session.ended"),
    "Linux M6 final webhook"
  );
  assert.ok(!output.includes(profileToken));
  console.log(
    JSON.stringify(
      {
        blockedBeforeGDevelop: true,
        authority: "duel",
        playerDocumentLoaded: true,
        externalVoiceWithoutLocalAgoraCredentials: true,
        serverExitCode: exitCode,
        serverBuildId: manifest.build.serverBuildId,
      },
      null,
      2
    )
  );
  console.log("M6 Ubuntu/Xvfb cross-service gate passed.");
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
