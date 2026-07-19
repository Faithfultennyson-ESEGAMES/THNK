# M1 Remote Authority Report

**Recorded:** 2026-07-18

**Platform branch:** `platform/m1-remote-authority`

**Baseline:** M0 commit `3834ccdf33b5a017867ff6bfed416766f30e7322`

## Outcome

The M1 fixture runs one non-player-hosted GDevelop server preview and two isolated
browser clients as separate processes. Both clients join the same Geckos.io
session, converge on server-owned movement and state, remove disconnected
players, reconnect into the current world, and detect server shutdown.

The vertical slice is complete. The repository includes the fixture,
generation/export scripts, automated runtime checks, unit regressions, and
exact manual steps. The second-machine gate was closed on 2026-07-19 by running
the exported authority on Ubuntu 24.04 and connecting Windows browser clients
over the LAN.

## Validated toolchain

| Component              |        Version |
| ---------------------- | -------------: |
| Node.js                |        18.20.8 |
| Yarn                   |        1.22.22 |
| GDevelop               |  5.6.274.33722 |
| GDevelop Electron      |         32.3.3 |
| GDevelop Chromium      | 128.0.6613.186 |
| Automated-check Chrome | 150.0.7871.115 |

## Fixture contract

[`fixtures/m1-remote-authority/game.json`](../../fixtures/m1-remote-authority/game.json)
contains three scenes:

- `ServerBootstrap` selects dedicated mode and starts a Geckos server on port 9208.
- `ClientBootstrap` connects to that server and enters the shared scene.
- `Authority` creates one synchronized `Player` per connection and maintains
  `State.Score` only in server events.

Right-arrow input is sent as `MoveRight`; the server selects the sender's owned
object and changes its X position. Space deliberately attempts to move every
local player by 1000 pixels and set `State.Score` to 999. The client lifecycle
restores the last authoritative object and scene state before either edit can
escape that client.

## Clean runtime result

The final run started a fresh server profile and two fresh Chrome profiles. It
observed this sequence:

| Check                | Result                                                                        |
| -------------------- | ----------------------------------------------------------------------------- |
| Initial join         | Both clients connected with score 2 and the same two players                  |
| Accepted input       | Server moved the owned player; both clients converged                         |
| Rejected local edits | The 1000px position edit and score 999 edit did not enter authoritative state |
| Abrupt client close  | Remaining client reached score 1 with one player; no server crash             |
| Reconnect            | Replacement client and existing client reached score 2 with identical players |
| Server stop          | Port 9208 was released and the remaining client reported `disconnected`       |

## Blocking lifecycle defects fixed

- Adapter connection and disconnection transitions are idempotent. Duplicate
  callbacks no longer erase queued messages or create duplicate leave events,
  and late packets after disconnect are ignored safely.
- The Geckos server waits for the HTTP listener before reporting ready, removes
  its unload listener, slices typed-array payloads correctly, and closes its
  connections and HTTP server once.
- Server and client startup close partially prepared adapters when startup or
  snapshot validation fails.
- Server tick timers belong to their THNK context, so a stopped/replaced context
  cannot leave the old global timer behind.
- Client connection requests retry every 500 ms until the server accepts the
  handshake. This removes the one-shot packet-loss race found in the live run.
- Clients capture authoritative synchronized object/scene state after incoming
  updates and restore it after client events. This closes the visual divergence
  where a local edit could persist when the next delta omitted an unchanged
  field.
- The GDevelop `StopServer` instruction is an action and calls the exported
  `closeServer` function. Dedicated-mode detection uses the supported settings
  API.

Each code-level lifecycle fix has a focused Jest regression. The full generated
extension build also compiles the fixture with no skipped/unknown instruction.

## Reproduce

Run the deterministic checks:

```text
yarn install --frozen-lockfile --non-interactive
yarn test --runInBand
yarn ts
yarn build
yarn fixture:m1:validate
yarn fixture:m1:prepare
yarn fixture:m1:export-client
```

The local-process and second-machine procedures are in
[`fixtures/m1-remote-authority/README.md`](../../fixtures/m1-remote-authority/README.md).
The automated browser check expects the exported client at
`http://127.0.0.1:8080` and Chrome debugging endpoints on ports 9222 and 9223,
then runs with `yarn fixture:m1:runtime-check`.

## M1 gate status

| Gate                                                        | State                     |
| ----------------------------------------------------------- | ------------------------- |
| Two clients share one non-player-hosted authoritative world | Pass locally and remotely |
| Client cannot overwrite synchronized position or score      | Pass                      |
| Join, leave/abrupt disconnect, reconnect, and server stop   | Pass locally and remotely |
| Fixture, automated check, and manual steps are versioned    | Pass                      |
| Separate machine or isolated network environment            | Pass on Ubuntu 24.04      |

M2 can start from the locally proven runtime boundary. Its first job is to
replace the GDevelop desktop server preview with a reproducible headless server
artifact; it must preserve this M1 fixture as its smoke test.
