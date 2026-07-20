const assert = require("assert");
const crypto = require("crypto");
const { once } = require("events");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { evaluate, sendCommand } = require("../m1/inspect-runtime");

const repositoryRoot = path.resolve(__dirname, "../..");
const m4Check = process.env.THNK_M4_CHECK === "true";
const m5Check = process.env.THNK_M5_CHECK === "true";
const m7Check = process.env.THNK_M7_CHECK === "true";
const m6Check = m7Check || process.env.THNK_M6_CHECK === "true";
const liveAgora = process.env.THNK_M4_LIVE === "true";
const milestone = m7Check
  ? "M7"
  : m6Check
  ? "M6"
  : m5Check
  ? "M5"
  : m4Check
  ? "M4"
  : "M3";
const voiceCheck = m4Check || m6Check;
const bundlePath = path.resolve(
  process.env.THNK_TEST_BUNDLE ||
    path.join(repositoryRoot, ".generated/m2/server-bundle")
);
const clientBuild = path.resolve(
  process.env.THNK_TEST_CLIENT_BUILD ||
    path.join(repositoryRoot, ".generated/m1/client/build")
);
const generatedRoot = path.join(
  repositoryRoot,
  m7Check
    ? ".generated/m7/integration-clients"
    : m6Check
    ? ".generated/m6"
    : m5Check
    ? ".generated/m5/integration-clients"
    : m4Check
    ? ".generated/m4"
    : ".generated/m3"
);
const chromePath =
  process.env.CHROME_BIN ||
  "C:/Program Files/Google/Chrome/Application/chrome.exe";
const controlToken = "m3-control-token-for-local-integration-only";
const webhookSecret = "m3-webhook-secret-for-local-integration-only";
const controlUrl = "http://127.0.0.1:9209";
const gameUrl = "http://127.0.0.1:9208/.wrtc/v2/connections";
const callbackPort = 9210;
const profilePort = 9212;
const clientPort = 8080;
const clients = new Map();
const receivedAttempts = [];
const logicalEvents = new Map();
const profileDocuments = new Map([
  ["alice", { progression: { xp: 7 } }],
  ["bob", { progression: { xp: 7 } }],
  ["probe", { progression: { xp: 7 } }],
]);
const profileLoads = new Map();
const profileWrites = [];
const profileToken = "m6-player-profile-service-token-only";
const agoraAppId = process.env.AGORA_APP_ID || "a".repeat(32);
const agoraAppCertificate = process.env.AGORA_APP_CERTIFICATE || "b".repeat(32);
let retryInjected = false;

if (!fs.existsSync(path.join(bundlePath, "manifest.json")))
  throw new Error("Run yarn fixture:m2:export before the M3 check.");
if (!fs.existsSync(path.join(clientBuild, "index.html")))
  throw new Error("Run yarn fixture:m1:export-client before the M3 check.");
if (!fs.existsSync(chromePath))
  throw new Error(`Chrome executable not found: ${chromePath}`);

const manifest = JSON.parse(
  fs.readFileSync(path.join(bundlePath, "manifest.json"), "utf8")
);
const authorityId =
  process.env.THNK_AUTHORITY_ID || Object.keys(manifest.authorities || {})[0];
