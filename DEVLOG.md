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

## 2026-07-19 - M6 cross-service integration hooks

### Player Profile boundary and documents

- Started `platform/m6-cross-service-hooks` from M5 commit `edf57ef`; the two
  companion services remain specifications/separate repositories.
- Added an optional Player Profile client configured only by server environment
  URL and an independent 32+ character service credential. HTTPS is required
  outside explicitly enabled loopback development; requests have a 3-second
  default timeout and documents have a 64 KiB bound.
- The supervisor validates assignment identity, then checks the whole roster's
  blocked status before GDevelop starts. A blocked fixture player returned
  `player_blocked` while authority-ready/scene markers remained absent.
- Signed admission now loads the player's game-scoped JSON document before
  connection creation. Added typed GDevelop number/string/boolean/JSON reads
  and `SetPlayerVariable`, which copies primitives/structures/arrays and throws
  inside the extension if invoked from client code.
- Serialized writes per player after review found that parallel PUTs could
  otherwise finish out of order. Reconnect waits for in-flight persistence;
  disconnect/session end perform a final flush. The fixture loaded XP 7,
  server-set/persisted XP 8, and reloaded it for Bob without identity mixing.

### Trust violation and external voice ownership

- Added an official-client lifecycle detector for local authoritative scene and
  synchronized-object edits. It reports a reserved violation before restoring
  state; the server derives player identity from the authenticated connection.
- Client/server cooldowns collapse a held Space edit into one incident. The
  existing signed outbox delivered exactly one HMAC-verified
  `trust.violation` with player, connection, type, session, and timestamp.
- Documented the honest boundary: a fully modified client can remove its own
  reporting, while the authoritative server still refuses the edited state.
- Added all-or-none `voiceGrants[playerId]` validation. Every roster player has
  one distinct UID/token/refresh capability; all use one App ID/channel and
  `refreshOwner: "matchmaker"`. Core passes these through and does not own the
  external refresh. M4 fallback remains `refreshOwner: "bridge"` and rotates
  its local capability per reconnect.
- The exported M6 gate explicitly deleted App ID, App Certificate, and local
  token URL. External grants still reached two distinct players and provider
  failure did not break gameplay or fresh-token reconnect.

### Local evidence

- TypeScript, 16 Jest suites/66 tests, full minified build, generated extension
  import/export, M6 bundle validation, and the real two-client M6 integration
  passed.
- M3, M4, and M5 exported-runtime regressions passed. The M4 local-mint path
  retained refresh/capability rotation; M5 retained independent authority
  selection and pre-GDevelop rejection.
- Two deterministic M6 exports matched build ID
  `sha256:0168bc1adfe55b5b12b7054558d91ced0d3a1ff3f5b1f9383ac80bbee55e553a`.
- Detailed contract/evidence: `docs/project/M6-CROSS-SERVICE-HOOKS.md`.
- Ubuntu 24.04/Xvfb passed with the exact content-addressed M6 artifact:
  blocked-roster preflight happened before GDevelop, Duel admission loaded a
  Player Profile document, external voice worked without local Agora
  credentials, signed lifecycle events drained, and the process exited 0.
- An initial remote run placed its test harness inside the artifact and was
  correctly rejected by integrity validation. The harness was moved outside
  the bundle and the exact artifact restored before the passing run.

## 2026-07-20 - M7 product hardening and release candidate

### Runtime and operational hardening

- Started `platform/m7-release-candidate` from M6 commit `3d91e94` and kept
  Matchmaking and Player Profile implementations outside Core as planned.
- Added newline-delimited structured logs with lifecycle correlation fields
  and recursive redaction for authorization, tokens, secrets, certificates,
  capabilities, private keys, passwords, and player documents. Test runs use a
  no-op default sink unless a logger is explicitly supplied.
- Added separate fixed-window limits for control, health, and public voice
  routes, capped limiter storage, 64 KiB JSON bodies, 16 KiB headers, content
  checks, request/body deadlines, safe response headers, and `Retry-After` on
  throttling.
- Added explicit live/ready endpoints. Readiness includes authority, session,
  Player Profile, and webhook state; Player Profile failure closes readiness,
  while webhook degradation remains visible without ending gameplay.
