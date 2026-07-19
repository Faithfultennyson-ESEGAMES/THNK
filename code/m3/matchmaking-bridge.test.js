const crypto = require("crypto");
const {
  AdmissionError,
  createJwtVerifier,
} = require("../../scripts/m2/runtime/jwt-verifier.cjs");
const {
  BridgeError,
  SessionManager,
} = require("../../scripts/m2/runtime/session-manager.cjs");
const {
  WebhookOutbox,
} = require("../../scripts/m2/runtime/webhook-outbox.cjs");
const {
  VoiceError,
} = require("../../scripts/m2/runtime/voice-token-manager.cjs");

const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" });
const NOW_MS = Date.parse("2026-07-19T12:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW_MS / 1000);
const RUNTIME_IDENTITY = Object.freeze({
  gameId: "game-1",
  authorityId: "duel",
  mapId: "arena-1",
  serverBuildId: `sha256:${"a".repeat(64)}`,
  compatibilityVersion: "1",
  clientBuildId: "client-1",
  protocolVersion: "thnk-flatbuffers-v1",
});

const signToken = (overrides = {}, headerOverrides = {}) => {
  const header = {
    alg: "RS256",
    kid: "test-key",
    typ: "JWT",
    ...headerOverrides,
  };
  const claims = {
    iss: "test-matchmaker",
    aud: "thnk-server",
    sessionId: "session-1",
    playerId: "alice",
    jti: "token-1",
    iat: NOW_SECONDS,
    exp: NOW_SECONDS + 120,
    ...RUNTIME_IDENTITY,
    tags: {},
    ...overrides,
  };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString(
    "base64url"
  );
  const encodedClaims = Buffer.from(JSON.stringify(claims)).toString(
    "base64url"
  );
  const message = `${encodedHeader}.${encodedClaims}`;
  const signature = crypto.sign(
    "RSA-SHA256",
    Buffer.from(message),
    keys.privateKey
  );
  return `${message}.${signature.toString("base64url")}`;
};

const sessionInput = (overrides = {}) => ({
  sessionId: "session-1",
  ...RUNTIME_IDENTITY,
  players: ["alice", { playerId: "bob" }],
  callbackUrl: "http://127.0.0.1:9999/events",
  reconnectPolicy: "fresh-token",
  metadata: { mode: "duel" },
  tokenVerification: {
    publicKey,
    keyId: "test-key",
    issuer: "test-matchmaker",
    audience: "thnk-server",
    algorithm: "RS256",
  },
  ...overrides,
});

const createManager = (overrides = {}) =>
  new SessionManager({
    enabled: true,
    webhookSecret: "w".repeat(32),
    allowInsecureCallbacks: true,
    fetchImpl: async () => ({ ok: true, status: 204 }),
    now: () => NOW_MS,
    playerDrainTimeoutMs: 20,
    runtimeIdentity: RUNTIME_IDENTITY,
    ...overrides,
  });

test("verifies signed admission claims and rejects forged or invalid JWTs", () => {
  const verify = createJwtVerifier({
    publicKey,
    keyId: "test-key",
    issuer: "test-matchmaker",
    audience: "thnk-server",
    now: () => NOW_MS,
  });

  expect(verify(signToken())).toMatchObject({
    sessionId: "session-1",
    playerId: "alice",
    jti: "token-1",
  });
  expect(() => verify(signToken({ exp: NOW_SECONDS - 60 }))).toThrow(
    "token_expired"
  );
  expect(() => verify(signToken({ iss: "attacker" }))).toThrow(
    "issuer_rejected"
  );
  expect(() => verify(signToken({}, { alg: "HS256" }))).toThrow(
    "algorithm_rejected"
  );
  expect(() =>
    verify(signToken({ exp: NOW_SECONDS, iat: NOW_SECONDS }))
  ).toThrow("invalid_token_window");

  const token = signToken();
  const [header, payload, signature] = token.split(".");
  const forgedPayload = Buffer.from(
    JSON.stringify({
      ...JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
      playerId: "bob",
    })
  ).toString("base64url");
  expect(() => verify(`${header}.${forgedPayload}.${signature}`)).toThrow(
    "invalid_signature"
  );
});

test("enforces roster identity, one connection, replay defense, and fresh-token reconnect", async () => {
  const manager = createManager();
  manager.setGameReady();
  expect(manager.isReady()).toBe(false);
  expect(manager.createSession(sessionInput())).toMatchObject({
    sessionId: "session-1",
    status: "active",
    connectedPlayers: [],
  });
  expect(manager.isReady()).toBe(true);
  expect(() => manager.createSession(sessionInput())).toThrow(
    "session_already_active"
  );
  expect(() =>
    manager.authorize(`Bearer ${signToken({ playerId: "mallory" })}`)
  ).toThrow("player_not_rostered");
  expect(() =>
    manager.authorize(
      `Bearer ${signToken({
        sessionId: "other-session",
        jti: "wrong-session",
      })}`
    )
  ).toThrow("wrong_session");

  const aliceToken = signToken();
  const alice = manager.authorize(`Bearer ${aliceToken}`).thnkIdentity;
  expect(() => manager.authorize(`Bearer ${aliceToken}`)).toThrow(
    "token_replayed"
  );
  expect(() =>
    manager.authorize(`Bearer ${signToken({ jti: "token-2" })}`)
  ).toThrow("player_already_connected");
  expect(manager.playerConnected(alice, "transport-a")).toBe(true);
  expect(manager.playerConnected(alice, "transport-b")).toBe(false);

  const bob = manager.authorize(
    `Bearer ${signToken({ playerId: "bob", jti: "token-bob" })}`
  ).thnkIdentity;
  expect(manager.playerConnected(bob, "transport-b")).toBe(true);
  expect(manager.getPublicState().connectedPlayers.sort()).toEqual([
    "alice",
    "bob",
  ]);

  manager.playerDisconnected(alice, "wrong-transport");
  expect(manager.getPublicState().connectedPlayers).toContain("alice");
  manager.playerDisconnected(alice, "transport-a");
  const reconnectedAlice = manager.authorize(
    `Bearer ${signToken({ jti: "token-reconnect" })}`
  ).thnkIdentity;
  expect(manager.playerConnected(reconnectedAlice, "transport-a2")).toBe(true);
  expect(manager.getPublicState().connectedPlayers.sort()).toEqual([
    "alice",
    "bob",
  ]);

  const ended = manager.endSession("match-complete");
  expect(ended.state.status).toBe("ending");
  expect(() =>
    manager.authorize(`Bearer ${signToken({ jti: "after-end" })}`)
  ).toThrow("session_not_active");
  manager.playerDisconnected(bob, "transport-b");
  manager.playerDisconnected(reconnectedAlice, "transport-a2");
  await expect(ended.drain).resolves.toBe(true);
});

test("rejects wrong authority, map, build, and compatibility identities with stable errors", () => {
  const cases = [
    ["gameId", "other-game", "wrong_game", 409],
    ["authorityId", "racing", "wrong_authority", 409],
    ["mapId", "other-map", "wrong_map", 409],
    ["serverBuildId", `sha256:${"b".repeat(64)}`, "wrong_server_build", 409],
    ["compatibilityVersion", "2", "client_update_required", 426],
    ["clientBuildId", "client-2", "client_update_required", 426],
    ["protocolVersion", "thnk-flatbuffers-v2", "client_update_required", 426],
  ];
  for (const [field, value, code, status] of cases) {
    const manager = createManager();
    expect(() =>
      manager.createSession(sessionInput({ [field]: value }))
    ).toThrow(code);
    try {
      manager.createSession(sessionInput({ [field]: value }));
    } catch (error) {
      expect(error).toMatchObject({ code, status });
    }
    expect(manager.getPublicState()).toBeNull();
  }
});

test("binds immutable signed matchmaking tags to the roster and admission", () => {
  const manager = createManager();
  manager.setGameReady();
  manager.createSession(
    sessionInput({
      players: [
        { playerId: "alice", tags: { team: "A", seed: 7, captain: true } },
      ],
    })
  );
  expect(() =>
    manager.authorize(
      `Bearer ${signToken({ tags: { team: "B", seed: 7, captain: true } })}`
    )
  ).toThrow("wrong_player_tags");

  const admission = manager.authorize(
    `Bearer ${signToken({
      jti: "correct-tags",
      tags: { team: "A", seed: 7, captain: true },
    })}`
  );
  expect(admission.thnkIdentity.tags).toEqual({
    team: "A",
    seed: 7,
    captain: true,
  });
  expect(Object.isFrozen(admission.thnkIdentity.tags)).toBe(true);
});

test("rejects admission tokens minted for another authority, build, or client version", () => {
  const manager = createManager();
  manager.setGameReady();
  manager.createSession(sessionInput());
  expect(() =>
    manager.authorize(
      `Bearer ${signToken({ authorityId: "racing", jti: "wrong-authority" })}`
    )
  ).toThrow("wrong_authority");
  expect(() =>
    manager.authorize(
      `Bearer ${signToken({
        serverBuildId: `sha256:${"b".repeat(64)}`,
        jti: "wrong-build",
      })}`
    )
  ).toThrow("wrong_server_build");
  expect(() =>
    manager.authorize(
      `Bearer ${signToken({ compatibilityVersion: "2", jti: "wrong-version" })}`
    )
  ).toThrow("client_update_required");
});

test("expires abandoned admissions without allowing their token to be replayed", () => {
  let now = NOW_MS;
  const manager = createManager({ now: () => now });
  manager.setGameReady();
  manager.createSession(sessionInput());
  const firstToken = signToken({ exp: NOW_SECONDS + 40 });
  manager.authorize(`Bearer ${firstToken}`);

  now += 41_000;
  expect(() => manager.authorize(`Bearer ${firstToken}`)).toThrow(
    "token_replayed"
  );
  const replacement = manager.authorize(
    `Bearer ${signToken({
      jti: "replacement",
      iat: NOW_SECONDS + 41,
      exp: NOW_SECONDS + 100,
    })}`
  );
  expect(replacement.thnkIdentity.playerId).toBe("alice");
});

test("binds voice grants to the exact gameplay admission lifecycle", () => {
  const voiceManager = {
    reset: jest.fn(),
    prepareAdmission: jest.fn((identity) => ({
      uid: `voice-${identity.playerId}`,
      token: "short-lived-token",
    })),
    activate: jest.fn(),
    revokeAdmission: jest.fn(),
    getPublicState: () => ({ enabled: true, activeGrants: 0 }),
  };
  const manager = createManager({ voiceManager });
  manager.setGameReady();
  manager.createSession(sessionInput());
  const admission = manager.authorize(`Bearer ${signToken()}`);

  expect(admission.thnkVoice.uid).toBe("voice-alice");
  expect(voiceManager.prepareAdmission).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionId: "session-1",
      playerId: "alice",
      players: ["alice", "bob"],
    })
  );
  expect(manager.playerConnected(admission.thnkIdentity, "transport-a")).toBe(
    true
  );
  expect(voiceManager.activate).toHaveBeenCalledWith(
    admission.thnkIdentity.admissionId,
    "transport-a"
  );
  manager.playerDisconnected(admission.thnkIdentity, "transport-a");
  expect(voiceManager.revokeAdmission).toHaveBeenCalledWith(
    admission.thnkIdentity.admissionId
  );
});

