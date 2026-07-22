# Server configuration reference

All credentials are server environment variables or secret mounts. Do not put
them in GDevelop project data, client exports, URLs, images, or source control.

## Runtime and identity

| Variable                        | Default                      | Contract                                                 |
| ------------------------------- | ---------------------------- | -------------------------------------------------------- |
| `THNK_AUTHORITY_ID`             | required for multi-authority | Cold-selected manifest authority.                        |
| `THNK_MAP_ID`                   | empty                        | Optional map identity included in assignment/JWT checks. |
| `THNK_EXPECTED_SERVER_BUILD_ID` | unset                        | Optional externally trusted `sha256:...` deployment pin. |
| `THNK_SERVER_START_TIMEOUT_MS`  | `30000`                      | GDevelop listen deadline, 1,000–300,000 ms.              |
| `THNK_MAX_SESSION_DURATION_MS`  | `14400000`                   | Forced reclamation, 1,000–86,400,000 ms.                 |
| `THNK_LOG_LEVEL`                | `info`                       | `debug`, `info`, `warn`, or `error`; output is NDJSON.   |

`THNK_RUNTIME_*`, `THNK_GECKOS_BRIDGE_PATH`, and bootstrap-scene variables are
supervisor-owned. Do not set them manually.

## Bridge control and callbacks

| Variable                             | Default       | Contract                                                 |
| ------------------------------------ | ------------- | -------------------------------------------------------- |
| `THNK_BRIDGE_ENABLED`                | `false`       | Enables supervised Matchmaking mode.                     |
| `THNK_MATCHMAKING_URL`               | none          | HTTPS Matchmaking root the Authority calls outbound.     |
| `THNK_MATCHMAKING_AUTHORITY_TOKEN`   | none          | Production or scoped dev Authority credential.           |
| `THNK_MATCHMAKING_TIMEOUT_MS`        | `5000`        | Per outbound control/voice request deadline.              |
| `THNK_ALLOW_INSECURE_MATCHMAKING_URL`| `false`       | Explicit private-LAN HTTP development only.               |
| `THNK_MODE_ID`                       | authority ID  | Exact Matchmaking route/mode identity.                    |
| `THNK_DEV_AUTHORITY_REGISTER`        | `false`       | Register/heartbeat this scoped dev Authority.             |
| `THNK_GAME_SERVER_URL`               | none          | Client-reachable address advertised by a dev Authority.  |
| `THNK_CONTROL_HOST`                  | `127.0.0.1`   | Bind to a private/protected interface only.              |
| `THNK_CONTROL_PORT`                  | game port + 1 | Must differ from the Geckos port.                        |
| `THNK_CONTROL_TOKEN`                 | none          | Legacy private/manual inbound-control credential only.   |
| `THNK_CONTROL_RATE_LIMIT_PER_MINUTE` | `120`         | Per-source health and control limits, isolated by group. |
| `THNK_CONTROL_REQUEST_TIMEOUT_MS`    | `10000`       | Complete request deadline, 1,000–120,000 ms.             |
| `THNK_CONTROL_BODY_TIMEOUT_MS`       | `5000`        | JSON body deadline, 250 ms up to request timeout.        |
| `THNK_SHUTDOWN_TIMEOUT_MS`           | `30000`       | Final drain deadline before a forced non-zero exit.      |
| `THNK_WEBHOOK_SECRET`                | none          | Independent 32+ character HMAC secret.                   |
| `THNK_ALLOW_INSECURE_CALLBACKS`      | `false`       | Allows HTTP only for loopback development.               |

Production orchestrators provision each Authority with the outbound URL,
credential, and exact route identity. Development registration uses the same
outbound direction and does not require Matchmaking to reach the advertised
address. Request bodies are limited to 64 KiB and headers to 16 KiB. The
legacy inbound control API is available only when outbound pull is not
configured.

## Player Profile

| Variable                                 | Default  | Contract                                      |
| ---------------------------------------- | -------- | --------------------------------------------- |
| `THNK_PLAYER_PROFILE_URL`                | disabled | HTTPS service root; configure with token.     |
| `THNK_PLAYER_PROFILE_TOKEN`              | none     | Independent 32+ character service credential. |
| `THNK_PLAYER_PROFILE_TIMEOUT_MS`         | `3000`   | Per-call deadline, 250–30,000 ms.             |
| `THNK_ALLOW_INSECURE_PLAYER_PROFILE_URL` | `false`  | Allows HTTP only for loopback development.    |
| `THNK_PLAYER_PROFILE_POLICY`              | `fail-closed` | Production policy; optional dev fallback below. |
| `THNK_DEV_MODE`                           | `false`  | Required for `local-ephemeral-fallback`.       |

Player documents are JSON objects limited to 64 KiB. The default policy fails
closed when Player Profile is absent or unavailable. Local development may set
`THNK_PLAYER_PROFILE_POLICY=local-ephemeral-fallback` only together with
`THNK_DEV_MODE=true`; documents then live in memory for that session only and
the runtime logs the fallback and writes. Ordered production write failure
marks readiness unavailable but never exposes document content.

## Agora voice

| Variable                                | Default | Contract                                           |
| --------------------------------------- | ------- | -------------------------------------------------- |
| `THNK_VOICE_ENABLED`                    | `false` | Requires Bridge mode.                              |
| `AGORA_APP_ID`                          | none    | 32 hexadecimal characters for local minting.       |
| `AGORA_APP_CERTIFICATE`                 | none    | Server secret for local minting; never log/export. |
| `THNK_VOICE_TOKEN_URL`                  | none    | Public HTTPS URL routed to `/v1/voice/token`.      |
| `THNK_ALLOW_INSECURE_VOICE_TOKEN_URL`   | `false` | Loopback HTTP development only.                    |
| `THNK_VOICE_TOKEN_TTL_SECONDS`          | `600`   | 60–86,400 seconds.                                 |
| `THNK_VOICE_MIN_REFRESH_INTERVAL_MS`    | `5000`  | Per-capability refresh spacing.                    |
| `THNK_VOICE_MAX_REFRESHES_PER_MINUTE`   | `8`     | Per-capability rolling limit.                      |
| `THNK_VOICE_HTTP_RATE_LIMIT_PER_MINUTE` | `60`    | Per-source public HTTP route limit.                |

In Matchmaking-managed mode, Core pulls a distinct grant only after validating
the player's admission token; it rejects pushed `voiceGrants`, and local Agora
credentials may be absent. In standalone mode, local credentials and the
bridge-owned refresh URL provide the M4 fallback.
