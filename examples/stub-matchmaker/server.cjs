const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const manifestPath = path.resolve(
  process.env.THNK_BUNDLE_MANIFEST || process.argv[2] || ""
);
if (!process.env.THNK_BUNDLE_MANIFEST && !process.argv[2])
  throw new Error(
    "Set THNK_BUNDLE_MANIFEST or pass the exported manifest.json path."
  );
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const port = Number(process.env.THNK_STUB_PORT || 9210);
const publicUrl = new URL(
  process.env.THNK_STUB_PUBLIC_URL || `http://127.0.0.1:${port}`
);
const controlUrl = new URL(
  process.env.THNK_CONTROL_URL || "http://127.0.0.1:9209"
);
const gameServerUrl =
  process.env.THNK_GAME_SERVER_URL || "http://127.0.0.1:9208";
const clientBuild = process.env.THNK_CLIENT_BUILD
  ? path.resolve(process.env.THNK_CLIENT_BUILD)
  : undefined;
const controlToken = process.env.THNK_CONTROL_TOKEN;
const webhookSecret = process.env.THNK_WEBHOOK_SECRET;
const profileToken = process.env.THNK_PLAYER_PROFILE_TOKEN;
for (const [name, value] of Object.entries({
  THNK_CONTROL_TOKEN: controlToken,
  THNK_WEBHOOK_SECRET: webhookSecret,
  THNK_PLAYER_PROFILE_TOKEN: profileToken,
}))
  if (typeof value !== "string" || value.length < 32)
    throw new Error(`${name} must contain at least 32 characters.`);
if (!Number.isInteger(port) || port < 1 || port > 65_535)
  throw new Error("THNK_STUB_PORT must be from 1 to 65535.");

const authorityId =
  process.env.THNK_AUTHORITY_ID || Object.keys(manifest.authorities || {})[0];
if (!manifest.authorities?.[authorityId])
  throw new Error(`Unknown authority '${authorityId}'.`);
