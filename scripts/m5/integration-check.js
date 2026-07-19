const assert = require("assert");
const crypto = require("crypto");
const { once } = require("events");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const repositoryRoot = path.resolve(__dirname, "../..");
const bundlePath = path.join(repositoryRoot, ".generated/m5/server-bundle");
const manifestPath = path.join(bundlePath, "manifest.json");
if (!fs.existsSync(manifestPath))
  throw new Error("Run yarn fixture:m5:export before the M5 check.");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
assert.deepStrictEqual(Object.keys(manifest.authorities), ["duel", "racing"]);

const nodePath = process.execPath;
const integrationPath = path.join(
  repositoryRoot,
  "scripts/m3/integration-check.js"
);
const controlToken = "m5-control-token-for-local-integration-only";
const webhookSecret = "m5-webhook-secret-for-local-integration-only";
const controlUrl = "http://127.0.0.1:9209";
const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const waitFor = async (read, predicate, description, timeout = 60_000) => {
  const deadline = Date.now() + timeout;
  let value;
  do {
    try {
      value = await read();
      if (predicate(value)) return value;
    } catch {}
    await delay(150);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${description}: ${String(value)}`);
};

const runFullDuelCheck = () =>
  new Promise((resolve, reject) => {
    const child = spawn(nodePath, [integrationPath], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        THNK_M5_CHECK: "true",
        THNK_TEST_BUNDLE: bundlePath,
        THNK_TEST_CLIENT_BUILD: path.join(
          repositoryRoot,
          ".generated/m5/client/build"
        ),
        THNK_AUTHORITY_ID: "duel",
      },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `M5 duel integration exited with ${signal || `code ${code}`}.`
          )
        );
    });
  });

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

const launchAuthority = (authorityId) => {
  const environment = {
    ...process.env,
    THNK_AUTHORITY_ID: authorityId,
    THNK_EXPECTED_SERVER_BUILD_ID: manifest.build.serverBuildId,
    THNK_BRIDGE_ENABLED: "true",
    THNK_CONTROL_HOST: "127.0.0.1",
    THNK_CONTROL_PORT: "9209",
    THNK_CONTROL_TOKEN: controlToken,
    THNK_WEBHOOK_SECRET: webhookSecret,
    THNK_ALLOW_INSECURE_CALLBACKS: "true",
  };
  delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(require("electron"), [bundlePath], {
    cwd: bundlePath,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      output += chunk.toString();
    });
  return { child, output: () => output };
};

const checkRacingSupervisor = async () => {
  const callbackServer = http.createServer((_request, response) =>
    response.writeHead(204).end()
  );
  callbackServer.listen(9211, "127.0.0.1");
  await once(callbackServer, "listening");
  const { child, output } = launchAuthority("racing");
  const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" });
  const identity = {
    gameId: manifest.project.gameId,
    authorityId: "racing",
    serverBuildId: manifest.build.serverBuildId,
    compatibilityVersion: manifest.build.compatibilityVersion,
    clientBuildId: manifest.build.clientBuildId,
    protocolVersion: manifest.build.protocolVersion,
  };
  const input = {
    sessionId: "m5-racing-session",
    ...identity,
    players: [{ playerId: "racer", tags: { team: "signed-team" } }],
    callbackUrl: "http://127.0.0.1:9211/events",
    reconnectPolicy: "fresh-token",
    tokenVerification: {
      publicKey,
      keyId: "m5-key",
      issuer: "m5-stub-matchmaker",
      audience: "m5-server",
      algorithm: "RS256",
    },
  };

  try {
    await waitFor(
      () => fetch(`${controlUrl}/health/live`),
      (response) => response.ok,
      "racing supervisor control API"
    );
    const rejectedAssignments = [
      [{ authorityId: "duel" }, 409, "wrong_authority"],
      [
        { serverBuildId: `sha256:${"b".repeat(64)}` },
        409,
        "wrong_server_build",
      ],
      [{ compatibilityVersion: "m5-v2" }, 426, "client_update_required"],
    ];
    for (const [override, status, error] of rejectedAssignments) {
      const result = await request("/v1/session", {
        method: "POST",
        body: { ...input, ...override },
      });
      assert.strictEqual(result.status, status);
      assert.strictEqual(result.body.error, error);
      assert.ok(!output().includes("THNK_SERVER_READY"));
      assert.ok(!output().includes("THNK_AUTHORITY_SCENE_STARTED"));
    }

    const created = await request("/v1/session", {
      method: "POST",
      body: input,
    });
    assert.strictEqual(created.status, 201, JSON.stringify(created.body));
    assert.strictEqual(created.body.session.authorityId, "racing");
    assert.strictEqual(
      created.body.session.serverBuildId,
      manifest.build.serverBuildId
    );
    await waitFor(
      () => Promise.resolve(output()),
      (value) => value.includes("THNK_AUTHORITY_SCENE_STARTED racing"),
      "RacingAuthority scene transition"
    );
    assert.ok(!output().includes("THNK_AUTHORITY_SCENE_STARTED duel"));

    const ended = await request("/v1/session/end", {
      method: "POST",
      body: { reason: "m5-racing-complete" },
    });
    assert.strictEqual(ended.status, 202);
    const [exitCode] = await once(child, "exit");
    assert.strictEqual(exitCode, 0, output());
  } finally {
    if (child.exitCode === null) child.kill();
    callbackServer.close();
  }
};

const checkUnknownAuthority = async () => {
  const { child, output } = launchAuthority("unknown-authority");
  const [exitCode] = await Promise.race([
    once(child, "exit"),
    delay(20_000).then(() => {
      child.kill();
      throw new Error("Unknown authority process did not fail closed.");
    }),
  ]);
  assert.notStrictEqual(exitCode, 0, output());
  assert.ok(!output().includes("THNK_CONTROL_READY"));
  assert.ok(!output().includes("THNK_SERVER_READY"));
  assert.ok(!output().includes("THNK_AUTHORITY_SCENE_STARTED"));
};

(async () => {
  await runFullDuelCheck();
  await checkRacingSupervisor();
  await checkUnknownAuthority();
  console.log(
    JSON.stringify(
      {
        authoritiesBootedIndependently: ["duel", "racing"],
        rejectedBeforeGDevelop: [
          "wrong-authority",
          "wrong-build",
          "wrong-compatibility",
          "unknown-authority",
        ],
        signedTagExpression: "signed-team",
        serverBuildId: manifest.build.serverBuildId,
      },
      null,
      2
    )
  );
  console.log("M5 multi-authority and hardened admission check passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
