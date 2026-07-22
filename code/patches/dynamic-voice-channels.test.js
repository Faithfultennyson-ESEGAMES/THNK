const crypto = require("crypto");
const {
  SessionManager,
} = require("../../scripts/m2/runtime/session-manager.cjs");
const {
  VoiceTokenManager,
  channelForSession,
} = require("../../scripts/m2/runtime/voice-token-manager.cjs");

const NOW_MS = Date.parse("2026-07-21T12:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW_MS / 1000);
const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" });
const runtimeIdentity = Object.freeze({
  gameId: "game-voice-patch",
  authorityId: "duel",
  mapId: "arena",
  serverBuildId: `sha256:${"7".repeat(64)}`,
  compatibilityVersion: "1",
  clientBuildId: "client-voice-patch",
  protocolVersion: "thnk-flatbuffers-v1",
});

const sessionInput = (overrides = {}) => ({
  sessionId: "session-voice-patch",
  ...runtimeIdentity,
  players: ["alice", "bob"],
  callbackUrl: "http://127.0.0.1:9999/events",
  tokenVerification: {
    publicKey,
    keyId: "voice-key",
    issuer: "voice-matchmaker",
    audience: "voice-server",
    algorithm: "RS256",
  },
  ...overrides,
});

let tokenCounter = 0;
const signToken = (overrides = {}) => {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: "voice-key", typ: "JWT" })
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: "voice-matchmaker",
      aud: "voice-server",
      sessionId: "session-voice-patch",
      playerId: "alice",
      jti: `voice-token-${++tokenCounter}`,
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

const externalVoiceGrant = (playerId, overrides = {}) => ({
  appId: "a".repeat(32),
  channel: "session-voice-patch-channel",
  uid: `voice-${playerId}`,
  token: `token-${playerId}-${"x".repeat(24)}`,
  expiresAt: new Date(NOW_MS + 120_000).toISOString(),
  refreshUrl: "https://voice.example/v1/voice/refresh",
  refreshCapability: (playerId === "alice" ? "a" : "b").repeat(43),
  refreshOwner: "matchmaker",
  ...overrides,
});

const manager = (overrides = {}) =>
  new SessionManager({
    enabled: true,
    profilePolicy: "local-ephemeral-fallback",
    devMode: true,
    webhookSecret: "w".repeat(32),
    allowInsecureCallbacks: true,
    fetchImpl: async () => ({ ok: true, status: 204 }),
    now: () => NOW_MS,
    runtimeIdentity,
    ...overrides,
  });

test("pulled per-player channels are accepted while mixed app ids stay voice-only errors", async () => {
  const participants = [
    { playerId: "alice", uid: "voice-alice" },
    { playerId: "bob", uid: "voice-bob" },
  ];
  const accepted = manager({
    authorityClient: {
      enabled: true,
      pullVoiceGrant: async ({ playerId }) => ({
        ...externalVoiceGrant(playerId, {
          ...(playerId === "alice" ? { channel: "squad-red" } : {}),
        }),
        participants,
      }),
    },
  });
  accepted.setGameReady();
  await accepted.prepareSession(sessionInput());
  await accepted.authorize(`Bearer ${signToken()}`);
  await accepted.authorize(
    `Bearer ${signToken({ playerId: "bob", jti: "voice-token-bob" })}`
  );
  expect(accepted.getPlayerVoiceChannel("alice")).toBe("squad-red");
  expect(accepted.getPlayerVoiceChannel("bob")).toBe(
    "session-voice-patch-channel"
  );
  accepted.endSession("done");

  const rejected = manager({
    authorityClient: {
      enabled: true,
      pullVoiceGrant: async ({ playerId }) => ({
        ...externalVoiceGrant(playerId, {
          ...(playerId === "bob" ? { appId: "c".repeat(32) } : {}),
        }),
        participants,
      }),
    },
  });
  rejected.setGameReady();
  await rejected.prepareSession(sessionInput());
  await rejected.authorize(`Bearer ${signToken({ jti: "mixed-app-alice" })}`);
  const bob = await rejected.authorize(
    `Bearer ${signToken({ playerId: "bob", jti: "mixed-app-bob" })}`
  );
  expect(bob.thnkVoice).toEqual({
    available: false,
    errorCode: "voice_grants_not_session_isolated",
  });
});

