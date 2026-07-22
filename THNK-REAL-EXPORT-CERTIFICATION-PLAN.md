# THNK real-export certification plan

**Status:** in progress; HTTPS export, Phase B, Phase C, and 2/4-player Phase E gates passed
**Scope:** THNK Core, THNK Matchmaking, THNK Player Profile, the exported
GDevelop Feature Lab, and live Agora RTC  
**Primary rule:** development shortcuts and deployment paths are independent
gates. Neither is evidence for the other.

## 1. What this run must prove

The certification is split into independently reported layers:

1. Every public GDevelop action, condition, and expression in the six THNK
   extensions is inventoried and has an explicit compile, behavior, negative,
   or not-applicable test owner.
2. Ninety accounts are created through the real Player Profile registration
   API and repeatedly authenticated with email/password. No stub identity is
   accepted in this lane.
3. Concurrent sessions remain bound to their canonical Player Profile subject.
   No token, Socket.IO connection, matchmaking ticket, Core player slot,
   friendship, message, or unread count may cross user identities.
4. Social workflows operate concurrently across the ninety-user cohort:
   friend request, accept, decline, remove, block/unblock, search, presence,
   realtime friend chat, durable direct messages, history, conversations, and
   unread/read transitions.
5. Public queues, parties, private lobbies, regional QoS, assignment recovery,
   signed admission, disconnect, reconnect, and duplicate submission are
   exercised with real Player Profile sessions.
6. A real GDevelop HTML export connects to real services and a real exported
   Authority process. FFA, Teams, solo, dev Authority, and production
   Authority-claim paths retain separate results.
7. Live Agora is exercised from a trusted HTTPS origin with real per-player
   grants, real publish/subscribe, mute controls, channel reassignment, refresh,
   leave, and rejoin. The Agora certificate never enters the Client export,
   browser storage, reports, or logs.

The run is a correctness and capacity-characterization gate. Until production
SLOs are chosen, latency is reported as p50/p95/p99 rather than judged against
an invented target. Correctness, isolation, security, and availability do have
hard pass/fail rules below.

## 2. Current baseline and gaps

- The existing Feature Lab already passed real two-client, four-client FFA,
  four-client Teams, and four-client private-lobby browser runs against Ubuntu.
- The six source extensions currently contain 203 functions: 193 public and 10
  private/lifecycle/category helpers.
- The 193 public functions comprise 69 actions, 42 conditions, 32 numeric
  expressions, 42 string expressions, and 8 expression/condition functions.
- The current game exercises the principal workflows, often through the same
  extension runtime used by GDevelop actions. It does not yet provide an
  auditable claim that all 193 public functions are referenced and behaviorally
  covered. That coverage artifact is the first deliverable of this plan.
- Player Profile defaults to 20 registrations/hour and 10 logins/minute per
  source IP. A ninety-user capacity run cannot be confused with the default
  abuse-policy test. The same build will be run in two isolated configurations:
  a production-policy lane that proves expected `429` responses, and a
  certification-capacity lane whose documented limits permit the planned load.
- Core is deliberately one match per Authority process. Matchmaking has already
  proved 96 concurrent assignments with multiple replicas and lightweight
  Authority claimers, but the repository does not implement a production
  autoscaling orchestrator or a session-aware Authority ingress. Therefore a
  90-user service/match-assignment result is not a claim that 22 live GDevelop
  match processes were hosted. The live-export lane initially proves one FFA
  and one Teams process concurrently (eight gameplay Clients). Certifying 22
  concurrent live matches requires a separately authorized orchestrator/ingress
  implementation and infrastructure capacity run.

## 3. HTTPS tunnel map

The tunnel should terminate trusted TLS and forward each hostname to the
following Windows listener. The certification harness will own these high
local ports and forward them to the selected Windows or Ubuntu component.

| Public hostname | Windows port | Purpose | Upstream during the first run |
| --- | ---: | --- | --- |
| `app1.solarcal.xyz` | `18080` | Exported Feature Lab | Ubuntu `192.168.1.196:8080` |
| `app2.solarcal.xyz` | `19400` | Player Profile | Ubuntu `192.168.1.196:9400` |
| `app3.solarcal.xyz` | `19300` | Matchmaking + voice refresh | Ubuntu `192.168.1.196:9300` |
| `app4.solarcal.xyz` | `19208` | FFA Authority gameplay | Ubuntu `192.168.1.196:9208` |
| `app5.solarcal.xyz` | `19210` | Teams Authority gameplay | second isolated Authority |

