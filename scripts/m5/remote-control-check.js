const assert = require("assert");
const crypto = require("crypto");
const http = require("http");
const path = require("path");

const bundlePath = path.resolve(process.argv[2] || ".");
const authorityId = process.env.THNK_AUTHORITY_ID;
const controlToken = process.env.THNK_CONTROL_TOKEN;
const controlUrl = process.env.THNK_CONTROL_URL || "http://127.0.0.1:9209";
const callbackPort = Number(process.env.THNK_CALLBACK_PORT || 9211);
if (!authorityId || !controlToken)
  throw new Error("THNK_AUTHORITY_ID and THNK_CONTROL_TOKEN are required.");
const manifest = require(path.join(bundlePath, "manifest.json"));
const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const waitFor = async (read, predicate, description, timeout = 30_000) => {
  const deadline = Date.now() + timeout;
  do {
    try {
      const value = await read();
      if (predicate(value)) return value;
    } catch {}
    await delay(150);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${description}.`);
};

const request = async (route, { method = "GET", body } = {}) => {
  const response = await fetch(`${controlUrl}${route}`, {
    method,
    headers: {
      authorization: `Bearer ${controlToken}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
};

(async () => {
  let resolveEnded;
  const ended = new Promise((resolve) => {
    resolveEnded = resolve;
  });
  const callbackServer = http.createServer((request_, response) => {
    const chunks = [];
    request_.on("data", (chunk) => chunks.push(chunk));
    request_.on("end", () => {
      try {
        const event = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (event.eventType === "session.ended") resolveEnded();
      } catch {}
      response.writeHead(204).end();
    });
  });
  callbackServer.listen(callbackPort, "127.0.0.1");
  await new Promise((resolve) => callbackServer.once("listening", resolve));

  try {
    await waitFor(
      () => fetch(`${controlUrl}/health/live`),
      (response) => response.ok,
      "Linux supervisor"
    );
    const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicKey = keys.publicKey.export({ type: "spki", format: "pem" });
    const identity = {
      gameId: manifest.project.gameId,
      authorityId,
      serverBuildId: manifest.build.serverBuildId,
      compatibilityVersion: manifest.build.compatibilityVersion,
      clientBuildId: manifest.build.clientBuildId,
      protocolVersion: manifest.build.protocolVersion,
    };
    const session = {
      sessionId: `linux-${authorityId}`,
      ...identity,
      players: [{ playerId: "linux-player", tags: { team: "linux" } }],
      callbackUrl: `http://127.0.0.1:${callbackPort}/events`,
      reconnectPolicy: "fresh-token",
      tokenVerification: {
        publicKey,
        keyId: "linux-key",
        issuer: "linux-stub-matchmaker",
        audience: "linux-fixture-server",
        algorithm: "RS256",
      },
    };
    const wrong = await request("/v1/session", {
      method: "POST",
      body: { ...session, serverBuildId: `sha256:${"b".repeat(64)}` },
    });
    assert.deepStrictEqual(wrong, {
      status: 409,
      body: { error: "wrong_server_build" },
    });

    const created = await request("/v1/session", {
      method: "POST",
      body: session,
    });
    assert.strictEqual(created.status, 201, JSON.stringify(created.body));
    assert.strictEqual(created.body.session.authorityId, authorityId);
    await waitFor(
      () => fetch(`${controlUrl}/health/ready`),
      (response) => response.status === 200,
      "Linux authority readiness"
    );
    await delay(750);
    const stopped = await request("/v1/session/end", {
      method: "POST",
      body: { reason: "linux-gate-complete" },
    });
    assert.strictEqual(stopped.status, 202);
    await Promise.race([
      ended,
      delay(10_000).then(() => {
        throw new Error("Timed out waiting for session.ended callback.");
      }),
    ]);
    console.log(
      JSON.stringify({
        authorityId,
        serverBuildId: manifest.build.serverBuildId,
        wrongBuildRejectedBeforeStart: true,
        gracefulSessionEnd: true,
      })
    );
  } finally {
    callbackServer.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
