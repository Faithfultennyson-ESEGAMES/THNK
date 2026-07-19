# THNK Server Platform — Implementation Plan

**Status:** Draft v1 plan (M0-M5 complete; M6-M7 retain the cross-service and release-candidate work agreed after M4)

**Prepared:** 2026-07-18

**Source spec:** `THNK-Server-Platform-Blueprint.md`

**Companion repositories:** Matchmaking and player identity/persistence are no longer in this repository's scope — they are two separate repositories, `THNK-Matchmaking-Implementation-Plan.md` and `THNK-PlayerProfile-Implementation-Plan.md`. This repository (THNK core) owns the runtime, the export/bundle contract, the Bridge, and the hooks those two services call into. It does not implement matchmaking logic, player identity, or persistent storage itself.

**Resolved implementation details (2026-07-19):** M5 uses a content-addressed
trust contract, not a misleading self-signed manifest. The exporter derives
`serverBuildId` as `sha256:<verified bundle hash>`; a deployer or matchmaker
registers that trusted ID, and the runtime can enforce it through
`THNK_EXPECTED_SERVER_BUILD_ID`. In bridge mode the control API is started
before GDevelop, validates the complete game/authority/map/build/version
assignment, and only then launches the selected authority. M6 still owns the
new detectable illegal-edit violation path, per-player pre-issued Agora grants
and their refresh contract, blocked-player checks, and Player Profile document
hooks. The two companion plan files now exist here as specifications; their
service implementations remain separate repositories.

## 1. What we are building

THNK Server Platform turns a GDevelop + THNK game into a deployable, authoritative multiplayer session without forcing the game developer to use a particular matchmaking service.

The v1 product has four deliverables:

1. **A proven remote-authority baseline** — the current THNK/Geckos.io path runs reliably with a headless server and two remote clients.
2. **A server export CLI** — a repeatable command packages the server half of a THNK game as a runnable artifact.
3. **An External Matchmaking Bridge** — an external matchmaker starts a session, admitted players authenticate with short-lived signed tokens, and session lifecycle events return to the matchmaker.
4. **Agora voice integration** — admitted players automatically join one voice channel per game session and receive local mute/volume controls.

The central boundary is:

```mermaid
flowchart LR
    MM[External matchmaker] -->|start session + roster| BR[Bridge control API]
    CL[Game clients] -->|signed admission token| BR
    BR -->|validated THNK connections| GS[Exported authoritative game server]
    BR -->|signed lifecycle webhooks| MM
    GS -->|voice token| CL
    CL <-->|session voice channel| AG[Agora RTC]
```

The matchmaker owns grouping and player identity. The bridge owns admission and session lifecycle. The exported game server owns game state. Agora owns voice transport.

## 2. Decisions for v1

These choices close the blueprint's open questions for the first implementation:

