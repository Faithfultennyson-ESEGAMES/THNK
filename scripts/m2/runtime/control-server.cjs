const crypto = require("crypto");
const http = require("http");
const { BridgeError } = require("./session-manager.cjs");
const { FixedWindowRateLimiter } = require("./rate-limiter.cjs");
const { structuredLogger } = require("./structured-logger.cjs");

const MAX_BODY_BYTES = 64 * 1024;
const MAX_HEADER_BYTES = 16 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_BODY_TIMEOUT_MS = 5_000;

const sendJson = (response, status, body, headers = {}) => {
  const encoded = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": encoded.length,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  response.end(encoded);
};

const voiceHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "600",
};

const authorized = (request, expectedToken) => {
  if (typeof expectedToken !== "string" || expectedToken.length < 32)
    return false;
  const actual = request.headers.authorization;
  const expected = `Bearer ${expectedToken}`;
  if (typeof actual !== "string" || actual.length !== expected.length)
    return false;
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
};

const readJson = (
  request,
  { maxBodyBytes = MAX_BODY_BYTES, timeoutMs = DEFAULT_BODY_TIMEOUT_MS } = {}
) =>
  new Promise((resolve, reject) => {
    if (
      !/^application\/json(?:;|$)/i.test(request.headers["content-type"] || "")
    )
      return reject(new BridgeError("content_type_must_be_json", 415));
    const contentLength = Number(request.headers["content-length"]);
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      request.resume();
      return reject(new BridgeError("request_too_large", 413));
    }
    const chunks = [];
    let length = 0;
    let tooLarge = false;
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onData = (chunk) => {
      if (tooLarge) return;
      length += chunk.length;
      if (length > maxBodyBytes) {
        tooLarge = true;
        chunks.length = 0;
      } else chunks.push(chunk);
    };
    const onEnd = () => {
      if (tooLarge)
        return finish(reject, new BridgeError("request_too_large", 413));
      try {
        finish(resolve, JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        finish(reject, new BridgeError("invalid_json"));
      }
    };
    const onError = (error) => finish(reject, error);
    const timeout = setTimeout(() => {
      request.resume();
      finish(reject, new BridgeError("request_timeout", 408));
    }, timeoutMs);
    timeout.unref?.();
    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
  });