- Added a four-hour default maximum session duration and bounded graceful
  SIGINT/SIGTERM/session-end draining for Player Profile writes, lifecycle
  webhooks, player disconnects, and renderer shutdown.

### Release surface, dependencies, and CI

- Bumped the exported artifact to format 5 and pinned Node 24.18.x,
  Electron 43.1.1, and `@electron/remote` 2.1.3. Runtime packages now live in
  production dependencies; Jest 30, ts-jest 29.4, TypeScript 5.9, tsup 8.5,
  and Node 24 types cover the development graph.
- Adapted Geckos/local/P2P typed-array boundaries for TypeScript 5.9 without
  changing wire behavior. Production audit reports zero moderate/high/critical
  advisories across 141 packages. The only full-graph finding is one low,
  development-only esbuild local-server advisory.
- Added Ubuntu 24.04/Node 24 CI for frozen install, TypeScript, Jest, build,
  secret scan, production audit, lifecycle smoke, and stub contract smoke.
- Added production configuration, compatibility, threat-model,
  troubleshooting, and start-to-stop guides plus a loopback-only executable
  Matchmaking/Player Profile stand-in.

### Platform and container findings

- Exact format-5 release build:
  `sha256:808e515304088c927c10376d8cccccbbe4a86cdd2edca6d44708eac6cd2b8d6a`.
- Electron 43.1.1 passed the complete M7 two-client matrix twice before the
  documentation-only final re-export, and the exact final hash passed once
  more, including distinct identities, fresh-token reconnect,
  adversarial token rejection, external per-player voice grants, provider
  outage isolation, signed webhook drain, and exit code 0.
- Ubuntu 24.04.4 x86-64 with Node 24.18.0, Electron 43.1.1, Xvfb, and the
  setuid Chromium sandbox passed blocked preflight, distinct Alice/Bob
  admission, readiness, payload/rate controls, structured-log redaction,
  external voice without local Agora credentials, webhook drain, and exit 0.
- The first container build found that Node 24's image already provides Yarn;
  reinstalling it failed. The next build showed Electron 43 no longer downloads
  its platform binary during dependency installation, so the Docker and
  generated-bundle instructions now run its explicit installer. Runtime smoke
  then identified missing `xauth` and Docker's default seccomp rejection of
  Chromium's nested namespace sandbox.
- The final image adds xauth, runs Electron with `--no-sandbox` only inside the
  non-root container boundary, and does not request privileged mode or extra
  capabilities. Native Ubuntu retains the root-owned mode-4755 sandbox.
  Image
  `sha256:83c3bc1a87c0df163a17440032f32c835bc32f7bb088e37d868b744cd4e045ed`
  runs as UID 10001 with Node 24.18.0, Yarn 1.22.22, and Electron 43.1.1;
  liveness returned 200 and readiness correctly returned 503 before assignment.
  Splitting dependency installation from the bundle copy made platform downloads
  reusable and avoiding a recursive ownership rewrite kept the root-owned,
  service-user-read-only final image to 469,917,558 bytes.

### Verification and remaining gate

- Frozen install, TypeScript, 17 Jest suites/73 tests, full build, exact bundle
  validation, production-only bundle install, secret scan (including the
  externally supplied Agora values), production audit, headless lifecycle
  smoke, stub contract smoke, client export, Windows runtime matrix, Ubuntu
  runtime matrix, and container runtime smoke passed.
- The App ID/App Certificate file remained external to the repository; supplied
  secret values were scanned against 890 files with zero leaks.
- Core M7 implementation and all available platform gates are complete. Formal
  M7 closure remains pending only on one real end-to-end run against separately
  deployed THNK Matchmaking and THNK Player Profile implementations. Those
  repositories do not exist yet, so the passing local stand-in is recorded as
  contract evidence and not substituted for the external acceptance gate.

## 2026-07-20 - M7 delivery and Matchmaking handoff

- Committed the M7 release candidate as `18566a1` and pushed
  `platform/m7-release-candidate` to the writable project origin. The
  user-owned `.vscode/settings.json` change remained outside the commit.
