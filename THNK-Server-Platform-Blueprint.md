# THNK Server Platform Blueprint

**One-line objective:** Fork THNK (the authoritative multiplayer framework for GDevelop) and turn it into a decomposed system: a one-click **server export**, a matchmaking-agnostic **session adapter**, and a built-in **Agora voice chat** layer — so anyone can plug in their own matchmaking backend and get a working, voice-enabled multiplayer game server with minimal setup.

This document is meant to be handed to a coding agent (Claude Code) as the working spec for implementation. It also gives Faithfultennyson a concrete GDevelop-side test plan to validate the server-authoritative path as it's built.

---

## 1. Background — what exists today

### 1.1 GDevelop's built-in Multiplayer extension
GDevelop ships a native "Multiplayer" extension. It's peer-hosted: one connected client acts as the authority, matchmaking/lobby happens through GDevelop's own hosted service, and there's no path to exporting a standalone dedicated server. Fine for casual same-session play; not what we need.

### 1.2 THNK
[THNK](https://github.com/arthuro555/THNK) (`arthuro555/THNK`) is a separate, more serious framework distributed as a set of GDevelop extensions. Key facts, confirmed from its repo/docs:

- **Architecture:** you tag events as server-run or client-run, mark objects to sync with a "Synchronize object" behavior, and prefix scene variables with `State.` to sync them. THNK is always authoritative — the server is the single source of truth, clients cannot directly mutate synced state.
- **Adapters:** networking is pluggable via "adapter" extensions. Currently shipped: **Local** (same-machine preview only), **P2P** (GDevelop's built-in WebRTC P2P, connect via a peer ID), **Geckos.io** (WebRTC, connect via IP/hostname, server = desktop build only), and **THNK Rooms/Relay** (room codes via a relay server, `coming soon` per docs — status needs re-verification once we fork).
- **Server builds:** THNK's own docs already name our exact goal as a planned feature: *"THNK is made to be able to create a special server build out of your game... In the future, a THNK Cloud is planned [to] take care of creating server builds for you and hosting your game servers, for free."* This is not shipped — it's a stated intent, currently done manually via `yarn build` in the repo, not a button in the GDevelop editor.
- **Protocol:** custom binary protocol via FlatBuffers + msgpackr, deflate-compressed, delta-synced (only changed data is sent).
- **Code layout** (from the repo's contribution guide): `code/server`, `code/client`, `code/adapters`, `code/types`, `code/utils`; `extensions/` holds the actual `.json` GDevelop extension files generated from that code; `protocol/` holds the FlatBuffers schema.

### 1.3 Does local/host-based play already work?
**Yes, largely — confirmed.** The Local adapter (added in the Alpha 4 release) and the P2P adapter are both real, shipped, working adapters — P2P in particular lets one player's machine act as host and others connect directly via WebRTC, and it's been stable since early releases. Documentation for it is thin, but the mechanism itself isn't the risky part of this project. **You're right to treat true externally-hosted server authority (headless server process, players connecting in over the network, no player machine acting as host) as the hard, unsolved part** — that's the Geckos.io / server-build path, and it's the least documented and least battle-tested piece.

### 1.4 Project health — is THNK stale?
Evidence gathered directly from the repo (as of this review):

- Latest tagged release is **Alpha 4**, dated December 2022. No newer tagged release exists. The repo has had ~86 commits total in its history — some may post-date Alpha 4, but tagged releases stopped there.
- All **15 open issues** on the tracker were filed between **August and December 2022**, and none show signs of being closed/resolved. Notably open:
  - **#15 Authentication support** — there is currently no built-in auth. This directly blocks our matchmaking-adapter design (see §3) — we'll have to build our own token/identity layer rather than rely on one from THNK.
  - **#36 Connection manager**, **#30 Disconnection features**, **#24 Context isolation** — connection lifecycle handling is incomplete. Relevant to how reliably our new adapter can detect player drop/reconnect.
  - **#21 Add QoS to THNK messages**, **#20 Internal unreliability compensation** — the protocol doesn't yet handle packet loss / delivery guarantees robustly. Matters for a real internet-hosted server (vs. LAN/P2P where it's been mostly tested).
  - **#12 Server replicas system** — no failover/redundancy story yet. Out of scope for v1 but worth knowing it doesn't exist.
  - **#13 Saving system**, **#10 Teams system**, **#14 Split-Screen adapter**, **#6 Rollback for platformer behavior**, **#16 Ping expression** — feature gaps, none blocking.
- The THNK Rooms/Relay adapter and "THNK Cloud" are both marked as forward-looking/"coming soon" in the docs; treat both as **not reliably usable yet** until verified directly against current source after forking.

**Bottom line:** your instinct was correct — THNK is a good architectural foundation but has had no real release in ~3.5 years, has no authentication layer, and has known gaps in connection reliability and QoS. Before layering matchmaking + voice chat on top, we should budget time to close #15 (auth), #36/#30 (connection lifecycle), and sanity-check the Geckos.io server path end-to-end, since that's the adapter our new work depends on most.

---

## 2. Fork & architecture decisions (recap)

- **Fork THNK only.** Do not fork GDevelop core (GDCore/GDJS engine, or the newIDE editor app). GDevelop core is large, changes frequently upstream, and a bug there has unlimited blast radius. THNK already sits at GDevelop's supported extension boundary (actions/conditions/behaviors + JS events) and is small enough to be safely modified by a coding agent.
- **Ship as an extension, not a native GDevelop feature**, for the same reason: smaller surface, isolated blast radius, no upstream rebasing tax. If a true "Export Server" button embedded in GDevelop's own export wizard is wanted later, that's a separate, optional fork of `newIDE` only — never the engine.
- Everything described below (export pipeline, bridge adapter, voice chat) is new code added inside the forked THNK repo, following its existing `code/adapters`-style extension pattern.

---

## 3. New system: External Matchmaking Bridge Adapter

### 3.1 Goal
Decouple **who plays together** (matchmaking — fully external, user-supplied, any implementation) from **how a match runs** (session hosting — our adapter + the exported server bundle). This is the standard pattern used by real game backends (e.g. Agones, Open Match, PlayFab): a matchmaker groups players, then hands the group off to a session runtime that knows nothing about matchmaking logic.

### 3.2 Three layers

1. **Matchmaker** (external, not our code) — decides which players belong in a session. Could be a simple lobby, an ELO matcher, a room-code system, whatever the game developer builds. Only requirement: it can call our adapter's API and holds/issues player identity tokens.
2. **Bridge Adapter** (new — this is the core deliverable) — a thin session runtime with a stable contract:
   - Receives a `startSession(sessionId, players[])` call from the matchmaker (players = list of `{ playerId, token }`).
   - Spins up (or routes into) an instance of the exported server bundle for that session.
   - Accepts incoming client transport connections, validates each against the token the matchmaker issued, and binds it to a server player-slot.
   - Emits lifecycle callbacks back to the matchmaker: session started, player joined, player left, session ended (likely via webhook or a long-lived control WebSocket — **open question, see §6**).
   - Does **not** implement matchmaking logic itself, and does not implement game logic — both are external to it.
3. **Exported server bundle** (§4) — the authoritative game logic, headless, engine-run. It only knows "N client connections speaking the THNK protocol," nothing about how those players were grouped.

### 3.3 Auth/token handoff
Since THNK has no built-in authentication (issue #15), the adapter needs its own scheme:
- Matchmaker and adapter share a secret (or use JWT signed with a key only the matchmaker holds).
- Matchmaker issues each player a short-lived signed token scoped to `{ sessionId, playerId, expiry }` when it hands players to the adapter.
- Client connects to the adapter's transport endpoint and presents that token; adapter verifies signature + expiry + sessionId match before admitting the connection into the server bundle.
- This also happens to close issue #15 in a scoped way (auth at the adapter boundary), without requiring a full identity system inside THNK itself.

### 3.4 Open design question to settle before implementation
One server process per session vs. one process serving multiple sessions. THNK's server-build model today appears to assume one running server = one game world instance. A matchmaking-driven system will likely need the adapter to be able to spawn/manage multiple concurrent server-bundle instances (a small "fleet manager" role above the adapter itself). Recommend scoping **v1 to one-session-per-process** (simplest, matches THNK's current assumptions) and treating multi-session orchestration as a v2 concern — flag this explicitly to Claude Code so it doesn't over-build on day one.

---

## 4. New system: Export / Server Build pipeline

- **Current state:** producing a server build is a manual `yarn build` step in the THNK repo; there's no button inside the GDevelop editor.
- **Target v1:** a THNK extension action (or a small companion CLI, e.g. `thnk export-server`) that takes a normal GDevelop project export and packages the server-relevant code + assets into a standalone, runnable bundle — no GDevelop editor UI changes required.
- **Target v2 (optional, larger fork):** an actual button inside GDevelop's export wizard (`newIDE` fork), next to "Export to Web/Android/etc." Defer until v1's CLI/extension path is proven.
- The bundle this produces is exactly what the Bridge Adapter (§3) loads and runs per session.

---

## 5. New system: Agora voice chat

### 5.1 Scope
- One voice channel per game session (mapped 1:1 to the THNK session/room), so players in the same match can hear each other.
- Per-player controls: individual **volume** (0–255, per Agora's playback volume model) and **mute/unmute** for each remote player, plus a local self-mute.
- A "virtual" client added per connected user — i.e., joining the game session auto-joins the matching Agora voice channel, no separate manual step for the player.
- Configuration: the game developer (not the end player) supplies their own **Agora App ID** and **App Certificate** as project/extension configuration — these are the developer's own Agora account credentials, not something we hardcode.

### 5.2 How Agora integration actually works (confirmed from Agora's current docs)
- **Client side:** Agora's Web SDK (RTC) runs in-browser — this is directly compatible with GDevelop/GDJS, since GDevelop games are JS/canvas apps (works in both browser exports and Electron/desktop, which is Chromium-based). Client joins a channel with an App ID + a token, then subscribes to remote users' audio tracks automatically.
- **Volume/mute:** each remote audio track exposes `setVolume(0–255)` — 0 is effectively mute, 255 is max — so per-player volume sliders and per-player mute are a direct mapping, no extra infrastructure needed.
- **Token generation is server-side by design:** Agora requires a signed token (HMAC-SHA256, generated using the App Certificate) to join a channel when App Certificate auth is enabled — and the App Certificate must **never** ship in client code. This means the exported server bundle (§4) is the right place to host a small token-generation endpoint, using Agora's open-source token generator library, keyed with the developer's App Certificate (kept server-side only).

### 5.3 Proposed flow
1. Developer sets `AGORA_APP_ID` and `AGORA_APP_CERTIFICATE` as config on the exported server bundle (env vars or a config file — not baked into the client build).
2. When the Bridge Adapter admits a player into a session, the server bundle mints an Agora token for that player (scoped to the session's channel name) and returns it to the client alongside the normal connection handshake.
3. Client-side THNK extension actions (new): `Join Voice Channel`, `Leave Voice Channel`, `Set Remote Player Volume`, `Mute Remote Player`, `Mute Self`. These wrap Agora Web SDK calls and key off THNK's existing player-linking (THNK already supports linking an object to a player, per its Preview #2 changelog — voice channel membership can piggyback on that same player identity).
4. No relation to game-state sync — voice runs on Agora's own infrastructure/network, THNK's protocol is untouched. The only coupling point is: session ID → Agora channel name, and player ID → Agora UID.

### 5.4 What needs building
- New GDevelop extension (or addition to the THNK adapter/extension set) wrapping Agora Web SDK: join/leave, per-remote volume, mute/unmute, self-mute, plus exposing "is speaking" / connection state if useful for UI (e.g. a talking indicator).
- Server-side token endpoint added to the exported server bundle.
- Config surface for the developer's App ID/Certificate (likely a THNK extension property set in the GDevelop project, or an env var read by the server bundle at boot — needs a decision, see §6).

---

## 6. Open questions to resolve before/while building
1. Lifecycle callback transport between adapter and matchmaker (webhook vs. persistent control connection)?
2. One-process-per-session (v1 assumption) — confirmed acceptable, or is multi-tenant server needed sooner?
3. Where do Agora App ID/Certificate get configured — GDevelop project properties (visible in the editor, synced into the export) vs. a separate server-only config file the developer edits post-export? (Leaning server-only config, since the Certificate must never reach the client bundle.)
4. Current real status of the THNK Rooms/Relay adapter and "THNK Cloud" — docs call both "coming soon"; needs direct source verification after forking, since it affects whether we build on top of Geckos.io only or also Rooms.
5. Should the Bridge Adapter's admission auth (§3.3) also serve as THNK's general answer to issue #15, or stay scoped only to matchmaking-driven sessions (leaving direct-connect adapters like P2P/Geckos unauthenticated as they are today)?

---

## 7. Test plan (GDevelop side, server-authority focus)

Purpose: validate the **externally-hosted server-authority path** specifically — not local/P2P host play, which already works. Minimal steps once the forked extensions exist:

1. Build a trivial THNK scene: one synced object (e.g. a player-controlled sprite) with the "Synchronize object" behavior, one `State.` prefixed variable (e.g. score), and a couple of server-tagged events (e.g. server moves the object on input) vs. client-tagged events (e.g. client renders/sends input).
2. Export a server build (§4) and run it headless on a machine other than the one previewing the game — this is the key difference from the "local adapter" tutorial, which runs client and server on the same machine.
3. Connect two separate client instances (two browser tabs or two machines) to that remote server via the Geckos.io adapter, using its IP/hostname — confirm both see the same authoritative state, and that a client can't directly force object movement without going through the server (basic cheat-resistance sanity check).
4. Once the Bridge Adapter exists: replace step 3's manual IP-connect with a call to a stub matchmaker (can be a five-line script) that calls `startSession` with two fake player tokens, and confirm both clients get routed into the same session via the adapter rather than a hardcoded IP.
5. Once voice chat exists: confirm both clients auto-join the session's Agora channel, and that muting/adjusting volume from one client only affects that client's local playback (not the other client's experience) — i.e. confirm current understanding of Agora's per-listener volume model.

I'll write up more detailed step-by-step instructions (exact GDevelop event sheets, exact extension actions) once the actual extension surface exists in the fork — right now this is the shape of the test, not exact clicks, since the actions/conditions don't exist yet to name precisely.

---

## 8. Suggested build order for Claude Code

1. Fork THNK; get the existing build (`yarn`, `yarn build`) running locally, confirm Geckos.io server path works today, exactly as documented, before changing anything.
2. Close/patch the connection-lifecycle gaps that matter most for a remote server (issues #36, #30) enough to be reliable for testing — doesn't need to be the full fix, just enough for stable sessions during dev.
3. Build the server export pipeline (§4) as a CLI first (lowest risk), producing a runnable headless server bundle from a THNK project.
4. Build the Bridge Adapter (§3) as a new adapter extension: `startSession` API, token-based admission, wiring into the exported server bundle.
5. Build Agora voice integration (§5): client-side extension actions first (can be tested against a manually-created channel/token before the server token endpoint exists), then the server-side token endpoint, then wire channel membership to session join/leave.
6. Re-test the full test plan in §7 end to end.
