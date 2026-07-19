# M2 Server Export Report

> Contract update: M5 supersedes the single-entry format described here with
> bundle format v4, an `authorities` catalog, and a content-addressed
> `serverBuildId`. Legacy one-authority projects are migrated to authority ID
> `default` during staged export. See `M5-MULTI-AUTHORITY.md`.

**Recorded:** 2026-07-19

**Platform branch:** `platform/m2-server-export`

**Baseline:** M1 commit `6df2c6e`

## Outcome

M2 exports a GDevelop JSON project into a validated, self-contained THNK server
directory. The artifact runs the authoritative game in a hidden Electron
window, without the GDevelop editor or THNK source tree. Local Windows and
remote Ubuntu 24.04 runs installed only the generated bundle's dependencies,
reached `THNK_SERVER_READY port=9208`, and passed disconnect/reconnect tests
with 8 and 16 isolated browser clients.

The runtime is windowless to an operator but is not rendererless: current
GDevelop game code needs its DOM/renderer, and the Geckos adapter needs
Node/Electron. Linux therefore runs Electron inside Xvfb. Container image
publication is deferred to M5, but the underlying packaged Linux/Xvfb runtime
is now verified.

## CLI contract

```text
thnk export-server --project <game.json> --output <directory>
thnk server validate --bundle <directory>
thnk server run --bundle <directory>
```

For this repository:

```text
yarn fixture:m2:export
yarn fixture:m2:validate
cd .generated/m2/server-bundle
yarn install --frozen-lockfile --production=true --non-interactive
cd ../../..
yarn thnk server run --bundle .generated/m2/server-bundle
```

The exporter accepts a GDevelop project containing exactly one literal
`THNK_GeckosServer::HostServer` action. It verifies the port and target scene,
imports the current THNK extensions, compiles an HTML5 runtime, detects skipped
instructions, patches the generated dedicated bootstrap, and atomically moves
the finished artifact into place. Existing output directories are not
overwritten.

## Bundle integrity and reproducibility

`manifest.json` records the format version, project identity, transport, scene
entry, runtime kind/version, port, build time, and SHA-256 content hash. The
validator rejects path traversal, missing runtime files/dependencies, invalid
ports, unsupported formats/transports, and any content hash mismatch.

GDevelop emits random memory-address-like suffixes for generated inline
functions. The exporter replaces only these `userFunc0x...` identifiers using
their first-appearance order. Two independent final fixture exports produced
the identical content hash:

```text
39e37e9b81a3e1c2e417b56ad83d591c15bff6702fb41589d40651ff9b0beb7d
```

`manifest.json` is intentionally outside the content hash so its documented
build timestamp can vary without changing the runtime artifact identity.

## Connection and reconnect guarantees

Transport connection IDs are generated per server process as:

```text
<cryptographic-server-session-uuid>:client:<monotonic-sequence>
```

The sequence is never reused within a running server. A reconnect receives a
new transport identity by design, so delayed packets and disconnect callbacks
cannot attach to a different live user. Unit coverage generated 10,000 IDs in
one session and verified uniqueness even with a fixed UUID source.

Lifecycle processing is idempotent and ordered. Duplicate connect/disconnect
callbacks are ignored; messages queued by a disconnected sender are removed
without touching other users; player-owned object lists remain available for
the GDevelop disconnect event and are released immediately afterward; closing
the server clears every player queue and ownership context.

The transport is pinned to Geckos 3.1.0 and its modern node-datachannel stack.
THNK uses a fully reliable, ordered data channel because its compact state diffs
depend on create, update, and delete order. Client object registration is also
idempotent: a replayed create for an already-live numeric ID keeps the existing
object and removes the duplicate instance.

This prevents users from being mixed up at the transport and live-object
levels. It does not yet reclaim an account's prior character after reconnect.
Stable `playerId` authentication, roster membership, and reconnect policy are
M3 responsibilities and will be bound to short-lived admission tokens.

## Remote runtime results

The automated check launched isolated headless Chrome profiles on Windows
against the exported authority on Ubuntu and observed:

| Check                 | Result                                                             |
| --------------------- | ------------------------------------------------------------------ |
| Initial join          | Every client converged on the expected score and unique object IDs |
| Ownership             | Right-arrow input changed exactly one object on every client       |
| Selective disconnect  | Half the clients closed; every survivor kept its object ID         |
| Reconnect             | Fresh browser profiles joined and every client converged again     |
| Reconnected ownership | Input from a reconnected client still changed exactly one object   |

The complete lifecycle passed first with 8 clients and then with 16 clients. In
the 16-client run, all clients converged on objects `1-16`; eight survivors kept
their IDs through the disconnect phase, and all 16 clients converged again
after reconnect. Numeric synchronized-object IDs may be recycled only after the
old object is deleted; reliable ordering prevents an old and new object from
crossing. These numeric IDs are not player/account identities.

## Ubuntu package/runtime result

The clean-machine test used Ubuntu 24.04.4 LTS, x86_64, 2 CPU cores, and 3.7 GiB
RAM. The host installed Xvfb plus Electron's GTK/NSS/ALSA/GBM/X11 runtime
libraries. The bundle used the repository-supported Node 18.20.8 toolchain; its
official archive checksum was verified before extraction. Electron's bundled
`chrome-sandbox` was installed as `root:root` mode `4755`, so the server did not
need the unsafe `--no-sandbox` flag.

The artifact archive checksum matched before extraction, the frozen production
install passed, the native WebRTC module loaded without missing shared
libraries, Windows reached port 9208 over the LAN, and the final 8/16-client
lifecycle checks passed against that deployed artifact.

## Verification

- Jest: 10 suites, 23 tests passed.
- GDevelop fixture compilation: zero skipped/unknown instructions.
- Independent repeat exports: identical SHA-256 content hash.
- Bundle validation: passed before launch.
- Bundle-local frozen production install: passed.
- Bundle-local hidden Electron launch: ready on port 9208 on Windows and Ubuntu.
- Remote 8-client join/move/disconnect/reconnect check: passed.
- Remote 16-client join/move/disconnect/reconnect check: passed in 100 seconds.

The repository-wide frozen install, `yarn ts`, `yarn test --runInBand`, and full
`yarn build` gates passed on Windows after restoring the accidentally omitted
tracked `code/relay` workspace. The full build also regenerates extensions
without embedding a machine-specific source path.

## Capacity boundary

Sixteen simultaneous clients are a correctness/stress proof, not a production
capacity claim. THNK replication cost grows with connected users, synchronized
objects, message rate, and tick rate. M5 must add repeatable load profiles,
CPU/memory and network measurements, latency percentiles, soak duration, and
explicit server limits before a supported maximum player count is advertised.