- Confirmed the final format-5 artifact and its documented Windows,
  Ubuntu/Xvfb, and container evidence are the Core contract baseline for the
  separate `THNK-Matchmaking` repository.
- Began the Matchmaking workstream in a sibling repository. Core remains
  responsible for artifact validation, supervised session creation, signed
  player admission, lifecycle callbacks, Player Profile hooks, and voice-grant
  consumption; Matchmaking owns queues, lobbies, assignments, signing-key
  custody, Bridge orchestration, and matchmaker-owned voice grants.
- The real-service M7 acceptance gate will be revisited after Matchmaking and
  Player Profile have executable integration milestones; the in-Core stub is
  still intentionally not treated as either production companion service.

## 2026-07-20 - External Matchmaking M1-M2 integration update

- The separately published `THNK-Matchmaking` service now has executable M1
  public-queue and M2 private-lobby handoff paths. Both use Core's exact M7
  control, admission, and signed lifecycle contracts; no alternate game-session
  protocol was introduced.
- On Ubuntu 24.04.4 x86-64, Matchmaking M1 handed a real two-player public match
  to exact Core build
  `sha256:808e515304088c927c10376d8cccccbbe4a86cdd2edca6d44708eac6cd2b8d6a`.
  Alice and Bob's distinct Matchmaking-issued tokens were accepted by the real
  Geckos endpoint and Core's signed end callback cleaned Matchmaking state.
- Matchmaking M2 final code commit `a767fe1` then created a real four-player
  private lobby, auto-started it after all members became ready, and handed the
  exact roster to the same Core build. All four distinct admissions were
  accepted; signed end lifecycle removed the linked lobby/session state;
  captured logs contained no
  tested control secret, webhook secret, or admission token.
- These gates close the previously pending external Matchmaking-to-Core portion
  of M7 verification. The separately deployed Player Profile production-service
  gate remains pending; M2 friendship checks used an independently authenticated
  contract stub and are not represented as a completed Player Profile service.

## 2026-07-20 - External Matchmaking M3 team-routing gate

- Matchmaking code commit `dfaeb90` generalized its Core handoff from one target
  to validated queue rules and mode routes while preserving Core's exact M7
  control/admission contracts. Matchmaking, not Core, resolves team policy and
  signs opaque `team`/`squad` tags.
- On Ubuntu 24.04.4 x86-64, an Alice/Bob party plus Carol/Dave backfill produced
  one real four-player session on exact Core build
  `sha256:808e515304088c927c10376d8cccccbbe4a86cdd2edca6d44708eac6cd2b8d6a`.
  Core accepted all four distinct tokens with Alice/Bob tagged team A and
  Carol/Dave team B, then emitted the signed lifecycle event that cleaned the
  external session state.
- The stubbed two-route gate separately proved queue-to-mode-to-authority/map/
  build resolution against two Core control endpoints. The exact native bundle
  contains one `duel` authority, so it validates tag/admission interoperability
  while multi-authority dispatch is covered at the real HTTP contract boundary.

## 2026-07-20 - External Matchmaking M4 regional-routing gate

- Matchmaking code commit 2666df8 added regional Core/game deployments,
  repeated QoS summaries, local MaxMind City lookup, GeoIP candidate ordering,
  and party-wide worst-player region selection. The final evidence commit is
  1cb2cc5 on matchmaking/m4-regional-qos.
- A real-Redis, two-Matchmaking-instance gate gave Alice a Nigeria/Africa
  location and Bob a US/North-America location. Their geographically preferred
  edge regions disagreed, while QoS minimax converged both players on one
  central Core deployment. Core metadata, assignments, and signed admissions
  all carried the same selected region.
- The exact M4 source archive matched between Windows and Ubuntu at SHA-256
  3f34f63065191dae5a6615c7e14403e9605e123a2f48455258155b0784d94fac.
  Ubuntu 24.04.4 passed frozen install, 25 tests, build, all M0-M4 Matchmaking
  integrations, the 37-package audit, and a real GeoLite2-City database lookup.
