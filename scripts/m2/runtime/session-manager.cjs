const crypto = require("crypto");
const { EventEmitter } = require("events");
const {
  AdmissionError,
  createJwtVerifier,
  validIdentifier,
} = require("./jwt-verifier.cjs");
const { WebhookOutbox } = require("./webhook-outbox.cjs");
const { VoiceError, VoiceTokenManager } = require("./voice-token-manager.cjs");

class BridgeError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = "BridgeError";
    this.code = code;
    this.status = status;
  }
}

const validateCallbackUrl = (value, allowInsecureCallbacks) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new BridgeError("invalid_callback_url");
  }
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(url.hostname);
  if (url.protocol !== "https:" && !(allowInsecureCallbacks && loopback))
    throw new BridgeError("callback_must_use_https");
  if (url.username || url.password)
    throw new BridgeError("callback_credentials_not_allowed");
  return url.toString();
};

class SessionManager extends EventEmitter {
  constructor({
    enabled = false,
    webhookSecret,
    allowInsecureCallbacks = false,
    fetchImpl,
    now = () => Date.now(),
    randomUUID = () => crypto.randomUUID(),
    outboxOptions = {},
    playerDrainTimeoutMs = 3_000,
    voiceManager = new VoiceTokenManager(),
  } = {}) {
    super();
    this.enabled = enabled;
    this.webhookSecret = webhookSecret;
    this.allowInsecureCallbacks = allowInsecureCallbacks;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.randomUUID = randomUUID;
    this.outboxOptions = outboxOptions;
    this.playerDrainTimeoutMs = playerDrainTimeoutMs;
    this.voiceManager = voiceManager;
    this.gameReady = false;
    this.session = undefined;
    this.verifier = undefined;
    this.outbox = undefined;
    this.usedTokenIds = new Set();
    this.pendingAdmissions = new Map();
    this.pendingByPlayer = new Map();
    this.activePlayers = new Map();
  }

  setGameReady(value = true) {
    this.gameReady = value;
  }

  isReady() {
    return (
      this.gameReady && (!this.enabled || this.session?.status === "active")
    );
  }

  prunePendingAdmissions() {
    const nowSeconds = Math.floor(this.now() / 1000);
    for (const [admissionId, identity] of this.pendingAdmissions) {
      if (identity.expiresAt > nowSeconds) continue;
      this.pendingAdmissions.delete(admissionId);
      this.voiceManager.revokeAdmission(admissionId);
      if (this.pendingByPlayer.get(identity.playerId) === admissionId)
        this.pendingByPlayer.delete(identity.playerId);
    }
  }

  createSession(input) {
    if (!this.enabled) throw new BridgeError("bridge_disabled", 404);
    if (this.session && this.session.status !== "ended")
      throw new BridgeError("session_already_active", 409);
    if (!this.webhookSecret || this.webhookSecret.length < 32)
      throw new BridgeError("webhook_secret_not_configured", 500);
    if (!validIdentifier(input?.sessionId))
      throw new BridgeError("invalid_session_id");
    if (!Array.isArray(input.players) || input.players.length < 1)
      throw new BridgeError("players_required");
    if (input.players.length > 256) throw new BridgeError("roster_too_large");

    const roster = new Set();
    for (const player of input.players) {
      const playerId = typeof player === "string" ? player : player?.playerId;
      if (!validIdentifier(playerId))
        throw new BridgeError("invalid_player_id");
      if (roster.has(playerId)) throw new BridgeError("duplicate_player_id");
      roster.add(playerId);
    }
    if (input.reconnectPolicy && input.reconnectPolicy !== "fresh-token")
      throw new BridgeError("unsupported_reconnect_policy");

    const callbackUrl = validateCallbackUrl(
      input.callbackUrl,
      this.allowInsecureCallbacks
    );
    try {
      this.verifier = createJwtVerifier({
        publicKey: input.tokenVerification?.publicKey,
        keyId: input.tokenVerification?.keyId,
        issuer: input.tokenVerification?.issuer,
        audience: input.tokenVerification?.audience,
        algorithm: input.tokenVerification?.algorithm || "RS256",
        now: this.now,
      });
    } catch (error) {
      if (error instanceof AdmissionError)
        throw new BridgeError(error.code, error.status);
      throw error;
    }

    this.usedTokenIds.clear();
    this.pendingAdmissions.clear();
    this.pendingByPlayer.clear();
    this.activePlayers.clear();
    this.voiceManager.reset();
    this.outbox = new WebhookOutbox({
      callbackUrl,
      secret: this.webhookSecret,
      fetchImpl: this.fetchImpl,
      now: () => new Date(this.now()),
      randomUUID: this.randomUUID,
      ...this.outboxOptions,
    });
    this.session = {
      sessionId: input.sessionId,
      status: "active",
      createdAt: new Date(this.now()).toISOString(),
      callbackUrl,
      reconnectPolicy: "fresh-token",
      roster,
      metadata:
        input.metadata && typeof input.metadata === "object"
          ? structuredClone(input.metadata)
          : {},
      tokenVerification: {
        keyId: input.tokenVerification.keyId,
        issuer: input.tokenVerification.issuer,
        audience: input.tokenVerification.audience,
        algorithm: input.tokenVerification.algorithm || "RS256",
      },
    };
    this.outbox.enqueue("session.started", this.session.sessionId, {
      data: { metadata: this.session.metadata },
    });
    return this.getPublicState();
  }