| Topic                | v1 decision                                                                                             | Reason                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| THNK baseline        | Start from upstream `master`, then inspect selected `v2` changes; do not build from `v2` wholesale      | `master` is the latest concrete implementation; `v2` describes itself as WIP explorations                   |
| Session isolation    | One operating-system process/container per game session                                                 | Matches THNK's current single-world assumptions and makes crashes, memory, logs, and cleanup session-scoped |
| Matchmaker callbacks | Signed HTTPS webhooks with event IDs, timestamps, retry, and idempotency                                | Simpler to deploy and test than a persistent control connection                                             |
| Admission tokens     | Short-lived asymmetric JWTs; matchmaker keeps the private key and the bridge receives only a public key | Avoids giving every runtime authority to mint player tokens                                                 |
| Agora secrets        | `AGORA_APP_ID` and `AGORA_APP_CERTIFICATE` are server environment variables/secrets                     | The certificate must never be present in a GDevelop client export                                           |
| THNK Rooms/Relay     | Not a v1 dependency                                                                                      | Its documented status and production readiness are uncertain                                                |
| Transport            | Geckos.io remains the initial data transport                                                            | It is the existing dedicated-server-shaped adapter and gives the shortest path to a proof                   |
| General THNK auth    | Bridge sessions only in v1                                                                              | Direct P2P/local behavior remains compatible; broader adapter auth can be designed after the bridge works   |
| GDevelop editor UI   | No `newIDE` fork in v1                                                                                  | The supported surface is the CLI plus generated GDevelop extensions                                         |
| Voice coupling       | Voice is side-band; no audio crosses the THNK state protocol                                            | Prevents voice concerns from destabilizing authoritative state sync                                         |
| Multi-authority (added post-M4) | One exported artifact may declare multiple named authorities (modes); the runtime boots exactly one per process, selected cold at start and checked against the verified, externally trusted content-addressed manifest | Lets one build serve many modes/levels without a separate matchmaker or bridge per mode |
| Team/party tags (added post-M4) | The Bridge carries an opaque `tags` map through admission claims without interpreting it | Keeps team/party sizing and assignment logic entirely in THNK Matchmaking; Core stays generic |
| Cross-service hooks (added post-M4) | Core calls into THNK Player Profile for player documents and blocked-status, and accepts an optional pre-issued voice grant from THNK Matchmaking | These are the concrete integration points the two companion repositories depend on; Core must expose them even though it doesn't implement matchmaking or identity itself |

## 3. Gates before feature work

### 3.1 Repository and licensing gate

The workspace does not yet contain the THNK source. Upstream verification on 2026-07-18 found:

- `master` points to commit `422d2ff0` (2024-04-03).
- `v2` points to commit `1924f02e` (2025-09-11) and its head message calls the work exploratory/WIP.
- The last published release is `alpha-4` from 2022-12-26.
- Upstream `package.json` declares `MIT`, while `LICENSE.md` contains AGPL-3.0 text.

Before distributing a fork or hosted derivative, we must establish the intended license and comply with it. Until clarified, treat AGPL-3.0 as the conservative governing assumption and preserve all notices. This is a project gate, not legal advice.

### 3.2 Technical baseline gate

Feature work begins only after we can:

- install dependencies from a clean checkout;
- run the TypeScript check and tests;
- run the full extension/adapters build;
- import the generated extensions into a compatible GDevelop version;
- launch the existing Geckos.io server;
- connect two clients and observe synchronized authoritative state;
- record the exact Node, package manager, GDevelop, browser, and Electron versions used.

## 4. Milestones

### M0 — Import and reproduce upstream

**Work**

- Create the project fork and configure `upstream` and `origin` remotes.
- Base the first development branch on upstream `master` commit `422d2ff0`.
- Compare `master` with `v2`; cherry-pick only changes supported by tests or a written rationale.
- Resolve the license declaration mismatch in project metadata/documentation before distribution.
- Pin a supported toolchain and make clean install/build/test commands deterministic.
- Add a short architecture decision record for every v1 choice in section 2.

**Exit criteria**

- Clean checkout builds without manual file edits.
- TypeScript and Jest checks pass, or every pre-existing failure is captured in a baseline report.
- Generated extension files are reproducible.

### M1 — Remote authoritative vertical slice

**Implementation status (2026-07-19):** Complete. The separate-process vertical
slice was first proven locally on `platform/m1-remote-authority`, then the
exported authority was run on an Ubuntu host and exercised by Windows browser
clients over the LAN. Fixture, runtime checks, lifecycle regressions, and
results are recorded in `docs/project/M1-REMOTE-AUTHORITY.md`.

**Work**

- Create a minimal GDevelop fixture with a synchronized player object, `State.Score`, server-side movement, and client input.
- Run the Geckos.io server and clients as separate processes first, then on separate machines or network environments.
- Instrument connect, admission, disconnect, reconnect, stop, and cleanup paths.
- Patch only the lifecycle failures that block a stable vertical slice.
- Add automated tests around every patched lifecycle transition.

**Exit criteria**

- Two clients share the same authoritative world through a non-player-hosted server.
- A client cannot directly overwrite synchronized position or score.
- Join, leave, abrupt disconnect, and server stop do not leave a ghost player or crash the session.
- The fixture and exact manual validation steps live in the repository.