The private control ports (`9209` and the second process equivalent) must not
be tunneled or publicly exposed. The browser origin allowlists will contain
only `https://app1.solarcal.xyz`. Player Profile, Matchmaking, and assigned
Authority URLs embedded into the generated test export will use `app2`, `app3`,
and `app4`/`app5` respectively.

The tunnel must support HTTP upgrades/WebSockets. Geckos gameplay also uses
WebRTC/UDP after signalling; the Windows headless Clients can reach the Ubuntu
LAN ICE candidate directly. This setup does not by itself prove remote-public
UDP reachability or TURN. That requires a later off-LAN client/network gate.

## 4. Test identities and secret handling

- Create one run ID, for example `cert-20260722-01`.
- Register `ThnkC001` through `ThnkC090` using unique syntactically valid test
  email addresses and generated unique passwords.
- Call `POST /auth/register` for every new account and `POST /auth/login` for
  every subsequent interval. A login fallback that silently registers is not
  permitted in the certification runner.
- Store credentials only under the ignored `.generated/certification/<runId>`
  directory with restrictive local permissions. Keep access, admission, voice,
  and internal service tokens in memory only and redact them from all errors.
- Reports use aliases and canonical player IDs, never email addresses or
  passwords.
- Accounts survive all intervals in one run so identity stability can be
  compared. Purging test accounts is a separate explicit `--purge` operation;
  it is never performed automatically after a failure.

## 5. Coverage work before load

### 5.1 Extension surface manifest

Generate a machine-readable and Markdown manifest from the six canonical
extension JSON files. Each public function records:

- extension, function name, type, side (Client/Authority/shared), and service;
- at least one GDevelop export/compile reference;
- behavioral scenario and assertion;
- negative/failure scenario where applicable;
- existing unit/integration evidence;
- status: `covered`, `pending`, `not-applicable`, or `hidden-lifecycle`.

The audit fails when a public function is added without a coverage owner. It
also fails when an embedded extension differs from its canonical source.

### 5.2 Feature Lab certification scenes

Keep the playable panels, then add generated certification event groups rather
than manually duplicating 193 definitions. References must be placed on the
correct side:

- Client identity/social/ranking and Matchmaking functions in a Client group;
- connection, assignment, QoS, party, lobby, chat, and voice observations in
  Client groups;
- server time, player variables/tags, ownership, authoritative messages,
  achievements, trust violations, and voice channel changes in Authority
  groups;
- Local solo functions in their own explicit development group.

Compile coverage is necessary but not sufficient. Behavior assertions remain
mapped to focused scenarios so a no-op function cannot pass merely because it
exported.

## 6. Execution phases

Each phase writes a standalone JSON report and may stop the run. Later phases
never erase an earlier failure.

### Phase A - immutable preflight

1. Record Git commit IDs, clean/dirty status, Node/Yarn/GDevelop/Chrome versions,
   exported Client hash, Authority artifact hash, Ubuntu OS, service config
   fingerprints, and clock skew. Do not record secret values.
2. Run frozen install, typecheck, all tests, builds, extension sync/audit, GDevelop
   import/save/export, server export validation, and dependency audit in all
   three repositories.
3. Capture health, Postgres connection/pool state, Redis state, disk, memory,
   CPU count, and a service-log cursor.
4. Verify all five HTTPS URLs, exact CORS/origin policy, WebSocket upgrade, and
   that private control/database/Redis ports are not public.

### Phase B - account bootstrap and authentication correctness

1. In the capacity configuration, register 90 real accounts in nine batches of
   10. Validate 90 unique canonical player IDs and exact username/email binding.
2. Reject duplicate email, duplicate username, malformed email, weak password,
   unknown account, and wrong password without leaking which credential failed.
3. Run login ramps of 2, 4, 10, 30, 60, then 90 accounts. The 90-user step is
   issued as nine batches of 10 with a short configurable gap.
4. Repeat the complete 90-user login cycle five times at two-minute intervals.
   Confirm every alias returns the same canonical player ID on every cycle.
5. For 15 selected accounts, open three concurrent authenticated sessions each.
   Disconnect and replace one session at a time. Presence stays online while at
   least one socket remains; identity never moves between aliases.