- M4 then reran the native Core gate against exact build
  sha256:808e515304088c927c10376d8cccccbbe4a86cdd2edca6d44708eac6cd2b8d6a.
  Core accepted all four distinct admissions with the added default region
  claim, preserved party/team tags, and completed signed lifecycle cleanup.
- This closes the regional-routing compatibility check without moving GeoIP or
  matchmaking policy into Core. The previously recorded M5/M6 technical work
  remains unchanged: trusted content identity, detectable trust violations,
  supervisor-first admission, and per-player external Agora grants with
  matchmaker-owned refresh authorization.

## 2026-07-20 - External Matchmaking M5 voice-grant gate

- Matchmaking M5 now owns Agora credential custody, complete per-roster voice
  grant issuance, lobby-to-session handoff, capability refresh, and lifecycle
  revocation. Core continues to validate and consume the exact external grant;
  it never receives the Agora App Certificate and does not proxy Matchmaking's
  refresh endpoint.
- An initial native attempt correctly rejected an HTTP loopback refresh URL as
  `invalid_external_voice_grant`. Matchmaking tightened both startup and schema
  validation to require HTTPS, matching Core's existing contract.
- On Ubuntu 24.04.4 x86-64 under Xvfb, final Matchmaking code commit `a94cc28`
  started a four-player session against exact Core build
  `sha256:808e515304088c927c10376d8cccccbbe4a86cdd2edca6d44708eac6cd2b8d6a`.
  Core accepted four distinct Matchmaking-issued external grants and four
  distinct admissions, preserved party/team tags, emitted signed lifecycle
  cleanup, and Matchmaking revoked the ended-session refresh capability.
- This closes the executable external Matchmaking-to-Core voice ownership gate.
  The production Player Profile repository remains separate; Matchmaking M5
  currently proves its friendship, durable-DM, unread, and chat-filter tally
  API through an independently authenticated contract stub.

## 2026-07-21 - External Matchmaking M6 scale and recovery gate

- Matchmaking M6 added drain-aware readiness, tracked public/private Core
  handoffs, shared Redis action limits, non-overridable/redacted structured
  logging, a pinned production container, and a full deployment runbook.
- The Windows gate ran three Matchmaking replicas over one Redis namespace and
  two Core regions: 96 concurrent public players formed 24 four-player sessions
  and 48 private players formed 12 sessions with no duplicate placement, lost
  ticket, orphan ownership, or player-ID crossover.
- Exact Matchmaking commit `c058e8f` matched on Ubuntu at SHA-256
  `87166b92a4024ff94cf4eaeee00f19088a6b92894e495781b4fac1539f12ecfa`.
  Its 48-player characterization passed six private and twelve public sessions,
  including four clients from a deliberately drained handoff reconnecting to a
  surviving replica and recovering only their exact assignment through
  `match.status`.
- Under Xvfb, that artifact reran the external gate against exact Core build
  `sha256:808e515304088c927c10376d8cccccbbe4a86cdd2edca6d44708eac6cd2b8d6a`.
  Core accepted four distinct admissions and external Agora grants, preserved
  teams, and completed signed lifecycle/revocation cleanup with secrets
  redacted. Core required no M6 code change.
- Matchmaking's 35 tests/build and 46-package production audit also passed with
  zero known vulnerabilities. Production Player Profile certification remains
  a named future external gate; Matchmaking currently exercises its exact API
  contract through the stub by project design.

## 2026-07-21 - External Player Profile M0 identity baseline

- Initialized the separate `THNK-PlayerProfile` repository and completed M0 on
  branch `player-profile/m0-baseline`. It owns canonical UUID player identity
  and durable Postgres records without moving identity state into Core or
  Matchmaking.
- Exact implementation commit `de5975d` provides transactional email/provider
  identity creation, Argon2id passwords, case-insensitive database uniqueness,
  HS256 cookie/Bearer sessions, authenticated `/me`, migrations, readiness,
  and PII/credential-redacted logs.
- A no-Git-metadata fresh checkout used exact Node 24.18.0, Yarn 1.22.22, and a
  real PostgreSQL 17.8 container. Frozen install, four tests, typecheck, build,
  M0 integration, concurrent duplicate-registration arbitration, and the
  79-package zero-vulnerability production audit passed.