  authorize(authorizationHeader) {
    if (!this.enabled) return {};
    if (!this.session || this.session.status !== "active")
      throw new AdmissionError("session_not_active", 503);
    this.prunePendingAdmissions();
    if (typeof authorizationHeader !== "string")
      throw new AdmissionError("authorization_required");
    const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(authorizationHeader);
    if (!match) throw new AdmissionError("invalid_authorization");
    const claims = this.verifier(match[1]);
    if (claims.sessionId !== this.session.sessionId)
      throw new AdmissionError("wrong_session", 403);
    if (!this.session.roster.has(claims.playerId))
      throw new AdmissionError("player_not_rostered", 403);
    if (this.usedTokenIds.has(claims.jti))
      throw new AdmissionError("token_replayed", 409);
    if (
      this.pendingByPlayer.has(claims.playerId) ||
      this.activePlayers.has(claims.playerId)
    )
      throw new AdmissionError("player_already_connected", 409);

    const admissionId = this.randomUUID();
    const identity = Object.freeze({
      sessionId: claims.sessionId,
      playerId: claims.playerId,
      admissionId,
      tokenId: claims.jti,
      expiresAt: claims.expiresAt,
    });
    this.usedTokenIds.add(claims.jti);
    this.pendingAdmissions.set(admissionId, identity);
    this.pendingByPlayer.set(claims.playerId, admissionId);
    try {
      const thnkVoice = this.voiceManager.prepareAdmission({
        ...identity,
        players: [...this.session.roster],
      });
      return thnkVoice
        ? { thnkIdentity: identity, thnkVoice }
        : { thnkIdentity: identity };
    } catch (error) {
      const errorCode =
        error instanceof VoiceError ? error.code : "voice_unavailable";
      this.emit("voice-error", { code: errorCode });
      return {
        thnkIdentity: identity,
        thnkVoice: { available: false, errorCode },
      };
    }
  }

  playerConnected(identity, connectionId) {
    if (!this.enabled) return true;
    if (!identity || identity.sessionId !== this.session?.sessionId)
      return false;
    const pending = this.pendingAdmissions.get(identity.admissionId);
    if (!pending || pending.playerId !== identity.playerId) return false;
    if (this.activePlayers.has(identity.playerId)) return false;

    this.pendingAdmissions.delete(identity.admissionId);
    this.pendingByPlayer.delete(identity.playerId);
    this.activePlayers.set(identity.playerId, {
      ...identity,
      connectionId,
      joinedAt: new Date(this.now()).toISOString(),
    });
    this.voiceManager.activate(identity.admissionId, connectionId);
    this.outbox.enqueue("player.joined", this.session.sessionId, {
      playerId: identity.playerId,
      connectionId,
    });
    return true;
  }

