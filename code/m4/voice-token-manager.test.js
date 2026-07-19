const {
  VoiceError,
  VoiceTokenManager,
  channelForSession,
  uidForPlayer,
  validateTokenUrl,
} = require("../../scripts/m2/runtime/voice-token-manager.cjs");

const appId = "a".repeat(32);
const appCertificate = "b".repeat(32);

const managerOptions = (overrides = {}) => ({
  enabled: true,
  appId,
  appCertificate,
  tokenUrl: "http://127.0.0.1:9209/v1/voice/token",
  allowInsecureLoopback: true,
  ...overrides,
});

test("derives stable isolated Agora identities from canonical session and player IDs", () => {
  expect(channelForSession("match-1")).toBe(channelForSession("match-1"));
  expect(channelForSession("match-1")).not.toBe(channelForSession("match-2"));
  expect(uidForPlayer("match-1", "alice")).toBe(
    uidForPlayer("match-1", "alice")
  );
  expect(uidForPlayer("match-1", "alice")).not.toBe(
    uidForPlayer("match-1", "bob")
  );
  expect(channelForSession("match-1")).toMatch(/^thnk-[a-f0-9]{40}$/);
  expect(uidForPlayer("match-1", "alice")).toMatch(/^thnk-u-[a-f0-9]{40}$/);
});

test("issues one channel grant per admitted identity without exposing the certificate", () => {
  let randomValue = 0;
  const manager = new VoiceTokenManager(
    managerOptions({
      randomBytes: () => Buffer.alloc(32, ++randomValue),
    })
  );
  const alice = manager.prepareAdmission({
    sessionId: "match-voice",
    playerId: "alice",
    admissionId: "admission-alice-1",
    players: ["alice", "bob"],
  });
  const bob = manager.prepareAdmission({
    sessionId: "match-voice",
    playerId: "bob",
    admissionId: "admission-bob-1",
    players: ["alice", "bob"],
  });

  expect(alice.channel).toBe(bob.channel);
  expect(alice.uid).not.toBe(bob.uid);
  expect(alice.refreshCapability).not.toBe(bob.refreshCapability);
  expect(alice.participants).toEqual(bob.participants);
  expect(alice.participants).toEqual(
    expect.arrayContaining([
      { playerId: "alice", uid: alice.uid },
      { playerId: "bob", uid: bob.uid },
    ])
  );
  expect(JSON.stringify({ alice, bob })).not.toContain(appCertificate);
  expect(manager.getPublicState()).toEqual({
    enabled: true,
    activeGrants: 0,
    tokenLifetimeSeconds: 600,
  });
});

test("refresh capability is inactive until gameplay connects, rate limited, and revoked on disconnect", () => {
  let now = 1_700_000_000_000;
  let tokenNumber = 0;
  const manager = new VoiceTokenManager(
    managerOptions({
      now: () => now,
      randomBytes: () => Buffer.alloc(32, 7),
      buildToken: () => `007-token-${++tokenNumber}-${"x".repeat(20)}`,
      minRefreshIntervalMs: 5_000,
      maxRefreshesPerMinute: 2,
    })
  );
  const grant = manager.prepareAdmission({
    sessionId: "match-refresh",
    playerId: "alice",
    admissionId: "admission-refresh",
  });
  const authorization = `Bearer ${grant.refreshCapability}`;

  expect(() => manager.refresh(authorization)).toThrow(
    "voice_authorization_invalid"
  );
  manager.activate("admission-refresh", "transport-1");
  expect(() => manager.refresh(authorization)).toThrow(
    "voice_refresh_too_frequent"
  );
  now += 5_000;
  expect(manager.refresh(authorization)).toMatchObject({
    channel: grant.channel,
    uid: grant.uid,
  });
  now += 5_000;
  expect(() => manager.refresh(authorization)).toThrow(
    "voice_refresh_rate_limited"
  );

  manager.revokeAdmission("admission-refresh");
  expect(() => manager.refresh(authorization)).toThrow(
    "voice_authorization_invalid"
  );
});

test("rejects unsafe public token URLs and incomplete server credentials", () => {
  expect(() => validateTokenUrl("http://voice.example/token", false)).toThrow(
    "must use HTTPS"
  );
  expect(() =>
    validateTokenUrl("http://localhost:9209/token", true)
  ).not.toThrow();
  expect(
    () => new VoiceTokenManager(managerOptions({ appCertificate: "too-short" }))
  ).toThrow("AGORA_APP_CERTIFICATE");
  expect(
    () => new VoiceTokenManager(managerOptions({ tokenLifetimeSeconds: 30 }))
  ).toThrow("THNK_VOICE_TOKEN_TTL_SECONDS");
});

test("uses only publisher audio token inputs and sanitizes generation failures", () => {
  const calls = [];
  const manager = new VoiceTokenManager(
    managerOptions({
      randomBytes: () => Buffer.alloc(32, 9),
      buildToken: (...arguments_) => {
        calls.push(arguments_);
        throw new Error(`provider leaked ${appCertificate}`);
      },
    })
  );
  expect(() =>
    manager.prepareAdmission({
      sessionId: "match-failure",
      playerId: "alice",
      admissionId: "admission-failure",
    })
  ).toThrow(new VoiceError("voice_token_generation_failed", 503));
  expect(calls).toHaveLength(1);
  expect(() => manager.refresh("Bearer invalid")).toThrow(
    "voice_authorization_required"
  );
});
