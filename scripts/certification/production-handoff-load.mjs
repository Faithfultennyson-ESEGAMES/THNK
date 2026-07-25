import assert from "node:assert/strict";
import { createHash, verify } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const requireFromMatchmaking = createRequire(
  resolve(repository, "../Matchmaking/package.json")
);
const { io } = requireFromMatchmaking("socket.io-client");
const args = Object.fromEntries(
  process.argv.slice(2).filter((value) => value.startsWith("--")).map((value) => {
    const [name, ...parts] = value.slice(2).split("=");
    return [name, parts.length ? parts.join("=") : "true"];
  })
);
const runId = String(args["run-id"] || "cert-20260722-https");
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(runId))
  throw new Error("invalid_run_id");
const profileUrl = new URL(args["profile-url"] || "https://app2.solarcal.xyz");
const matchmakingUrl = new URL(
  args["matchmaking-url"] || "https://app3.solarcal.xyz"
);
const publicKeyPath = resolve(
  args["public-key"] ||
    resolve(repository, ".generated/certification", runId, "production-admission-public.pem")
);
const credentialsPath = resolve(
  args.credentials ||
    resolve(
      repository,
      "../PlayerProfile/.generated/certification",
      runId,
      "credentials.json"
    )
);
const userCount = Number(args.users || 90);
const matchedUsers = Number(args["matched-users"] || 88);
const batchSize = Number(args["batch-size"] || 10);
if (
  !Number.isInteger(userCount) ||
  userCount !== 90 ||
  !Number.isInteger(matchedUsers) ||
  matchedUsers !== 88 ||
  !Number.isInteger(batchSize) ||
  batchSize < 1 ||
  batchSize > 20
)
  throw new Error("invalid_load_shape");
if (!existsSync(credentialsPath)) throw new Error("credentials_missing");
if (!existsSync(publicKeyPath)) throw new Error("admission_public_key_missing");

const accounts = JSON.parse(readFileSync(credentialsPath, "utf8")).accounts.slice(
  0,
  userCount
);
if (
  accounts.length !== userCount ||
  accounts.some(
    (account) =>
      typeof account.playerId !== "string" ||
      typeof account.email !== "string" ||
      typeof account.password !== "string"
  )
)
  throw new Error("credentials_incomplete");
const publicKey = readFileSync(publicKeyPath, "utf8");
const startedAt = new Date().toISOString();
const reportRoot = resolve(repository, ".generated/certification", runId);
mkdirSync(reportRoot, { recursive: true });
const reportPath = resolve(
  reportRoot,
  `phase-d-production-handoff-u${userCount}-${startedAt.replace(/[:.]/g, "-")}.json`
);
const report = {
  status: "running",
  runId,
  startedAt,
  target: {
    profileOrigin: profileUrl.origin,
    matchmakingOrigin: matchmakingUrl.origin,
    connectedUsers: userCount,
    matchedUsers,
    expectedSessions: matchedUsers / 4,
    underfilledUsers: userCount - matchedUsers,
  },
  gates: [],
  failures: [],
};
const record = (gate, details = {}) => report.gates.push({ gate, ...details });
const progress = (event, details = {}) =>
  process.stdout.write(`${JSON.stringify({ event, ...details })}\n`);
const sleep = (milliseconds) =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
const inBatches = async (items, callback) => {
  const output = [];
  for (let offset = 0; offset < items.length; offset += batchSize) {
    output.push(
      ...(await Promise.all(
        items
          .slice(offset, offset + batchSize)
          .map((item, index) => callback(item, offset + index))
      ))
    );
    if (offset + batchSize < items.length) await sleep(100);
  }
  return output;
};
const login = async (account) => {
  const response = await fetch(new URL("/auth/login", profileUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: account.email, password: account.password }),
    signal: AbortSignal.timeout(20_000),
  });
  let body = {};
  try {
    body = await response.json();
  } catch {}
  if (
    response.status !== 200 ||
    body.player?.playerId !== account.playerId ||
    typeof body.accessToken !== "string"
  )
    throw new Error(`login_failed_${account.alias || "account"}`);
  return { ...account, accessToken: body.accessToken };
};

