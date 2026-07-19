# M3 External Matchmaking Bridge Report

> Contract update: M5 extends every session assignment and admission JWT with
> game, authority, optional map, server build, client build, compatibility,
> protocol, and signed player-tag identity. It also starts the control
> supervisor before GDevelop. See `M5-MULTI-AUTHORITY.md`.

**Recorded:** 2026-07-19

**Platform branch:** `platform/m3-matchmaking-bridge`

**Baseline:** M2 documentation commit `05a497a`

## Outcome

M3 adds an opt-in, one-session-per-process matchmaking bridge to exported THNK
servers. An external matchmaker controls the session through an authenticated
HTTP API, while browser clients present short-lived RS256 admission JWTs in the
Geckos HTTP `Authorization` header. The server binds the verified `playerId` to
the live THNK user; it never accepts a client-selected identity.

Direct Geckos connections remain compatible when bridge mode is disabled. The
control listener is not opened in that mode. The bundle format is now version
2 and records its versioned control contract and authorization-header
admission transport in `manifest.json`.

## Runtime configuration

The generated `config.example.env` contains every bridge setting:

```text
THNK_BRIDGE_ENABLED=false
THNK_CONTROL_HOST=127.0.0.1
THNK_CONTROL_PORT=9209
THNK_CONTROL_TOKEN=
THNK_WEBHOOK_SECRET=
THNK_ALLOW_INSECURE_CALLBACKS=false
```

Bridge mode requires independent, random control and webhook secrets of at
least 32 characters. The control API binds to loopback by default. Production
deployments should expose it only on a private/protected interface and place
TLS in front of all external traffic. Plain HTTP callback URLs are rejected;
the only exception is an explicit loopback-development switch.

Neither secret belongs in a game project or client export. The matchmaker's
private JWT signing key also stays outside the server bundle; the session
request contains only its public verification key.

## Control API v1

Health endpoints do not require control authentication:

```http
GET /health/live
GET /health/ready
```

Session endpoints require `Authorization: Bearer <THNK_CONTROL_TOKEN>`:

```http
POST /v1/session
GET  /v1/session
POST /v1/session/end
```

A session is created with an `application/json` request like:

```json
{
  "sessionId": "match-123",
  "players": ["player-a", { "playerId": "player-b" }],
  "callbackUrl": "https://matchmaker.example/thnk-events",
  "reconnectPolicy": "fresh-token",
  "metadata": { "mode": "duel" },
  "tokenVerification": {
    "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
    "keyId": "matchmaker-key-1",
    "issuer": "https://matchmaker.example",
    "audience": "thnk-game-server",
    "algorithm": "RS256"
  }
}
```

Creation returns `201`. A second start while that session is active or ending
returns `409 session_already_active`. Session end returns `202`, closes admitted
clients, waits for player-leave processing, sends the final webhook, drains the
bounded webhook outbox, stops the game, and exits. JSON bodies are capped at 64
KiB and oversized requests receive `413 request_too_large`.

`GET /v1/session` returns only safe operational state: roster, metadata,
connected and pending player IDs, public verification configuration, and
webhook counters. It does not return the public-key body, callback URL, player
tokens, or either shared secret.

## Player admission contract

The bridge accepts RS256 JWTs with the configured `kid`, issuer, and audience.
Every token requires:

```json
{
  "sessionId": "match-123",
  "playerId": "player-a",
  "jti": "single-use-token-id",
  "iat": 1784462400,
  "nbf": 1784462400,
  "exp": 1784462640
}
```

`nbf` is optional. Token lifetime is capped at five minutes with 30 seconds of
clock skew. The verifier rejects algorithm substitution, wrong key ID,
non-RSA/under-2048-bit keys, invalid signatures, wrong issuer/audience/session,
unrostered players, invalid time windows, reused `jti` values, and concurrent
connections for one player.

Admission JWTs are sent in the initial Geckos HTTP `Authorization` header, not
in a query string. GDevelop exposes a `Connect to server with admission token`
action. Pass it the short-lived token returned by the matchmaker; do not place a
literal production token in the project. The adapter clears its transient
token reference once the connection attempt completes.

Reconnect policy is deliberately explicit: a disconnected player must obtain
a new token with a new `jti`. The canonical `playerId` stays the same, while the
transport connection ID and token ID change. Abandoned pending admissions
expire; their token IDs remain consumed to prevent replay.

## Lifecycle webhook contract

The runtime emits:

- `session.started`
- `player.joined`
- `player.left`
- `session.ended`

Each JSON event contains `version`, `eventId`, `eventType`, `timestamp`, and
`sessionId`, plus player/connection or event-specific data. Delivery is
at-least-once. The same event body and event ID are used on every retry, so the
receiver must deduplicate by `eventId`.

Requests contain:

```text
X-THNK-Event-Id: <eventId>
X-THNK-Timestamp: <event timestamp>
X-THNK-Signature: sha256=<hex HMAC-SHA256>
```

The signature covers the exact request-body bytes using `THNK_WEBHOOK_SECRET`.
Delivery uses a three-second request timeout and at most five attempts with
bounded exponential backoff. Failed delivery is visible in the session's
webhook counters, and the in-memory record remains available for that process's
lifetime.

## Automated verification

Run the exported-fixture proof after building and exporting M1/M2 fixtures:

```text
yarn fixture:m3:check
```

The final Windows run exercised the actual exported Electron server and two
isolated headless Chrome clients. It proved:

| Check | Result |
| --- | --- |
| Session control | Authenticated create/get/end passed; duplicate create returned 409 |
| Valid clients | `alice` and `bob` joined one authoritative world under their roster identities |
| Ownership | Alice's input moved exactly one server-owned object and both clients converged |
| Hostile admission | Missing, expired, wrong-session, wrong-player, and replayed tokens were rejected |
| Disconnect | Bob left without changing Alice's identity |
| Reconnect | Bob's old token was rejected; a fresh token restored Bob without identity mixing |
| Webhook retry | 9 delivery attempts represented 8 logical events; the retried event kept its ID/body/signature |
| Shutdown | Both live clients drained, all leave events arrived, `session.ended` reported `playersDrained: true`, and Electron exited 0 |

Two independent final exports produced the same format-v2 bundle content hash:

```text
37bdb16734028946abd097e843b14a010ef11c9752d4750b86ba2de4b88d6ad0
```

A separate bridge-disabled run confirmed that the control port remained closed
while three direct clients passed join, ownership, selective disconnect,
reconnect, stable-survivor identity, and convergence.

Unit and contract coverage additionally checks forged signatures, algorithm
substitution, issuer rejection, token time windows, unsafe callback URLs,
duplicate rosters, absent control secrets, bounded total callback outage,
64-KiB request enforcement, HMAC output, stable retry IDs, and bundle-format
validation.

## Boundaries

- Session and webhook state is process-local by design; v1 runs one isolated
  game session per process.
- HTTPS termination, firewalling, process scheduling, persistence, fleet
  placement, and DDoS controls belong to the deployment platform.
- M2 already verified the packaged Electron/Xvfb runtime on Ubuntu 24.04. M5
  owns the complete cross-platform release matrix, soak/load profiles, and
  production capacity claims.
