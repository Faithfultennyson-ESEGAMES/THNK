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

## 2026-07-19 - M4 Agora session voice (implementation and credential-free gate)

### Server voice boundary

- Started `platform/m4-agora-voice` from M3 commit `1534766`.
- Selected Agora's maintained `agora-token` 2.0.5 server package and Agora Web
  SDK 4.24.6 after checking the official token builder and current Web SDK API.
- Added opt-in server configuration. Voice requires bridge mode, a valid
  32-hex-character App ID and App Certificate, and a public HTTPS token URL;
  only explicitly enabled loopback development may use HTTP.
- Derived a shared safe channel from the canonical session ID and a distinct,
  stable voice UID from each canonical session/player pair. Reconnecting the
  same player preserves that UID; different players cannot collide through
  client-selected identity input.
- Added ten-minute publisher tokens, configurable 120-to-3600-second bounds,
  five-second minimum refresh spacing, and an eight-per-minute default bound.
- Added a random 256-bit refresh capability to each admitted connection. Only
  its SHA-256 digest is stored. It is inactive before gameplay connect and is
  revoked on abandoned admission, disconnect, or session end. Reconnect rotates
  the capability.
- Added `POST /v1/voice/token` with bearer-capability authentication, CORS
  preflight, `Cache-Control: no-store`, stable errors, and `Retry-After` for
  issuance throttling.
- Bumped the server bundle contract to format version 3, added the maintained
  Agora token dependency and voice manifest contract, and expanded generated
  configuration/README guidance. The App Certificate remains environment-only.

### Client and GDevelop surface

- Added an Agora voice runtime to the Geckos client extension. It auto-joins
  only after the authenticated Geckos handshake returns a voice grant.
- Added join, leave, self mute/unmute, canonical-player remote mute/unmute,
  per-listener 0-to-100 volume, connection state, connected/muted conditions,
  speaking indicator/level, and sanitized last-error surfaces.
- Added remote Agora UID mapping from the server-authoritative roster so
  moderation controls address canonical player IDs rather than client-chosen
  aliases.
- Added timer and Agora-event token refresh. Refresh responses are accepted
  only if App ID, channel, and UID still match the original admission grant.
- Microphone denial retains a listen-only connection. Provider join,
  subscribe, token-endpoint, refresh, and leave errors remain voice-only and do
  not reject or close gameplay.
- Minified the Agora-bearing Geckos client adapter separately; the generated
  extension is about 1.65 MB rather than the initial unminified 2.55 MB.

### Tests and exported-runtime proof

- Added server tests for deterministic/isolated channel and UID derivation,
  real token creation, certificate absence, capability activation/revocation,
  refresh throttling, unsafe URL rejection, credential validation, and
  sanitized provider failures.
- Added session/control tests proving voice grant lifecycle binding, gameplay
  admission despite token-generation failure, public CORS refresh behavior,
  and opaque capability enforcement.
- Added client tests for admission-only auto-join, publish, listen-only
  microphone denial, canonical remote mute/volume, speaking state, secure
  refresh, provider outage isolation, and disconnect cleanup.
- TypeScript passed. Jest passed 14 suites and 46 tests. Full build and
  generated GDevelop extension import/export passed.
- Exported format-v3 server dependencies installed from the frozen lockfile.
- The credential-free two-client exported-runtime gate passed: one shared
  channel, distinct Alice/Bob UIDs, distinct capabilities, successful refresh,
  stable Bob UID across fresh-token reconnect, rotated Bob capability,
  uninterrupted authoritative gameplay during intentional Agora outage,
  9 webhook attempts for 8 logical events, player drain, and exit code 0.
- App Certificate test material was absent from the complete client export,
  voice refresh response, and server logs.
- Added `docs/project/M4-AGORA-VOICE.md` and a real-provider test runner that
  reads credentials from an external, non-repository JSON file without printing
  them.

### External gate setup

- The actual two-client Agora publication/subscription, local control, voice
  leave/rejoin, and refreshed-token gate needs a real App ID/App Certificate.
  It will run only after the external secret file exists; no credential value
  will be committed or copied into this log.

### Live Agora gate completed

- Read the App ID and App Certificate from the external
  `D:\CodexTools\THNK-v1\agora-m4.json` file. The runner accepts camel-case or
  environment-style JSON fields and never prints either value.
- The first live run proved initial two-way publish/subscribe and local
  controls, then exposed a test-fixture issue: Alice was intentionally left
  self-muted before rejoining, so Bob correctly received no republished audio
  event. Gameplay stayed connected. The server shut down and invalidated the
  temporary capabilities.
- Updated the test to unmute before voice rejoin and changed diagnostic
  snapshots to compare SHA-256 capability fingerprints. Timeout output also
  redacts token, secret, certificate, authorization, and capability fields.
- The clean rerun passed real Agora audio publication/subscription for both
  clients, local self/remote mute and volume, voice-only leave/rejoin with
  resumed mutual audio, short-lived token refresh, stable canonical UID and
  rotated capability on Bob's fresh-token reconnect, authoritative gameplay,
  webhook retry/drain, and exit code 0.
- The full client export and server output were scanned for the real App
  Certificate; neither contained it. Refresh responses also contained no
  certificate.

### M4 final artifact and audit

- A fixed-time reproducibility check initially alternated between two hashes.
  The only changing generated file reused GDevelop inline-function numbers in
  separate behavior contexts. Updated normalization to scope generated
  identifiers by their qualified context and added a regression covering
  identical numeric names under different prefixes.
- Two consecutive final exports then produced the identical format-v3 hash
  `7a9f0d92ad2d52941c43d7f98835fea88d0d8fab739872952ee4598b102495a1`.
