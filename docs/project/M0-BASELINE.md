# M0 Upstream Baseline Report

**Recorded:** 2026-07-18

**Platform branch:** `platform/m0-baseline`

**Upstream:** `https://github.com/arthuro555/THNK.git`

**Baseline:** `upstream/master` at `422d2ff005a1e55b6de1d692b73915a4ae92bf98`

## Outcome

The concrete upstream `master` baseline installs, type-checks, passes its existing tests, and completes the full extension build with the pinned M0 toolchain.

The local repository uses `https://github.com/arthuro555/THNK.git` as `upstream` and `https://github.com/Faithfultennyson-ESEGAMES/THNK.git` as the writable `origin`. Both remotes matched baseline commit `422d2ff0` when M0 was finalized.

## Pinned toolchain

| Component | Version |
|---|---:|
| Node.js | 18.20.8 |
| Yarn | 1.22.22 |
| TypeScript (lockfile) | 4.9.4 |
| Jest (lockfile) | 29.3.1 |
| tsup (lockfile) | 6.5.0 |
| GDevelop | Not exercised in M0; required for M1 fixture validation |

The host's globally installed Node.js is 25.2.1. It is intentionally not the project runtime because this repository and its native/transitive build tooling predate that release line.

## Baseline commands and results

| Command | Result |
|---|---|
| `yarn install --frozen-lockfile --non-interactive` | Pass |
| `yarn ts` | Pass |
| `yarn test --runInBand` | Pass: 1 suite, 6 tests |
| `yarn build` | Pass |

The current tests cover `SyncedVariable` serialization, change tracking, and change application. They do not cover adapters, process lifecycle, remote authority, export, authentication, or voice. Those gaps are intentional inputs to M1 and later milestones.

## Windows disk workaround

At baseline time the C: drive had less than 100 MB free while D: had about 60 GB. Installing dependencies directly into the workspace failed with `ENOSPC`. For this local checkout only:

- the Node/Yarn task toolchain lives under `D:\CodexTools\THNK-v1\toolchain`;
- Yarn cache/temp data lives under `D:\CodexTools\THNK-v1`;
- the workspace `node_modules` path is a junction to `D:\CodexTools\THNK-v1\workspace\node_modules`.

`tsup.config.ts` enables esbuild's `preserveSymlinks` option so generated extension bundles do not embed the physical D: dependency-cache path. This also improves byte stability for contributors who use junctioned or symlinked dependency stores.

## License finding

Commit `ee565d4` is titled `Switch from MIT to AGPL license` and replaced the license text on 2023-11-29. The root `package.json` retained its older `MIT` field. M0 aligns package metadata with the repository license by declaring `AGPL-3.0-only`.

## `master` versus `v2`

`upstream/v2` is one commit ahead of `master` at `1924f02e` (`WIP - Various notes`). It adds:

- an experimental Rust protocol under `v2/proto`;
- a Svelte input prototype under `thnk-input`;
- 27 changed paths and roughly 890 added text lines.

It does not replace or stabilize the current THNK runtime. No `v2` code is merged into the v1 platform baseline. Ideas may be revisited behind tests during later protocol work.

## M0 gates

| Gate | State |
|---|---|
| Upstream source imported without losing platform documents | Pass |
| Baseline commit and branch recorded | Pass |
| Install, type-check, tests, and build | Pass |
| Toolchain pinned | Pass |
| License metadata aligned with license history | Pass |
| `v2` assessed rather than merged wholesale | Pass |
| Writable fork configured as `origin` | Pass |
| Generated extensions byte-stable with junctioned dependencies | Pass after `preserveSymlinks` tooling fix |

## M1 handoff

M1 starts with a minimal GDevelop project that proves server-owned movement and a synchronized `State.Score`. The first technical investigation will exercise the Geckos.io server start/stop and client connect/disconnect paths before adding new adapter behavior.