- Core's M6 document/block contracts remain future Player Profile M2/M4 work;
  M0 deliberately establishes identity plumbing without pretending those
  internal APIs already exist.

## 2026-07-21 - External Player Profile M1 OAuth identity linking

- Player Profile implementation commit `3b31481` adds server-verified Google,
  Google Play Games, and Facebook adapters plus safe canonical-account linking.
  Browser flows use opaque browser-bound single-use state; Google adds nonce
  and S256 PKCE. Play Games resolves its own authenticated player ID, while
  Facebook app/token/profile IDs must agree and its email remains unverified.
- Automatic linking requires a provider-verified email that maps through
  exactly one already verified identity. Unverified email never silently
  merges accounts; explicit links require a valid Player Profile session, and
  an identity owned by another player cannot be moved.
- Exact source archive SHA-256
  `58262c6cf71205b1788db5d48d5a9b5343d8458874513f12ff94ca8e8bb2f456`
  passed a fresh frozen install on Node 24.18.0/Yarn 1.22.22, typecheck, four
  unit/security tests, build, M0 regression, real-PostgreSQL M1 adversarial
  integration, and a 79-package audit with zero known vulnerabilities.
- Real Google/Play Games/Facebook sandbox callbacks remain an explicit external
  credential gate; mocked adapters are not reported as live provider proof.
  This milestone changes no Core runtime code. Core document/block integration
  remains Player Profile M2/M4 work.

## 2026-07-21 - External Player Profile M2 document contract

- Player Profile commit `703dc35` implements game-scoped internal credentials,
  atomic field/achievement schema registration, and the exact document and
  blocked-status endpoints expected by Core's M6 client.
- Its real-PostgreSQL integration invokes Core's shipped
  `scripts/m2/runtime/player-profile-client.cjs` and passes default hydration,
  64 KiB enforcement, wrong-type/undeclared-field rejection, reconnect
  persistence, schema upgrade, and cross-player/game isolation.
- Game-defined achievement state lives inside the same persistent document and
  enforces declared IDs, schema-bound targets, monotonic progress, and
  irreversible unlocks. The companion GDevelop extension supplies the five M2
  achievement operations with server-only pre-mutation guards.
- The native amendment's Step 0 is proven end to end. GDevelop 5.6.274 exported
  the fixture through its normal Android/Cordova path, Cordova Android 15.0.0
  built that exact export, and ADB installed it on an Infinix X6880 running
  Android 15. Android UIAutomator observed the custom Java plugin's callback
  value `THNK_SPIKE_OK`. The APK SHA-256 is
  `ef07111df26f25cca199dfcb8f720f128dd0b438b219efa8e24867d334871b48`.
  M2.0 is complete and production Android Google/Facebook SDK work is unblocked.
- Core required no runtime change. Its once-future M2 document integration is
  now executable; the Player Profile M4 blocked/moderation administration flow
  remains separate future work.

## 2026-07-21 - External Player Profile M2.3 Android-native provider bridge

- Player Profile implementation commit: `53c6b698ead6926ec8ac919598726ebbc7efa832`.
- Player Profile implements a Cordova Android bridge pinned to Play Games
  Services v2 21.0.0 and Facebook Login 18.3.0. The same GDevelop Google and
  Facebook actions select native Android or retain the M1 browser redirects on
  Web/PC. Google returns a one-time server auth code; Facebook uses its distinct
  native access-token route. Provider secrets remain server-only.
- GDevelop Desktop 5.6.274 imports the generated production extension with its
  Cordova dependency intact. Cordova Android 15 compiles both native SDKs, and
  the Infinix X6880 receives the stable fail-closed native configuration error.
  Google Play Games profile-creation prompting is suppressed until the game
  deliberately requests login.
- Strict typecheck, 15 tests, build, M0/M1 regressions, real-PostgreSQL M2
  contract/native-CORS gate, and the 79-package zero-vulnerability production
  audit pass. Live Google/Facebook success still requires the external Play
  Console/Meta app registration, tester accounts, and credentials; the Google
  popup seen from a fake compile-only project ID is not counted as success.
- Core requires no code change for this implementation.

