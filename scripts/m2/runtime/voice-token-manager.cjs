const crypto = require("crypto");
const { RtcRole, RtcTokenBuilder } = require("agora-token");

const APP_CREDENTIAL_PATTERN = /^[a-f0-9]{32}$/i;
const DEFAULT_TOKEN_LIFETIME_SECONDS = 600;
const DEFAULT_MIN_REFRESH_INTERVAL_MS = 5_000;
const DEFAULT_MAX_REFRESHES_PER_MINUTE = 8;

class VoiceError extends Error {
  constructor(code, status = 400, retryAfterSeconds) {
    super(code);
    this.name = "VoiceError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const integerOption = (name, value, minimum, maximum) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new Error(
      `${name} must be an integer from ${minimum} to ${maximum}.`
    );
  return parsed;
};

const validateTokenUrl = (value, allowInsecureLoopback) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("THNK_VOICE_TOKEN_URL must be an absolute URL.");
  }
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(url.hostname);
  if (url.protocol !== "https:" && !(allowInsecureLoopback && loopback))
    throw new Error(
      "THNK_VOICE_TOKEN_URL must use HTTPS, except for explicitly enabled loopback development."
    );
  if (url.username || url.password || url.hash)
    throw new Error(
      "THNK_VOICE_TOKEN_URL cannot contain credentials or a fragment."
    );
  return url.toString();
};

const hash = (value) =>
  crypto.createHash("sha256").update(value, "utf8").digest("hex");

const channelForSession = (sessionId) => `thnk-${hash(sessionId).slice(0, 40)}`;
const uidForPlayer = (sessionId, playerId) =>
  `thnk-u-${hash(`${sessionId}\0${playerId}`).slice(0, 40)}`;

class VoiceTokenManager {
  constructor({
    enabled = false,
    appId,
    appCertificate,
    tokenUrl,
    allowInsecureLoopback = false,
    tokenLifetimeSeconds = DEFAULT_TOKEN_LIFETIME_SECONDS,
    minRefreshIntervalMs = DEFAULT_MIN_REFRESH_INTERVAL_MS,
    maxRefreshesPerMinute = DEFAULT_MAX_REFRESHES_PER_MINUTE,
    now = () => Date.now(),
    randomBytes = (length) => crypto.randomBytes(length),
    buildToken = (...arguments_) =>
      RtcTokenBuilder.buildTokenWithUserAccount(...arguments_),
  } = {}) {
    this.enabled = enabled;
    this.now = now;
    this.randomBytes = randomBytes;
    this.buildToken = buildToken;
    this.recordsByCapabilityHash = new Map();
    this.capabilityHashByAdmission = new Map();

    if (!enabled) return;
    if (!APP_CREDENTIAL_PATTERN.test(appId || ""))
      throw new Error(
        "AGORA_APP_ID must contain exactly 32 hexadecimal characters."
      );
    if (!APP_CREDENTIAL_PATTERN.test(appCertificate || ""))
      throw new Error(
        "AGORA_APP_CERTIFICATE must contain exactly 32 hexadecimal characters."
      );
    this.appId = appId;
    this.appCertificate = appCertificate;
    this.tokenUrl = validateTokenUrl(tokenUrl, allowInsecureLoopback);
    this.tokenLifetimeSeconds = integerOption(
      "THNK_VOICE_TOKEN_TTL_SECONDS",
      tokenLifetimeSeconds,
      120,
      3_600
    );
    this.minRefreshIntervalMs = integerOption(
      "THNK_VOICE_MIN_REFRESH_INTERVAL_MS",
      minRefreshIntervalMs,
      1_000,
      60_000
    );
    this.maxRefreshesPerMinute = integerOption(
      "THNK_VOICE_MAX_REFRESHES_PER_MINUTE",
      maxRefreshesPerMinute,
      1,
      60
    );
  }

  reset() {
    this.recordsByCapabilityHash.clear();
    this.capabilityHashByAdmission.clear();
  }

