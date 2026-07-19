# M4 Agora Session Voice Report

**Recorded:** 2026-07-19

**Platform branch:** `platform/m4-agora-voice`

**Baseline:** M3 commit `1534766`

## Outcome

M4 adds opt-in Agora RTC voice to the authenticated THNK session lifecycle.
Voice is issued only after the matchmaking bridge accepts a player. Every
player in one game session receives the same derived Agora channel, a distinct
UID derived from the canonical session/player pair, a ten-minute publisher
token, and a random per-admission refresh capability.

Voice is deliberately fail-open relative to gameplay. Token generation,
microphone permission, Agora join, subscription, refresh, and provider outage
errors update only the voice state and safe error code. They never reject or
close an otherwise valid THNK gameplay connection.

## Security boundary

`AGORA_APP_CERTIFICATE` is read only by the exported server process. It is not
included in the bundle, session state, Geckos user data, token response, client
export, or logs. The App ID is public and is included in the voice grant as
required by Agora clients.

The initial Geckos handshake returns:

- a short-lived Agora RTC token;
- the derived session channel and player UID;
- a canonical player-ID-to-voice-UID map for local moderation controls;
- the public HTTPS refresh URL; and
- a random 256-bit refresh capability.

Only a SHA-256 digest of the refresh capability is retained server-side. The
capability is inactive until the matching gameplay admission becomes a live
connection. It is revoked on disconnect, abandoned-admission expiry, or
session end. A fresh gameplay token/reconnect produces a new capability while
preserving the canonical player's derived voice UID.

The refresh route is:

```http
POST /v1/voice/token
Authorization: Bearer <per-admission-voice-capability>
```

It returns only App ID, channel, UID, a new short-lived RTC token, and expiry.
Responses use `Cache-Control: no-store`. Browser CORS preflight is supported.
Issuance is limited by both a minimum interval and a per-minute bound. The
client verifies that App ID, channel, and UID do not change in a refresh
response before accepting its token.

## Server configuration

Voice requires bridge mode and is disabled by default:

```text
THNK_BRIDGE_ENABLED=true
THNK_VOICE_ENABLED=true
AGORA_APP_ID=<server secret injection>
AGORA_APP_CERTIFICATE=<server secret injection>
THNK_VOICE_TOKEN_URL=https://game.example/v1/voice/token
THNK_ALLOW_INSECURE_VOICE_TOKEN_URL=false
THNK_VOICE_TOKEN_TTL_SECONDS=600
THNK_VOICE_MIN_REFRESH_INTERVAL_MS=5000
THNK_VOICE_MAX_REFRESHES_PER_MINUTE=8
```

The public URL must use HTTPS. Explicit loopback HTTP is accepted only for
local development with `THNK_ALLOW_INSECURE_VOICE_TOKEN_URL=true`. In
production, route only `/v1/voice/token` from the public edge to the control
listener. Keep session-control routes private even though they also require a
separate strong control bearer token.

App ID and App Certificate must each be 32 hexadecimal characters. The
default token lifetime is 600 seconds; configurable bounds are 120 to 3600
seconds. Agora's client warning event occurs 30 seconds before expiry, and the
runtime also schedules refresh 45 seconds before the recorded expiry.

## GDevelop surface

The `THNK_GeckosClient` extension now exposes:

| Surface | Purpose |
| --- | --- |
| Join / Leave Session Voice | Explicit voice lifecycle control; admission also auto-joins |
| Mute / Unmute Self | Changes the local microphone track |
| Mute / Unmute Remote Participant | Local listener-only control by canonical player ID |
| Set Remote Participant Volume | Local 0-to-100 playback volume by canonical player ID |
| Session Voice Connected | Includes normal and listen-only connections |
| Session Voice State | Stable lifecycle state string |
| Self / Remote Muted | Local state conditions |
| Voice Participant Speaking | Agora volume-indicator threshold condition |
| Voice Participant Speaking Level | Agora 0-to-100 volume level |
| Last Session Voice Error | Stable, sanitized voice-only error code |

Microphone denial results in `CONNECTED_LISTEN_ONLY` with
`microphone_permission_denied`; remote audio can continue. Provider and token
endpoint failures retain the gameplay connection and report only a voice
error.

## Automated verification

Credential-free gates:

```text
yarn ts
yarn test --runInBand
yarn build
yarn fixture:m4:check
```

The exported-runtime check uses syntactically valid non-production credentials
to exercise real token generation and an intentionally unavailable Agora
project. It proved two-player admission, shared channel, distinct UIDs,
capability isolation, refresh, stable reconnect UID, rotated reconnect
capability, secret absence, provider-outage isolation, webhook retry, gameplay
ownership, drain, and clean exit.

The real provider gate reads credentials from an external file so values never
appear in a command line or repository file:

```text
D:\CodexTools\THNK-v1\agora-m4.json
{"appId":"...","appCertificate":"..."}

# The runner also accepts:
AGORA_APP_ID=...
AGORA_APP_CERTIFICATE=...

yarn fixture:m4:live
```

That gate launches two isolated Chrome clients with fake microphone streams,
waits for both to publish and subscribe to each other's Agora audio tracks,
tests local mute/volume, voice-only leave/rejoin, token refresh, gameplay
continuity, and reconnect identity/capability behavior. Delete the external
secret file after the gate if it is no longer needed.

## Verification status

- TypeScript: passed.
- Unit/contract tests: 14 suites, 46 tests passed.
- Full build and GDevelop extension generation: passed.
- Exported-server format v3 build and frozen production install: passed.
- Credential-free two-client M4 integration: passed.
- Live two-client Agora audio exchange: passed with external credentials and
  fake microphone streams; both clients published/subscribed, local controls
  passed, voice leave/rejoin resumed mutual audio, refresh passed, gameplay
  remained connected, and the server exited cleanly.
- Two consecutive fixed-time exports produced the identical format-v3 content
  hash `7a9f0d92ad2d52941c43d7f98835fea88d0d8fab739872952ee4598b102495a1`.
- Production audit: no critical findings. Eight high findings remain in the
  pre-existing Electron 32 runtime and Geckos/node-datachannel installer chain;
  the new Agora packages introduced none. Runtime/dependency upgrades are an
  explicit M5 release-hardening gate.

## Boundaries

- Voice capacity, geographic quality, billing, production TURN/firewall
  behavior, long-duration token soak, and provider SLA validation remain M5
  release-hardening work.
- A successful fake-media live test proves RTC publication/subscription and
  controls, not subjective microphone or speaker quality on end-user devices.
- The public refresh endpoint still needs normal deployment-layer TLS, rate
  limiting, monitoring, and DDoS protection in addition to its application
  capability and issuance limits.
- M4 is feature-complete, not a production release candidate. M5 must clear or
  formally mitigate the recorded Electron and native-installer advisories.