6. In the production-policy configuration, prove the documented registration
   and login ceilings return controlled `429 rate_limited` responses and recover
   after the relevant window. Expected policy rejections do not count as
   capacity failures and are reported separately.

### Phase C - ninety-user social graph

1. Search all 90 aliases and verify exact IDs.
2. Create 45 disjoint friend requests concurrently and accept them from the
   correct recipients. Validate incoming/outgoing lists on both sides.
3. Use separate cohorts to exercise decline, cancellation/removal,
   block/unblock, self-request rejection, duplicate request idempotency/error,
   and requests racing in opposite directions.
4. Build a deterministic ring after cleanup so every user has two friends.
   Validate the complete graph from Player Profile and friend-filtered presence
   from Matchmaking.
5. Send one durable DM and one realtime friend-chat message per ring edge.
   Assert sender, recipient, text, history order, conversation partner, unread
   total, per-player unread count, mark-read behavior, and cross-replica live
   delivery.
6. Exercise world chat at allowed rate, profanity masking, PII rejection, and a
   deliberate rate-limit wave. Confirm no raw rejected content appears in
   application logs or trust records.
7. Disconnect/reconnect alternating sockets while messages are in flight.
   Durable DMs must be recoverable; realtime delivery follows its documented
   online/offline semantics and must never reach a non-friend.

### Phase D - Matchmaking concurrency with real identities

1. Connect all 90 real Player Profile tokens to multiple Matchmaking replicas.
2. Verify heartbeat/presence, duplicate sockets, reconnect, and replica changes.
3. Queue 88 users into 22 four-player rosters; keep two users in the queue long
   enough to prove underfilled behavior, then cancel them.
4. Assert unique placement, one assignment per player, exact four-player
   rosters, correct mode/build/protocol/region, signed player-scoped admission,
   and no private envelope or voice grant in Client assignments.
5. Run party cohorts of 2 and private-lobby cohorts of 4, including ready,
   unready, host leave/reassignment, kick, rejoin, full start, and cleanup.
6. Repeat with delayed claim/readiness, one Matchmaking replica draining, one
   Authority claimer failing, and Player Profile temporarily unavailable.
7. Inspect Redis for orphan tickets, claims, sessions, lobbies, presence sets,
   and stale capabilities after lifecycle completion.

This phase uses real services and real player sessions. Lightweight production
Authority claimers may be used only to validate 22 simultaneous assignment
handoffs; their report must not be labeled as live GDevelop gameplay.

### Phase E - real exported gameplay

1. Re-run the existing two-Client waiting/cancel/reconnect path over HTTPS.
2. Run four real browser Clients through FFA, authoritative movement, overlap
   scoring, achievements, player document save/load, disconnect/reconnect, and
   identity-correct object ownership.
3. Run four real browser Clients through Teams with server-owned team tags and
   team scoring.
4. Run the complete four-player private-lobby-to-Authority flow.
5. Run FFA and Teams Authority processes concurrently on isolated hosts or
   containers and connect eight real browsers (four per session). Assert that
   session IDs, player objects, scores, voice channels, and lifecycle events
   remain isolated.
6. Run deliberate wrong-player, modified, expired, wrong-build, wrong-authority,
   replayed admission, duplicate transport, illegal client edit, blocked player,
   and out-of-policy reconnect cases. Every rejection must be controlled and
   must not create a player object.
7. Separately run `StartSoloMode`, dev Authority registration/routing, and the
   production-credential outbound claim/readiness path. Results are separate.

Rendered Chromium is used for the 2/4/8 interaction gates. The 90-user load
uses protocol-level clients plus representative rendered Clients; launching 90
full GDevelop/Chromium renderers would mostly measure GPU/browser memory and
would make service failures harder to diagnose. A separate browser-density run
can be added after the protocol load passes.

### Phase F - live Agora over HTTPS

1. First prove missing Agora configuration is voice-only: login, matchmaking,
   and gameplay remain healthy and the extension exposes an actionable state.
2. With server-side credentials enabled, join two then four real Chromium
   clients using fake microphone media and automatic permission flags.
3. Assert per-player grant uniqueness, same-session channel membership,
   publish/subscribe, participant presence, speaking state/level, self
   mute/unmute, remote mute/unmute, remote volume, leave/rejoin, and cleanup.
4. Move one player to a new Authority-selected voice channel. Assert the Client
   refreshes through the HTTPS Matchmaking URL and migrates; peers left in the
   old channel no longer receive it.