const sockets = [];
const connect = async (account) => {
  const socket = io(matchmakingUrl.origin, {
    autoConnect: false,
    forceNew: true,
    reconnection: false,
    transports: ["websocket"],
    timeout: 20_000,
    auth: { accessToken: account.accessToken },
  });
  sockets.push(socket);
  const assignment = new Promise((resolveAssignment) => {
    socket.once("match.found", (value) => {
      resolveAssignment(value);
    });
  });
  await new Promise((resolveConnect, rejectConnect) => {
    const timer = setTimeout(
      () => rejectConnect(new Error(`connect_timeout_${account.alias}`)),
      20_000
    );
    socket.once("connect", () => {
      clearTimeout(timer);
      resolveConnect();
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timer);
      rejectConnect(
        new Error(
          `connect_failed_${account.alias}_${String(error?.message || "unknown")}`
        )
      );
    });
    socket.connect();
  });
  return { account, socket, assignment };
};

const ack = async (state, event, input) => {
  try {
    return input === undefined
      ? await state.socket.timeout(20_000).emitWithAck(event)
      : await state.socket.timeout(20_000).emitWithAck(event, input);
  } catch {
    throw new Error(`ack_timeout_${event}_${state.account.alias}`);
  }
};
const quality = [
  {
    regionId: "local-lan",
    medianRttMs: 35,
    p95RttMs: 45,
    jitterMs: 3,
    packetLoss: 0,
    timeoutRate: 0,
    samples: 3,
    successfulSamples: 3,
  },
];
const matchRequest = {
  queueId: "feature-lab-ffa",
  clientBuildId: "feature-lab-client-1",
  protocolVersion: "thnk-flatbuffers-v1",
  attributes: {},
  regionalQuality: quality,
};
const tokenDigest = (value) =>
  createHash("sha256").update(value).digest("hex").slice(0, 16);
const verifyToken = (token, assignment) => {
  const [headerPart, claimsPart, signaturePart, extra] = token.split(".");
  if (!headerPart || !claimsPart || !signaturePart || extra)
    throw new Error("invalid_admission_shape");
  const header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8"));
  const claims = JSON.parse(Buffer.from(claimsPart, "base64url").toString("utf8"));
  assert.equal(header.alg, "RS256");
  assert.equal(
    verify(
      "RSA-SHA256",
      Buffer.from(`${headerPart}.${claimsPart}`),
      publicKey,
      Buffer.from(signaturePart, "base64url")
    ),
    true
  );
  assert.equal(claims.playerId, assignment.playerId);
  assert.equal(claims.sessionId, assignment.sessionId);
  assert.equal(claims.gameId, "c5bb6fbd-08a1-48a6-b96f-722d11c13e51");
  assert.equal(claims.authorityId, assignment.authorityId);
  assert.equal(claims.regionId, assignment.regionId);
  assert.equal(claims.serverBuildId, assignment.serverBuildId);
  assert.equal(claims.compatibilityVersion, "m7-v1");
  assert.equal(claims.clientBuildId, "feature-lab-client-1");
  assert.equal(claims.protocolVersion, "thnk-flatbuffers-v1");
  assert.equal(claims.iss, "thnk-matchmaking");
  assert.equal(claims.aud, "thnk-core");
  assert.equal(typeof claims.jti, "string");
  const verifierNow = Math.floor(Date.now() / 1000);
  const clockSkewToleranceSeconds = 10;
  assert.ok(claims.nbf <= verifierNow + clockSkewToleranceSeconds);
  assert.ok(claims.exp > verifierNow - clockSkewToleranceSeconds);
  return { keyId: header.kid, tokenId: claims.jti };
};