## 2026-07-21 - External Player Profile M2.4 generic ranked queries

- Player Profile implementation commit: `d7b5741492fa96027d9aa71939f462191634eb50`.
- Added authenticated, game-scoped rankings over any numeric field registered
  in a Player Profile document schema, including nested field paths and direct
  own-rank lookup. This is generic infrastructure, not an XP-specific feature.
- A normalized PostgreSQL numeric projection is backfilled by migration and
  updated in the same transaction as authoritative document load/save/schema
  operations. Ascending/descending indexes, bounded 100-player requests,
  deterministic competition ties, and explicit unranked results are covered.
- GDevelop Player Profile extension 0.4.0 provides async list/own-rank actions,
  loaded/ranked conditions, result/status/error expressions, and stale-response
  protection. GDevelop Desktop 5.6.274 imported all 26 functions while retaining
  the Android Cordova dependency.
- Strict typecheck, 20 tests, production build, all M0-M2 regressions, the new
  real-PostgreSQL M2.4 integration, and the 79-package zero-vulnerability audit
  pass. Core requires no runtime change because its existing authoritative
  document writes are the source feeding the ranking projection.

## 2026-07-21 - Patch: dynamic voice channels, server time, generic change events

- Implemented `CORE-PATCH-DYNAMIC-VOICE-AND-GENERIC-TOOLS.md` together with
  its Matchmaking companion (Matchmaking commit `f515966` adds the
  per-player grant issuance and channel-reissue capability this depends on).
- Dynamic per-player voice channels: the session grant validation now
  requires only a shared App ID; each roster member's grant may carry its
  own channel. The default path is unchanged — when nobody assigns a
  channel, every player still lands on the identical session-derived
  channel, proven by the untouched M4-M7 suites. `setVoiceChannel` on the
  session manager moves a live, connected player mid-session: in the
  externally-granted path it POSTs the player's own opaque refresh
  capability plus `{channel}` to the matchmaker's reissue endpoint,
  validates the returned grant, stores it, and emits `voice-grant-updated`;
  with bundle-local Agora credentials it mints the new-channel token
  directly. Reassignment reuses the same capability in both paths, so
  rapid repeated moves leak nothing; a non-connected player, an invalid
  channel name, and a matchmaker 429 are surfaced as distinct errors.
  `getPlayerVoiceChannel` reads the live assignment, and the geckos bridge
  exposes both plus a `voice-grant-updated` subscription. The client-side
  Agora handler now treats a refresh that returns a different channel as a
  migration (leave, rejoin new channel) instead of rejecting it, while
  still rejecting uid/appId changes.
- New GDevelop surface in the THNK extension: server-only
  `Set Voice Channel(playerId, channelId)` and `GetPlayerVoiceChannel`,
  `GetServerTimestamp()` (the Authority's own clock, milliseconds since
  the Unix epoch, 0 in client-tagged code — the single trusted primitive
  for time-gated systems), and `On Player Variable Changed(fieldName)`.
- The change event fires exactly once per actual value change of a watched
  document field — same-value writes do not fire — covers both own
  `SetPlayerVariable` writes and document loads reflecting changes made
  elsewhere, picks the changed player, ignores fields no condition has
  watched, and drops pending events for released players. This generic
  event deliberately replaces any bespoke achievement/level-up surface.
- Verification: strict typecheck and all 82 Jest tests pass (eight new:
  per-player grant acceptance with mixed-appId rejection, external
  reassignment through a stubbed matchmaker with capability-derived
  authentication, 429 propagation, bundle-local reassignment without
  capability leaks, client channel-migration on refresh, and the
  server-time/change-event suite). The Matchmaking repository's
  `test:voice:channels:core` gate additionally drives this exact
  `session-manager.cjs` against the real Matchmaking server and Redis:
  default channel at admission, live reassignment via the real reissue
  endpoint, matchmaker-side participant-list sync, shared cooldown (429),
  capability stability across repeated moves, and rejection of a
  never-connected player.
- Remaining external gate: a GDevelop export/device pass over the four new
  extension functions and a live-Agora two-device audible-migration check;
  the structural halves are fully proven above.
