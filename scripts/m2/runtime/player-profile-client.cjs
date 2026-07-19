const DEFAULT_TIMEOUT_MS = 3_000;
const MAX_DOCUMENT_BYTES = 64 * 1024;

class PlayerProfileError extends Error {
  constructor(code = "player_profile_unavailable", status = 503) {
    super(code);
    this.name = "PlayerProfileError";
    this.code = code;
    this.status = status;
  }
}

const validateBaseUrl = (value, allowInsecureLoopback) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("THNK_PLAYER_PROFILE_URL must be an absolute URL.");
  }
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(url.hostname);
  if (url.protocol !== "https:" && !(allowInsecureLoopback && loopback))
    throw new Error(
      "THNK_PLAYER_PROFILE_URL must use HTTPS, except for explicitly enabled loopback development."
    );
  if (url.username || url.password || url.hash || url.search)
    throw new Error(
      "THNK_PLAYER_PROFILE_URL cannot contain credentials, a query, or a fragment."
    );
  url.pathname = `${url.pathname.replace(/\/$/, "")}/`;
  return url;
};

const isDocument = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

class PlayerProfileClient {
  constructor({
    baseUrl,
    serviceToken,
    allowInsecureLoopback = false,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.enabled = Boolean(baseUrl || serviceToken);
    if (!this.enabled) return;
    if (
      !baseUrl ||
      typeof serviceToken !== "string" ||
      serviceToken.length < 32
    )
      throw new Error(
        "THNK_PLAYER_PROFILE_URL and a THNK_PLAYER_PROFILE_TOKEN of at least 32 characters are both required."
      );
    if (typeof fetchImpl !== "function")
      throw new Error("A fetch implementation is required for Player Profile.");
    const parsedTimeout = Number(timeoutMs);
    if (
      !Number.isInteger(parsedTimeout) ||
      parsedTimeout < 250 ||
      parsedTimeout > 30_000
    )
      throw new Error(
        "THNK_PLAYER_PROFILE_TIMEOUT_MS must be an integer from 250 to 30000."
      );
    this.baseUrl = validateBaseUrl(baseUrl, allowInsecureLoopback);
    this.serviceToken = serviceToken;
    this.timeoutMs = parsedTimeout;
    this.fetchImpl = fetchImpl;
  }

  async request(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    timeout.unref?.();
    try {
      const response = await this.fetchImpl(new URL(path, this.baseUrl), {
        ...options,
        headers: {
          authorization: `Bearer ${this.serviceToken}`,
          accept: "application/json",
          ...(options.body ? { "content-type": "application/json" } : {}),
          ...options.headers,
        },
        signal: controller.signal,
      });
      if (!response.ok)
        throw new PlayerProfileError(
          response.status === 401 || response.status === 403
            ? "player_profile_unauthorized"
            : "player_profile_unavailable"
        );
      return response;
    } catch (error) {
      if (error instanceof PlayerProfileError) throw error;
      throw new PlayerProfileError();
    } finally {
      clearTimeout(timeout);
    }
  }

  playerPath(playerId, suffix, gameId) {
    const path = `internal/players/${encodeURIComponent(playerId)}/${suffix}`;
    if (gameId === undefined) return path;
    return `${path}?gameId=${encodeURIComponent(gameId)}`;
  }

  async isBlocked(playerId) {
    if (!this.enabled) return false;
    const response = await this.request(this.playerPath(playerId, "blocked"));
    const body = await response.json().catch(() => undefined);
    if (typeof body?.blocked !== "boolean") throw new PlayerProfileError();
    return body.blocked;
  }

  async loadDocument(playerId, gameId) {
    if (!this.enabled) return {};
    const response = await this.request(
      this.playerPath(playerId, "document", gameId)
    );
    const body = await response.json().catch(() => undefined);
    if (!isDocument(body?.document)) throw new PlayerProfileError();
    const encoded = JSON.stringify(body.document);
    if (Buffer.byteLength(encoded) > MAX_DOCUMENT_BYTES)
      throw new PlayerProfileError("player_document_too_large", 413);
    return structuredClone(body.document);
  }

  async saveDocument(playerId, gameId, sessionId, document) {
    if (!this.enabled) return;
    if (!isDocument(document))
      throw new PlayerProfileError("invalid_player_document", 400);
    const body = JSON.stringify({ document, sessionId });
    if (Buffer.byteLength(body) > MAX_DOCUMENT_BYTES)
      throw new PlayerProfileError("player_document_too_large", 413);
    await this.request(this.playerPath(playerId, "document", gameId), {
      method: "PUT",
      body,
    });
  }
}

module.exports = {
  MAX_DOCUMENT_BYTES,
  PlayerProfileClient,
  PlayerProfileError,
  validateBaseUrl,
};