test("voice token failure is reported without rejecting gameplay admission", () => {
  const voiceManager = {
    reset: jest.fn(),
    prepareAdmission: () => {
      throw new VoiceError("voice_token_generation_failed", 503);
    },
    activate: jest.fn(),
    revokeAdmission: jest.fn(),
    getPublicState: () => ({ enabled: true, activeGrants: 0 }),
  };
  const manager = createManager({ voiceManager });
  manager.setGameReady();
  manager.createSession(sessionInput());
  const admission = manager.authorize(`Bearer ${signToken()}`);

  expect(admission.thnkVoice).toEqual({
    available: false,
    errorCode: "voice_token_generation_failed",
  });
  expect(manager.playerConnected(admission.thnkIdentity, "transport-a")).toBe(
    true
  );
  expect(manager.getPublicState().connectedPlayers).toEqual(["alice"]);
});

test("uses one stable signed event across bounded webhook retries", async () => {
  const requests = [];
  const outbox = new WebhookOutbox({
    callbackUrl: "https://matchmaker.example/events",
    secret: "s".repeat(32),
    fetchImpl: async (_url, request) => {
      requests.push(request);
      return { ok: requests.length === 3, status: 503 };
    },
    sleep: async () => {},
    maxAttempts: 4,
    randomUUID: () => "event-1",
    now: () => new Date(NOW_MS),
  });

  const { event, delivery } = outbox.enqueue("player.joined", "session-1", {
    playerId: "alice",
  });
  await expect(delivery).resolves.toBe(true);
  expect(requests).toHaveLength(3);
  expect(new Set(requests.map((request) => request.body))).toEqual(
    new Set([JSON.stringify(event)])
  );
  expect(
    new Set(requests.map((request) => request.headers["x-thnk-event-id"]))
  ).toEqual(new Set(["event-1"]));
  const expectedSignature = crypto
    .createHmac("sha256", "s".repeat(32))
    .update(JSON.stringify(event))
    .digest("hex");
  expect(requests[0].headers["x-thnk-signature"]).toBe(
    `sha256=${expectedSignature}`
  );
  expect(outbox.stats()).toEqual({
    total: 1,
    delivered: 1,
    failed: 0,
    pending: 0,
  });
});

