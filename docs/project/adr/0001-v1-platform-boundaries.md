# ADR 0001: V1 Platform Boundaries

- **Status:** Accepted
- **Date:** 2026-07-18
- **Decision owners:** THNK Server Platform maintainers

## Context

THNK already separates authoritative game logic from transport adapters, but it does not provide a supported dedicated-server export, matchmaking-neutral admission contract, or integrated session voice. V1 must prove those capabilities without depending on unfinished upstream services or taking on fleet-management scope.

## Decision

| Area | V1 decision |
|---|---|
| Source baseline | Build from upstream `master`; inspect `v2` ideas selectively and never merge the WIP branch wholesale |
| Process model | Run one game session per operating-system process/container |
| Session callbacks | Send signed HTTPS webhooks with stable event IDs, bounded retry, and receiver idempotency |
| Player admission | Use short-lived asymmetric JWTs; matchmaker holds the private key and runtime holds verification keys |
| Agora configuration | Load App ID and App Certificate from server-side environment/secrets only |
| State transport | Use the existing Geckos.io adapter for the first dedicated-server vertical slice |
| Rooms/Relay | Do not depend on THNK Rooms, Relay, or Cloud in v1 |
| Authentication scope | Authenticate matchmaking-bridge sessions; leave Local/P2P/direct adapters compatible for v1 |
| Export surface | Deliver a CLI and generated extensions; do not fork GDevelop `newIDE` for v1 |
| Voice architecture | Keep Agora media side-band from the THNK state protocol; couple only session/player identity |

## Consequences

- Matchmaking logic, multi-session scheduling, autoscaling, persistence, and failover remain external or future work.
- Process isolation makes lifecycle behavior observable and cleanup deterministic at the cost of higher per-session overhead.
- Asymmetric admission prevents compromised game runtimes from minting valid matchmaker identities.
- Webhooks require durable retry and deduplication but avoid a persistent matchmaker control connection.
- Voice failures can be isolated from gameplay failures.
- A future editor button can call the proven CLI instead of embedding the export implementation in GDevelop.

## Revisit triggers

Revisit this ADR if measurements show one-process-per-session is operationally infeasible, browser transport cannot carry admission securely, or a stable upstream Rooms/Relay implementation materially changes the shortest dedicated-server path.