  createToken(record) {
    const issuedAt = this.now();
    let token;
    try {
      token = this.buildToken(
        this.appId,
        this.appCertificate,
        record.channel,
        record.uid,
        RtcRole.PUBLISHER,
        this.tokenLifetimeSeconds,
        this.tokenLifetimeSeconds
      );
    } catch {
      throw new VoiceError("voice_token_generation_failed", 503);
    }
    if (typeof token !== "string" || token.length < 16)
      throw new VoiceError("voice_token_generation_failed", 503);
    record.issuedAt.push(issuedAt);
    return {
      appId: this.appId,
      channel: record.channel,
      uid: record.uid,
      token,
      expiresAt: new Date(
        issuedAt + this.tokenLifetimeSeconds * 1_000
      ).toISOString(),
    };
  }

  prepareAdmission({ sessionId, playerId, admissionId, players = [] }) {
    if (!this.enabled) return undefined;
    const capability = this.randomBytes(32).toString("base64url");
    const capabilityHash = hash(capability);
    const record = {
      sessionId,
      playerId,
      admissionId,
      state: "pending",
      connectionId: undefined,
      channel: channelForSession(sessionId),
      uid: uidForPlayer(sessionId, playerId),
      issuedAt: [],
    };
    this.recordsByCapabilityHash.set(capabilityHash, record);
    this.capabilityHashByAdmission.set(admissionId, capabilityHash);
    try {
      return {
        ...this.createToken(record),
        participants: players.map((canonicalPlayerId) => ({
          playerId: canonicalPlayerId,
          uid: uidForPlayer(sessionId, canonicalPlayerId),
        })),
        refreshUrl: this.tokenUrl,
        refreshCapability: capability,
      };
    } catch (error) {
      this.revokeAdmission(admissionId);
      throw error;
    }
  }

  activate(admissionId, connectionId) {
    if (!this.enabled) return;
    const capabilityHash = this.capabilityHashByAdmission.get(admissionId);
    const record = this.recordsByCapabilityHash.get(capabilityHash);
    if (!record || record.state !== "pending") return;
    record.state = "active";
    record.connectionId = connectionId;
  }

  revokeAdmission(admissionId) {
    if (!this.enabled) return;
    const capabilityHash = this.capabilityHashByAdmission.get(admissionId);
    this.capabilityHashByAdmission.delete(admissionId);
    if (capabilityHash) this.recordsByCapabilityHash.delete(capabilityHash);
  }

  refresh(authorizationHeader) {
    if (!this.enabled) throw new VoiceError("voice_disabled", 404);
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(
      authorizationHeader || ""
    );
    if (!match) throw new VoiceError("voice_authorization_required", 401);
    const record = this.recordsByCapabilityHash.get(hash(match[1]));
    if (!record || record.state !== "active")
      throw new VoiceError("voice_authorization_invalid", 401);

    const now = this.now();
    record.issuedAt = record.issuedAt.filter(
      (issuedAt) => issuedAt > now - 60_000
    );
    const lastIssue = record.issuedAt.at(-1);
    if (
      lastIssue !== undefined &&
      now - lastIssue < this.minRefreshIntervalMs
    ) {
      const retryAfterSeconds = Math.ceil(
        (this.minRefreshIntervalMs - (now - lastIssue)) / 1_000
      );
      throw new VoiceError(
        "voice_refresh_too_frequent",
        429,
        retryAfterSeconds
      );
    }
    if (record.issuedAt.length >= this.maxRefreshesPerMinute)
      throw new VoiceError("voice_refresh_rate_limited", 429, 60);
    return this.createToken(record);
  }

  getPublicState() {
    return {
      enabled: this.enabled,
      activeGrants: [...this.recordsByCapabilityHash.values()].filter(
        (record) => record.state === "active"
      ).length,
      tokenLifetimeSeconds: this.enabled
        ? this.tokenLifetimeSeconds
        : undefined,
    };
  }
}

module.exports = {
  APP_CREDENTIAL_PATTERN,
  VoiceError,
  VoiceTokenManager,
  channelForSession,
  uidForPlayer,
  validateTokenUrl,
};