const mapId = process.env.THNK_MAP_ID || "";
const assignmentIdentity = Object.freeze({
  gameId: manifest.project.gameId,
  authorityId,
  ...(mapId ? { mapId } : {}),
  serverBuildId: manifest.build.serverBuildId,
  compatibilityVersion: manifest.build.compatibilityVersion,
  clientBuildId: manifest.build.clientBuildId,
  protocolVersion: manifest.build.protocolVersion,
});
const signedTags = m5Check ? { team: "signed-team" } : {};

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const directoryContains = (directory, value) => {
  const needle = Buffer.from(value);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (directoryContains(entryPath, value)) return true;
    } else if (entry.isFile() && fs.readFileSync(entryPath).includes(needle))
      return true;
  }
  return false;
};

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
  const safeValue = JSON.stringify(value, (key, entry) =>
    /token|secret|certificate|authorization|capability/i.test(key)
      ? "[redacted]"
      : entry
  );
  throw new Error(`Timed out waiting for ${description}: ${safeValue}`);
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
      ...assignmentIdentity,
      tags: signedTags,
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
      JSON.stringify({ document: profileDocuments.get(playerId) || {} })
    );
  }
  if (match[2] === "document" && request.method === "PUT") {
    const body = JSON.parse((await readBody(request)).toString("utf8"));
    profileDocuments.set(playerId, structuredClone(body.document));
    profileWrites.push({ playerId, ...body });
    return response.writeHead(204).end();
  }
  response.writeHead(405).end();
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
    `(async () => {
      const scene = window.__thnkRuntimeScene;
      const voice = window.THNK?.voice;
      const voiceGrant = voice?.grant;
      const capabilityBytes = voiceGrant?.refreshCapability
        ? await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(voiceGrant.refreshCapability)
          )
        : undefined;
      const refreshCapabilityFingerprint = capabilityBytes
        ? Array.from(new Uint8Array(capabilityBytes))
            .map(byte => byte.toString(16).padStart(2, "0"))
            .join("")
        : undefined;
      return {
        admissionTokenCleared: !("THNK_ADMISSION_TOKEN" in window),
        connection: window.THNK?.client?.getConnectionState?.(),
        score: scene?.getVariables().get("State").getChild("Score").getAsNumber(),
        lastTeam: scene?.getVariables().get("State").getChild("LastTeam").getAsString(),
        lastProfileXP: scene?.getVariables().get("State").getChild("LastProfileXP").getAsNumber(),
        players: (scene?.getObjects("Player") || []).map(player => ({
          id: player.thnkID,
          x: player.getX()
        })).sort((left, right) => left.id - right.id),
        voice: {
          state: voice?.getConnectionState?.(),
          error: voice?.getLastError?.(),
          channel: voiceGrant?.channel,
          uid: voiceGrant?.uid,
          refreshCapabilityFingerprint,
          localTrackPublished: Boolean(voice?.localTrack),
          remoteAudioUsers: voice?.remoteUsers?.size || 0
        }
      };
    })()`
  );

const gameplaySnapshot = ({ voice: _voice, ...gameplay }) => gameplay;

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
      ...(liveAgora
        ? [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            "--autoplay-policy=no-user-gesture-required",
          ]
        : []),
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
  THNK_AUTHORITY_ID: authorityId,
  THNK_MAP_ID: mapId,
  THNK_EXPECTED_SERVER_BUILD_ID: manifest.build.serverBuildId,
});
if (m4Check)
  Object.assign(serverEnvironment, {
    THNK_VOICE_ENABLED: "true",
    AGORA_APP_ID: agoraAppId,
    AGORA_APP_CERTIFICATE: agoraAppCertificate,
    THNK_VOICE_TOKEN_URL: `${controlUrl}/v1/voice/token`,
    THNK_ALLOW_INSECURE_VOICE_TOKEN_URL: "true",
  });
if (m6Check)
  Object.assign(serverEnvironment, {
    THNK_VOICE_ENABLED: "true",
    THNK_PLAYER_PROFILE_URL: `http://127.0.0.1:${profilePort}/`,
    THNK_PLAYER_PROFILE_TOKEN: profileToken,
    THNK_ALLOW_INSECURE_PLAYER_PROFILE_URL: "true",
  });
