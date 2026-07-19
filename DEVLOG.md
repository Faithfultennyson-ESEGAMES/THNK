# THNK Server Platform Development Log

This is the chronological engineering log for the THNK Server Platform work.
It records what changed, why it changed, validation results, important
incidents, and remaining boundaries. Commands containing credentials, private
host addresses, or other secrets are deliberately excluded.

Detailed milestone evidence lives under `docs/project/`; this file is the
project-wide timeline and must be updated as part of every milestone commit.

## 2026-07-18 — Project plan and M0 baseline

### Direction established

- Read `THNK-Server-Platform-Blueprint.md` and created
  `THNK-Implementation-Plan.md`.
- Defined the v1 product boundary: one authoritative game session per process,
  external matchmaking through a bridge, short-lived asymmetric admission
  tokens, signed lifecycle webhooks, and side-band Agora voice.
- Added ADR 0001 to preserve these architecture decisions.

### Repository baseline

- Imported upstream `master` at `422d2ff0` and configured:
  - `upstream`: the original THNK repository;
  - `origin`: the writable project fork.
- Inspected upstream `v2` at `1924f02e`. It was exploratory/WIP, so no v2 code
  was merged wholesale.
- Corrected package metadata to `AGPL-3.0-only`, matching the repository's
  license history.
- Pinned Node 18.20.8 and Yarn 1.22.22.
- Added deterministic build support for junctioned dependencies by preserving
  symlinks in esbuild.

### Workstation storage incident

- Dependency installation originally failed because the Windows system drive
  was full.
- Project storage was moved to a secondary drive through a directory junction.
- The Node/Yarn toolchain and dependency cache were also placed on the secondary
  drive. Builds were checked for physical-path leakage.

### M0 verification

- Frozen dependency install: passed.
- TypeScript: passed.
- Jest: 1 suite, 6 tests passed.
- Full generated-extension build: passed.
- Milestone commit: `3834ccd` (`chore: establish THNK server platform baseline`).

## 2026-07-18 — M1 remote-authority vertical slice

### Fixture and automation

- Added the `m1-remote-authority` GDevelop fixture with:
  - dedicated `ServerBootstrap` and `ClientBootstrap` scenes;
  - one server-owned synchronized player per connection;
  - authoritative `State.Score`;
  - server-accepted movement input;
  - deliberate illegal client edits to prove authoritative restoration.
- Added fixture validation, preparation, browser export, static serving,
  runtime inspection, and automated lifecycle scripts.

### Lifecycle defects fixed

- Made connect/disconnect handling idempotent and ignored late packets safely.
- Preserved disconnected-player ownership context through the GDevelop leave
  event, then released it deterministically.
- Removed queued messages belonging to disconnected users without affecting
  other connections.
- Fixed Geckos server startup/listener readiness, typed-array slicing, unload
  listeners, and server/connection cleanup.
- Closed partially initialized adapters when startup failed.
- Scoped tick timers to their server context so old game sessions cannot keep
  running.
- Added retry for the initial client connection request.
- Captured and restored authoritative client scene/object state after local
  events.
- Corrected dedicated-mode detection and the GDevelop `StopServer` action.

### M1 verification

- Two separate browser clients converged on one non-player-hosted authority.
- Only the owning player's accepted input moved its object.
- Illegal local score and position edits did not enter authoritative state.
- Normal leave, abrupt disconnect, reconnect, and server stop passed.
- Focused regression tests were added for every code-level lifecycle repair.
- Milestone commit: `6df2c6e` (`feat: prove remote authority vertical slice`).

## 2026-07-19 — M2 deterministic server export

### Export and bundle contract

- Added the server CLI surface:
  - `thnk export-server`;
  - `thnk server validate`;
  - `thnk server run`.
- Added a hidden Electron runtime and Geckos bridge that run the exported game
  without the GDevelop editor or THNK source tree.
- Added a versioned manifest, SHA-256 content hash, required runtime metadata,
  frozen bundle dependencies, configuration example, and generated README.
- Added strict validation for path traversal, required files, transport/runtime
  compatibility, ports, dependencies, and content-hash tampering.
- Normalized GDevelop's random inline-function identifiers so repeated exports
  are byte-stable apart from documented manifest metadata.
- Corrected the Relay adapter import so generated extensions do not embed a
  machine-specific workspace path.

### Restored Relay workspace

- The tracked `code/relay` workspace had accidentally appeared deleted after
  the storage move.
- Restored it from `HEAD`, reinstalled dependencies with the pinned toolchain,
  and reran all repository gates successfully.
- Follow-up commit: `c903585` (`fix: keep relay builds repository-relative`).

### Linux packaging investigation

- Copied a checksum-verified server bundle to a separate Ubuntu 24.04 x86_64
  development host over the private LAN.
- Installed Xvfb and Electron's required GTK/NSS/ALSA/GBM/X11 libraries.
- Installed the supported Node 18.20.8 user-local toolchain after discovering
  that the host's older Node/native ABI could not use the pinned WebRTC binary.
- Configured Electron's `chrome-sandbox` as `root:root` mode `4755`; the unsafe
  `--no-sandbox` workaround was not used.

### WebRTC compatibility defect

- The original Geckos 2.3/node-datachannel 0.4 stack loaded on Linux but failed
  inside Electron with an empty SHA-256 fingerprint.
- A minimal probe proved that the same old native library worked under plain
  Node but failed under Electron.
- A second probe proved that node-datachannel 0.32.1 worked in the same Electron
  runtime.
- Upgraded both Geckos client and server to 3.1.0, bringing in the modern native
  WebRTC stack.
