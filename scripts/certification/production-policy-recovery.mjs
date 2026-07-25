import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const requireFromMatchmaking = createRequire(
  resolve(repository, "../Matchmaking/package.json")
);
const { io } = requireFromMatchmaking("socket.io-client");
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((value) => value.startsWith("--"))
    .map((value) => {
      const [key, ...rest] = value.slice(2).split("=");
      return [key, rest.length ? rest.join("=") : "true"];
    })
);
const runId = String(args["run-id"] || process.env.THNK_CERT_RUN_ID || "");
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(runId))
  throw new Error("invalid_run_id");
const profileUrl = new URL(
  args["profile-url"] || "https://app2.solarcal.xyz"
);
const matchmakingUrl = new URL(
  args["matchmaking-url"] || "https://app3.solarcal.xyz"
);
for (const [name, url] of [
  ["profile", profileUrl],
  ["matchmaking", matchmakingUrl],
])
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1")
    throw new Error(`${name}_url_must_use_https`);
const credentialPath = resolve(
  args.credentials ||
    resolve(
      repository,
      "../PlayerProfile/.generated/certification",
      runId,
      "credentials.json"
    )
);
if (!existsSync(credentialPath))
  throw new Error("certification_credentials_missing");
const accounts = JSON.parse(readFileSync(credentialPath, "utf8")).accounts;
const account = accounts.at(-1);
if (!account?.email || !account.password || !account.playerId)
  throw new Error("certification_credentials_incomplete");

const startedAt = new Date().toISOString();
const reportRoot = resolve(repository, ".generated/certification", runId);
mkdirSync(reportRoot, { recursive: true });
const reportPath = resolve(
  reportRoot,
  `phase-policy-recovery-${startedAt.replace(/[:.]/g, "-")}.json`
);
const report = {
  status: "running",
  runId,
  startedAt,
  target: {
    playerProfileOrigin: profileUrl.origin,
    matchmakingOrigin: matchmakingUrl.origin,
  },
  assertions: [],
  failures: [],
};
const sleep = (milliseconds) =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
const login = async () => {
  const response = await fetch(new URL("/auth/login", profileUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: account.email,
      password: account.password,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
};
const connect = async (accessToken) => {
  const socket = io(matchmakingUrl.origin, {
    autoConnect: false,
    forceNew: true,
    reconnection: false,
    transports: ["websocket"],
    timeout: 20_000,
    auth: { accessToken },
  });
  await new Promise((resolveConnect, rejectConnect) => {
    const timer = setTimeout(
      () => rejectConnect(new Error("matchmaking_connect_timeout")),
      25_000
    );
    socket.once("presence.snapshot", () => {
      clearTimeout(timer);
      resolveConnect();
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timer);
      rejectConnect(
        new Error(`matchmaking_connect_${error?.message || "unknown"}`)
      );
    });
    socket.connect();
  });
  return socket;
};
const ack = async (socket, event, input) =>
  input === undefined
    ? socket.timeout(10_000).emitWithAck(event)
    : socket.timeout(10_000).emitWithAck(event, input);
const matchRequest = {
  queueId: "feature-lab-ffa",
  clientBuildId: "feature-lab-client-1",
  protocolVersion: "thnk-flatbuffers-v1",
  attributes: {},
  regionalQuality: [
    {
      regionId: "local-lan",
      medianRttMs: 13,
      p95RttMs: 14,
      jitterMs: 1,
      packetLoss: 0,
      timeoutRate: 0,
      samples: 3,
      successfulSamples: 3,
    },
  ],
};

let socket;
let failure;
try {
  let accessToken;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const result = await login();
    assert.equal(result.status, 200);
    assert.equal(result.body.player?.playerId, account.playerId);
    assert.equal(typeof result.body.accessToken, "string");
    accessToken = result.body.accessToken;
  }
  const profileLimited = await login();
  assert.equal(profileLimited.status, 429);
  assert.deepEqual(profileLimited.body, { error: "rate_limited" });
  report.assertions.push({
    gate: "player_profile.production_login_limit",
    allowed: 10,
    rejectedAttempt: 11,
    error: "rate_limited",
  });

  socket = await connect(accessToken);
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const found = await ack(socket, "match.find", matchRequest);
    assert.equal(found.ok, true);
    assert.ok(["created", "queued"].includes(found.state));
    const cancelled = await ack(socket, "match.cancel");
    assert.deepEqual(cancelled, { ok: true, state: "cancelled" });
  }
  const matchmakingLimited = await ack(socket, "match.find", matchRequest);
  assert.deepEqual(matchmakingLimited, {
    ok: false,
    error: "match_rate_limited",
  });
  report.assertions.push({
    gate: "matchmaking.production_match_limit",
    allowed: 10,
    rejectedAttempt: 11,
    error: "match_rate_limited",
  });

  const waitStartedAt = new Date().toISOString();
  await sleep(30_000);
  await sleep(32_000);
  const profileRecovered = await login();
  assert.equal(profileRecovered.status, 200);
  assert.equal(profileRecovered.body.player?.playerId, account.playerId);
  const matchmakingRecovered = await ack(socket, "match.find", matchRequest);
  assert.equal(matchmakingRecovered.ok, true);
  assert.ok(["created", "queued"].includes(matchmakingRecovered.state));
  assert.deepEqual(await ack(socket, "match.cancel"), {
    ok: true,
    state: "cancelled",
  });
  report.assertions.push({
    gate: "production_fixed_window_recovery",
    waitStartedAt,
    recoveredAt: new Date().toISOString(),
    playerProfile: true,
    matchmaking: true,
    canonicalPlayerIdUnchanged: true,
  });
  report.status = "passed";
} catch (error) {
  failure = error;
  report.status = "failed";
  report.failures.push({
    code:
      error instanceof Error && /^[A-Za-z0-9_:.-]+$/.test(error.message)
        ? error.message
        : "production_policy_recovery_failed",
    fingerprint: createHash("sha256")
      .update(String(error instanceof Error ? error.stack : error))
      .digest("hex")
      .slice(0, 16),
  });
} finally {
  socket?.close();
  report.finishedAt = new Date().toISOString();
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify({ status: report.status, reportPath }));
if (failure) throw failure;