test("stops retrying an unavailable callback after the configured bound", async () => {
  const delays = [];
  const outbox = new WebhookOutbox({
    callbackUrl: "https://matchmaker.example/events",
    secret: "s".repeat(32),
    fetchImpl: async () => ({ ok: false, status: 503 }),
    sleep: async (milliseconds) => delays.push(milliseconds),
    maxAttempts: 3,
    initialDelayMs: 10,
  });
  const { delivery } = outbox.enqueue("session.started", "session-1");
  await expect(delivery).resolves.toBe(false);
  expect(delays).toEqual([10, 20]);
  expect(outbox.stats()).toEqual({
    total: 1,
    delivered: 0,
    failed: 1,
    pending: 0,
  });
});

test("rejects unsafe session configuration", () => {
  const manager = createManager({ allowInsecureCallbacks: false });
  expect(() => manager.createSession(sessionInput())).toThrow(
    "callback_must_use_https"
  );
  expect(() =>
    createManager().createSession(
      sessionInput({ callbackUrl: "https://user:secret@example.com/events" })
    )
  ).toThrow("callback_credentials_not_allowed");
  expect(() =>
    createManager().createSession(sessionInput({ players: ["alice", "alice"] }))
  ).toThrow("duplicate_player_id");
  expect(() =>
    new SessionManager({ enabled: true }).createSession(sessionInput())
  ).toThrow("webhook_secret_not_configured");
  expect(AdmissionError).toBeDefined();
  expect(BridgeError).toBeDefined();
});
