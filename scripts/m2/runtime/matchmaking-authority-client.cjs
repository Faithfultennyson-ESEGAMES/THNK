const { structuredLogger } = require("./structured-logger.cjs");

class MatchmakingAuthorityError extends Error {
  constructor(code, status = 503) {
    super(code);
    this.name = "MatchmakingAuthorityError";
    this.code = code;
    this.status = status;
  }
}

const isPrivateIpv4 = (hostname) => {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value)))
    return false;
  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
};

const validateBaseUrl = (value, allowInsecureLocal) => {
  if (!value) return undefined;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("THNK_MATCHMAKING_URL must be a valid URL.");
  }
  const local =
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) ||
    isPrivateIpv4(url.hostname);
  if (url.protocol !== "https:" && !(allowInsecureLocal && local))
    throw new Error(
      "THNK_MATCHMAKING_URL must use HTTPS (or explicit insecure local development)."
    );
  if (url.username || url.password || url.hash)
    throw new Error("THNK_MATCHMAKING_URL cannot contain credentials or a fragment.");
  return url.toString().replace(/\/$/, "");
};

class MatchmakingAuthorityClient {
  constructor({
    baseUrl,
    serviceToken,
    allowInsecureLocal = false,
    timeoutMs = 5_000,
    fetchImpl = globalThis.fetch,
    logger = structuredLogger,
  } = {}) {
    this.baseUrl = validateBaseUrl(baseUrl, allowInsecureLocal);
    this.serviceToken = serviceToken;
    this.enabled = Boolean(this.baseUrl || serviceToken);
    if (this.enabled && (!this.baseUrl || typeof serviceToken !== "string" || serviceToken.length < 32))
      throw new Error(
        "THNK_MATCHMAKING_URL and THNK_MATCHMAKING_AUTHORITY_TOKEN must be configured together."
      );
    if (this.enabled && typeof fetchImpl !== "function")
      throw new Error("A fetch implementation is required for Matchmaking Authority pull.");
    this.timeoutMs = Number(timeoutMs);
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 500 || this.timeoutMs > 30_000)
      throw new Error("THNK_MATCHMAKING_TIMEOUT_MS must be from 500 to 30000.");
    this.fetchImpl = fetchImpl;
    this.logger = logger;
  }

  async request(path, { method = "POST", body } = {}) {
    if (!this.enabled)
      throw new MatchmakingAuthorityError("matchmaking_authority_pull_disabled", 404);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    timeout.unref?.();
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.serviceToken}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
    } catch {
      throw new MatchmakingAuthorityError("matchmaking_unavailable", 503);
    } finally {
      clearTimeout(timeout);
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new MatchmakingAuthorityError(
        typeof payload?.error === "string"
          ? payload.error
          : `matchmaking_http_${response.status}`,
        response.status
      );
    return payload;
  }

  registerDev(registration) {
    return this.request("/v1/authorities/dev/registration", {
      body: registration,
    });
  }

  heartbeatDev() {
    return this.request("/v1/authorities/dev/heartbeat", { body: {} });
  }

  deregisterDev() {
    return this.request("/v1/authorities/dev/registration", {
      method: "DELETE",
    });
  }

  async claim(identity) {
    const payload = await this.request("/v1/authorities/sessions/claim", {
      body: identity,
    });
    return payload.session;
  }

  ready(sessionId) {
    return this.request("/v1/authorities/sessions/ready", {
      body: { sessionId },
    });
  }

  async pullVoiceGrant({ sessionId, playerId, admissionToken }) {
    const payload = await this.request("/v1/authorities/voice/grant", {
      body: { sessionId, playerId, admissionToken },
    });
    if (!payload?.grant || typeof payload.grant !== "object")
      throw new MatchmakingAuthorityError("invalid_authority_voice_grant", 502);
    return payload.grant;
  }
}

module.exports = {
  MatchmakingAuthorityClient,
  MatchmakingAuthorityError,
  validateBaseUrl,
};