- The exact final artifact passed validation, frozen production dependency
  install, the credential-free outage/isolation proof, and the live Agora
  publish/subscribe/control/rejoin/reconnect proof.
- Final repository gates: frozen root install, TypeScript, 14 Jest suites/46
  tests, full minified build, generated-extension import, fixture contract,
  client export, server export validation, and repeated content hash passed.
- Production dependency audit reported 0 critical, 8 high, 10 moderate, and 3
  low advisories. All high paths are pre-existing: Electron 32 runtime issues
  and Geckos/node-datachannel's prebuild installer (`semver`/`tar-fs`). Neither
  `agora-token` nor `agora-rtc-sdk-ng` introduced a high advisory. M5 must
  upgrade/test the runtime chain or record formal mitigations before a release
  candidate.

### M4 completion record

- M4 implementation was committed on branch `platform/m4-agora-voice` as
  `e76d5f458876402b07e1180361365a688b81a8fd` (`feat: add secure Agora session
  voice`).
- The user-owned `.vscode/settings.json` change was deliberately excluded from
  the M4 commit.
- Before commit, 849 tracked and untracked repository files were scanned for
  the external Agora App Certificate; zero matches were found.

## 2026-07-19 - M5 multi-authority and admission hardening

### Authority catalog, artifact identity, and supervisor

- Started `platform/m5-multi-authority` from M4 commit `0b0c6f0` and treated
  the user-authored Matchmaking and Player Profile plans as cross-service
  contracts; their implementations remain separate repositories.
- Bumped the bundle format to v4. The exporter now scans all literal Geckos
  `HostServer` actions into a deterministic authority catalog, rejects
  duplicate/invalid IDs and mixed ports, and preserves legacy one-authority
  projects by assigning `default` in the staged export.
- Added compatibility, client-build, and protocol identities. The server build
  ID is the verified bundle SHA-256 (`sha256:<contentHash>`), optionally pinned
  from the deployment registry with `THNK_EXPECTED_SERVER_BUILD_ID`.
- Deliberately resolved the earlier "signed manifest" ambiguity as a trusted
  content-addressed manifest. A self-contained signature would not establish
  trust unless its public key were anchored outside the bundle.
- Added runtime preflight that recomputes integrity, selects one authority and
  optional map, patches the GDevelop bootstrap scene, and exits 1 before
  Electron initialization for an unknown authority or untrusted build.
- Converted bridge startup into a supervisor: the control API becomes live
  first, validates the complete session assignment, launches the hidden
  GDevelop authority, and only then reports readiness. Wrong authority/build
  or client compatibility never calls the start hook.

### Admission identity and GDevelop tags

- Extended session assignments and RS256 JWTs with game, authority, optional
  map, server build, compatibility, client build, protocol, and flat scalar
  tags. Added stable wrong-game/authority/map/build and
  `client_update_required` errors.
- Bound each signed tag map to its roster entry and froze it in canonical
  admission identity. Added `GetPlayerTag` as a read-only server expression.
- The first exported-runtime tag proof found that the separately bundled
  Geckos adapter had a second private `PlayerContext` map. It now writes tags
  through the canonical global `THNK.players` registry; tests and the fixture
  prove the exact signed value survives connect and fresh-token reconnect.
- Kept canonical player IDs, one-live-connection checks, single-use tokens,
  stale-transport disconnect protection, and per-player voice capabilities
  intact.

### Fixture and regression findings

- Added a generated Duel/Racing fixture and matching client export. The first
  client attempt used the old M1 scene catalog and correctly failed to enter a
  renamed authority; exporting both halves from the same M5 project fixed the
  contract mismatch.
- Added dedicated unit/contract cases for authority catalogs, runtime hash
  verification, trusted build pinning, unknown authority, supervisor ordering,
  wrong game/authority/map/build/version claims, signed tag mismatches, and
  immutable tag values.
- The legacy M2 regression found GDevelop rejects an omitted new string
  parameter even though Core maps it to `default`; staged parameter migration
  now keeps existing projects source-compatible.
- Direct Ctrl+C sent through `xvfb-run` also terminated its virtual display and
  produced an Electron wrapper shutdown fault. The real supervisor
  `/v1/session/end` path on Ubuntu drained callbacks and shut down cleanly.

### Final evidence

- Frozen root install, TypeScript, 15 Jest suites/56 tests, full minified build,
  generated extension import/export, bundle validation, and a repeated
  content-hash export passed.
- Final format-v4 build ID:
  `sha256:78155313b606c8128aa2b2972d25b0547658ff6425280db4c27ac548af232029`.
- The Windows M5 gate passed two-client authoritative state, exact signed tag
  propagation, disconnect/reconnect identity isolation, two independent
  authority selections, all pre-start rejection cases, webhook drain, and
  exit code 0.
- M3 and M4 exported-runtime gates passed again on the legacy `default`
  authority. M4 retained isolated voice grants, refresh, reconnect capability
  rotation, and gameplay continuity during provider outage.
- Ubuntu 24.04.4 x86_64 with Node 18.20.8 and Xvfb loaded the verified artifact:
  Duel reached its scene marker; Racing rejected a wrong build, accepted the
  valid assignment, and shut down through the control API; unknown authority
  exited 1 before control/GDevelop startup.
- The Ubuntu host's npm registry connection timed out. Linux reused the exact
  Electron/Geckos cache proven during M2 plus platform-independent Agora JS
  dependencies; no credential was copied or logged.
- Detailed contract and evidence: `docs/project/M5-MULTI-AUTHORITY.md`.
- M6 still owns real illegal-edit detection for `trust.violation`, roster-keyed
  pre-issued Agora grants and refresh ownership, Player Profile documents, and
  blocked-player admission.
