const crypto = require("crypto");
const { EventEmitter } = require("events");
const {
  AdmissionError,
  createJwtVerifier,
  normalizeTags,
  validIdentifier,
} = require("./jwt-verifier.cjs");
const { WebhookOutbox } = require("./webhook-outbox.cjs");
const {
  VoiceError,
  VoiceTokenManager,
  validateExternalGrant,
} = require("./voice-token-manager.cjs");
const { PlayerProfileClient } = require("./player-profile-client.cjs");
const { structuredLogger } = require("./structured-logger.cjs");

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
    profileClient = new PlayerProfileClient(),
    runtimeIdentity = {},
    maxSessionDurationMs = 4 * 60 * 60 * 1_000,
    logger = structuredLogger,
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
    this.profileClient = profileClient;
    this.runtimeIdentity = Object.freeze({ ...runtimeIdentity });
    this.maxSessionDurationMs = Number(maxSessionDurationMs);
    if (
      !Number.isInteger(this.maxSessionDurationMs) ||
      this.maxSessionDurationMs < 1_000 ||
      this.maxSessionDurationMs > 24 * 60 * 60 * 1_000
    )
      throw new Error(
        "THNK_MAX_SESSION_DURATION_MS must be an integer from 1000 to 86400000."
      );
    this.logger = logger;
    this.gameReady = false;
    this.session = undefined;
    this.verifier = undefined;
    this.outbox = undefined;
    this.usedTokenIds = new Set();
    this.pendingAdmissions = new Map();
    this.pendingByPlayer = new Map();
    this.activePlayers = new Map();
    this.documentsByAdmission = new Map();
    this.pendingProfileWrites = new Set();
    this.profileWriteTails = new Map();
    this.recentViolations = new Map();
    this.sessionCreationPending = false;
    this.maximumDurationTimer = undefined;
    this.sessionDrain = undefined;
    this.dependencyState = {
      playerProfile: this.profileClient.enabled ? "unknown" : "disabled",
    };
  }

  setGameReady(value = true) {
    this.gameReady = value;
    this.logger.info("authority.readiness_changed", {
      sessionId: this.session?.sessionId,
      ready: value,
    });
    if (value && this.session?.status === "starting") {
      this.session.status = "active";
      this.outbox.enqueue("session.started", this.session.sessionId, {
        data: {
          metadata: this.session.metadata,
          authorityId: this.session.authorityId,
          serverBuildId: this.session.serverBuildId,
        },
      });
    }
  }

  isReady() {
    return (
      this.gameReady &&
      (!this.enabled || this.session?.status === "active") &&
      this.dependencyState.playerProfile !== "unavailable"
    );
  }

  getHealthState() {
    const webhook = this.outbox?.stats();
    return {
      ready: this.isReady(),
      checks: {
        authority: this.gameReady ? "ready" : "not_ready",
        session: this.enabled ? this.session?.status || "absent" : "direct",
        playerProfile: this.dependencyState.playerProfile,
        webhook:
          webhook?.failed > 0
            ? "degraded"
            : webhook?.pending > 0
            ? "pending"
            : "available",
      },
    };
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
    const runtime = this.runtimeIdentity;
    for (const [name, value] of Object.entries(runtime)) {
      if (name === "mapId" && value === "") continue;
      if (!validIdentifier(value))
        throw new BridgeError(`runtime_${name}_not_configured`, 500);
    }
    if (input.gameId !== runtime.gameId)
      throw new BridgeError("wrong_game", 409);
    if (input.authorityId !== runtime.authorityId)
      throw new BridgeError("wrong_authority", 409);
    if ((input.mapId || "") !== (runtime.mapId || ""))
      throw new BridgeError("wrong_map", 409);
    if (input.serverBuildId !== runtime.serverBuildId)
      throw new BridgeError("wrong_server_build", 409);
    if (
      input.compatibilityVersion !== runtime.compatibilityVersion ||
      input.clientBuildId !== runtime.clientBuildId ||
      input.protocolVersion !== runtime.protocolVersion
    )
      throw new BridgeError("client_update_required", 426);
    if (!Array.isArray(input.players) || input.players.length < 1)
      throw new BridgeError("players_required");
    if (input.players.length > 256) throw new BridgeError("roster_too_large");

    const roster = new Map();
    for (const player of input.players) {
      const playerId = typeof player === "string" ? player : player?.playerId;
      if (!validIdentifier(playerId))
        throw new BridgeError("invalid_player_id");
      if (roster.has(playerId)) throw new BridgeError("duplicate_player_id");
      roster.set(
        playerId,
        normalizeTags(
          typeof player === "string" ? undefined : player.tags,
          BridgeError
        )
      );
    }
    const voiceGrants = new Map();
    if (input.voiceGrants !== undefined) {
      if (
        !input.voiceGrants ||
        typeof input.voiceGrants !== "object" ||
        Array.isArray(input.voiceGrants)
      )
        throw new BridgeError("invalid_voice_grants");
      const suppliedPlayers = Object.keys(input.voiceGrants);
      if (
        suppliedPlayers.length !== roster.size ||
        suppliedPlayers.some((playerId) => !roster.has(playerId))
      )
        throw new BridgeError("voice_grants_must_match_roster");
      try {
        for (const playerId of roster.keys())
          voiceGrants.set(
            playerId,
            validateExternalGrant(input.voiceGrants[playerId], this.now())
          );
      } catch (error) {
        if (error instanceof VoiceError)
          throw new BridgeError(error.code, error.status);
        throw error;
      }
      const first = voiceGrants.values().next().value;
      const voiceUids = new Set();
      const voiceTokens = new Set();
      const refreshCapabilities = new Set();
      for (const grant of voiceGrants.values()) {
        if (grant.appId !== first.appId || grant.channel !== first.channel)
          throw new BridgeError("voice_grants_not_session_isolated");
        if (
          voiceUids.has(grant.uid) ||
          voiceTokens.has(grant.token) ||
          refreshCapabilities.has(grant.refreshCapability)
        )
          throw new BridgeError("voice_grants_not_player_isolated");
        voiceUids.add(grant.uid);
        voiceTokens.add(grant.token);
        refreshCapabilities.add(grant.refreshCapability);
      }
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
    this.documentsByAdmission.clear();
    this.pendingProfileWrites.clear();
    this.profileWriteTails.clear();
    this.recentViolations.clear();
    clearTimeout(this.maximumDurationTimer);
    this.sessionDrain = undefined;
    this.voiceManager.reset();
    this.outbox = new WebhookOutbox({
      callbackUrl,
      secret: this.webhookSecret,
      fetchImpl: this.fetchImpl,
      now: () => new Date(this.now()),
      randomUUID: this.randomUUID,
      logger: this.logger,
      ...this.outboxOptions,
    });
    this.session = {
      sessionId: input.sessionId,
      status: this.gameReady ? "active" : "starting",
      createdAt: new Date(this.now()).toISOString(),
      gameId: runtime.gameId,
      authorityId: runtime.authorityId,
      mapId: runtime.mapId || "",
      serverBuildId: runtime.serverBuildId,
      compatibilityVersion: runtime.compatibilityVersion,
      clientBuildId: runtime.clientBuildId,
      protocolVersion: runtime.protocolVersion,
      callbackUrl,
      reconnectPolicy: "fresh-token",
      roster,
      voiceGrants,
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
    this.maximumDurationTimer = setTimeout(() => {
      this.logger.warn("session.maximum_duration_reached", {
        sessionId: this.session?.sessionId,
        maxSessionDurationMs: this.maxSessionDurationMs,
      });
      this.emit("maximum-duration");
    }, this.maxSessionDurationMs);
    this.maximumDurationTimer.unref?.();
    this.logger.info("session.created", {
      sessionId: this.session.sessionId,
      authorityId: this.session.authorityId,
      serverBuildId: this.session.serverBuildId,
      rosterSize: this.session.roster.size,
    });
    if (this.session.status === "active")
      this.outbox.enqueue("session.started", this.session.sessionId, {
        data: {
          metadata: this.session.metadata,
          authorityId: this.session.authorityId,
          serverBuildId: this.session.serverBuildId,
        },
      });
    return this.getPublicState();
  }

  async prepareSession(input) {
    if (this.sessionCreationPending)
      throw new BridgeError("session_creation_in_progress", 409);
    this.sessionCreationPending = true;
    try {
      this.validateSessionPreflight(input);
      if (this.profileClient.enabled) {
        if (!Array.isArray(input?.players) || input.players.length < 1)
          throw new BridgeError("players_required");
        const playerIds = input.players.map((player) =>
          typeof player === "string" ? player : player?.playerId
        );
        for (const playerId of playerIds)
          if (!validIdentifier(playerId))
            throw new BridgeError("invalid_player_id");
        let blocked;
        try {
          blocked = await Promise.all(
            playerIds.map((playerId) => this.profileClient.isBlocked(playerId))
          );
          this.dependencyState.playerProfile = "available";
        } catch (error) {
          this.dependencyState.playerProfile = "unavailable";
          throw new BridgeError(
            error?.code || "player_profile_unavailable",
            Number.isInteger(error?.status) ? error.status : 503
          );
        }
        if (blocked.some(Boolean)) throw new BridgeError("player_blocked", 403);
      }
      return this.createSession(input);
    } finally {
      this.sessionCreationPending = false;
    }
  }

  validateSessionPreflight(input) {
    if (!this.enabled) throw new BridgeError("bridge_disabled", 404);
    if (this.session && this.session.status !== "ended")
      throw new BridgeError("session_already_active", 409);
    if (!this.webhookSecret || this.webhookSecret.length < 32)
      throw new BridgeError("webhook_secret_not_configured", 500);
    if (!validIdentifier(input?.sessionId))
      throw new BridgeError("invalid_session_id");
    const runtime = this.runtimeIdentity;
    if (input.gameId !== runtime.gameId)
      throw new BridgeError("wrong_game", 409);
    if (input.authorityId !== runtime.authorityId)
      throw new BridgeError("wrong_authority", 409);
    if ((input.mapId || "") !== (runtime.mapId || ""))
      throw new BridgeError("wrong_map", 409);
    if (input.serverBuildId !== runtime.serverBuildId)
      throw new BridgeError("wrong_server_build", 409);
    if (
      input.compatibilityVersion !== runtime.compatibilityVersion ||
      input.clientBuildId !== runtime.clientBuildId ||
      input.protocolVersion !== runtime.protocolVersion
    )
      throw new BridgeError("client_update_required", 426);
    if (!Array.isArray(input.players) || input.players.length < 1)
      throw new BridgeError("players_required");
    if (input.players.length > 256) throw new BridgeError("roster_too_large");
    const seen = new Set();
    for (const player of input.players) {
      const playerId = typeof player === "string" ? player : player?.playerId;
      if (!validIdentifier(playerId))
        throw new BridgeError("invalid_player_id");
      if (seen.has(playerId)) throw new BridgeError("duplicate_player_id");
      seen.add(playerId);
    }
    validateCallbackUrl(input.callbackUrl, this.allowInsecureCallbacks);
    try {
      createJwtVerifier({
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
    if (claims.gameId !== this.session.gameId)
      throw new AdmissionError("wrong_game", 403);
    if (claims.authorityId !== this.session.authorityId)
      throw new AdmissionError("wrong_authority", 403);
    if (claims.mapId !== this.session.mapId)
      throw new AdmissionError("wrong_map", 403);
    if (claims.serverBuildId !== this.session.serverBuildId)
      throw new AdmissionError("wrong_server_build", 403);
    if (
      claims.compatibilityVersion !== this.session.compatibilityVersion ||
      claims.clientBuildId !== this.session.clientBuildId ||
      claims.protocolVersion !== this.session.protocolVersion
    )
      throw new AdmissionError("client_update_required", 426);
    if (!this.session.roster.has(claims.playerId))
      throw new AdmissionError("player_not_rostered", 403);
    const expectedTags = this.session.roster.get(claims.playerId);
    const tagsMatch =
      Object.keys(expectedTags).length === Object.keys(claims.tags).length &&
      Object.entries(expectedTags).every(
        ([key, value]) => claims.tags[key] === value
      );
    if (!tagsMatch) throw new AdmissionError("wrong_player_tags", 403);
    if (this.usedTokenIds.has(claims.jti))
      throw new AdmissionError("token_replayed", 409);
    if (
      this.pendingByPlayer.has(claims.playerId) ||
      this.activePlayers.has(claims.playerId)
    )
      throw new AdmissionError("player_already_connected", 409);

    this.usedTokenIds.add(claims.jti);
    const reservationId = `loading:${claims.jti}`;
    this.pendingByPlayer.set(claims.playerId, reservationId);
    if (this.profileClient.enabled)
      return Promise.resolve(this.profileWriteTails.get(claims.playerId))
        .catch(() => {})
        .then(() =>
          this.profileClient.loadDocument(claims.playerId, this.session.gameId)
        )
        .then((document) => {
          this.dependencyState.playerProfile = "available";
          return this.finishAuthorization(claims, document);
        })
        .catch((error) => {
          this.dependencyState.playerProfile = "unavailable";
          this.usedTokenIds.delete(claims.jti);
          if (this.pendingByPlayer.get(claims.playerId) === reservationId)
            this.pendingByPlayer.delete(claims.playerId);
          throw new AdmissionError(
            error.code || "player_profile_unavailable",
            503
          );
        });
    return this.finishAuthorization(claims, {});
  }

  finishAuthorization(claims, document) {
    if (
      this.session?.status !== "active" ||
      !this.pendingByPlayer.get(claims.playerId)?.startsWith("loading:")
    )
      throw new AdmissionError("session_not_active", 503);
    const admissionId = this.randomUUID();
    const identity = Object.freeze({
      sessionId: claims.sessionId,
      playerId: claims.playerId,
      admissionId,
      tokenId: claims.jti,
      expiresAt: claims.expiresAt,
      gameId: claims.gameId,
      authorityId: claims.authorityId,
      mapId: claims.mapId,
      serverBuildId: claims.serverBuildId,
      compatibilityVersion: claims.compatibilityVersion,
      clientBuildId: claims.clientBuildId,
      protocolVersion: claims.protocolVersion,
      tags: claims.tags,
    });
    this.pendingAdmissions.set(admissionId, identity);
    this.pendingByPlayer.set(claims.playerId, admissionId);
    this.documentsByAdmission.set(admissionId, structuredClone(document));
    this.logger.info("player.admission_authorized", {
      sessionId: identity.sessionId,
      playerId: identity.playerId,
      admissionId,
    });
    try {
      const externalGrant = this.session.voiceGrants.get(claims.playerId);
      const externalParticipants = externalGrant
        ? [...this.session.voiceGrants].map(([playerId, grant]) => ({
            playerId,
            uid: grant.uid,
          }))
        : undefined;
      const thnkVoice = this.voiceManager.prepareAdmission({
        ...identity,
        players: [...this.session.roster.keys()],
        externalGrant,
        externalParticipants,
      });
      return {
        thnkIdentity: identity,
        thnkPlayerDocument: structuredClone(document),
        ...(thnkVoice ? { thnkVoice } : {}),
      };
    } catch (error) {
      const errorCode =
        error instanceof VoiceError ? error.code : "voice_unavailable";
      this.emit("voice-error", { code: errorCode });
      return {
        thnkIdentity: identity,
        thnkPlayerDocument: structuredClone(document),
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
    this.logger.info("player.connected", {
      sessionId: identity.sessionId,
      playerId: identity.playerId,
      connectionId,
    });
    this.outbox.enqueue("player.joined", this.session.sessionId, {
      playerId: identity.playerId,
      connectionId,
      data: { tags: identity.tags },
    });
    return true;
  }

  playerDisconnected(identity, connectionId, document) {
    if (!this.enabled || !identity) return;
    const active = this.activePlayers.get(identity.playerId);
    if (!active || active.connectionId !== connectionId) return;
    this.activePlayers.delete(identity.playerId);
    if (document) this.queueProfileSave(identity, document);
    this.voiceManager.revokeAdmission(identity.admissionId);
    this.documentsByAdmission.delete(identity.admissionId);
    this.logger.info("player.disconnected", {
      sessionId: identity.sessionId,
      playerId: identity.playerId,
      connectionId,
    });
    this.outbox.enqueue("player.left", this.session.sessionId, {
      playerId: identity.playerId,
      connectionId,
      data: { tags: identity.tags },
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

  queueProfileSave(identity, document) {
    if (!this.profileClient.enabled || !identity) return Promise.resolve();
    const savedDocument = structuredClone(document);
    this.documentsByAdmission.set(identity.admissionId, savedDocument);
    const previous = this.profileWriteTails.get(identity.playerId);
    const write = Promise.resolve(previous)
      .catch(() => {})
      .then(() =>
        this.profileClient.saveDocument(
          identity.playerId,
          identity.gameId,
          identity.sessionId,
          savedDocument
        )
      )
      .then(() => {
        this.dependencyState.playerProfile = "available";
        return true;
      })
      .catch((error) => {
        this.dependencyState.playerProfile = "unavailable";
        this.logger.error("player_profile.write_failed", {
          sessionId: identity.sessionId,
          playerId: identity.playerId,
          errorCode: error.code || "player_profile_unavailable",
        });
        this.emit("profile-error", {
          code: error.code || "player_profile_unavailable",
          playerId: identity.playerId,
        });
        return false;
      })
      .finally(() => {
        this.pendingProfileWrites.delete(write);
        if (this.profileWriteTails.get(identity.playerId) === write)
          this.profileWriteTails.delete(identity.playerId);
      });
    this.pendingProfileWrites.add(write);
    this.profileWriteTails.set(identity.playerId, write);
    return write;
  }

  playerDocumentChanged(identity, document) {
    const active = this.activePlayers.get(identity?.playerId);
    if (!active || active.admissionId !== identity.admissionId) return false;
    void this.queueProfileSave(identity, document);
    return true;
  }

  reportTrustViolation(playerId, violationType) {
    const active = this.activePlayers.get(playerId);
    if (!active || typeof violationType !== "string") return false;
    const key = `${active.admissionId}\0${violationType}`;
    const lastReported = this.recentViolations.get(key);
    if (lastReported !== undefined && this.now() - lastReported < 5_000)
      return false;
    this.recentViolations.set(key, this.now());
    this.logger.warn("trust.violation", {
      sessionId: this.session.sessionId,
      playerId,
      connectionId: active.connectionId,
      violationType,
    });
    this.outbox.enqueue("trust.violation", this.session.sessionId, {
      playerId,
      connectionId: active.connectionId,
      violationType,
    });
    return true;
  }

  endSession(reason = "requested") {
    if (!this.enabled) throw new BridgeError("bridge_disabled", 404);
    if (!this.session || !["active", "starting"].includes(this.session.status))
      throw new BridgeError("session_not_active", 409);
    this.session.status = "ending";
    clearTimeout(this.maximumDurationTimer);
    this.voiceManager.reset();
    this.logger.info("session.ending", {
      sessionId: this.session.sessionId,
      reason,
    });
    const drain = (async () => {
      this.emit("session-ending", { reason });
      const playersDrained = await this.waitForPlayersDrained();
      await Promise.allSettled([...this.pendingProfileWrites]);
      const { delivery } = this.outbox.enqueue(
        "session.ended",
        this.session.sessionId,
        { data: { reason, playersDrained } }
      );
      await Promise.allSettled([delivery, this.outbox.drain(5_000)]);
      this.logger.info("session.ended", {
        sessionId: this.session.sessionId,
        reason,
        playersDrained,
      });
      return playersDrained;
    })();
    this.sessionDrain = drain;
    return { state: this.getPublicState(), drain };
  }

  shutdown(reason = "process_shutdown") {
    if (!this.enabled || !this.session) return Promise.resolve(true);
    if (this.session.status === "ending")
      return this.sessionDrain || Promise.resolve(true);
    if (["active", "starting"].includes(this.session.status))
      return this.endSession(reason).drain;
    return Promise.resolve(true);
  }

  getPublicState() {
    if (!this.session) return null;
    return {
      sessionId: this.session.sessionId,
      status: this.session.status,
      createdAt: this.session.createdAt,
      gameId: this.session.gameId,
      authorityId: this.session.authorityId,
      mapId: this.session.mapId,
      serverBuildId: this.session.serverBuildId,
      compatibilityVersion: this.session.compatibilityVersion,
      clientBuildId: this.session.clientBuildId,
      protocolVersion: this.session.protocolVersion,
      reconnectPolicy: this.session.reconnectPolicy,
      roster: [...this.session.roster.keys()],
      playerTags: Object.fromEntries(this.session.roster),
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
const profileClient = new PlayerProfileClient({
  baseUrl: process.env.THNK_PLAYER_PROFILE_URL,
  serviceToken: process.env.THNK_PLAYER_PROFILE_TOKEN,
  allowInsecureLoopback:
    process.env.THNK_ALLOW_INSECURE_PLAYER_PROFILE_URL === "true",
  timeoutMs: process.env.THNK_PLAYER_PROFILE_TIMEOUT_MS || 3_000,
});
const sessionManager = new SessionManager({
  enabled: bridgeEnabled,
  webhookSecret: process.env.THNK_WEBHOOK_SECRET,
  allowInsecureCallbacks: process.env.THNK_ALLOW_INSECURE_CALLBACKS === "true",
  voiceManager,
  profileClient,
  maxSessionDurationMs:
    process.env.THNK_MAX_SESSION_DURATION_MS || 4 * 60 * 60 * 1_000,
  runtimeIdentity: {
    gameId: process.env.THNK_RUNTIME_GAME_ID,
    authorityId: process.env.THNK_AUTHORITY_ID,
    mapId: process.env.THNK_MAP_ID || "",
    serverBuildId: process.env.THNK_RUNTIME_SERVER_BUILD_ID,
    compatibilityVersion: process.env.THNK_RUNTIME_COMPATIBILITY_VERSION,
    clientBuildId: process.env.THNK_RUNTIME_CLIENT_BUILD_ID,
    protocolVersion: process.env.THNK_RUNTIME_PROTOCOL_VERSION,
  },
});

module.exports = { BridgeError, SessionManager, sessionManager };
