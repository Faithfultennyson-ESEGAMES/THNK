import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const bundle = path.join(
  repository,
  ".generated/live-e2e-authority-20260722-r10"
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(bundle, "manifest.json"), "utf8")
);
const authorityId = Object.keys(manifest.authorities)[0];
const electron = createRequire(import.meta.url)("electron");
const controlToken = "certification-control-token-2026-07-25";
const webhookSecret = "certification-webhook-secret-2026-07-25";
const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" });

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

const freePort = async () => {
  const server = http.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  server.close();
  await once(server, "close");
  return port;
};

const waitFor = async (read, predicate, description, timeout = 30_000) => {
  const deadline = Date.now() + timeout;
  let value;
  while (Date.now() < deadline) {
    try {
      value = await read();
      if (predicate(value)) return value;
    } catch {}
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${description}`);
};

const request = async (baseUrl, route, { method = "GET", body } = {}) => {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      authorization: `Bearer ${controlToken}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
};

const assignment = (sessionId, callbackUrl) => ({
  sessionId,
  gameId: manifest.project.gameId,
  authorityId,
  serverBuildId: manifest.build.serverBuildId,
  compatibilityVersion: manifest.build.compatibilityVersion,
  clientBuildId: manifest.build.clientBuildId,
  protocolVersion: manifest.build.protocolVersion,
  players: [{ playerId: "alice", tags: {} }],
  callbackUrl,
  reconnectPolicy: "fresh-token",
  tokenVerification: {
    publicKey,
    keyId: "certification-key",
    issuer: "certification-matchmaking",
    audience: "certification-core",
    algorithm: "RS256",
  },
});

const runPolicy = async ({ policy, devMode, expectedStatus }) => {
  const [controlPort, callbackPort] = await Promise.all([
    freePort(),
    freePort(),
  ]);
  const callbackServer = http.createServer((_request, response) =>
    response.writeHead(204).end()
  );
  callbackServer.listen(callbackPort, "127.0.0.1");
  await once(callbackServer, "listening");

  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.THNK_PLAYER_PROFILE_URL;
  delete environment.THNK_PLAYER_PROFILE_TOKEN;
  delete environment.THNK_MATCHMAKING_URL;
  delete environment.THNK_MATCHMAKING_AUTHORITY_TOKEN;
  delete environment.THNK_DEV_AUTHORITY_REGISTER;
  Object.assign(environment, {
    THNK_BRIDGE_ENABLED: "true",
    THNK_CONTROL_HOST: "127.0.0.1",
    THNK_CONTROL_PORT: String(controlPort),
    THNK_CONTROL_TOKEN: controlToken,
    THNK_WEBHOOK_SECRET: webhookSecret,
    THNK_ALLOW_INSECURE_CALLBACKS: "true",
    THNK_AUTHORITY_ID: authorityId,
    THNK_EXPECTED_SERVER_BUILD_ID: manifest.build.serverBuildId,
    THNK_PLAYER_PROFILE_POLICY: policy,
    THNK_DEV_MODE: String(devMode),
    THNK_VOICE_ENABLED: "false",
  });

  const authority = spawn(electron, [bundle], {
    cwd: bundle,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exitPromise = once(authority, "exit");
  let output = "";
  authority.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  authority.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  const baseUrl = `http://127.0.0.1:${controlPort}`;

  try {
    await waitFor(
      () => fetch(`${baseUrl}/health/live`),
      (response) => response.ok,
      `${policy} control server`
    );
    const created = await request(baseUrl, "/v1/session", {
      method: "POST",
      body: assignment(
        `certification-${policy}`,
        `http://127.0.0.1:${callbackPort}/events`
      ),
    });
    assert.equal(created.status, expectedStatus, JSON.stringify(created.body));

    if (policy === "fail-closed") {
      assert.equal(created.body.error, "player_profile_unavailable");
      const health = await fetch(`${baseUrl}/health/ready`).then((response) =>
        response.json()
      );
      assert.equal(health.checks.playerProfile, "unavailable");
      assert.equal(output.includes("THNK_AUTHORITY_SCENE_STARTED"), false);
      return {
        policy,
        devMode,
        sessionStatus: expectedStatus,
        playerProfile: health.checks.playerProfile,
        gdevelopStarted: false,
      };
    }

    await waitFor(
      () => fetch(`${baseUrl}/health/ready`),
      (response) => response.status === 200,
      "ephemeral Authority readiness"
    );
    const health = await fetch(`${baseUrl}/health/ready`).then((response) =>
      response.json()
    );
    assert.equal(health.checks.playerProfile, "ephemeral");
    const ended = await request(baseUrl, "/v1/session/end", {
      method: "POST",
      body: { reason: "certification-complete" },
    });
    assert.equal(ended.status, 202);
    const [exitCode] = await exitPromise;
    assert.equal(exitCode, 0, output);
    return {
      policy,
      devMode,
      sessionStatus: expectedStatus,
      playerProfile: health.checks.playerProfile,
      gdevelopStarted: true,
      authorityExitCode: exitCode,
    };
  } finally {
    if (authority.exitCode === null) {
      authority.kill();
      await Promise.race([exitPromise, delay(5_000)]);
    }
    callbackServer.closeAllConnections?.();
    callbackServer.close();
  }
};

const failClosed = await runPolicy({
  policy: "fail-closed",
  devMode: false,
  expectedStatus: 503,
});
const ephemeral = await runPolicy({
  policy: "local-ephemeral-fallback",
  devMode: true,
  expectedStatus: 201,
});

process.stdout.write(
  `${JSON.stringify({
    status: "passed",
    failClosed,
    ephemeral,
  })}\n`
);
