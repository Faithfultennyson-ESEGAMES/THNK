# THNK v1 production guide

This guide is the supported M7 path from a GDevelop project to one isolated
authoritative session process. THNK Matchmaking and THNK Player Profile remain
separate products; the included development stub exercises their Core
contracts but is not a production substitute.

## Prerequisites

- Node 24.18.x and Yarn 1.22.x.
- GDevelop installed locally for exports.
- Ubuntu 24.04 x86-64 with Xvfb, or Docker, for a Linux authority host.
- A private network path from Matchmaking to the control API.
- HTTPS endpoints for lifecycle callbacks, Player Profile, and public voice
  refresh outside loopback development.

Run the repository gates first:

```text
yarn install --frozen-lockfile --non-interactive
yarn ts
yarn test --runInBand
yarn build
yarn ci:secret-scan
yarn ci:production-audit
yarn ci:headless-smoke
```

## Export the release fixture

The checked fixture demonstrates two authorities, signed admission, reconnect,
Player Profile documents, trust violations, and both Agora ownership modes:

```text
yarn fixture:m7:prepare
yarn fixture:m7:export-client
yarn fixture:m7:export
yarn fixture:m7:validate
```

For your own game, import the three generated files from `extensions/` into
GDevelop and export with:

```text
node bin/thnk.js export-server --project C:\path\game.json --output C:\path\server-bundle --compatibility-version 1 --client-build-id my-client-1
```

Every `HostServer` authority ID must be literal and unique. Deploy the complete
output directory without modifying it. `manifest.json` carries the
content-addressed `serverBuildId`; the supervisor fails before GDevelop if any
artifact file changes.

## Launch and exercise locally

Install the exported server's production dependencies:

```text
cd .generated/m7/server-bundle
yarn install --frozen-lockfile --production=true --non-interactive
node node_modules/electron/install.js
```

Electron 43 exposes its platform download as an explicit installer command;
dependency installation alone does not place the runtime binary in `dist/`.

Set the variables described in [configuration](CONFIGURATION.md). Production
Authorities use `THNK_MATCHMAKING_URL` and the orchestrator-issued
`THNK_MATCHMAKING_AUTHORITY_TOKEN` to claim sessions outbound; Matchmaking does
not need an Authority route. The older local stub below deliberately exercises
the still-supported private/manual control API. For that stub only, select
`duel`, set the profile URL to
`http://127.0.0.1:9210/`, and enable both loopback HTTP callback/profile
switches. The bundle terminal therefore needs:

```text
THNK_AUTHORITY_ID=duel
THNK_BRIDGE_ENABLED=true
THNK_CONTROL_TOKEN=<32+ random characters>
THNK_WEBHOOK_SECRET=<different 32+ random characters>
THNK_PLAYER_PROFILE_URL=http://127.0.0.1:9210/
THNK_PLAYER_PROFILE_TOKEN=<different 32+ random characters>
THNK_ALLOW_INSECURE_CALLBACKS=true
THNK_ALLOW_INSECURE_PLAYER_PROFILE_URL=true
```

Use your shell's environment syntax (`set NAME=value` in Command Prompt,
`$env:NAME="value"` in PowerShell, or `export NAME=value` on Linux). Reuse the
three generated development values in the stub terminal; never reuse them in
production.

Start the bundle first with `yarn start`. In this legacy stub example it becomes live on the control port
and waits for an assignment. In another terminal, from the repository root,
start the development stub with the same credential values:

```text
set THNK_CLIENT_BUILD=.generated/m7/client/build
node examples/stub-matchmaker/server.cjs .generated/m7/server-bundle/manifest.json
```

Create a session:

```text
curl -X POST http://127.0.0.1:9210/start -H "content-type: application/json" -d "{\"players\":[\"alice\",\"bob\"]}"
```

Open the two returned `/play/alice/` and `/play/bob/` URLs. Each page receives
only its own short-lived admission token. Test movement/state, disconnect and
reconnect, then inspect signed lifecycle events with
`http://127.0.0.1:9210/state`. End with `POST /end`.

For voice, configure either the standalone Agora variables in
[configuration](CONFIGURATION.md), or have a real Matchmaking deployment send
one grant per roster member. Microphone permission denial and provider failure
remain gameplay-safe. Never expose the App Certificate to the client.

The automated equivalent is:

```text
yarn fixture:m7:check
```

## Linux and container launch

The generated bundle README lists native Electron packages and the Xvfb
command. The container example is built using the exported bundle as context:

```text
docker build -f examples/container/Dockerfile -t thnk-authority:rc .generated/m7/server-bundle
docker run --rm --network host --env-file C:\secure\thnk-server.env thnk-authority:rc
```

On Linux use an absolute Linux path for `--env-file`. Host networking is used
in this v1 example because WebRTC requires UDP/ICE reachability beyond the two
HTTP ports; production orchestration must provide equivalent networking and a
TURN strategy where direct ICE is insufficient.

The image runs as the unprivileged `thnk` user. Its Electron command disables
Chromium's nested process sandbox because Docker's default seccomp policy
blocks the namespace operation it requires; isolation is provided by the
non-root container boundary instead. Do not add privileged mode, broad Linux
capabilities, host filesystem mounts, or a relaxed seccomp profile. Native
Ubuntu launches keep Electron's root-owned mode-4755 setuid sandbox enabled.

## Operations

- `/health/live` means the process/control listener is alive.
- `/health/ready` is 200 only when the assigned authority is active and
  required Player Profile calls are healthy. Its check names contain no
  credentials.
- Logs are newline-delimited JSON. Correlate on `sessionId`, `playerId`,
  `connectionId`, and webhook `eventId`.
- SIGINT/SIGTERM and the maximum-session timer stop new control work, signal
  the GDevelop adapter, flush Player Profile writes and lifecycle webhooks, and
  exit. The configurable 30-second outer watchdog remains the final crash
  boundary.
- One process owns exactly one session. Start another process/container for
  every concurrent match.

Read the [threat model](THREAT-MODEL.md),
[compatibility policy](COMPATIBILITY.md), and
[troubleshooting guide](TROUBLESHOOTING.md) before exposing a build.
