# Feature Lab operations

This is the canonical development deployment for the THNK cross-service test
game. All long-running services live on the Ubuntu host at `192.168.1.196` and
are managed by systemd. Windows Docker is not part of this stack.

## Service map

| Component | Listener | Exposure |
| --- | --- | --- |
| PostgreSQL 17 | `127.0.0.1:5432` | Ubuntu only |
| Redis 7 | `127.0.0.1:6379` | Ubuntu only |
| Player Profile | `0.0.0.0:9400` | LAN clients |
| Matchmaking | `0.0.0.0:9300` | LAN clients |
| Feature Lab Authority | `0.0.0.0:9208` | LAN clients |
| Legacy/manual Authority control | `127.0.0.1:9209` | Reserved; not opened by the outbound-only lane |
| Feature Lab browser build | `0.0.0.0:8080` | LAN clients |

The service environment and generated runtime files live under
`/home/smile/thnk-dev`. Secrets are mode `0600` files under
`/home/smile/thnk-dev/config`; do not copy them into a repository.

## Start, stop, inspect

SSH to the Ubuntu host and use the one operator command:

```bash
thnk-stack start
thnk-stack status
thnk-stack logs
thnk-stack restart
thnk-stack stop
```

PostgreSQL and Redis remain running when `thnk-stack stop` is used so local
profile data and queue infrastructure stay available. Every THNK unit is
enabled at boot.

An idle outbound Authority is healthy when its systemd unit is active and its
log contains `authority.pull_ready`. Port 9208 opens only after it claims a
session; `server.ready` confirms that session is accepting gameplay clients.

The exported bundle contains two Authority levels but one process owns one
Geckos port. Select which level the development Authority runs, then open a new
match:

```bash
thnk-stack mode ffa
thnk-stack mode duel
thnk-stack mode teams
```

`duel` selects the FFA Authority rules with a two-player queue. It is the
fastest real dedicated-Authority check. The development service may set
`THNK_DEV_AUTO_END_EMPTY_MS` (currently 5000 on the lab host): after the last
connected player leaves, the Authority waits that grace period, sends the
normal `session.ended` lifecycle event, exits, and systemd returns a clean
process to `authority.pull_ready`. The runtime rejects this option unless
registered development-Authority mode is enabled.

This one-at-a-time switch is only a development-host constraint. A production
orchestrator launches each assigned Authority in its own isolated process or
container, so different modes can run concurrently while using the same
Matchmaking service and server artifact.

## Open the Feature Lab

For the real LAN service path, open this URL in a desktop or mobile browser on
the same Wi-Fi:

```text
http://192.168.1.196:8080
```

The certified HTTPS lane uses the following public origins while the Windows
TCP forwarders and the user's HTTPS tunnels are active:

```text
https://app1.solarcal.xyz/cert-social-20260728/
https://app2.solarcal.xyz
https://app3.solarcal.xyz
```

`app1` is the browser export, `app2` is Player Profile, and `app3` is
Matchmaking. Authority addresses are returned to the Client in `match.found`;
Matchmaking never connects into a developer Authority.

Use the immutable `cert-social-20260728` path for this release. The origin root
may retain an older edge-cached GDevelop script even after the Ubuntu files are
replaced; a new immutable path prevents mixed-version HTML and JavaScript.

Open it in four separate browser profiles or private windows. In each window:

1. In a real export, enter an email and password and use the visible Login or
   Register controls. In GDevelop Preview, the four explicit Alice/Bob/Cara/Dora
   persona buttons are also available as test shortcuts.
2. Use the Play, Social, Chat, Leaderboard, Profile, and Diagnostics tabs. The
   lab now provides actual buttons and text fields; keyboard commands are
   retained only as an automation compatibility surface.
3. Matchmaking connects automatically after login. On Play, choose Contact
   Duel for a two-window/two-phone check, or FFA for four Clients. The global
   strip shows the real queue state and `X of Y` roster progress. On mobile,
   use the on-screen directional pad; it sends the same Authority input message
   as desktop arrow keys.
4. Use Social to search/add/remove/block players by unique username, Chat for
   world/direct messages, Profile to edit the public username/avatar, and
   Leaderboard to verify persistent Authority-awarded overlap scores. Private
   account first/last names are never loaded into the game client.
5. To test Teams, run `thnk-stack mode teams`, reconnect the four clients, and
   choose 2v2 Teams on Play.

The development Authority credential is deliberately scoped to the four
Feature Lab identities. Normal registration/login still works for other users,
but those users take the production-orchestrator routing path rather than being
granted access to a developer machine. Add a friend's canonical player ID to
the dev credential only when that access is intentional, then restart
Matchmaking followed by the Authority. Keep the allowlist enabled.

The checked-in GDevelop Preview lane deliberately uses the hosted HTTPS Player
Profile and Matchmaking services (`app2` and `app3`), then connects directly to
the LAN Authority address returned in the signed assignment. This proves the
hosted-backend/local-Authority development workflow. A generated local export
instead defaults to the Ubuntu LAN Player Profile and Matchmaking URLs. The
export script operates on a generated copy and never rewrites the source
project.

Preview, local export, and deployment export are deliberately separate test
lanes. The checked-in project is tagged `gdevelop-preview`; the export script
creates a generated copy tagged `local-export` or `deployment-export`. It never
changes the source project. The current lane and backend addresses are visible
in Diagnostics.

## Opening the GDevelop project

The project is:

```text
C:\Users\Denis\Desktop\WORKSTATION\PROJECTS\THNK\PlayerProfile\gdevelop-test-game\THNK-Test-Game.json
```

Use `Client_FeatureLab` as the ordinary client scene. The `DevAuthority_*` and
`Authority_*` scenes are server roles, not scenes a player should open by hand.
`Solo_FeatureLab` is the explicit in-process local lane and does not replace the
dedicated-Authority test above.

GDevelop embeds extension copies in the project. After changing an extension,
run the Player Profile repository's `feature-lab:sync`, `feature-lab:audit`, and
`feature-lab:export` scripts before treating a browser build as current.

## Current security boundary

The LAN URL is an explicit development shortcut. Player sessions and signed
admission tokens are real, and Player Profile remains fail-closed for the
dedicated Authority. Secure cookies and browser voice require the HTTPS lane;
the short-lived access token is the working browser credential on LAN HTTP.

Agora credentials stay on Matchmaking only. A dedicated Authority pulls one
player-bound grant after signed admission; neither Matchmaking nor the Client
pushes an unsigned grant into the Authority. The HTTPS certification lane has
proved four-client cloud publish/subscribe, mute/unmute, leave/rejoin, and
channel reassignment using synthetic audio. A human audible desktop/Android
conversation remains a separate device check. Missing voice remains a
controlled voice-only state and does not break login, social features,
matchmaking, or gameplay.

## Fast diagnosis

```bash
thnk-stack status
systemctl --no-pager --full status thnk-playerprofile thnk-matchmaking thnk-authority
journalctl --no-pager -u thnk-authority -n 100
```

From another LAN computer, these must answer:

```text
http://192.168.1.196:9400/health/ready
http://192.168.1.196:9300/health/ready
http://192.168.1.196:8080
```
