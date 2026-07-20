# M7 Product Hardening and Release Candidate Report

**Recorded:** 2026-07-20

**Platform branch:** `platform/m7-release-candidate`

**Baseline:** M6 commit `3d91e94`

## Outcome

M7 turns the M6 cross-service-capable authority into a documented,
operationally bounded release candidate. Core now has structured redacted logs,
explicit liveness/readiness, bounded control traffic, dependency deadlines,
session reclamation, graceful drain, a pinned supported runtime, CI security
gates, a container example, and an executable local Matchmaking/Player Profile
stand-in.

The real THNK Matchmaking and THNK Player Profile repositories do not exist in
this workspace yet. Their mandatory real-deployment end-to-end run therefore
remains the one external M7 release gate; the included stub proves Core's
published contract but is deliberately not represented as either product.

## Runtime hardening

- Runtime records are newline-delimited JSON with event names and available
  `sessionId`, `playerId`, `connectionId`, and lifecycle `eventId` fields.
  Authorization, token, secret, certificate, capability, password,
  private-key, and player-document fields are recursively redacted. Console
  strings receive pattern redaction and a size bound.
- `GET /health/live` exposes process liveness. `GET /health/ready` reports
  authority, session, Player Profile, and webhook checks without credentials.
  A configured unavailable Player Profile fails readiness closed; a degraded
  webhook remains visible without terminating active gameplay.
- Control JSON is limited to 64 KiB, headers to 16 KiB, and request/body
  processing has deadlines. Health, control, and public voice routes have
  independent fixed-window source limits. Limiter key storage is capped and
  evicts expired/oldest entries.
- A session has a four-hour default maximum duration. SIGINT, SIGTERM, explicit
  session end, and maximum duration stop new work, notify the GDevelop bridge,
  flush ordered Player Profile writes and lifecycle delivery, then exit. A
  configurable 30-second watchdog bounds a stuck drain.

## Release surface

- Bundle format 5 pins Node 24.18.x, Electron 43.1.1,
  `@electron/remote` 2.1.3, and the established Geckos/Agora versions.
- Runtime packages moved to production dependencies so the production audit
  reflects deployed code. The test/build stack moved to current compatible
  Jest 30, ts-jest 29.4, TypeScript 5.9, and tsup 8.5 lines.
- CI performs a frozen install, TypeScript, all unit/contract tests, extension
  build, secret scan, production audit, headless lifecycle smoke, and the
  development stub contract smoke on Ubuntu 24.04/Node 24.18.
- `examples/container/Dockerfile` packages one authority per container with
  Xvfb/xauth, a non-root runtime user, a healthcheck, and host-network guidance
  for WebRTC/ICE. Native Ubuntu uses Electron's setuid sandbox; Docker uses
  `--no-sandbox` because its default seccomp policy blocks Chromium's nested
  namespace operation and retains the non-root/container boundary instead.
- `examples/stub-matchmaker` issues short-lived RS256 player admission tokens,
  hosts a minimal Player Profile implementation, verifies signed lifecycle
  callbacks, and can serve the fixture client with one token per player. It
  binds only to loopback and stores data in memory.

## Developer and compatibility contract

The production guide is the single start-to-stop walkthrough. Separate
references cover configuration, format/control/protocol compatibility, the
threat model, troubleshooting, and known limits.

Format 5 is exact-match: a format-4 artifact must be re-exported, not edited.
Control API `v1`, the THNK protocol version, game compatibility version,
client build, and content-addressed server build are separate axes. Every
session assignment and admission token must match them before authority start
or player admission.

## Verification

Local Windows evidence recorded for this candidate:

- Frozen install, TypeScript, full extension build, 17 Jest suites/73 tests,
  secret scan, production audit, headless lifecycle/readiness/redaction smoke,
  and Matchmaking/Profile stub smoke pass.
- The full dependency graph has no moderate, high, or critical advisories. One
  low development-only esbuild local-server advisory remains; the production
  dependency audit reports zero moderate/high/critical findings across 141
  packages.
- The GDevelop client export and exact format-5 server bundle validate. Current
  build ID:
  `sha256:808e515304088c927c10376d8cccccbbe4a86cdd2edca6d44708eac6cd2b8d6a`.
- The production-only generated-bundle install succeeds with its frozen lock.
- Electron 43.1.1 passed the exported two-client M7 matrix twice before the
  documentation-only final re-export, and the exact final hash passed it once
  more: distinct Alice/Bob identities, fresh-token reconnect, all
  missing/expired/wrong/replayed-token rejections, per-player external voice
  grants without local Agora credentials, provider-outage isolation, signed
  webhook drain, and exit code 0.
- The exact bundle passed on Ubuntu 24.04.4 x86-64 with Node 24.18.0,
  Electron 43.1.1, Xvfb, and a root-owned mode-4755 `chrome-sandbox`.
  Blocked-player preflight occurred before GDevelop; Alice and Bob were
  admitted distinctly; readiness, 64 KiB rejection, rate limiting, redacted
  structured logs, external voice isolation, callback drain, and exit code 0
  all passed.
- Docker image
  `sha256:83c3bc1a87c0df163a17440032f32c835bc32f7bb088e37d868b744cd4e045ed`
  built from the exported bundle. It runs as UID 10001 with Node 24.18.0,
  Yarn 1.22.22, and Electron 43.1.1. Its internal healthcheck and published
  `/health/live` returned healthy/200; `/health/ready` correctly returned 503
  while awaiting a session. The final image is 469,917,558 bytes and the
  service user cannot write the root-owned artifact.
- Container testing found and fixed three reproducibility gaps: the Node image
  already supplies Yarn 1.22.22, Electron 43 requires its explicit
  `install.js` binary step, and minimized Xvfb requires `xauth`. Dependency
  installation is layered before the bundle copy so content-only exports reuse
  the platform download cache.

## Release blockers

The exact candidate has passed the Windows, native Ubuntu, and container
platform gates. M7 must not be marked fully complete until separately deployed
real THNK Matchmaking and THNK Player Profile services pass the documented
end-to-end contract at least once. Those implementations belong to the planned
companion repositories and do not exist yet; the passing in-repository stub is
contract evidence, not a mocked claim of that final external gate.
