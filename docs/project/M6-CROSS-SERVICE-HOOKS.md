# M6 Cross-service Integration Hooks Report

**Recorded:** 2026-07-19

**Platform branch:** `platform/m6-cross-service-hooks`

**Baseline:** M5 commit `edf57ef`

## Outcome

THNK Core now exposes the concrete runtime hooks required by the future,
separate THNK Player Profile and THNK Matchmaking repositories. The exported
authority can preflight blocked roster members, load one game-scoped document
per admitted player, expose typed GDevelop reads and a server-only write
action, persist ordered updates, report an observable authoritative-state edit
as a signed trust webhook, and accept one externally issued Agora grant per
roster member.

Neither companion service is implemented in this repository. M6 uses realistic
HTTP stubs to prove Core's side of each contract.

## Player Profile contract

The bundle enables Player Profile only when both of these server-side settings
exist:

```text
THNK_PLAYER_PROFILE_URL=https://profile.internal/
THNK_PLAYER_PROFILE_TOKEN=<independent service credential, 32+ characters>
```

The URL is deployment configuration, never session input. HTTPS is mandatory
outside an explicitly enabled loopback test. Calls have a bounded timeout and
send the Player Profile service credential—not the control token or a player
admission JWT.

Core calls:

```text
GET /internal/players/:id/blocked
-> { "blocked": false }

GET /internal/players/:id/document?gameId=<gameId>
-> { "document": { ... } }

PUT /internal/players/:id/document?gameId=<gameId>
<- { "document": { ... }, "sessionId": "..." }
```

Documents must be JSON objects and are capped at 64 KiB. A failed dependency
call fails closed with a stable `player_profile_unavailable` 503 error.
All roster blocked checks finish before the supervisor calls the GDevelop
start hook. A blocked result returns `player_blocked` and leaves the authority
unloaded.

Document loading happens after the signed admission identity passes and before
the Geckos connection is created. The canonical player context is populated
before `On client connected`. Writes for a player are serialized so an older
request cannot overtake a newer one; reconnect waits for any local in-flight
write before loading the document again. Disconnect and session drain perform
a final write/flush.

## GDevelop surface

The THNK extension adds:

```text
GetPlayerNumberVariable("progression.xp")
GetPlayerStringVariable("profile.title")
GetPlayerBooleanVariable("settings.ready")
GetPlayerVariableJSON("inventory")
SetPlayerVariable("progression.xp", SceneVariable)
```

Paths are dot separated. Reads use the currently selected canonical player and
do not create missing fields. The set action copies a GDevelop scene variable,
so primitives, structures, and arrays are supported. It is guarded inside the
extension before the write function: if a client-tagged event invokes it, the
extension throws a server-only error and no mutation/write-through occurs.

The M6 exported fixture loads XP 7, executes the server-tagged set action on
connection, exposes synchronized XP 8, persists it, and reloads it on Bob's
fresh-token reconnect without mixing Alice's document.

## Detectable trust violation

The official client runtime now snapshots authoritative scene/object state,
detects a local edit at the post-event boundary, reports the reserved
`authoritative_state_edit` violation, then restores the authoritative values.
The server derives the player from the authenticated transport; a client
cannot name another player. Client and server cooldowns collapse repeated
frames from one held input into one incident. The existing outbox emits:

```json
{
  "eventType": "trust.violation",
  "sessionId": "...",
  "playerId": "...",
  "connectionId": "...",
  "violationType": "authoritative_state_edit",
  "timestamp": "..."
}
```

It uses the same event ID, timestamp, HMAC-SHA256 signature, retry, and drain
rules as lifecycle webhooks. The adversarial fixture's Space edit produces one
delivered, correctly signed logical violation.

This detector is intentionally described precisely: it detects edits made
through the official THNK client lifecycle and protocol-observable violation
messages. A fully modified hostile client can remove its own reporting code;
server-authoritative simulation remains the actual security boundary and does
not accept the edited state.

## External Agora grant and refresh ownership

`POST /v1/session` may supply an all-or-none roster map:

```json
{
  "voiceGrants": {
    "alice": {
      "appId": "...",
      "channel": "session-channel",
      "uid": "voice-alice",
      "token": "...",
      "expiresAt": "2026-07-19T12:04:00.000Z",
      "refreshUrl": "https://matchmaking.example/voice/alice/refresh",
      "refreshCapability": "...",
      "refreshOwner": "matchmaker"
    }
  }
}
```

Every roster member must have exactly one grant; extra/missing players are
rejected. All grants must use the same App ID and channel, while every player
has their own UID, token, refresh URL/capability, and roster-derived participant
mapping. External grants require `refreshOwner: "matchmaker"`: Core validates
and passes that player's grant through but never proxies or mints its refresh.
The grant is stable for that player across a fresh gameplay reconnect until the
matchmaker replaces or expires it.

The fallback contract remains unchanged. With no `voiceGrants`, a standalone
bundle uses M4 local minting and returns `refreshOwner: "bridge"`; its
per-admission capability rotates on reconnect. External-only mode accepts the
grants with `THNK_VOICE_ENABLED=true` while `AGORA_APP_ID`,
`AGORA_APP_CERTIFICATE`, and `THNK_VOICE_TOKEN_URL` are all absent.

Tokens, refresh capabilities, Player Profile credentials, and documents are
absent from the public control state and logs.

## Verification

Local Windows evidence:

- TypeScript, full build, generated-extension import/export, and 16 Jest
  suites/66 tests passed.
- M6's realistic Player Profile stub proved blocked preflight, typed document
  load/server mutation/ordered persistence/reconnect reload, and final flush.
- The adversarial client edit produced exactly one signed `trust.violation`.
- A roster-keyed external voice session ran with local Agora credentials
  explicitly deleted; UIDs stayed distinct and gameplay/reconnect continued
  through the expected provider failure.
- M3, M4, and M5 exported-runtime regressions passed. M4 retained local token
  refresh and rotating per-admission capabilities; M5 retained independent
  Duel/Racing selection and pre-GDevelop assignment rejection.
- Two fixed-time M6 exports both produced build ID
  `sha256:0168bc1adfe55b5b12b7054558d91ced0d3a1ff3f5b1f9383ac80bbee55e553a`.

Ubuntu 24.04/Xvfb evidence:

- The exact content-addressed bundle ran from `/home/smile/thnk-m6-0168bc`
  with Electron 32.3.3 and the dependency set already verified for M5.
- Its supervisor rejected a blocked roster before GDevelop, admitted the Duel
  authority, loaded a Player Profile document, delivered an external voice
  grant while local Agora credentials were absent, drained signed lifecycle
  events, and exited cleanly with code 0.
- Placing the test harness inside the content-addressed artifact first caused
  the validator to fail closed. Moving the harness outside and restoring the
  exact artifact allowed the gate to pass, providing additional evidence that
  unexpected bundle files are detected.

## Remaining scope

M7 owns release hardening, dependency/runtime upgrades or formal mitigations,
structured production logs, rate limits, readiness/dependency policy, and the
complete release-candidate matrix. Matchmaking algorithms, accounts, durable
storage, moderation decisions, and external voice mint/refresh implementation
remain in the two companion repositories.
