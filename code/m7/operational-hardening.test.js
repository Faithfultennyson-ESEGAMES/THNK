const crypto = require("crypto");
const { once } = require("events");
const {
  createControlServer,
} = require("../../scripts/m2/runtime/control-server.cjs");
const {
  FixedWindowRateLimiter,
} = require("../../scripts/m2/runtime/rate-limiter.cjs");
const {
  SessionManager,
} = require("../../scripts/m2/runtime/session-manager.cjs");
const {
  REDACTED,
  createStructuredLogger,
} = require("../../scripts/m2/runtime/structured-logger.cjs");

const NOW_MS = Date.parse("2026-07-19T16:00:00.000Z");
const runtimeIdentity = Object.freeze({
  gameId: "game-m7",
  authorityId: "duel",
  mapId: "arena",
  serverBuildId: `sha256:${"7".repeat(64)}`,
  compatibilityVersion: "1",
  clientBuildId: "client-m7",
  protocolVersion: "thnk-flatbuffers-v1",
});
const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" });
const sessionInput = {
  sessionId: "session-m7",
  ...runtimeIdentity,
  players: ["alice"],
  callbackUrl: "http://127.0.0.1:9999/events",
  tokenVerification: {
    publicKey,
    keyId: "m7-key",
    issuer: "m7-matchmaker",
    audience: "m7-server",
  },
};

const manager = (overrides = {}) =>
  new SessionManager({
    enabled: true,
    profilePolicy: "local-ephemeral-fallback",
    devMode: true,
    webhookSecret: "w".repeat(32),
    allowInsecureCallbacks: true,
    fetchImpl: async () => ({ ok: true, status: 204 }),
    runtimeIdentity,
    ...overrides,
  });

test("structured logger preserves correlation IDs and redacts credentials", () => {
  const lines = [];
  const logger = createStructuredLogger({
    now: () => new Date(NOW_MS),
    write: (line) => lines.push(line),
  });
  logger.info("security.probe", {
    sessionId: "session-m7",
    playerId: "alice",
    connectionId: "connection-1",
    eventId: "event-1",
    authorization: "Bearer should-never-appear",
    nested: {
      appCertificate: "certificate-should-never-appear",
      message: "token=also-hidden",
    },
  });
  expect(lines).toHaveLength(1);
  const record = JSON.parse(lines[0]);
  expect(record).toMatchObject({
    event: "security.probe",
    sessionId: "session-m7",
    playerId: "alice",
    connectionId: "connection-1",
    eventId: "event-1",
    authorization: REDACTED,
    nested: { appCertificate: REDACTED, message: `token=${REDACTED}` },
  });
  expect(lines[0]).not.toContain("should-never-appear");
  expect(lines[0]).not.toContain("also-hidden");
});

test("fixed-window rate limiter returns a bounded retry interval", () => {
  let now = NOW_MS;
  const limiter = new FixedWindowRateLimiter({
    limit: 2,
    windowMs: 60_000,
    now: () => now,
  });
  expect(limiter.check("client")).toMatchObject({
    allowed: true,
    remaining: 1,
  });
  expect(limiter.check("client")).toMatchObject({
    allowed: true,
    remaining: 0,
  });
  expect(limiter.check("client")).toMatchObject({
    allowed: false,
    retryAfterSeconds: 60,
  });
  now += 60_000;
  expect(limiter.check("client")).toMatchObject({
    allowed: true,
    remaining: 1,
  });
});

test("fixed-window rate limiter bounds distinct source keys", () => {
  const limiter = new FixedWindowRateLimiter({ limit: 1, maxEntries: 100 });
  for (let index = 0; index < 101; index += 1)
    limiter.check(`source-${index}`);
  expect(limiter.windows.size).toBe(100);
  expect(limiter.windows.has("source-0")).toBe(false);
  expect(limiter.windows.has("source-100")).toBe(true);
});

test("HTTP health and control limits are isolated and return 429", async () => {
  const controlRateLimiter = new FixedWindowRateLimiter({ limit: 2 });
  const server = createControlServer({
    sessionManager: manager(),
    controlToken: "c".repeat(32),
    controlRateLimiter,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    expect((await fetch(`${baseUrl}/health/live`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/health/live`)).status).toBe(200);
    const limited = await fetch(`${baseUrl}/health/live`);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    await expect(limited.json()).resolves.toEqual({
      error: "rate_limit_exceeded",
    });
    expect((await fetch(`${baseUrl}/v1/session`)).status).toBe(401);
  } finally {
    const closed = once(server, "close");
    server.close();
    server.closeAllConnections?.();
    await closed;
  }
});

test("maximum session duration emits a reclamation signal", () => {
  jest.useFakeTimers();
  try {
    const sessionManager = manager({ maxSessionDurationMs: 1_000 });
    const expired = jest.fn();
    sessionManager.on("maximum-duration", expired);
    sessionManager.createSession(sessionInput);
    jest.advanceTimersByTime(1_000);
    expect(expired).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

test("graceful shutdown drains the active session and becomes unready", async () => {
  const sessionManager = manager();
  sessionManager.setGameReady();
  sessionManager.createSession(sessionInput);
  expect(sessionManager.getHealthState().ready).toBe(true);
  await sessionManager.shutdown("test_shutdown");
  expect(sessionManager.getPublicState().status).toBe("ending");
  expect(sessionManager.getHealthState().ready).toBe(false);
  expect(sessionManager.outbox.stats()).toMatchObject({
    total: 2,
    delivered: 2,
    failed: 0,
  });
});

test("Player Profile preflight failure is visible in dependency readiness", async () => {
  const sessionManager = manager({
    profileClient: {
      enabled: true,
      isBlocked: async () => {
        throw new Error("dependency offline");
      },
    },
  });
  sessionManager.setGameReady();
  await expect(
    sessionManager.prepareSession(sessionInput)
  ).rejects.toMatchObject({
    code: "player_profile_unavailable",
    status: 503,
  });
  expect(sessionManager.getHealthState()).toMatchObject({
    ready: false,
    checks: { playerProfile: "unavailable" },
  });
});