### M2 — Server export CLI

**Implementation status (2026-07-19):** Complete on
`platform/m2-server-export`. The exporter, validator, hidden Electron runner,
deterministic content hash, and bundle-local dependency install pass on
Windows. The packaged artifact also runs on Ubuntu 24.04 with Xvfb and passed
remote 8-client and 16-client identity/disconnect/reconnect proofs. See
`docs/project/M2-SERVER-EXPORT.md`.

Command surface:

```text
thnk export-server --project <path> --output <directory>
thnk server validate --bundle <directory>
thnk server run --bundle <directory>
```

The stable input is a GDevelop `.json` project containing exactly one literal
Geckos `HostServer` action. The exporter imports the repository's generated
extensions and compiles the dedicated HTML5/Electron runtime itself.

**Bundle contract**

```text
server-bundle/
  manifest.json
  package.json
  server/
  assets/
  config.example.env
  README.md
```

`manifest.json` must include bundle format version, project identity, build time, required runtime version, transport, entry point, and content hash. Runtime secrets are referenced by name and never embedded.

**Exit criteria**

- One documented command produces a clean, runnable server artifact from the fixture.
- The artifact starts headlessly on a clean machine/container without the GDevelop editor or THNK source tree.
- Missing assets, incompatible project configuration, and missing runtime variables fail with actionable messages.
- Repeated exports from identical inputs are reproducible apart from explicitly documented metadata.

### M3 — External Matchmaking Bridge

**Implementation status (2026-07-19):** Complete on
`platform/m3-matchmaking-bridge`. The versioned one-session control API,
RS256/roster admission, canonical player binding, fresh-token reconnect,
signed retrying webhooks, exported-artifact process lifecycle, and adversarial
two-client proof are recorded in
`docs/project/M3-MATCHMAKING-BRIDGE.md`.

The one-session-per-process runtime exposes a versioned control contract. A provisional API, to be finalized after the Geckos transport spike, is:

```http
POST /v1/session
GET  /v1/session
POST /v1/session/end
GET  /health/live
GET  /health/ready
```

`POST /v1/session` accepts a session ID, roster of player IDs, token verification key/key ID, callback URL, and session metadata. Only one active session is permitted; conflicting starts return `409`.

Client admission must validate:

- JWT signature and allowed algorithm;
- issuer and audience;
- `sessionId` and `playerId` claims;
- expiry and not-before bounds with limited clock skew;
- roster membership;
- one active connection per player unless reconnect policy explicitly permits replacement.

Tokens must not be placed in ordinary URL query strings because URLs are commonly logged. The M1/M3 transport spike must select a browser-compatible secure handoff, such as a first authenticated protocol message or a supported WebSocket subprotocol mechanism.

Lifecycle webhooks use stable event IDs and include at least:

- `session.started`
- `player.joined`
- `player.left`
- `session.ended`

Webhook delivery is at-least-once. Receivers deduplicate by event ID. Requests are signed, retry with bounded exponential backoff, and are stored until delivered or the retention limit is reached.

**Exit criteria**

- A stub matchmaker starts one session and two token-bearing clients join it.
- Invalid, expired, wrong-session, wrong-player, and replayed admission attempts are rejected.
- Lifecycle events arrive at the stub matchmaker and retries do not create duplicate logical events.
- Ending a session drains clients, stops the game loop, and exits cleanly.

### M4 — Agora voice

**Implementation status (2026-07-19):** Complete on
`platform/m4-agora-voice`. Server-side identity/token/capability handling, the
Agora Web client runtime, GDevelop controls, failure isolation, the
credential-free exported-runtime proof, and the real two-client Agora audio
publish/subscribe gate pass. See `docs/project/M4-AGORA-VOICE.md`.

**Server work**

- Load Agora credentials only from server-side secrets.
- Mint the shortest practical RTC token for the admitted player and current session channel.
- Derive safe Agora channel and UID values from canonical session/player identities.
- Rate-limit token issuance and support refresh before token expiry.

