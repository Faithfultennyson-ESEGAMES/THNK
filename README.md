# 🤔 THNK

![The THNK Framework Banner](./banner.png "He do be thonkin")

An authoritative multiplayer games framework for the FLOSS engine
[GDevelop](https://gdevelop.io/). THNK lets a GDevelop project run its game
logic on a trusted server that owns the authoritative state, while clients send
input and render synchronized objects — so cheating a client cannot change what
actually happened in the match.

> This repository is a **server-platform build of THNK**: the upstream THNK
> framework hardened into a deployable, server-authoritative platform with a
> headless per-match server export, an operator CLI, and two companion backend
> services (identity and matchmaking). It is based on the original
> [THNK by Arthur "arthuro555" Pacaud](https://github.com/arthuro555/THNK) and
> is distributed under the same AGPL-3.0 license. See
> [Upstream & credits](#upstream--credits).

## What this repository provides

The platform is built and verified in milestones (see `DEVLOG.md` and
`docs/project/` for the full record). M0 through M7 plus a dynamic-voice patch
are complete:

- **Authoritative runtime** — the THNK GDevelop extension (`extensions/THNK.json`)
  runs the same game scene as either a dedicated server or a client, with
  server-owned object synchronization, player ownership, and rejection of
  illegal client-side edits (`M1`, `fixtures/m1-remote-authority`).
- **Headless per-match server export** — `bin/thnk.js` exports a GDevelop
  project's server logic into a self-contained bundle and runs it as one
  isolated authority process per session (an Electron renderer kept active on
  a virtual display), instead of requiring a desktop GDevelop preview (`M2`,
  `docs/project/M2-SERVER-EXPORT.md`).
- **Outbound matchmaking bridge** — a signed claim/handoff contract where an
  Authority asks Matchmaking for its assigned session, acknowledges readiness,
  verifies Client-relayed per-player RS256 admission tokens, and sends
  replay-safe lifecycle webhooks. Matchmaking never needs network access to the
  Authority (`M3` plus the outbound-networking patch).
- **In-session voice** — per-player Agora voice grants with dynamic channel
  assignment and server-controlled channel separation within a session (`M4`
  and the dynamic-voice patch, `docs/project/PATCH-DYNAMIC-VOICE-AND-GENERIC-TOOLS.md`).
- **Multi-authority & admission hardening**, **cross-service integration
  hooks**, and a **product-hardening / release-candidate** pass with secret
  scanning, a production dependency audit, and headless smoke gates (`M5`–`M7`).

### The three THNK services

THNK is deliberately split into three independently deployable pieces. This
repository is the first one; the other two live in sibling repositories.

| Service | This repo | Role |
| --- | --- | --- |
| **THNK Core** (here) | `THNK/v1` | The GDevelop framework + the per-match authoritative server exported from a game project. Not always-on: one process per live match. |
| **THNK Player Profile** | `THNK/PlayerProfile` | Always-on identity & durable player data: email/OAuth login, sessions, friends, direct messages, moderation, rankings, achievements. |
| **THNK Matchmaking** | `THNK/Matchmaking` | Always-on queueing, parties, private lobbies, realtime social/chat, and Matchmaking-owned voice grants. |

Core stays a per-match process; Player Profile and Matchmaking are the two
long-running backends it hands off to and trusts through signed contracts.

For local work, `THNK_Local::StartSoloMode` runs the real THNK server and client
stacks in one preview process. A registered dev Authority can instead use a
shared hosted Matchmaking service: Matchmaking returns the dev Authority's
Client-reachable address beside the signed admission token, so no tunnel or
shared LAN with Matchmaking is needed. Production orchestrators provision the
same exported Authority with its production Matchmaking credential; it claims
sessions outbound. Gameplay voice grants are pulled server-to-server only after
admission and are never relayed through the Client.

## Quick start

```bash
yarn install --frozen-lockfile   # installs deps and runs protocol codegen
yarn ts                          # TypeScript typecheck
yarn test                        # jest unit/integration tests
yarn build                       # build THNK + adapters and inject into extensions/
```

Then either import `extensions/THNK.json` into your own GDevelop project, or run
the reference remote-authority fixture end to end:

```bash
yarn build
yarn fixture:m1:validate
yarn fixture:m1:prepare        # generates server/client copies under .generated/
yarn fixture:m1:export-client
```

See `fixtures/m1-remote-authority/README.md` for the full run procedure (one
GDevelop preview as the authority, others as clients) and
`docs/production/README.md` for the supported project-to-production path using
the `thnk server` CLI.

## Documentation

- **`docs/production/`** — the supported deployment path: `README.md`,
  `CONFIGURATION.md`, `COMPATIBILITY.md`, `THREAT-MODEL.md`, `TROUBLESHOOTING.md`.
- **`docs/project/`** — the per-milestone design and verification records
  (`M0-BASELINE.md` … `M7-RELEASE-CANDIDATE.md`, plus the dynamic-voice patch and
  the `adr/` decisions).
- **`DEVLOG.md`** — the chronological implementation log, including the external
  Matchmaking and Player Profile integration gates run against this Core.
- **`THNK-Implementation-Plan.md`**, **`THNK-Server-Platform-Blueprint.md`** —
  the platform plan and blueprint; the sibling services have their own plans
  (`THNK-Matchmaking-Implementation-Plan.md`,
  `THNK-PlayerProfile-Implementation-Plan.md`).
- **`docs/development/FEATURE-LAB-OPERATIONS.md`** contains the Ubuntu
  service/port map, `thnk-stack` commands, GDevelop scene guidance, and the
  four-client cross-service test procedure.
- Upstream framework documentation lives at
  [thnk.cloud/docs](https://thnk.cloud/docs/getting-started/) (concepts and the
  GDevelop-facing API remain compatible with upstream).

## The `thnk` CLI

`bin/thnk.js` is the operator entry point for the exported authority server:

```bash
node ./bin/thnk.js server validate --bundle ./.generated/<m>/server-bundle
node ./bin/thnk.js server run      --bundle ./.generated/<m>/server-bundle
```

`server validate` checks a server bundle's integrity and configuration;
`server run` launches one headless authority process for a session. See
`docs/production/CONFIGURATION.md` for the environment contract (outbound
Matchmaking credential, lifecycle callbacks, Player Profile policy, and Agora
configuration).

## Contributing

### Installing

To install all dependencies, run `yarn`. You may use `npm`, but note that only a
yarn lockfile will be provided and accepted in PRs. If you have disabled
postinstall scripts, run `yarn generate-protocol` to run the code generator on
the flatbuffer files.

### Building

Run `yarn build` to execute the full build pipeline, or build individual parts
with the other `build:*` scripts in `package.json`. `yarn build:thnk` and
`yarn build:adapters` output a bundle to `dist/`; `yarn build:extensions` inserts
those into the THNK extensions in `extensions/`.

To test changes to the GDevelop-facing surface, import the extension into
GDevelop. If you change the extension itself, export it back to the `extensions`
folder before committing.

### Submitting changes

Before submitting a PR, make sure your code builds and fully functions within
the extension and passes both the TypeScript and jest checks: `yarn ts && yarn
test`. Make sure the extensions in `extensions/` are regenerated with the latest
code (`yarn build` if in doubt). For platform/server changes, also run the
relevant `fixture:*` and `ci:*` gates described in `docs/production/README.md`.

### File structure

- `extensions` — the GDevelop extension files. Most logic lives in `code`, but
  the extensions declare the actions/conditions/expressions and embed the built
  THNK bundle.
- `bin` — the `thnk` operator CLI (`thnk.js`).
- `protocol` — FlatBuffers protocol definitions. Anything sent between server and
  client **must** be defined as a FlatBuffer `ServerMessage` or `ClientMessage`;
  run `yarn generate-protocol` after changing them.
- `code` — the THNK extension TypeScript. Imports are relative to this directory
  (`import "server"` → `code/server`). Contains `server`, `client`, `adapters`,
  `types`, and `utils`.
- `fixtures` — runnable reference projects (`m1-remote-authority`).
- `examples` — the deployment `container` and the `stub-matchmaker` used by the
  cross-service gates.
- `scripts` — build, protocol codegen, and the per-milestone fixture/CI scripts.
- `docs` — the docusaurus site plus the `production/` and `project/` docs.
- `types` — GDJS type definitions.

## Upstream & credits

THNK was created by Arthur "arthuro555" Pacaud and its contributors. This
repository builds on that work; the framework concepts, GDevelop integration,
and protocol design originate upstream. Please support the original project:

- [🌐 Website](https://thnk.cloud/)
- [📰 Introduction blog post](https://bit.ly/thnk-introduction)
- [📅 Roadmap](https://bit.ly/thnk-roadmap)
- [💖 Support the project](https://ko-fi.com/arthuro555)
- [📄 Documentation](https://thnk.cloud/docs/getting-started/)

Thanks to all the contributors to THNK!

<!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->
[![All Contributors](https://img.shields.io/badge/all_contributors-8-orange.svg?style=flat-square)](#contributors-)
<!-- ALL-CONTRIBUTORS-BADGE:END -->

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://ko-fi.com/arthuro555"><img src="https://storage.ko-fi.com/cdn/brandasset/kofi_s_logo_nolabel.png?s=100" width="100px;" alt="Ko-fi contributors"/><br /><sub><b>Ko-fi contributors</b></sub></a><br /><a href="#financial" title="Financial">💵</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/arthuro555"><img src="https://avatars.githubusercontent.com/u/19349038?v=4?s=100" width="100px;" alt="Arthur Pacaud"/><br /><sub><b>Arthur Pacaud</b></sub></a><br /><a href="#maintenance-arthuro555" title="Maintenance">🚧</a> <a href="https://github.com/arthuro555/THNK/commits?author=arthuro555" title="Code">💻</a> <a href="https://github.com/arthuro555/THNK/commits?author=arthuro555" title="Documentation">📖</a> <a href="#blog-arthuro555" title="Blogposts">📝</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/MyNameIsRinax"><img src="https://avatars.githubusercontent.com/u/40387061?v=4?s=100" width="100px;" alt="Rinax"/><br /><sub><b>Rinax</b></sub></a><br /><a href="https://github.com/arthuro555/THNK/issues?q=author%3AMyNameIsRinax" title="Bug reports">🐛</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/Midhil457"><img src="https://avatars.githubusercontent.com/u/73597906?v=4?s=100" width="100px;" alt="Leo_Red"/><br /><sub><b>Leo_Red</b></sub></a><br /><a href="#design-Midhil457" title="Design">🎨</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/Entr0py404"><img src="https://avatars.githubusercontent.com/u/75917656?v=4?s=100" width="100px;" alt="Tim"/><br /><sub><b>Tim</b></sub></a><br /><a href="https://github.com/arthuro555/THNK/commits?author=Entr0py404" title="Documentation">📖</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/triloute"><img src="https://avatars.githubusercontent.com/u/45915223?v=4?s=100" width="100px;" alt="triloute"/><br /><sub><b>triloute</b></sub></a><br /><a href="https://github.com/arthuro555/THNK/commits?author=triloute" title="Documentation">📖</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://discord.io/wemg"><img src="https://avatars.githubusercontent.com/u/67420178?v=4?s=100" width="100px;" alt="Emily Lemonly"/><br /><sub><b>Emily Lemonly</b></sub></a><br /><a href="https://github.com/arthuro555/THNK/commits?author=EmilyLemonly" title="Documentation">📖</a></td>
    </tr>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/dartpk"><img src="https://avatars.githubusercontent.com/u/84038852?v=4?s=100" width="100px;" alt="dartpk"/><br /><sub><b>dartpk</b></sub></a><br /><a href="https://github.com/arthuro555/THNK/issues?q=author%3Adartpk" title="Bug reports">🐛</a> <a href="https://github.com/arthuro555/THNK/commits?author=dartpk" title="Code">💻</a></td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

## License

THNK is licensed under AGPL-3.0-only. Copyright (C) 2023 Arthur "arthuro555"
Pacaud and contributors. See `LICENSE.md`.
