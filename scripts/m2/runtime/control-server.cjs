const crypto = require("crypto");
const http = require("http");
const { BridgeError } = require("./session-manager.cjs");

const MAX_BODY_BYTES = 64 * 1024;

const sendJson = (response, status, body, headers = {}) => {
  const encoded = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": encoded.length,
    "cache-control": "no-store",
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

const readJson = (request) =>
  new Promise((resolve, reject) => {
    if (
      !/^application\/json(?:;|$)/i.test(request.headers["content-type"] || "")
    )
      return reject(new BridgeError("content_type_must_be_json", 415));
    const chunks = [];
    let length = 0;
    let tooLarge = false;
    request.on("data", (chunk) => {
      if (tooLarge) return;
      length += chunk.length;
      if (length > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
      } else chunks.push(chunk);
    });
    request.on("end", () => {
      if (tooLarge) return reject(new BridgeError("request_too_large", 413));
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new BridgeError("invalid_json"));
      }
    });
    request.on("error", reject);
  });

const createControlServer = ({
  sessionManager,
  controlToken,
  onSessionStart = async () => {},
  onSessionEnd = () => {},
}) =>
  http.createServer(async (request, response) => {
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    try {
      if (request.method === "OPTIONS" && path === "/v1/voice/token") {
        response.writeHead(204, voiceHeaders);
        response.end();
        return;
      }
      if (path === "/v1/voice/token") {
        if (request.method !== "POST")
          return sendJson(
            response,
            405,
            { error: "method_not_allowed" },
            voiceHeaders
          );
        try {
          return sendJson(
            response,
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
          return sendJson(response, status, { error: code }, headers);
        }
      }
      if (request.method === "GET" && path === "/health/live")
        return sendJson(response, 200, { status: "live" });
      if (request.method === "GET" && path === "/health/ready")
        return sendJson(response, sessionManager.isReady() ? 200 : 503, {
          status: sessionManager.isReady() ? "ready" : "not_ready",
        });

      if (!["/v1/session", "/v1/session/end"].includes(path))
        return sendJson(response, 404, { error: "not_found" });
      if (!authorized(request, controlToken))
        return sendJson(response, 401, { error: "unauthorized" });

      if (request.method === "GET" && path === "/v1/session")
        return sendJson(response, 200, {
          session: sessionManager.getPublicState(),
        });
      if (request.method === "POST" && path === "/v1/session") {
        const input = await readJson(request);
        if (typeof sessionManager.prepareSession === "function")
          await sessionManager.prepareSession(input);
        else sessionManager.createSession(input);
        await onSessionStart();
        return sendJson(response, 201, {
          session: sessionManager.getPublicState(),
        });
      }
      if (request.method === "POST" && path === "/v1/session/end") {
        const input = await readJson(request);
        const result = sessionManager.endSession(input?.reason || "requested");
        sendJson(response, 202, { session: result.state });
        onSessionEnd(result.drain);
        return;
      }
      return sendJson(response, 405, { error: "method_not_allowed" });
    } catch (error) {
      const status = error instanceof BridgeError ? error.status : 500;
      const code = error instanceof BridgeError ? error.code : "internal_error";
      sendJson(response, status, { error: code });
    }
  });

module.exports = { MAX_BODY_BYTES, createControlServer };
