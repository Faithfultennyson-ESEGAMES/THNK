# M2 Server Export Report

**Recorded:** 2026-07-19

**Platform branch:** `platform/m2-server-export`

**Baseline:** M1 commit `6df2c6e`

## Outcome

M2 exports a GDevelop JSON project into a validated, self-contained THNK server
directory. The artifact runs the authoritative game in a hidden Electron
window, without the GDevelop editor or THNK source tree. A local Windows run
installed only the generated bundle's dependencies, reached
`THNK_SERVER_READY port=9208`, and passed an eight-client disconnect/reconnect
test.

The runtime is windowless to an operator but is not rendererless: current
GDevelop game code needs its DOM/renderer, and the inherited Geckos adapter
needs Node/Electron. Linux and container deployment therefore still need a
virtual-display/package test before M2 is declared cross-platform.

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
their first-appearance order. Two independent fixture exports with the same
`SOURCE_DATE_EPOCH` produced the identical content hash:

```text
7abe5dc50a036d08772c3c8f66b8776bddaa3eeaaa6ef44537627da57461fc87
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

This prevents users from being mixed up at the transport and live-object
levels. It does not yet reclaim an account's prior character after reconnect.
Stable `playerId` authentication, roster membership, and reconnect policy are
M3 responsibilities and will be bound to short-lived admission tokens.

## Eight-client runtime result

The automated check launched eight isolated headless Chrome profiles against
one exported authority process and observed:

| Check                 | Result                                                                   |
| --------------------- | ------------------------------------------------------------------------ |
| Initial join          | Every client converged on score 8 and unique objects 1-8                 |
| Ownership             | Right-arrow input changed exactly one object on every client             |
| Selective disconnect  | Four closed clients were removed; four survivors kept their object IDs   |
| Reconnect             | Four fresh browser profiles joined and all eight clients converged again |
| Reconnected ownership | Input from a reconnected client still changed exactly one object         |

Observed survivor IDs were `1, 2, 5, 6`; after reconnect the live synchronized
set was again `1-8`. Numeric synchronized-object IDs may be recycled after the
old object is gone; they are not player/account identities.

## Verification

- Jest: 10 suites, 22 tests passed.
- GDevelop fixture compilation: zero skipped/unknown instructions.
- Independent repeat exports: identical SHA-256 content hash.
- Bundle validation: passed before launch.
- Bundle-local frozen production install: passed.
- Bundle-local hidden Electron launch: ready on port 9208.
- Eight-client join/move/disconnect/reconnect check: passed.

The repository-wide frozen install, `yarn ts`, `yarn test --runInBand`, and full
`yarn build` gates passed on Windows after restoring the accidentally omitted
tracked `code/relay` workspace. The full build also regenerates extensions
without embedding a machine-specific source path.

## Capacity boundary

Eight simultaneous clients are a correctness proof, not a production capacity
claim. THNK replication cost grows with connected users, synchronized objects,
message rate, and tick rate. M5 must add repeatable load profiles, CPU/memory and
network measurements, latency percentiles, soak duration, and explicit server
limits before a supported maximum player count is advertised.