**GDevelop/client extension surface**

- Join Session Voice
- Leave Session Voice
- Mute/Unmute Self
- Mute/Unmute Remote Player
- Set Remote Player Volume
- Voice Connection State
- Player Is Speaking (if supported reliably by the selected SDK)
- Voice Error Code / Last Voice Error

Automatic voice join happens only after game admission succeeds. Failure to join voice must not disconnect a player from the game session.

**Exit criteria**

- Two admitted clients join only their session's channel and exchange audio.
- App Certificate and bridge signing secrets are absent from client files and network responses.
- Per-listener mute/volume changes affect only the local listener.
- Leave, disconnect, reconnect, token refresh, microphone denial, and Agora outage paths are handled without breaking gameplay.

### M5 — Multi-authority manifest and admission hardening

**Implementation status (2026-07-19):** Complete on
`platform/m5-multi-authority`. Format-v4 artifacts contain a deterministic
authority catalog and content-addressed build identity. The supervisor,
assignment/version claims, optional map identity, signed read-only player
tags, legacy single-authority migration, Windows two-client proof, and Ubuntu
24.04/Xvfb gates are recorded in
`docs/project/M5-MULTI-AUTHORITY.md`.

**Why this milestone exists:** M3's exporter and control API assume exactly
one bootstrap scene and one game scene per artifact, and M3's admission check
validates session/player/roster but not authority, build, or version
identity. Discussed after M4: a single exported artifact should be able to
declare several selectable server authorities (e.g. Duel, Racing, Battle
Royale as different GDevelop scenes). The supervisor must reject a wrong
session assignment before the game loads; after a valid assignment starts the
authority, per-player admission must still reject a token minted for the wrong
authority, build, or client version before creating a player connection.

**Work**

- Extend the exporter and `manifest.json` to declare an authority catalog (`authorities: { id: { bootstrapScene, gameScene } }`) instead of one fixed `bootstrapScene`/`gameScene` pair. Bump the bundle format version.
- Add cold-start authority selection: the runtime reads a requested authority ID (e.g. `THNK_AUTHORITY_ID`, optionally `THNK_MAP_ID`) at process start, validates it against the integrity-checked and externally trusted manifest's authority catalog, and refuses to boot GDevelop at all for an unknown ID.
- Extend admission JWT claims beyond the existing `sessionId`/`playerId`/`jti`/roster to include `authorityId`, `serverBuildId` (content hash), `compatibilityVersion`, `clientBuildId`, `protocolVersion`, and an opaque `tags` object.
- Enforce the new claims at admission: reject wrong game, wrong authority, wrong server build, and unsupported compatibility version, returning a stable error (e.g. `client_update_required` for version mismatches) in addition to the existing M3 rejection cases.
- Expose `tags` claim values to GDevelop event sheets as read-only expressions (e.g. `GetPlayerTag("team")`); Core applies only bounded flat-scalar structure and exact roster/signature checks, and does not interpret matchmaking meaning or assign tag values.

**Exit criteria**

- One exported artifact contains at least two distinct authority scenes (a fixture equivalent to Duel/Racing); starting the process with each authority ID boots only that scene.
- A wrong authority/build/version session assignment is rejected before the game loads. After a valid assignment starts the authority, a token minted for authority A is rejected by authority B, a token for another `serverBuildId` is rejected, and an unsupported `compatibilityVersion` receives a stable error before a player connection is created.
- An unknown authority ID passed at process start never reaches GDevelop initialization.
- `GetPlayerTag` returns exactly the value carried in the signed token and cannot be influenced by client-side manipulation.
- Full repository gates (frozen install, TypeScript, Jest, generated-extension build, fixture/bundle validation) pass, and the new adversarial cases (wrong authority, wrong build, wrong compatibility version, unknown authority ID) have dedicated regression tests, consistent with M1-M4's testing discipline.

### M6 — Cross-service integration hooks