const mapId = process.env.THNK_MAP_ID || "";
const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" });
const keyId = `stub-${crypto.randomUUID()}`;
const issuer = "thnk-development-stub";
const audience = "thnk-authority";
const documents = new Map();
const blockedPlayers = new Set(
  String(process.env.THNK_STUB_BLOCKED_PLAYERS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);
const lifecycleEvents = new Map();
let activeSession;

const json = (response, status, body) => {
  const encoded = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": encoded.length,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(encoded);
};

const readBody = (request, limit = 64 * 1024) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    request.on("data", (chunk) => {
      length += chunk.length;
      if (length <= limit) chunks.push(chunk);
    });
    request.on("end", () => {
      if (length > limit) return reject(new Error("request_too_large"));
      try {
        resolve(Buffer.concat(chunks));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });

const readJson = async (request) => {
  const body = await readBody(request);
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new Error("invalid_json");
  }
};

const controlRequest = async (route, body) => {
  const response = await fetch(new URL(route, controlUrl), {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${controlToken}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || `control_http_${response.status}`);
    error.status = response.status;
    throw error;
  }
  return result;
};

const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const signAdmission = (player) => {
  const now = Math.floor(Date.now() / 1_000);
  const header = encode({ alg: "RS256", kid: keyId, typ: "JWT" });
  const payload = encode({
    iss: issuer,
    aud: audience,
    iat: now,
    exp: now + 120,
    jti: crypto.randomUUID(),
    sessionId: activeSession.sessionId,
    playerId: player.playerId,
    tags: player.tags || {},
    gameId: manifest.project.gameId,
    authorityId,
    mapId,
    serverBuildId: manifest.build.serverBuildId,
    compatibilityVersion: manifest.build.compatibilityVersion,
    clientBuildId: manifest.build.clientBuildId,
    protocolVersion: manifest.build.protocolVersion,
  });
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${crypto
    .sign("RSA-SHA256", Buffer.from(unsigned), keys.privateKey)
    .toString("base64url")}`;
};

const authorizedProfileRequest = (request) =>
  request.headers.authorization === `Bearer ${profileToken}`;

const contentTypes = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".wasm": "application/wasm",
};

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, publicUrl);
  try {
    if (request.method === "GET" && url.pathname === "/health/live")
      return json(response, 200, { status: "live" });

    const play = /^\/play\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
    if (request.method === "GET" && play && clientBuild) {
      const player = activeSession?.players.find(
        (candidate) => candidate.playerId === decodeURIComponent(play[1])
      );
      if (!player) return json(response, 404, { error: "player_not_rostered" });
      const relativePath = play[2] || "index.html";
      const filePath = path.resolve(clientBuild, relativePath);
      if (
        filePath !== clientBuild &&
        !filePath.startsWith(`${clientBuild}${path.sep}`)
      )
        return json(response, 403, { error: "invalid_path" });
      let contents = fs.readFileSync(filePath);
      if (relativePath === "index.html") {
        const injection = `<script>window.THNK_ADMISSION_TOKEN=${JSON.stringify(
          signAdmission(player)
        )};</script>`;
        contents = Buffer.from(
          contents.toString("utf8").replace("<head>", `<head>${injection}`)
        );
      }
      response.writeHead(200, {
        "content-type":
          contentTypes[path.extname(filePath)] || "application/octet-stream",
        "content-length": contents.length,
        "cache-control": "no-store",
      });
      return response.end(contents);
    }

    if (request.method === "POST" && url.pathname === "/start") {
      if (activeSession)
        return json(response, 409, { error: "session_active" });
      const input = await readJson(request);
      if (!Array.isArray(input.players) || input.players.length < 1)
        return json(response, 400, { error: "players_required" });
      const players = input.players.map((player) =>
        typeof player === "string"
          ? { playerId: player, tags: {} }
          : { playerId: player.playerId, tags: player.tags || {} }
      );
      activeSession = {
        sessionId: input.sessionId || `stub-${crypto.randomUUID()}`,
        players,
      };
      try {
        const result = await controlRequest("/v1/session", {
          sessionId: activeSession.sessionId,
          gameId: manifest.project.gameId,
          authorityId,
          mapId,
          serverBuildId: manifest.build.serverBuildId,
          compatibilityVersion: manifest.build.compatibilityVersion,
          clientBuildId: manifest.build.clientBuildId,
          protocolVersion: manifest.build.protocolVersion,
          players,
          callbackUrl: new URL("/events", publicUrl).toString(),
          tokenVerification: {
            publicKey,
            keyId,
            issuer,
            audience,
            algorithm: "RS256",
          },
        });
        return json(response, 201, {
          session: result.session,
          join: players.map(({ playerId }) => ({
            playerId,
            url: new URL(
              clientBuild
                ? `/play/${encodeURIComponent(playerId)}/`
                : `/join?playerId=${encodeURIComponent(playerId)}`,
              publicUrl
            ),
          })),
        });
      } catch (error) {
        activeSession = undefined;
        throw error;
      }
    }

    if (request.method === "GET" && url.pathname === "/join") {
      const player = activeSession?.players.find(
        (candidate) => candidate.playerId === url.searchParams.get("playerId")
      );
      if (!player) return json(response, 404, { error: "player_not_rostered" });
      return json(response, 200, {
        sessionId: activeSession.sessionId,
        playerId: player.playerId,
        gameServerUrl,
        admissionToken: signAdmission(player),
        expiresInSeconds: 120,
      });
    }

    if (request.method === "POST" && url.pathname === "/end") {
      if (!activeSession)
        return json(response, 409, { error: "session_not_active" });
      const result = await controlRequest("/v1/session/end", {
        reason: "stub_requested",
      });
      activeSession = undefined;
      return json(response, 202, result);
    }

    if (request.method === "GET" && url.pathname === "/state")
      return json(response, 200, {
        session: activeSession,
        lifecycleEvents: [...lifecycleEvents.values()],
        documents: Object.fromEntries(documents),
        blockedPlayers: [...blockedPlayers],
      });

    if (request.method === "POST" && url.pathname === "/events") {
      const body = await readBody(request);
      const expected = `sha256=${crypto
        .createHmac("sha256", webhookSecret)
        .update(body)
        .digest("hex")}`;
      const actual = request.headers["x-thnk-signature"];
      if (
        typeof actual !== "string" ||
        actual.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
      )
        return json(response, 401, { error: "invalid_signature" });
      const event = JSON.parse(body.toString("utf8"));
      if (request.headers["x-thnk-event-id"] !== event.eventId)
        return json(response, 400, { error: "event_id_mismatch" });
      lifecycleEvents.set(event.eventId, event);
      return response.writeHead(204).end();
    }

    const profile = /^\/internal\/players\/([^/]+)\/(blocked|document)$/.exec(
      url.pathname
    );
    if (profile) {
      if (!authorizedProfileRequest(request))
        return json(response, 401, { error: "unauthorized" });
      const playerId = decodeURIComponent(profile[1]);
      if (profile[2] === "blocked" && request.method === "GET")
        return json(response, 200, { blocked: blockedPlayers.has(playerId) });
      if (profile[2] === "document" && request.method === "GET")
        return json(response, 200, {
          document: documents.get(playerId) || { progression: { xp: 0 } },
        });
      if (profile[2] === "document" && request.method === "PUT") {
        const body = await readJson(request);
        documents.set(playerId, body.document);
        return response.writeHead(204).end();
      }
      return json(response, 405, { error: "method_not_allowed" });
    }

    return json(response, 404, { error: "not_found" });
  } catch (error) {
    const code = /^[a-z0-9_]+$/.test(error.message || "")
      ? error.message
      : "internal_error";
    return json(response, error.status || 500, {
      error: code,
    });
  }
});

server.listen(port, "127.0.0.1", () =>
  console.log(
    JSON.stringify({
      event: "stub.ready",
      url: publicUrl.toString(),
      authorityId,
      manifest: manifestPath,
    })
  )
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