test("externally-granted reassignment reissues through the matchmaker", async () => {
  const refreshRequests = [];
  const fetchImpl = async (url, options = {}) => {
    if (String(url).includes("/v1/voice/refresh")) {
      refreshRequests.push({ url: String(url), options });
      const requested = JSON.parse(options.body).channel;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          grant: externalVoiceGrant("alice", {
            channel: requested,
            token: `token-alice-${requested}-${"y".repeat(16)}`,
            participants: [{ playerId: "alice", uid: "voice-alice" }],
          }),
        }),
      };
    }
    return { ok: true, status: 204 };
  };
  const sessionManager = manager({
    fetchImpl,
    authorityClient: {
      enabled: true,
      pullVoiceGrant: async ({ playerId }) => ({
        ...externalVoiceGrant(playerId),
        participants: [
          { playerId: "alice", uid: "voice-alice" },
          { playerId: "bob", uid: "voice-bob" },
        ],
      }),
    },
  });
  sessionManager.setGameReady();
  await sessionManager.prepareSession(sessionInput());
  const admission = await sessionManager.authorize(`Bearer ${signToken()}`);
  sessionManager.playerConnected(admission.thnkIdentity, "transport-1");

  const updates = [];
  sessionManager.on("voice-grant-updated", (update) => updates.push(update));
  const grant = await sessionManager.setVoiceChannel("alice", "squad-red");
  expect(grant.channel).toBe("squad-red");
  expect(sessionManager.getPlayerVoiceChannel("alice")).toBe("squad-red");
  expect(sessionManager.getPlayerVoiceChannel("bob")).toBe("");
  expect(refreshRequests).toHaveLength(1);
  expect(refreshRequests[0].options.headers.authorization).toBe(
    `Bearer ${"a".repeat(43)}`
  );
  expect(JSON.parse(refreshRequests[0].options.body)).toEqual({
    channel: "squad-red",
  });
  expect(updates).toHaveLength(1);
  expect(updates[0].playerId).toBe("alice");

  await expect(
    sessionManager.setVoiceChannel("bob", "squad-red")
  ).rejects.toMatchObject({ code: "player_not_in_session" });
  await expect(
    sessionManager.setVoiceChannel("alice", "bad channel!")
  ).rejects.toMatchObject({ code: "invalid_voice_channel" });
  await expect(
    sessionManager.setVoiceChannel("mallory", "squad-red")
  ).rejects.toMatchObject({ code: "player_not_in_session" });

  const throttled = manager({
    fetchImpl: async (url) =>
      String(url).includes("/v1/voice/refresh")
        ? { ok: false, status: 429, json: async () => ({}) }
        : { ok: true, status: 204 },
    authorityClient: {
      enabled: true,
      pullVoiceGrant: async ({ playerId }) => ({
        ...externalVoiceGrant(playerId),
        participants: [
          { playerId: "alice", uid: "voice-alice" },
          { playerId: "bob", uid: "voice-bob" },
        ],
      }),
    },
  });
  throttled.setGameReady();
  await throttled.prepareSession(sessionInput());
  const throttledAdmission = await throttled.authorize(
    `Bearer ${signToken({ jti: "throttled-token" })}`
  );
  throttled.playerConnected(throttledAdmission.thnkIdentity, "transport-2");
  await expect(
    throttled.setVoiceChannel("alice", "squad-red")
  ).rejects.toMatchObject({ code: "voice_refresh_too_frequent", status: 429 });
});

test("bundle-local reassignment mints directly without leaking capabilities", async () => {
  let voiceNow = NOW_MS;
  const voiceManager = new VoiceTokenManager({
    enabled: true,
    appId: "d".repeat(32),
    appCertificate: "e".repeat(32),
    tokenUrl: "https://game.example/v1/voice/token",
    now: () => voiceNow,
  });
  const sessionManager = manager({ voiceManager });
  sessionManager.setGameReady();
  await sessionManager.prepareSession(sessionInput());
  const admission = sessionManager.authorize(`Bearer ${signToken()}`);
  expect(admission.thnkVoice.channel).toBe(
    channelForSession("session-voice-patch")
  );
  sessionManager.playerConnected(admission.thnkIdentity, "transport-1");
  expect(sessionManager.getPlayerVoiceChannel("alice")).toBe(
    channelForSession("session-voice-patch")
  );

  const capabilitiesBefore = voiceManager.recordsByCapabilityHash.size;
  const moved = await sessionManager.setVoiceChannel("alice", "squad-red");
  expect(moved.channel).toBe("squad-red");
  expect(moved.token.length).toBeGreaterThan(16);
  expect(sessionManager.getPlayerVoiceChannel("alice")).toBe("squad-red");
  const movedAgain = await sessionManager.setVoiceChannel("alice", "squad-blue");
  expect(movedAgain.channel).toBe("squad-blue");
  expect(voiceManager.recordsByCapabilityHash.size).toBe(capabilitiesBefore);

  voiceNow += 10_000;
  const refreshed = voiceManager.refresh(
    `Bearer ${admission.thnkVoice.refreshCapability}`
  );
  expect(refreshed.channel).toBe(
    "squad-blue"
  );
});
