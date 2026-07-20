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
| `THNK_CONTROL_HOST`                  | `127.0.0.1`   | Bind to a private/protected interface only.              |
| `THNK_CONTROL_PORT`                  | game port + 1 | Must differ from the Geckos port.                        |
| `THNK_CONTROL_TOKEN`                 | none          | Independent 32+ character Matchmaking credential.        |
| `THNK_CONTROL_RATE_LIMIT_PER_MINUTE` | `120`         | Per-source health and control limits, isolated by group. |
| `THNK_CONTROL_REQUEST_TIMEOUT_MS`    | `10000`       | Complete request deadline, 1,000–120,000 ms.             |
| `THNK_CONTROL_BODY_TIMEOUT_MS`       | `5000`        | JSON body deadline, 250 ms up to request timeout.        |
| `THNK_SHUTDOWN_TIMEOUT_MS`           | `30000`       | Final drain deadline before a forced non-zero exit.      |
| `THNK_WEBHOOK_SECRET`                | none          | Independent 32+ character HMAC secret.                   |
| `THNK_ALLOW_INSECURE_CALLBACKS`      | `false`       | Allows HTTP only for loopback development.               |

Request bodies are limited to 64 KiB and headers to 16 KiB. Control errors use
stable JSON codes. Rate-limited responses are 429 with `Retry-After`.

## Player Profile

| Variable                                 | Default  | Contract                                      |
| ---------------------------------------- | -------- | --------------------------------------------- |
| `THNK_PLAYER_PROFILE_URL`                | disabled | HTTPS service root; configure with token.     |
| `THNK_PLAYER_PROFILE_TOKEN`              | none     | Independent 32+ character service credential. |
| `THNK_PLAYER_PROFILE_TIMEOUT_MS`         | `3000`   | Per-call deadline, 250–30,000 ms.             |
| `THNK_ALLOW_INSECURE_PLAYER_PROFILE_URL` | `false`  | Allows HTTP only for loopback development.    |

Player documents are JSON objects limited to 64 KiB. A blocked check or
document load fails closed. Ordered write failure marks Player Profile
readiness unavailable but never exposes the document in logs/control state.

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

If Matchmaking supplies all roster grants, local Agora credentials may be
absent and `refreshOwner` must be `matchmaker`. Without grants, both local
credentials and the bridge-owned refresh URL are required.