**Why this milestone exists:** THNK Matchmaking and THNK Player Profile are
separate repositories, but each depends on specific hooks that only Core can
provide: a way to load/save a player's persistent document during a session,
a way to report cheating/trust violations, a way to know a player is
blocked before admitting them, and a way to accept a voice grant issued
externally instead of always minting one from bundle-local Agora credentials.
None of this exists yet — M4 only built bundle-local voice minting, and
nothing today reports illegal-edit rejections anywhere or loads any
persistent player data.

**Work**

- Add a player-document hook: on successful admission, the Bridge calls THNK Player Profile's internal document API (`GET /internal/players/:id/document?gameId=`) for each admitted player and exposes the result to GDevelop as new `Get Player Variable`/`Set Player Variable` actions and expressions. `Set` is restricted to server-tagged events only, mirroring the existing `State.` variable trust model exactly. On relevant events/session end, the Bridge writes the current value back via the document API's `PUT`.
- First add a detectable illegal-client-edit violation path—the M1 behavior currently prevents and overwrites an edit but does not classify the attempt. When that detector fires, emit a `trust.violation` webhook (`session`, `player`, `violationType`, `timestamp`) using the exact same signed-webhook transport already built for `session.*`/`player.*` events in M3—no new transport.
- Add a blocked-player check at admission: call THNK Player Profile's internal blocked-status endpoint before admitting a player; reject if blocked, using the same stable-error pattern as M5's new rejections.
- Add optional roster-keyed voice-grant acceptance to `POST /v1/session`: `voiceGrants[playerId]` contains that player's channel, UID, token, expiry, refresh URL, and an explicit refresh-ownership contract. The Bridge must never reuse one session-wide token for every player. When no external grant is supplied, M4's existing bundle-local minting remains the fallback for standalone THNK use without a matchmaker.

**Exit criteria**