if (m6Check) {
  delete serverEnvironment.AGORA_APP_ID;
  delete serverEnvironment.AGORA_APP_CERTIFICATE;
  delete serverEnvironment.THNK_VOICE_TOKEN_URL;
}
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
  if (m6Check) profileServer.listen(profilePort, "127.0.0.1");
  await Promise.all([
    once(callbackServer, "listening"),
    once(clientServer, "listening"),
    ...(m6Check ? [once(profileServer, "listening")] : []),
  ]);

  await waitFor(
    () => fetch(`${controlUrl}/health/live`),
    (response) => response.ok,
    `${milestone} control API`
  );
  const baseSessionInput = {
    sessionId: "m3-session",
    ...assignmentIdentity,
    players: ["alice", "bob", "probe"].map((playerId) => ({
      playerId,
      tags: signedTags,
    })),
    callbackUrl: `http://127.0.0.1:${callbackPort}/events`,
    reconnectPolicy: "fresh-token",
    metadata: { fixture: milestone.toLowerCase() },
    tokenVerification: {
      publicKey,
      keyId: "m3-key",
      issuer: "m3-stub-matchmaker",
      audience: "m3-fixture-server",
      algorithm: "RS256",
    },
    ...(m6Check
      ? {
          voiceGrants: Object.fromEntries(
            ["alice", "bob", "probe"].map((playerId) => [
              playerId,
              {
                appId: "a".repeat(32),
                channel: "m6-external-session",
                uid: `m6-${playerId}`,
                token: `m6-${playerId}-${"t".repeat(32)}`,
                expiresAt: new Date(Date.now() + 240_000).toISOString(),
                refreshUrl: `https://voice.invalid/${playerId}/refresh`,
                refreshCapability: crypto
                  .createHash("sha256")
                  .update(`m6-${playerId}`)
                  .digest("base64url"),
                refreshOwner: "matchmaker",
              },
            ])
          ),
        }
      : {}),
  };
  if (m6Check) {
    const blocked = await controlRequest("/v1/session", {
      method: "POST",
      body: {
        ...baseSessionInput,
        players: [{ playerId: "blocked-player", tags: signedTags }],
        voiceGrants: {
          "blocked-player": {
            ...baseSessionInput.voiceGrants.alice,
            uid: "m6-blocked-player",
          },
        },
      },
    });
    assert.strictEqual(blocked.status, 403);
    assert.strictEqual(blocked.body.error, "player_blocked");
    assert.ok(!serverOutput.includes("THNK_SERVER_READY"));
    assert.ok(!serverOutput.includes("THNK_AUTHORITY_SCENE_STARTED"));
  }
  const session = await controlRequest("/v1/session", {
    method: "POST",
    body: baseSessionInput,
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
          (!m5Check || value.lastTeam === "signed-team") &&
          (!m6Check || value.lastProfileXP === 8) &&
          value.admissionTokenCleared
      ),
    "two admitted clients to converge"
  );
  assert.deepStrictEqual(
    gameplaySnapshot(joined[0]),
    gameplaySnapshot(joined[1])
  );
  let initialBobVoice;
  if (voiceCheck) {
    const voiceReady = await waitFor(
      () => Promise.all([snapshot(9422), snapshot(9423)]),
      (values) => values.every((value) => value.voice.channel),
      "two isolated voice grants"
    );
    assert.strictEqual(
      voiceReady[0].voice.channel,
      voiceReady[1].voice.channel
    );
    assert.notStrictEqual(voiceReady[0].voice.uid, voiceReady[1].voice.uid);
    assert.notStrictEqual(
      voiceReady[0].voice.refreshCapabilityFingerprint,
      voiceReady[1].voice.refreshCapabilityFingerprint
    );
    assert.ok(
      !directoryContains(clientBuild, agoraAppCertificate),
      "The Agora App Certificate appeared in the client export."
    );
    if (m4Check) {
      await delay(5_100);
      const refresh = await evaluate(
        9422,
        `(async () => {
        const grant = window.THNK.voice.grant;
        const response = await fetch(grant.refreshUrl, {
          method: "POST",
          headers: { authorization: "Bearer " + grant.refreshCapability }
        });
        const body = await response.json();
        return {
          status: response.status,
          channelMatches: body.channel === grant.channel,
          uidMatches: body.uid === grant.uid,
          hasToken: typeof body.token === "string" && body.token.length > 16,
          hasCertificate: JSON.stringify(body).includes(${JSON.stringify(
            agoraAppCertificate
          )})
        };
      })()`
      );
      assert.deepStrictEqual(refresh, {
        status: 200,
        channelMatches: true,
        uidMatches: true,
        hasToken: true,
        hasCertificate: false,
      });
    }
    initialBobVoice = voiceReady[1].voice;
    if (liveAgora) {
      await waitFor(
        () => Promise.all([snapshot(9422), snapshot(9423)]),
        (values) =>
          values.every(
            (value) =>
              value.connection === "connected" &&
              value.voice.state === "CONNECTED" &&
              value.voice.localTrackPublished &&
              value.voice.remoteAudioUsers === 1
          ),
        "two-way Agora audio publication and subscription",
        90_000
      );
      const localControls = await evaluate(
        9422,
        `(() => {
          THNK.voice.setRemoteVolume("bob", 37);
          THNK.voice.setRemoteMuted("bob", true);
          void THNK.voice.setSelfMuted(true);
          return {
            remoteMuted: THNK.voice.isRemoteMuted("bob"),
            selfMuted: THNK.voice.isSelfMuted(),
            gameplay: THNK.client.getConnectionState()
          };
        })()`
      );
      assert.deepStrictEqual(localControls, {
        remoteMuted: true,
        selfMuted: true,
        gameplay: "connected",
      });
      await evaluate(
        9422,
        `(async () => {
          await THNK.voice.setSelfMuted(false);
          THNK.voice.setRemoteMuted("bob", false);
        })()`
      );
      await evaluate(9422, "THNK.voice.leave()");
      await waitFor(
        () => Promise.all([snapshot(9422), snapshot(9423)]),
        (values) =>
          values[0].connection === "connected" &&
          values[0].voice.state === "DISCONNECTED" &&
          values[1].connection === "connected" &&
          values[1].voice.remoteAudioUsers === 0,
        "voice-only leave without gameplay disconnect",
        60_000
      );
      await evaluate(9422, "THNK.voice.join()");
      await waitFor(
        () => Promise.all([snapshot(9422), snapshot(9423)]),
        (values) =>
          values.every(
            (value) =>
              value.connection === "connected" &&
              value.voice.state === "CONNECTED" &&
              value.voice.remoteAudioUsers === 1
          ),
        "voice rejoin and resumed audio exchange",
        90_000
      );
    }
  }
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
      JSON.stringify(gameplaySnapshot(values[0])) ===
        JSON.stringify(gameplaySnapshot(values[1])) &&
      values[0].players.filter(
        (player, index) => player.x !== joined[0].players[index].x
      ).length === 1,
    "canonical player ownership and authoritative movement"
  );
  if (m6Check) {
    await setKey(9422, true, 32);
    await delay(250);
    await setKey(9422, false, 32);
    await waitFor(
      () =>
        Promise.resolve(
          [...logicalEvents.values()].filter(
            (event) => event.eventType === "trust.violation"
          )
        ),
      (events) => events.length === 1,
      "one signed trust violation webhook"
    );
  }

  await closeClient(9423);
  const rejoined = await waitFor(
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
  if (voiceCheck) {
    const rejoinedVoice = await waitFor(
      () => snapshot(9423),
      (value) => Boolean(value.voice.channel),
      "Bob reconnect voice grant"
    );
    assert.strictEqual(rejoinedVoice.voice.channel, initialBobVoice.channel);
    assert.strictEqual(rejoinedVoice.voice.uid, initialBobVoice.uid);
    if (m4Check)
      assert.notStrictEqual(
        rejoinedVoice.voice.refreshCapabilityFingerprint,
        initialBobVoice.refreshCapabilityFingerprint
      );
    else
      assert.strictEqual(
        rejoinedVoice.voice.refreshCapabilityFingerprint,
        initialBobVoice.refreshCapabilityFingerprint
      );
    assert.ok(
      ["JOINING", "CONNECTED", "CONNECTED_LISTEN_ONLY", "FAILED"].includes(
        rejoinedVoice.voice.state
      ),
      `Unexpected voice state after reconnect: ${rejoinedVoice.voice.state}`
    );
  }

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
  if (m6Check) {
    assert.strictEqual(
      [...logicalEvents.values()].filter(
        (event) => event.eventType === "trust.violation"
      ).length,
      1
    );
    assert.ok(profileWrites.length >= 2);
    assert.strictEqual(profileDocuments.get("alice").progression.xp, 8);
    assert.strictEqual(profileDocuments.get("bob").progression.xp, 8);
    assert.ok((profileLoads.get("bob") || 0) >= 2);
  }
  assert.ok(retryInjected);
  assert.ok(
    !serverOutput.includes(agoraAppCertificate),
    "The Agora App Certificate appeared in server logs."
  );

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
        ...(voiceCheck
          ? {
              voiceChannelShared: true,
              voiceUsersDistinct: true,
              voiceRefreshPassed: m4Check,
              externalVoiceGrantDeliveredWithoutLocalCredentials: m6Check,
              reconnectVoiceUidStable: true,
              reconnectCapabilityRotated: m4Check,
              agoraOutageGameplayUnaffected: true,
              ...(liveAgora
                ? {
                    liveAgoraAudioExchanged: true,
                    liveMuteVolumePassed: true,
                    liveVoiceLeaveRejoinPassed: true,
                  }
                : {}),
            }
          : {}),
      },
      null,
      2
    )
  );
  console.log(`${milestone} authenticated matchmaking/voice check passed.`);
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
    profileServer.close();
  });
