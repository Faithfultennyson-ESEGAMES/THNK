# Bundle and API compatibility policy

THNK uses three separate compatibility axes; none may be inferred from another.

- `formatVersion` is the exported directory/runtime schema. M7 emits format 5.
  The CLI/runtime deliberately accepts only its exact format. Re-export with
  the matching CLI to move from format 4; do not hand-edit a manifest.
- Control API `v1` covers route names, authentication placement, request/response
  shapes, stable error codes, and signed lifecycle envelope version 1. Additive
  response fields are allowed. Removing/renaming a field or changing semantics
  requires `v2`.
- `protocolVersion` identifies the THNK state wire protocol.
  `compatibilityVersion` is the developer's game-level compatibility promise,
  while `clientBuildId` identifies a particular client artifact.

Every session assignment and player JWT must exactly match `gameId`,
`authorityId`, optional `mapId`, `serverBuildId`, `compatibilityVersion`,
`clientBuildId`, and `protocolVersion`. A mismatch is rejected before admission;
authority/build assignment mismatch is rejected before GDevelop starts.

`serverBuildId` is the SHA-256 content identity of the complete artifact. Trust
comes from the deployment system registering/pinning that value outside the
bundle—not from a self-contained signature inside the same directory.

Patch releases may add optional manifest/API fields or new stable errors.
Format/control/protocol changes require the corresponding version bump. A
client rollout must keep the previous authority build available until no
active assignment references it; sessions never hot-swap authority code.