let failure;
try {
  const authenticated = await inBatches(accounts, login);
  const states = await inBatches(authenticated, connect);
  record("production_handoff.real_identity_connections", {
    authenticatedUsers: authenticated.length,
    websocketConnections: states.length,
    uniquePlayerIds: new Set(authenticated.map(({ playerId }) => playerId)).size,
  });
  progress("production_handoff.connected", { users: states.length });

  const matchedStates = states.slice(0, matchedUsers);
  const submitResults = await inBatches(matchedStates, async (state) => {
    const result = await ack(state, "match.find", matchRequest);
    if (result?.ok !== true || !["created", "queued"].includes(result.state))
      throw new Error(`match_find_failed_${state.account.alias}`);
    return result;
  });
  assert.equal(submitResults.length, matchedUsers);
  const assignments = await Promise.race([
    Promise.all(matchedStates.map(({ assignment }) => assignment)),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("assignment_timeout")), 120_000)
    ),
  ]);
  progress("production_handoff.assigned", { assignments: assignments.length });

  const sessionGroups = new Map();
  const tokenDigests = new Set();
  const tokenIds = new Set();
  for (let index = 0; index < assignments.length; index += 1) {
    const assignment = assignments[index];
    const account = matchedStates[index].account;
    assert.equal(assignment.playerId, account.playerId);
    assert.equal(assignment.queueId, "feature-lab-ffa");
    assert.equal(assignment.modeId, "feature-lab-ffa");
    assert.equal(assignment.authorityId, "feature-lab-ffa");
    assert.equal(assignment.regionId, "local-lan");
    assert.equal(
      assignment.serverBuildId,
      "sha256:801a9ebfa02fc4180f33c1b47642c5fc3bd507fcc2f463eada41d310dc8db788"
    );
    assert.equal(assignment.gameServerUrl, "https://app4.solarcal.xyz");
    assert.equal("voiceGrant" in assignment, false);
    assert.equal("players" in assignment, false);
    const verified = verifyToken(assignment.admissionToken, assignment);
    const digest = tokenDigest(assignment.admissionToken);
    assert.equal(tokenDigests.has(digest), false);
    assert.equal(tokenIds.has(verified.tokenId), false);
    tokenDigests.add(digest);
    tokenIds.add(verified.tokenId);
    const group = sessionGroups.get(assignment.sessionId) || [];
    group.push(assignment.playerId);
    sessionGroups.set(assignment.sessionId, group);
  }
  assert.equal(sessionGroups.size, matchedUsers / 4);
  assert.ok([...sessionGroups.values()].every((players) => players.length === 4));
  assert.equal(
    new Set(assignments.map(({ playerId }) => playerId)).size,
    matchedUsers
  );
  record("production_handoff.assignments", {
    assignments: assignments.length,
    sessions: sessionGroups.size,
    exactRosterSize: 4,
    uniquePlacement: true,
    correctRouteAndCompatibility: true,
    signedPlayerScopedAdmissions: assignments.length,
    uniqueAdmissionTokens: tokenDigests.size,
    publicAssignmentsContainVoiceGrant: false,
    publicAssignmentsContainPrivateRoster: false,
  });

  const underfilled = states.slice(matchedUsers);
  const underfilledResults = await Promise.all(
    underfilled.map((state) => ack(state, "match.find", matchRequest))
  );
  assert.ok(
    underfilledResults.every(
      (result) =>
        result?.ok === true && ["created", "queued"].includes(result.state)
    )
  );
  await sleep(5_000);
  const statuses = await Promise.all(
    underfilled.map((state) => ack(state, "match.status"))
  );
  assert.ok(
    statuses.every(
      (status) =>
        status?.ok === true &&
        status.state === "idle" &&
        status.assignment === undefined
    )
  );
  const cancellations = await Promise.all(
    underfilled.map((state) => ack(state, "match.cancel"))
  );
  assert.ok(
    cancellations.every(
      (result) => result?.ok === true && result.state === "cancelled"
    )
  );
  const postCancel = await Promise.all(
    underfilled.map((state) => ack(state, "match.status"))
  );
  assert.ok(
    postCancel.every(
      (status) => status?.ok === true && status.state === "idle"
    )
  );
  record("production_handoff.underfilled_cancel", {
    queuedUsers: underfilled.length,
    observationMs: 5_000,
    assignmentsReceived: 0,
    cancelledUsers: cancellations.length,
    postCancelIdle: true,
  });
  report.status = "passed";
} catch (error) {
  failure = error;
  report.status = "failed";
  report.failures.push({
    code:
      error instanceof Error && /^[A-Za-z0-9_:.-]+$/.test(error.message)
        ? error.message
        : "production_handoff_failed",
  });
} finally {
  for (const socket of sockets) socket.close();
  report.finishedAt = new Date().toISOString();
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}
progress("production_handoff.complete", {
  status: report.status,
  reportPath,
});
if (failure) throw failure;
