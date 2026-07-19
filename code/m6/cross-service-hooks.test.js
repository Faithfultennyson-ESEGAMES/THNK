const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  PlayerProfileClient,
} = require("../../scripts/m2/runtime/player-profile-client.cjs");
const {
  SessionManager,
} = require("../../scripts/m2/runtime/session-manager.cjs");
const {
  VoiceTokenManager,
} = require("../../scripts/m2/runtime/voice-token-manager.cjs");

const NOW_MS = Date.parse("2026-07-19T12:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW_MS / 1000);
const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" });
const runtimeIdentity = Object.freeze({
  gameId: "game-m6",
  authorityId: "duel",
  mapId: "arena",
  serverBuildId: `sha256:${"6".repeat(64)}`,
  compatibilityVersion: "1",
  clientBuildId: "client-m6",
  protocolVersion: "thnk-flatbuffers-v1",
});

const sessionInput = (overrides = {}) => ({
  sessionId: "session-m6",
  ...runtimeIdentity,
  players: ["alice"],
  callbackUrl: "http://127.0.0.1:9999/events",
  tokenVerification: {
    publicKey,
    keyId: "m6-key",
    issuer: "m6-matchmaker",
    audience: "m6-server",
    algorithm: "RS256",
  },
  ...overrides,
});

const signToken = (overrides = {}) => {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: "m6-key", typ: "JWT" })
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: "m6-matchmaker",
      aud: "m6-server",
      sessionId: "session-m6",
      playerId: "alice",
      jti: "m6-token",
      iat: NOW_SECONDS,
      exp: NOW_SECONDS + 120,
      tags: {},
      ...runtimeIdentity,
      ...overrides,
    })
  ).toString("base64url");
  const message = `${header}.${payload}`;
  return `${message}.${crypto
    .sign("RSA-SHA256", Buffer.from(message), keys.privateKey)
    .toString("base64url")}`;
};

const externalVoiceGrant = (playerId) => ({
  appId: "a".repeat(32),
  channel: "session-m6-channel",
  uid: `voice-${playerId}`,
  token: `token-${playerId}-${"x".repeat(24)}`,
  expiresAt: new Date(NOW_MS + 120_000).toISOString(),
  refreshUrl: `https://voice.example/${playerId}/refresh`,
  refreshCapability: `${playerId === "alice" ? "a" : "b"}`.repeat(43),
  refreshOwner: "matchmaker",
});

const manager = (overrides = {}) =>
  new SessionManager({
    enabled: true,
    webhookSecret: "w".repeat(32),
    allowInsecureCallbacks: true,
    fetchImpl: async () => ({ ok: true, status: 204 }),
    now: () => NOW_MS,
    randomUUID: (() => {
      let value = 0;
      return () => `m6-id-${++value}`;
    })(),
    runtimeIdentity,
    ...overrides,
  });

test("preflights blocked roster members before committing a session", async () => {
  const profileClient = {
    enabled: true,
    isBlocked: jest.fn(async (playerId) => playerId === "blocked-player"),
  };
  const sessionManager = manager({ profileClient });
  await expect(
    sessionManager.prepareSession(
      sessionInput({ players: ["alice", "blocked-player"] })
    )
  ).rejects.toMatchObject({ code: "player_blocked", status: 403 });
  expect(sessionManager.getPublicState()).toBeNull();
  expect(profileClient.isBlocked).toHaveBeenCalledTimes(2);
});

test("maps a failed Player Profile preflight to a stable service error", async () => {
  const profileClient = {
    enabled: true,
    isBlocked: jest.fn(async () => {
      throw new Error("network failure");
    }),
  };
  const sessionManager = manager({ profileClient });
  await expect(
    sessionManager.prepareSession(sessionInput())
  ).rejects.toMatchObject({
    code: "player_profile_unavailable",
    status: 503,
  });
  expect(sessionManager.getPublicState()).toBeNull();
});

