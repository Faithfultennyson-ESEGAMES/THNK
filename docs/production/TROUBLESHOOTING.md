# Troubleshooting

## The control port is closed

Confirm `THNK_BRIDGE_ENABLED=true`, a valid 32+ character control token, and a
free `THNK_CONTROL_PORT`. `server.preflight_failed` means artifact/authority
validation failed before Electron; `server.start_failed` means later runtime
configuration or listener startup failed.

## Liveness is 200 but readiness is 503

Read the `checks` object. `session: absent` means the supervisor is correctly
waiting for Matchmaking. `authority: not_ready` means the assigned GDevelop
server has not reached its Geckos listen port. `playerProfile: unavailable`
means the configured blocked/document dependency failed and admission is
closed until a successful call restores readiness. Webhook `degraded` is
reported but does not terminate gameplay.

## Session creation fails before GDevelop

Use the exact values from `manifest.json`. `wrong_authority`, `wrong_map`,
`wrong_server_build`, or `client_update_required` indicate a deployment/client
assignment mismatch. `player_blocked` and Player Profile errors are intentional
fail-closed results. A 429 includes `Retry-After`; do not immediately retry.

## A player cannot connect or reconnect

Admission JWTs last at most five minutes and are single-use. Reconnect requires
a newly issued token with the same assignment identity and a new `jti`. Check
roster spelling and ensure no old transport for that player remains active.
Never put the token in a URL or log.

## Voice is unavailable but gameplay works

This isolation is expected. For local minting, provide both Agora credentials,
the public refresh URL, and Bridge mode. For external grants, every roster
member must have exactly one unique grant and `refreshOwner: matchmaker`.
Microphone denial should become listen-only; provider outage should not stop
state synchronization.

## Linux Electron does not start

Install the libraries in the generated README, run under Xvfb, and set the
installed `chrome-sandbox` owner to root with mode 4755. Do not add test files
inside the content-addressed artifact: integrity validation correctly rejects
every unexpected file. Electron 43 prebuilt Linux binaries target Ubuntu 22.04
or newer; the release gate uses Ubuntu 24.04. If `node_modules/electron/dist`
is absent after dependency installation, run
`node node_modules/electron/install.js` before configuring the sandbox.

## Movement updates arrive about once per second

Confirm that the Authority runs under Xvfb and that
`THNK_AUTHORITY_RENDER_VISIBLE=true`. GDevelop drives the authoritative scene
with `requestAnimationFrame`; a hidden Chromium renderer can throttle that loop
to roughly 1 FPS even though network round trips remain fast. Do not diagnose
this cadence as tunnel latency until the Authority renderer setting is checked.

## Shutdown hangs or exits 1

The runtime gives player disconnects, ordered Player Profile writes, and signed
webhooks up to the bounded drain/watchdog period. Inspect `server.stopping`,
`player_profile.write_failed`, `webhook.delivery_failed`, and
`webhook.exhausted` records by `sessionId`/`eventId`. Exit 1 means the outer
watchdog or renderer failure ended the process; treat the process as disposable
and do not reuse it for another session.