- A session loads a real (fixture) player document from a stub Player Profile service, a server-tagged event mutates it, and the mutated value is persisted and correctly reloaded in a fresh session for the same player.
- A client-tagged event cannot invoke the write action (rejected at the extension level, not just silently ignored at runtime).
- A deliberately triggered illegal client edit (reusing the M1 fixture's adversarial case) produces exactly one delivered, correctly signed `trust.violation` webhook.
- A player marked blocked by a stub Player Profile service is rejected at admission without the GDevelop process ever loading.
- A session started with a pre-issued voice grant never reads or requires bundle-local Agora credentials; a session started without one behaves identically to the existing M4 path, with a regression test proving both paths still work.
- Full repository gates pass, including new adversarial/contract tests for each of the above.

### M7 — Product hardening and release candidate

*(This is the milestone originally numbered M5 in the pre-M5-update version of
this plan; content unchanged except for the note on the stub matchmaker.)*

**Work**

- Run the complete two-client test plan locally and on a remote host.
- Add structured logs keyed by `sessionId`, `playerId`, connection ID, and lifecycle event ID, with tokens/secrets redacted.
- Add health/readiness checks, graceful shutdown, payload limits, rate limits, and dependency timeouts.
- Publish a container example, stub matchmaker, fixture game, configuration reference, threat model, and troubleshooting guide. The "stub matchmaker" may now be either a minimal stand-in or the real THNK Matchmaking repository at whatever milestone it has reached.
- Define bundle and control API compatibility/versioning policy (formalizing the `compatibilityVersion`/`serverBuildId`/`clientBuildId` fields introduced in M5).

**Exit criteria**

- A new developer can export, launch, start, join, play, speak, leave, and stop the fixture by following only repository documentation.
- CI proves build, unit tests, integration tests, secret scanning, and the headless smoke test.
- Known limitations and out-of-scope items are documented.
- A full end-to-end run against real THNK Matchmaking and THNK Player Profile deployments (not just stubs) is performed at least once and recorded, even though those two repositories are tested primarily in their own plans.

## 5. Test strategy

Testing is layered so protocol and security failures are caught before full GDevelop tests:

| Layer       | Coverage                                                                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | token claims, roster rules, state transitions, webhook signatures/retries, channel/UID derivation, config validation, authority-catalog validation, tag passthrough |
| Contract    | matchmaker control API, webhook schema, bundle manifest, error codes, compatibility versions, Player Profile document/blocked-status API shape |
| Integration | Geckos connect/disconnect/reconnect, server process lifecycle, exported artifact boot, Agora token generation, multi-authority cold start, document load/save round trip |
| End-to-end  | stub matchmaker + exported fixture + two clients + authoritative movement/state + voice; and, from M6 onward, a real (or realistic stub) Player Profile + Matchmaking pairing |
| Adversarial | expired/wrong-session/replayed tokens, duplicate starts, abrupt disconnects, oversized payloads, callback outage, secret leakage checks, wrong-authority/wrong-build/wrong-compatibility tokens, blocked-player admission attempts |

Every bug found manually in M1–M7 should first gain the smallest useful regression test.

## 6. Security and operational requirements

- All external traffic uses TLS outside local development.
- Private signing keys, shared webhook secrets, and the Agora App Certificate remain server-side.
- Logs redact authorization material and do not record admission tokens.
- Control endpoints require matchmaker authentication independent of player admission JWTs.
- Allowed JWT algorithms and issuers are configured explicitly; algorithm fallback is forbidden.
- Session and player identifiers are validated before use in paths, logs, metrics, process arguments, or Agora identifiers.
- The runtime has graceful termination and a maximum session duration so abandoned processes are reclaimable.
- Calls into THNK Player Profile's internal document/blocked-status API use their own service-to-service credential, distinct from player admission JWTs and from the matchmaker's control-API credential.
- A pre-issued voice grant accepted from a matchmaker is used as-is and never logged in full.
- v1 promises process isolation, not multi-session scheduling, autoscaling, failover, persistence beyond the player-document hook, or DDoS protection.

## 7. Out of scope for v1

- Matchmaking algorithms, lobby UI, ELO/ranking, accounts, or player databases — these live entirely in THNK Matchmaking and THNK Player Profile; Core only exposes the hooks (M6) those services call.
- Team/party *assignment logic* (deciding who's on which team) — Core only carries the resulting `tags` claim (M5); it never decides team membership itself.
- Multiple game sessions inside one THNK process.
- A GDevelop `newIDE` export button.
- THNK Rooms/Relay or THNK Cloud completion.
- General authentication for Local/P2P/direct Geckos adapters.
- State persistence beyond the player-document hook (M6), replicas/failover, rollback netcode, or split screen.
- Server-side audio mixing or recording.

## 8. First executable work package

The first implementation package is **M0 + the local half of M1**:

1. Obtain the intended GitHub fork URL/owner and clone it into this workspace.
2. Add upstream `arthuro555/THNK` as the read-only upstream remote.
3. Record the baseline commit and tool versions.
4. Install, type-check, test, and build without modifying behavior.
5. Build the minimal GDevelop authority fixture.
6. Start the existing Geckos.io server and connect two local client processes.
7. Produce a short baseline report listing what works, what fails, and the minimum lifecycle patches needed next.

This work package deliberately proves the riskiest inherited assumption before we design the exporter around it.

## 9. Definition of v1 done

V1 is complete when a developer can take the repository's fixture THNK game with at least two distinct authorities, run one CLI export, deploy the resulting artifact, have an arbitrary stub matchmaker (or a real THNK Matchmaking deployment) start an isolated session for a specific authority and build, admit two signed-in clients whose tokens are validated against authority/build/compatibility/roster, load and persist a real player document through THNK Player Profile, automatically connect them to session voice (whether bundle-minted or matchmaker-granted), report an illegal-edit attempt as a trust-violation webhook, reject a blocked player at admission, receive reliable lifecycle callbacks, and shut the process down cleanly — with no private credential present in the client bundle, and with the same full-Linux-host testing rigor used for M1-M4 applied to every new capability in M5 and M6 before M7's release-candidate work begins.
