const { once } = require("events");
const {
  createControlServer,
} = require("../../scripts/m2/runtime/control-server.cjs");
const {
  SessionManager,
} = require("../../scripts/m2/runtime/session-manager.cjs");
const crypto = require("crypto");

const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" });
const controlToken = "control-token-that-is-at-least-32-characters";
let server;

afterEach(async () => {
  if (!server) return;
  const closed = once(server, "close");
  server.close();
  server.closeAllConnections?.();
  await closed;
  server = undefined;
});

const request = async (baseUrl, path, { method = "GET", token, body } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
};

test("serves authenticated one-session control lifecycle and health", async () => {
  let endDrain;
  const manager = new SessionManager({
    enabled: true,
    webhookSecret: "w".repeat(32),
    allowInsecureCallbacks: true,
    fetchImpl: async () => ({ ok: true, status: 204 }),
  });
  manager.setGameReady();
  server = createControlServer({
    sessionManager: manager,
    controlToken,
    onSessionEnd: (drain) => {
      endDrain = drain;
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  await expect(request(baseUrl, "/health/live")).resolves.toEqual({
    status: 200,
    body: { status: "live" },
  });
  await expect(request(baseUrl, "/health/ready")).resolves.toEqual({
    status: 503,
    body: { status: "not_ready" },
  });
  await expect(request(baseUrl, "/v1/session")).resolves.toMatchObject({
    status: 401,
    body: { error: "unauthorized" },
  });

  const input = {
    sessionId: "session-api",
    players: ["alice", "bob"],
    callbackUrl: "http://127.0.0.1:9999/events",
    tokenVerification: {
      publicKey,
      keyId: "api-key",
      issuer: "api-matchmaker",
      audience: "api-server",
    },
  };
  const created = await request(baseUrl, "/v1/session", {
    method: "POST",
    token: controlToken,
    body: input,
  });
  expect(created).toMatchObject({
    status: 201,
    body: { session: { sessionId: "session-api", status: "active" } },
  });
  expect((await request(baseUrl, "/health/ready")).status).toBe(200);
  expect(
    (
      await request(baseUrl, "/v1/session", {
        token: controlToken,
      })
    ).body.session
  ).not.toHaveProperty("callbackUrl");
  expect(
    await request(baseUrl, "/v1/session", {
      method: "POST",
      token: controlToken,
      body: input,
    })
  ).toMatchObject({ status: 409, body: { error: "session_already_active" } });

  const ended = await request(baseUrl, "/v1/session/end", {
    method: "POST",
    token: controlToken,
    body: { reason: "test-complete" },
  });
  expect(ended).toMatchObject({
    status: 202,
    body: { session: { status: "ending" } },
  });
  await endDrain;
});

test("never authorizes control requests when the server secret is absent", async () => {
  server = createControlServer({
    sessionManager: new SessionManager(),
    controlToken: undefined,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/v1/session`, {
    headers: { authorization: "Bearer " },
  });
  expect(response.status).toBe(401);
});

test("rejects oversized control payloads with a bounded 413 response", async () => {
  server = createControlServer({
    sessionManager: new SessionManager(),
    controlToken,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/v1/session`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${controlToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ padding: "x".repeat(65 * 1024) }),
  });
  expect(response.status).toBe(413);
  await expect(response.json()).resolves.toEqual({
    error: "request_too_large",
  });
});

test("serves the public CORS voice refresh route through an opaque capability", async () => {
  const refreshVoice = jest.fn((authorization) => {
    if (authorization !== `Bearer ${"v".repeat(43)}`) {
      const error = new Error("voice_authorization_invalid");
      error.code = "voice_authorization_invalid";
      error.status = 401;
      throw error;
    }
    return {
      appId: "a".repeat(32),
      channel: "thnk-channel",
      uid: "thnk-u-alice",
      token: "007-refreshed-token",
      expiresAt: "2030-01-01T00:00:00.000Z",
    };
  });
  server = createControlServer({
    sessionManager: { refreshVoice },
    controlToken,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/v1/voice/token`;

  const preflight = await fetch(url, { method: "OPTIONS" });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
  expect(preflight.headers.get("access-control-allow-headers")).toContain(
    "authorization"
  );

  const unauthorized = await fetch(url, { method: "POST" });
  expect(unauthorized.status).toBe(401);
  await expect(unauthorized.json()).resolves.toEqual({
    error: "voice_authorization_invalid",
  });

  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${"v".repeat(43)}` },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  await expect(response.json()).resolves.toMatchObject({
    uid: "thnk-u-alice",
    token: "007-refreshed-token",
  });
  expect(refreshVoice).toHaveBeenLastCalledWith(`Bearer ${"v".repeat(43)}`);
});