test("loads, serializes, persists, and reloads one player document", async () => {
  const stored = new Map([["alice", { progression: { xp: 7 } }]]);
  const writes = [];
  const profileClient = {
    enabled: true,
    isBlocked: async () => false,
    loadDocument: async (playerId) => structuredClone(stored.get(playerId)),
    saveDocument: async (playerId, gameId, sessionId, document) => {
      writes.push({ playerId, gameId, sessionId, document });
      stored.set(playerId, structuredClone(document));
    },
  };
  const first = manager({ profileClient });
  first.setGameReady();
  await first.prepareSession(sessionInput());
  const admission = await first.authorize(`Bearer ${signToken()}`);
  expect(admission.thnkPlayerDocument).toEqual({ progression: { xp: 7 } });
  expect(first.playerConnected(admission.thnkIdentity, "transport-1")).toBe(
    true
  );
  expect(
    first.playerDocumentChanged(admission.thnkIdentity, {
      progression: { xp: 8 },
    })
  ).toBe(true);
  await Promise.all([...first.pendingProfileWrites]);
  expect(writes.at(-1)).toEqual({
    playerId: "alice",
    gameId: "game-m6",
    sessionId: "session-m6",
    document: { progression: { xp: 8 } },
  });

  first.playerDisconnected(
    admission.thnkIdentity,
    "transport-1",
    stored.get("alice")
  );
  await Promise.all([...first.pendingProfileWrites]);
  const second = manager({ profileClient });
  second.setGameReady();
  await second.prepareSession(sessionInput({ sessionId: "session-m6-next" }));
  const reloaded = await second.authorize(
    `Bearer ${signToken({ sessionId: "session-m6-next", jti: "next-token" })}`
  );
  expect(reloaded.thnkPlayerDocument).toEqual({ progression: { xp: 8 } });
});

test("serializes rapid document writes so the newest value wins", async () => {
  const completions = [];
  const profileClient = {
    enabled: true,
    isBlocked: async () => false,
    loadDocument: async () => ({}),
    saveDocument: async (_playerId, _gameId, _sessionId, document) => {
      await new Promise((resolve) => completions.push(resolve));
      return document;
    },
  };
  const sessionManager = manager({ profileClient });
  sessionManager.setGameReady();
  await sessionManager.prepareSession(sessionInput());
  const admission = await sessionManager.authorize(`Bearer ${signToken()}`);
  sessionManager.playerConnected(admission.thnkIdentity, "transport-1");
  sessionManager.playerDocumentChanged(admission.thnkIdentity, { revision: 1 });
  sessionManager.playerDocumentChanged(admission.thnkIdentity, { revision: 2 });
  await new Promise(setImmediate);
  expect(completions).toHaveLength(1);
  completions.shift()();
  await new Promise(setImmediate);
  expect(completions).toHaveLength(1);
  completions.shift()();
  await Promise.all([...sessionManager.pendingProfileWrites]);
});

test("delivers one signed trust violation for repeated reports in one incident", async () => {
  const requests = [];
  const webhookSecret = "s".repeat(32);
  const sessionManager = manager({
    webhookSecret,
    fetchImpl: async (_url, request) => {
      requests.push(request);
      return { ok: true, status: 204 };
    },
  });
  sessionManager.setGameReady();
  sessionManager.createSession(sessionInput());
  const admission = sessionManager.authorize(`Bearer ${signToken()}`);
  sessionManager.playerConnected(admission.thnkIdentity, "transport-1");
  expect(
    sessionManager.reportTrustViolation("alice", "authoritative_state_edit")
  ).toBe(true);
  expect(
    sessionManager.reportTrustViolation("alice", "authoritative_state_edit")
  ).toBe(false);
  await sessionManager.outbox.drain();
  const events = requests.map((request) => JSON.parse(request.body));
  const violations = events.filter(
    (event) => event.eventType === "trust.violation"
  );
  expect(violations).toHaveLength(1);
  expect(violations[0]).toMatchObject({
    sessionId: "session-m6",
    playerId: "alice",
    violationType: "authoritative_state_edit",
  });
  const request = requests.find(
    (entry) => JSON.parse(entry.body).eventType === "trust.violation"
  );
  expect(request.headers["x-thnk-signature"]).toBe(
    `sha256=${crypto
      .createHmac("sha256", webhookSecret)
      .update(request.body)
      .digest("hex")}`
  );
});