- Configured THNK state traffic as fully reliable and ordered because its
  compact create/update/delete diffs require message order.

### Identity and reconnect hardening

- Confirmed transport connection IDs use a random server-session UUID plus a
  monotonically increasing, non-reused connection sequence.
- The first eight-client Linux run exposed a duplicate synchronized object on
  one client.
- Made client object creation idempotent: a replayed create message cannot
  replace or duplicate an already-live numeric ID.
- Tightened browser-test readiness so reconnect checks wait for GDevelop's
  lifecycle API, not only the partially initialized `gdjs` global.
- Added `THNK_FIXTURE_SERVER_HOST` so generated client fixtures can target a
  second machine without modifying the tracked fixture.

### Remote validation and power interruption

- Eight-client remote lifecycle passed: unique IDs, authoritative ownership,
  selective disconnect, stable survivor identities, reconnect, and convergence.
- Sixteen-client remote stress lifecycle passed on the 2-core/3.7 GiB Ubuntu
  development host.
- A power interruption occurred during the final artifact copy. After power
  returned, the local archive and remote transfer were checksum-verified,
  dependencies were reinstalled from the frozen lockfile, and the exact final
  bundle passed the complete eight-client lifecycle again.
- The remote server was stopped afterward and port 9208 was verified free.

### M2 final verification

- Frozen install: passed.
- TypeScript: passed.
- Jest: 10 suites, 23 tests passed.
- Full build and generated extensions: passed.
- Formatting and fixture contract: passed.
- Repeated final exports produced content hash
  `39e37e9b81a3e1c2e417b56ad83d591c15bff6702fb41589d40651ff9b0beb7d`.
- Windows and Ubuntu/Xvfb bundle launch: passed.
- Final milestone hardening commit: `f03309e`
  (`fix: harden remote reconnect lifecycle`).

### Remaining boundary

- Sixteen clients are a correctness/stress proof, not a supported production
  capacity. Formal load profiles, resource measurements, latency percentiles,
  soak testing, and published player limits remain M5 work.

## 2026-07-19 — M3 started

- M3 scope: external matchmaking bridge, one-session control API, asymmetric
  admission-token verification, roster enforcement, reconnect policy, signed
  lifecycle webhooks, bounded retry, and idempotency.
- Implementation work starts from M2 commit `f03309e`.

## 2026-07-19 - M3 external matchmaking bridge

### Control and admission contract

- Added an opt-in v1 HTTP control API with liveness/readiness, authenticated
  session create/read/end, one active session per process, 64-KiB request
  limits, and conflict/error responses.
- Bridge-disabled servers do not open the control port and retain the existing
  direct Geckos connection path.
- Bumped the exported bundle contract to format version 2. The manifest now
  declares the control API version, default loopback port, bridge environment
  switch, and authorization-header admission transport.
- Added built-in RS256 JWT verification with explicit algorithm, key ID,
  issuer, audience, signature, session/player, `iat`/`nbf`/`exp`, five-minute
  lifetime, roster, single-use `jti`, and one-live-connection checks.
- Bound verified `playerId` values to THNK's canonical server user IDs. A
  disconnect and fresh-token reconnect retain the player identity while using
  a new token and transport connection; stale callbacks cannot remove another
  connection.
- Added the GDevelop `Connect to server with admission token` action. Tokens
  travel in the Geckos HTTP `Authorization` header and are cleared from the
  adapter after the connection attempt.

### Lifecycle callbacks and shutdown

- Added `session.started`, `player.joined`, `player.left`, and `session.ended`
  webhooks with stable event IDs, exact-body HMAC-SHA256 signatures, request
  timeouts, and bounded exponential retry.
- Kept event records in a process-local outbox and exposed only aggregate
  delivery state through the authenticated control response.
- Session end now closes admitted channels first, waits for player cleanup and
  leave callbacks, emits the final session event, drains webhook work, closes
  the game adapter, and exits.
- The first process-level run exposed two shutdown defects: an inherited
  `beforeunload` guard forced exit code 1, while bypassing it with window
  destruction could crash native WebRTC teardown. The final path allows normal
  unload, closes Geckos/node-datachannel through the adapter, and exits 0.

### M3 verification

- Unit/contract coverage includes forged, expired, wrong-issuer,
  wrong-session, wrong-player, replayed, and concurrent-player tokens;
  duplicate rosters/sessions; unsafe callbacks; missing control secrets;
  HMAC/stable retry behavior; total callback outage; and oversized payloads.
- The exported-artifact integration check started a stub matchmaker, admitted
  isolated `alice` and `bob` browser clients, proved authoritative ownership,
  disconnected Bob, rejected his old token, reconnected him with a fresh token,
  and preserved Alice's identity.
- The callback outage injection produced 9 HTTP attempts for 8 logical events,
  proving at-least-once delivery with stable idempotency keys.
- Ending the session drained both clients, delivered the final lifecycle event
  with `playersDrained: true`, stopped the game, and exited with code 0.
- A separate three-client bridge-disabled run passed join, ownership,
  selective disconnect, fresh browser reconnect, identity stability, and
  convergence, confirming M2 direct-connect compatibility. The control port
  remained closed throughout that run.
- Final repository gates passed: frozen install, TypeScript, 12 Jest suites/32
  tests, complete generated-extension build, fixture validation, and bundle
  validation. Two independent final exports produced content hash
  `37bdb16734028946abd097e843b14a010ef11c9752d4750b86ba2de4b88d6ad0`.
- Detailed contract and evidence: `docs/project/M3-MATCHMAKING-BRIDGE.md`.