const createControlServer = ({
  sessionManager,
  controlToken,
  onSessionStart = async () => {},
  onSessionEnd = () => {},
  logger = structuredLogger,
  controlRateLimiter = new FixedWindowRateLimiter({
    limit: process.env.THNK_CONTROL_RATE_LIMIT_PER_MINUTE || 120,
  }),
  voiceRateLimiter = new FixedWindowRateLimiter({
    limit: process.env.THNK_VOICE_HTTP_RATE_LIMIT_PER_MINUTE || 60,
  }),
  requestTimeoutMs = process.env.THNK_CONTROL_REQUEST_TIMEOUT_MS ||
    DEFAULT_REQUEST_TIMEOUT_MS,
  bodyTimeoutMs = process.env.THNK_CONTROL_BODY_TIMEOUT_MS ||
    DEFAULT_BODY_TIMEOUT_MS,
}) => {
  const parsedRequestTimeoutMs = Number(requestTimeoutMs);
  const parsedBodyTimeoutMs = Number(bodyTimeoutMs);
  if (
    !Number.isInteger(parsedRequestTimeoutMs) ||
    parsedRequestTimeoutMs < 1_000 ||
    parsedRequestTimeoutMs > 120_000
  )
    throw new Error(
      "THNK_CONTROL_REQUEST_TIMEOUT_MS must be an integer from 1000 to 120000."
    );
  if (
    !Number.isInteger(parsedBodyTimeoutMs) ||
    parsedBodyTimeoutMs < 250 ||
    parsedBodyTimeoutMs > 30_000 ||
    parsedBodyTimeoutMs > parsedRequestTimeoutMs
  )
    throw new Error(
      "THNK_CONTROL_BODY_TIMEOUT_MS must be an integer from 250 up to THNK_CONTROL_REQUEST_TIMEOUT_MS."
    );
  const server = http.createServer(
    { maxHeaderSize: MAX_HEADER_BYTES },
    async (request, response) => {
      const startedAt = Date.now();
      const requestId = crypto.randomUUID();
      const path = new URL(request.url, "http://127.0.0.1").pathname;
      const remoteAddress = request.socket.remoteAddress || "unknown";
      const reply = (status, body, headers) => {
        logger.info("control.response", {
          requestId,
          method: request.method,
          path,
          status,
          durationMs: Date.now() - startedAt,
          remoteAddress,
          sessionId: sessionManager.getPublicState?.()?.sessionId,
        });
        return sendJson(response, status, body, headers);
      };
      try {
        if (request.method === "OPTIONS" && path === "/v1/voice/token") {
          response.writeHead(204, voiceHeaders);
          response.end();
          return;
        }
        const isVoiceRoute = path === "/v1/voice/token";
        const rateGroup = path.startsWith("/health/") ? "health" : "control";
        const rate = (
          isVoiceRoute ? voiceRateLimiter : controlRateLimiter
        ).check(`${remoteAddress}:${isVoiceRoute ? "voice" : rateGroup}`);
        if (!rate.allowed)
          return reply(
            429,
            { error: "rate_limit_exceeded" },
            {
              ...(isVoiceRoute ? voiceHeaders : {}),
              "retry-after": String(rate.retryAfterSeconds),
            }
          );
        if (path === "/v1/voice/token") {
          if (request.method !== "POST")
            return reply(405, { error: "method_not_allowed" }, voiceHeaders);
          try {
            return reply(
              200,
              sessionManager.refreshVoice(request.headers.authorization),
              voiceHeaders
            );
          } catch (error) {
            const status = Number.isInteger(error?.status) ? error.status : 500;
            const code = error?.code || "internal_error";
            const headers = { ...voiceHeaders };
            if (error?.retryAfterSeconds)
              headers["retry-after"] = String(error.retryAfterSeconds);
            return reply(status, { error: code }, headers);
          }
        }
        if (request.method === "GET" && path === "/health/live")
          return reply(200, { status: "live" });
        if (request.method === "GET" && path === "/health/ready") {
          const health = sessionManager.getHealthState?.() || {
            ready: sessionManager.isReady(),
          };
          return reply(health.ready ? 200 : 503, {
            status: health.ready ? "ready" : "not_ready",
            checks: health.checks,
          });
        }

        if (!["/v1/session", "/v1/session/end"].includes(path))
          return reply(404, { error: "not_found" });
        if (!authorized(request, controlToken))
          return reply(401, { error: "unauthorized" });

        if (request.method === "GET" && path === "/v1/session")
          return reply(200, {
            session: sessionManager.getPublicState(),
          });
        if (request.method === "POST" && path === "/v1/session") {
          const input = await readJson(request, {
            timeoutMs: parsedBodyTimeoutMs,
          });
          if (typeof sessionManager.prepareSession === "function")
            await sessionManager.prepareSession(input);
          else sessionManager.createSession(input);
          await onSessionStart();
          return reply(201, {
            session: sessionManager.getPublicState(),
          });
        }
        if (request.method === "POST" && path === "/v1/session/end") {
          const input = await readJson(request, {
            timeoutMs: parsedBodyTimeoutMs,
          });
          const result = sessionManager.endSession(
            input?.reason || "requested"
          );
          reply(202, { session: result.state });
          onSessionEnd(result.drain);
          return;
        }
        return reply(405, { error: "method_not_allowed" });
      } catch (error) {
        const status = error instanceof BridgeError ? error.status : 500;
        const code =
          error instanceof BridgeError ? error.code : "internal_error";
        if (status >= 500)
          logger.error("control.request_failed", {
            requestId,
            method: request.method,
            path,
            errorCode: code,
          });
        reply(status, { error: code });
      }
    }
  );
  server.requestTimeout = parsedRequestTimeoutMs;
  server.headersTimeout = Math.min(parsedRequestTimeoutMs, 5_000);
  server.keepAliveTimeout = 5_000;
  return server;
};

module.exports = {
  DEFAULT_BODY_TIMEOUT_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  MAX_BODY_BYTES,
  MAX_HEADER_BYTES,
  createControlServer,
  readJson,
};