5. Exercise refresh cooldown, expiry/reissue, wrong-player capability,
   revoked-session capability, Matchmaking restart, and Client reconnect.
6. Search Client artifacts, browser storage, reports, and service logs for the
   App Certificate and all known secret fingerprints; matches are a hard fail.

The automated run proves real Agora cloud publish/subscribe using synthetic
audio. A final desktop/Android audible conversation remains a short manual
device gate because headless automation cannot prove what a human speaker and
microphone sound like.

### Phase G - interval soak and fault recovery

1. Keep the 90 authenticated users connected for at least 30 minutes with
   heartbeats, periodic social reads, controlled chat, queue/cancel cycles, and
   reconnect waves at 5, 10, 20, and 30 minutes.
2. Restart one Matchmaking replica, then the non-primary test Authority, and
   prove bounded recovery without identity changes or duplicate placement.
3. Exercise fail-closed Player Profile behavior separately from its explicit
   local ephemeral fallback. Never enable fallback in the deployment lane.
4. Capture CPU, memory, event-loop lag, Postgres pool/slow-query data, Redis
   latency/memory, operation latency, error codes, reconnect duration, and
   service restarts throughout.

## 7. Hard acceptance rules

- 90/90 aliases keep one and only one canonical Player Profile ID across every
  successful registration/login interval.
- Zero identity crossover, foreign friendship mutation, foreign DM/unread
  state, cross-session object ownership, or cross-session voice membership.
- Zero unexpected HTTP `5xx`, uncaught browser exception, process crash,
  unplanned service restart, database error, Redis error, or secret leak.
- Paced correctness phases require 100% success. Deliberate overload/policy
  phases require exactly the documented bounded rejection, never a timeout,
  crash, partial write, or identity mix-up.
- No player is assigned twice, no roster exceeds its rules, no admission token
  admits another player/session/build, and no completed run leaves operational
  queue/session/lobby/claim/capability orphans.
- All 193 public extension functions have a coverage owner; every function
  promised as behaviorally covered has an observed assertion, not only an
  export reference.
- Dev routing, production claiming, solo, dedicated Authority, Profile
  fallback, and Profile fail-closed each have their own result.
- A failing phase blocks release. Retries are recorded and cannot silently turn
  the original failure into a pass.

## 8. Evidence and cleanup

Each run creates an ignored directory containing:

- `manifest.json` with commits, hashes, safe config fingerprints, tools, and
  topology;
- `api-coverage.json` and `api-coverage.md`;
- per-phase JSON reports, latency histograms, resource samples, and assertions;
- redacted Client network/console events, service-log slices, and screenshots;
- a final `release-decision.md` listing passed, failed, skipped, and blocked
  gates without collapsing their lanes.

After evidence is written, stop certification-only proxies/processes, restore
the normal Feature Lab service configuration, clear only run-owned ephemeral
Redis keys, and verify all standard health checks. Durable test accounts remain
until an explicit reviewed purge is requested.

## 9. Execution order

Implementation and execution will proceed in this order:

1. coverage generator and missing Feature Lab certification hooks;
2. redacted ninety-user load runner and evidence format;
3. isolated capacity/policy configuration and HTTPS forwarders;
4. Phases A-C;
5. Phase D service/assignment scale;
6. Phase E 2/4/8 real-export gameplay;
7. Phase F live Agora;
8. Phase G soak/faults and final release decision.

No 90-user blast begins until the 2-, 4-, and 10-user ramps pass cleanly.

## 10. Execution record

Completed on 2026-07-22:

- HTTPS tunnel/CORS/WebSocket preflight and a cache-isolated real GDevelop
  export;
- compile ownership for all 193 public extension functions;
- exported-game two-user, four-player FFA, four-player Teams, and four-player
  private-lobby gates;
- 90 real registered accounts, all login ramps, five interval cycles, and
  multi-session bearer isolation;
- the complete 90-user Player Profile friendship ring and durable-message load;
- 90 authenticated Matchmaking sockets, friend-filtered presence,
  multi-session replacement, realtime friend chat, and world-chat moderation.

Still open: production-policy rate-limit recovery, 22 concurrent assignment
handoffs through lightweight production claimers, two simultaneous exported
Authorities/eight browsers, negative admission cases, live Agora, the
30-minute recovery soak, and final release decision. Failed attempts caused by
fixture policy/idempotency mistakes remain retained beside their passing
retries and are not rewritten as first-attempt passes.