test("uses roster-keyed external Agora grants without local credentials", () => {
  const voiceManager = new VoiceTokenManager({
    enabled: true,
    now: () => NOW_MS,
  });
  const sessionManager = manager({ voiceManager });
  sessionManager.setGameReady();
  sessionManager.createSession(
    sessionInput({
      players: ["alice", "bob"],
      voiceGrants: Object.fromEntries(
        ["alice", "bob"].map((playerId) => [
          playerId,
          externalVoiceGrant(playerId),
        ])
      ),
    })
  );
  const admission = sessionManager.authorize(`Bearer ${signToken()}`);
  expect(admission.thnkVoice).toMatchObject({
    uid: "voice-alice",
    refreshOwner: "matchmaker",
  });
  expect(admission.thnkVoice.participants).toEqual([
    { playerId: "alice", uid: "voice-alice" },
    { playerId: "bob", uid: "voice-bob" },
  ]);
  expect(JSON.stringify(sessionManager.getPublicState())).not.toContain(
    admission.thnkVoice.token
  );
});

test("rejects partial external grants and preserves local minting fallback", () => {
  const externalOnly = manager({
    voiceManager: new VoiceTokenManager({ enabled: true, now: () => NOW_MS }),
  });
  expect(() =>
    externalOnly.createSession(
      sessionInput({ players: ["alice", "bob"], voiceGrants: {} })
    )
  ).toThrow("voice_grants_must_match_roster");

  const aliceGrant = externalVoiceGrant("alice");
  expect(() =>
    externalOnly.createSession(
      sessionInput({
        players: ["alice", "bob"],
        voiceGrants: {
          alice: aliceGrant,
          bob: {
            ...aliceGrant,
            refreshUrl: "https://voice.example/bob/refresh",
          },
        },
      })
    )
  ).toThrow("voice_grants_not_player_isolated");

  const local = manager({
    voiceManager: new VoiceTokenManager({
      enabled: true,
      appId: "a".repeat(32),
      appCertificate: "b".repeat(32),
      tokenUrl: "http://127.0.0.1:9209/v1/voice/token",
      allowInsecureLoopback: true,
      now: () => NOW_MS,
      randomBytes: () => Buffer.alloc(32, 9),
      buildToken: () => `local-token-${"x".repeat(24)}`,
    }),
  });
  local.setGameReady();
  local.createSession(sessionInput());
  expect(local.authorize(`Bearer ${signToken()}`).thnkVoice).toMatchObject({
    appId: "a".repeat(32),
    refreshOwner: "bridge",
  });
});

test("Player Profile client uses a separate service credential and bounded contract", async () => {
  const calls = [];
  const client = new PlayerProfileClient({
    baseUrl: "http://127.0.0.1:9400/",
    serviceToken: "p".repeat(32),
    allowInsecureLoopback: true,
    fetchImpl: async (url, request) => {
      calls.push({ url: url.toString(), request });
      return {
        ok: true,
        status: 200,
        json: async () =>
          url.toString().includes("/blocked")
            ? { blocked: false }
            : { document: { xp: 9 } },
      };
    },
  });
  await expect(client.isBlocked("alice")).resolves.toBe(false);
  await expect(client.loadDocument("alice", "game-m6")).resolves.toEqual({
    xp: 9,
  });
  await client.saveDocument("alice", "game-m6", "session-m6", { xp: 10 });
  expect(calls).toHaveLength(3);
  expect(
    calls.every(
      ({ request }) =>
        request.headers.authorization === `Bearer ${"p".repeat(32)}`
    )
  ).toBe(true);
  expect(calls[1].url).toContain("gameId=game-m6");
});

test("GDevelop Set Player Variable action rejects client-tagged execution", () => {
  const extension = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, "../../extensions/THNK.json"),
      "utf8"
    )
  );
  const action = extension.eventsFunctions.find(
    (candidate) => candidate.name === "SetPlayerVariable"
  );
  expect(action.functionType).toBe("Action");
  const code = action.events
    .flatMap((event) => event.inlineCode || [])
    .join("\n");
  expect(code).toContain("if (runtimeScene.thnkClient) throw new Error");
  expect(code.indexOf("throw new Error")).toBeLessThan(
    code.indexOf("setCurrentPlayerVariable")
  );
});
