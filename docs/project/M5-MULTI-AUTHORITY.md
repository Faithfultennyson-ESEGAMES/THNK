# M5 Multi-authority and Admission Hardening Report

**Recorded:** 2026-07-19

**Platform branch:** `platform/m5-multi-authority`

**Baseline:** M4 commit `0b0c6f0`

## Outcome

One format-v4 server artifact can now carry several named GDevelop authority
scene pairs while running exactly one authority per process. The M5 fixture
exports `duel` and `racing`; both use the same artifact and transport port but
select different bootstrap/game scenes at cold start.

Bridge mode is now a supervisor. It exposes the control API first, checks the
session's game, authority, optional map, server build, client build,
compatibility, and protocol identity, and launches GDevelop only after that
assignment is valid. Unknown authority IDs fail during preflight, before the
control listener or GDevelop is initialized.

## Artifact trust and manifest contract

The manifest is integrity checked and content addressed; it is not described
as cryptographically signed. Its relevant shape is:

```json
{
  "formatVersion": 4,
  "project": { "gameId": "..." },
  "authorities": {
    "duel": {
      "bootstrapScene": "DuelBootstrap",
      "gameScene": "DuelAuthority"
    },
    "racing": {
      "bootstrapScene": "RacingBootstrap",
      "gameScene": "RacingAuthority"
    }
  },
  "build": {
    "serverBuildId": "sha256:...",
    "compatibilityVersion": "m5-v1",
    "clientBuildId": "m5-client-v1",
    "protocolVersion": "thnk-flatbuffers-v1"
  }
}
```

At export and runtime, THNK recomputes the SHA-256 hash over bundle content
excluding `manifest.json` and installed dependencies. `serverBuildId` must be
exactly `sha256:<contentHash>`. Production deployment supplies the trusted
registered ID as `THNK_EXPECTED_SERVER_BUILD_ID`; this creates an external
trust anchor instead of pretending that a bundle can vouch for its own key.

Legacy projects containing one three-argument `HostServer` action remain
supported. Their staged export receives authority ID `default`; the developer's
source project is not rewritten. Multi-authority projects require unique,
literal authority IDs and one shared server port.

## Runtime and admission identity

Cold-start configuration uses:

```text
THNK_AUTHORITY_ID=duel
THNK_MAP_ID=arena-1                    # optional
THNK_EXPECTED_SERVER_BUILD_ID=sha256:...
```

The authenticated `POST /v1/session` assignment and every RS256 admission JWT
carry the same identity:

```json
{
  "gameId": "...",
  "authorityId": "duel",
  "mapId": "arena-1",
  "serverBuildId": "sha256:...",
  "compatibilityVersion": "m5-v1",
  "clientBuildId": "m5-client-v1",
  "protocolVersion": "thnk-flatbuffers-v1"
}
```

Stable assignment errors include `wrong_game`, `wrong_authority`, `wrong_map`,
`wrong_server_build`, and `client_update_required`. Rejected assignments do
not invoke the authority-start callback. Player JWTs remain short lived,
single use, roster bound, and reconnect with a fresh token as in M3.

## Signed player tags

Each roster member may have up to 32 flat scalar tags. The same tag map must be
present in the signed admission token; a mismatch returns
`wrong_player_tags`. Core does not assign teams or interpret matchmaking
meaning. It freezes the verified values and exposes them only on the server
through the GDevelop string expression:

```text
GetPlayerTag("team")
```

The Geckos adapter writes tags into the canonical global player context before
the connection event and that context is released on disconnect. Clients
cannot set this map. The end-to-end fixture copies the expression result into
synchronized state and proves the exact signed value `signed-team` reaches
both clients. A fresh-token reconnect repeats the binding without mixing Bob's
identity with Alice's.

## Verification

Local Windows evidence:

- Frozen root and production bundle installs passed.
- TypeScript passed; Jest passed 15 suites and 56 tests.
- Full minified build and generated-extension import/export passed.
- Two consecutive final exports produced server build ID
  `sha256:78155313b606c8128aa2b2972d25b0547658ff6425280db4c27ac548af232029`.
- The M5 two-client gate passed authoritative movement, exact signed tag
  propagation, disconnect/reconnect identity isolation, webhook retry/drain,
  and exit code 0 for `duel`.
- The same artifact booted only `RacingAuthority` for `racing`; wrong
  authority/build/compatibility assignments remained outside GDevelop.
- Unknown authority preflight exited 1 without a control/game-ready marker.
- M3 authenticated gameplay and M4 credential-free Agora isolation/refresh
  gates passed again on the format-v4 legacy `default` artifact.

Ubuntu 24.04.4 x86_64 evidence:

- Node 18.20.8, Electron 32.3.3, Geckos 3.1.0, and Xvfb loaded the exact
  content-addressed artifact.
- `duel` reached its selected scene marker.
- The `racing` supervisor rejected a wrong build before start, accepted the
  correct assignment, reached readiness, delivered `session.ended`, and shut
  down through the control API.
- Unknown authority preflight printed only the stable preflight failure and
  exited 1.

The Ubuntu host's outbound npm request timed out during this run. The gate
therefore reused the exact-version Linux Electron/Geckos dependency cache from
the prior M2 gate and added Agora's platform-independent JavaScript packages.
Bundle integrity was independently recomputed before either authority was
selected. A clean frozen install was also completed locally.

## Deferred technical work

M6 must create a real detectable illegal-client-edit violation path before it
emits `trust.violation`; M1 currently prevents and overwrites such edits but
does not classify the attempt. M6 must also define roster-keyed pre-issued
Agora grants and refresh ownership, blocked-player pre-admission checks, and
Player Profile document load/save hooks. Matchmaking and Player Profile remain
separate service repositories governed by their companion implementation
plans.