  playerDisconnected(identity, connectionId) {
    if (!this.enabled || !identity) return;
    const active = this.activePlayers.get(identity.playerId);
    if (!active || active.connectionId !== connectionId) return;
    this.activePlayers.delete(identity.playerId);
    this.voiceManager.revokeAdmission(identity.admissionId);
    this.outbox.enqueue("player.left", this.session.sessionId, {
      playerId: identity.playerId,
      connectionId,
    });
    if (this.activePlayers.size === 0) this.emit("players-drained");
  }

  async waitForPlayersDrained() {
    if (this.activePlayers.size === 0) return true;
    let timeout;
    let onDrained;
    const drained = new Promise((resolve) => {
      onDrained = () => resolve(true);
      this.once("players-drained", onDrained);
    });
    const timedOut = new Promise((resolve) => {
      timeout = setTimeout(() => resolve(false), this.playerDrainTimeoutMs);
      timeout.unref?.();
    });
    const result = await Promise.race([drained, timedOut]);
    clearTimeout(timeout);
    this.off("players-drained", onDrained);
    return result;
  }

  endSession(reason = "requested") {
    if (!this.enabled) throw new BridgeError("bridge_disabled", 404);
    if (!this.session || this.session.status !== "active")
      throw new BridgeError("session_not_active", 409);
    this.session.status = "ending";
    this.voiceManager.reset();
    const drain = (async () => {
      this.emit("session-ending", { reason });
      const playersDrained = await this.waitForPlayersDrained();
      const { delivery } = this.outbox.enqueue(
        "session.ended",
        this.session.sessionId,
        { data: { reason, playersDrained } }
      );
      await Promise.allSettled([delivery, this.outbox.drain(5_000)]);
      return playersDrained;
    })();
    return { state: this.getPublicState(), drain };
  }

  getPublicState() {
    if (!this.session) return null;
    return {
      sessionId: this.session.sessionId,
      status: this.session.status,
      createdAt: this.session.createdAt,
      reconnectPolicy: this.session.reconnectPolicy,
      roster: [...this.session.roster],
      metadata: structuredClone(this.session.metadata),
      tokenVerification: { ...this.session.tokenVerification },
      connectedPlayers: [...this.activePlayers.keys()],
      pendingPlayers: [...this.pendingByPlayer.keys()],
      webhook: this.outbox.stats(),
      voice: this.voiceManager.getPublicState(),
    };
  }

  refreshVoice(authorizationHeader) {
    if (!this.enabled || !this.session || this.session.status !== "active")
      throw new VoiceError("session_not_active", 503);
    return this.voiceManager.refresh(authorizationHeader);
  }
}

const bridgeEnabled = process.env.THNK_BRIDGE_ENABLED === "true";
const voiceEnabled = process.env.THNK_VOICE_ENABLED === "true";
if (voiceEnabled && !bridgeEnabled)
  throw new Error("THNK_VOICE_ENABLED requires THNK_BRIDGE_ENABLED=true.");
const voiceManager = new VoiceTokenManager({
  enabled: voiceEnabled,
  appId: process.env.AGORA_APP_ID,
  appCertificate: process.env.AGORA_APP_CERTIFICATE,
  tokenUrl: process.env.THNK_VOICE_TOKEN_URL,
  allowInsecureLoopback:
    process.env.THNK_ALLOW_INSECURE_VOICE_TOKEN_URL === "true",
  tokenLifetimeSeconds: process.env.THNK_VOICE_TOKEN_TTL_SECONDS || 600,
  minRefreshIntervalMs: process.env.THNK_VOICE_MIN_REFRESH_INTERVAL_MS || 5_000,
  maxRefreshesPerMinute: process.env.THNK_VOICE_MAX_REFRESHES_PER_MINUTE || 8,
});
const sessionManager = new SessionManager({
  enabled: bridgeEnabled,
  webhookSecret: process.env.THNK_WEBHOOK_SECRET,
  allowInsecureCallbacks: process.env.THNK_ALLOW_INSECURE_CALLBACKS === "true",
  voiceManager,
});

module.exports = { BridgeError, SessionManager, sessionManager };
