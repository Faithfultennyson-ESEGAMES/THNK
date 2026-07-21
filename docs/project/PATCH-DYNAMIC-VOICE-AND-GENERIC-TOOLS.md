# Patch Report — Dynamic Voice Channels, Server Time, Generic Change Events

**Recorded:** 2026-07-21

**Baseline:** M7 release candidate; additive patch per
`CORE-PATCH-DYNAMIC-VOICE-AND-GENERIC-TOOLS.md`.

**Companion:** THNK Matchmaking commit `f515966`
(`MATCHMAKING-PATCH-DYNAMIC-VOICE-GRANTS.md`) supplies the per-player
grant issuance and channel-reissue capability the external voice path
calls. Build and deploy them together.

## 1. Dynamic per-player voice channels

The session-grant validation in `session-manager.cjs` now requires only a
shared Agora App ID across the roster; each player's grant may carry its
own channel. If a developer never touches the new surface, behavior is
unchanged: every player still lands on the identical session-derived
channel, and the pre-existing M4-M7 suites pass untouched.

`SessionManager.setVoiceChannel(playerId, channelId)` moves a live,
connected player mid-session, repeatably:

- **Externally-issued grants** (the normal path for this project): Core
  POSTs the player's own opaque refresh capability plus `{channel}` to the
  matchmaker's reissue endpoint, validates the returned grant with the
  same `validateExternalGrant` rules as admission, stores it on the
  session (so reconnect admission hands out the current channel), and
  emits `voice-grant-updated`.
- **Bundle-local Agora credentials** (standalone THNK): the
  `VoiceTokenManager` record's channel is updated in place and a fresh
  token is minted directly; the player's next capability refresh also
  returns the new channel.

Both paths reuse the player's existing capability, so rapid repeated
reassignment leaks no grants or capabilities. A player who is not in the
active roster is rejected (`player_not_in_session`), malformed channels
are rejected (`invalid_voice_channel`), and a matchmaker rate-limit
surfaces as `voice_refresh_too_frequent`. `getPlayerVoiceChannel(playerId)`
reads the live assignment; the geckos bridge exposes both calls plus a
`voice-grant-updated` subscription.

Client side, `AgoraSessionVoice` treats a refresh response whose channel
differs from the current grant as a migration — leave, rejoin the new
channel with the new token — instead of rejecting it. Responses that
change the uid or App ID are still rejected.

## 2. Trusted server time

`GetServerTimestamp()` returns the Authority process's own clock as
**milliseconds since the Unix epoch**, and returns 0 in client-tagged
code so a client clock can never masquerade as the trusted value. It is
the single primitive for time-gated systems; daily rewards, cooldowns,
and streaks are ordinary GDevelop comparisons against numeric document
fields the developer already persists. Menu/hub scenes needing it are
ordinary (often single-player) THNK authorities, so they already pass
through the server-tagged write path and M6 document hooks — confirm that
framing against the actual menu flow before relying on it.

## 3. Generic player-variable change event

`On Player Variable Changed(fieldName)` fires once per actual value
change of a watched document field: same-value writes do not fire; both
this session's own `Set Player Variable` writes and a fresh document load
reflecting a change made elsewhere do; the changed player becomes the
currently picked player; fields no condition has started watching are
never tracked, so nothing floods; pending events for released players are
dropped. This deliberately replaces any bespoke achievement/level-up
surface — what a change means and what UI it drives is the developer's
call.

## GDevelop surface added to the THNK extension

| Function | Kind | Notes |
|---|---|---|
| `Set Voice Channel(playerId, channelId)` | Action | Server-only guard before any effect |
| `GetPlayerVoiceChannel(playerId)` | String expression | Empty string without an active grant |
| `GetServerTimestamp()` | Expression | ms since epoch; 0 in client-tagged code |
| `On Player Variable Changed(fieldName)` | Condition | Watch-on-first-use, once per actual change |

## Verification

Strict typecheck and all 82 Jest tests pass, including the new suites:
per-player grant acceptance with mixed-App-ID rejection, external
reassignment through a capability-authenticated matchmaker stub, 429
propagation, bundle-local reassignment without capability leaks, client
channel migration on refresh with identity-change rejection, and the
server-time/change-event behavior set.

Two cross-repo gates in Matchmaking additionally exercise this exact
`session-manager.cjs`, not a stub, end to end:

- `test:voice:channels:core` drives it against the real Matchmaking server
  and Redis: default channel at admission, live reassignment through the
  real reissue endpoint, matchmaker-side participant-list sync, shared
  cooldown, capability stability, and rejection of a never-connected
  player.
- `test:voice:channels:agora` goes further and proves the actual audio
  boundary against the live Agora cloud: two headless Chrome instances
  join real Agora RTC channels with real tokens, publish fake microphone
  tracks, and are observed mutually present through Agora's own
  `user-published` events; after a real reassignment through Matchmaking,
  the original channel-mate genuinely stops seeing the moved player (Agora
  itself enforces the separation, not just our bookkeeping) and a third
  client on the new channel does see them.

**Remaining external gate:** a GDevelop editor export/import pass over
the four new extension functions (confirming they appear and wire
correctly inside the GDevelop UI/event sheet, the same category of gate
already recorded for M2's native packaging) and a physical two-device
audible channel-migration check. The live-Agora gate above proves the
runtime and network behavior is correct; it does not exercise the
GDevelop editor or physical hardware.
