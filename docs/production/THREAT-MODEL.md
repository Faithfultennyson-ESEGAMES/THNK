# THNK v1 threat model

## Assets and trust boundaries

Protected assets are authoritative state, admission identity, Player Profile
documents, lifecycle authenticity, Agora certificates/tokens, and deployment
artifact identity. Matchmaking, Player Profile, the authority process, the
secret store, and the externally registered build hash are trusted services.
Game clients, player networks, callback delivery networks, and all client input
are untrusted.

## Primary controls

- One OS process/container per session limits memory, crash, and cleanup scope.
- A content-addressed format-5 artifact is verified before authority selection.
- Matchmaking control auth is independent from short-lived asymmetric player
  JWTs. Exact roster, token ID, assignment/build, algorithm, issuer, audience,
  expiry, and replay checks happen server-side.
- Player IDs come from authenticated transports; clients cannot name another
  player in trust/lifecycle reports.
- Control JSON is capped at 64 KiB, headers at 16 KiB, requests/dependencies
  have deadlines, and source-address fixed-window limits bound ordinary abuse.
- HTTPS is mandatory for non-loopback callbacks, Player Profile, and voice
  refresh URLs. HMAC event IDs make webhook retries idempotent and verifiable.
- Structured logging redacts authorization, token, secret, certificate,
  capability, password, private-key, and player-document fields. Opaque game
  console messages receive string-pattern redaction and a length bound.
- Per-player Agora grants require unique UIDs, tokens, and refresh capabilities.
  The App Certificate never enters a client response.
- SIGTERM/SIGINT and maximum duration attempt player/document/webhook drains;
  the outer watchdog bounds a stuck renderer.

The hidden Electron renderer needs Node integration and cannot use Chromium's
renderer sandbox because exported GDevelop authority code loads native Geckos
modules. Therefore it must load only the verified local bundle, never remote
web content. Electron and Node are pinned to supported, audited release lines.
The Docker example also passes `--no-sandbox` because Docker's default seccomp
profile blocks Chromium's nested namespace sandbox; it compensates with a
non-root UID and the ordinary container boundary. Never run this image as
privileged or grant broad capabilities. Native Ubuntu keeps the setuid sandbox.

## Explicit limitations

- A fully modified client can remove the official illegal-edit self-report.
  Server authority still rejects its state, but the report is not an anti-cheat
  proof or kernel attestation.
- Rate limits mitigate mistakes and small abuse; they are not DDoS protection.
  Put public signaling/voice behind provider/network controls.
- Direct Local/P2P/unsupervised Geckos modes do not receive Bridge admission.
- v1 has no replicas, live migration, failover, rollback netcode, multi-session
  scheduler, durable webhook queue, or persistence beyond Player Profile hooks.
- IP address is not identity and is used only as the local HTTP limiting key.
- Voice is provider side-band; THNK does not mix, record, or moderate audio.
- Matchmaking decisions, account authentication, bans, ranks, lobbies, regions,
  and durable player storage belong to the companion repositories.
