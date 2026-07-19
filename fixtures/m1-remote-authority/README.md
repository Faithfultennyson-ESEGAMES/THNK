# M1 remote-authority fixture

This project is the smallest THNK authority proof: two Geckos clients connect to
one dedicated GDevelop preview, each connection owns one synchronized `Player`,
and the server alone changes `State.Score` and accepted player movement.

## Prepare

Build the repository, then generate server/client copies with the current local
extensions:

```text
yarn build
yarn fixture:m1:validate
yarn fixture:m1:prepare
yarn fixture:m1:export-client
```

Set `GDEVELOP_BIN` when GDevelop is not on `PATH`. The prepared projects are
written under `.generated/m1/` and deliberately ignored by Git because each one
embeds the generated extensions.

## Run as separate local processes

1. Open `.generated/m1/server/game.json` in GDevelop and preview
   `ServerBootstrap`. Keep that desktop preview running; it listens on UDP/TCP
   port `9208` and loads `Authority` in dedicated mode.
2. Either open `.generated/m1/client/game.json` in a second GDevelop process and
   start two independent previews of `ClientBootstrap`, or run
   `yarn fixture:m1:serve-client` and open `http://127.0.0.1:8080` in two
   independent browser windows.
3. Each client should show the same two `PLAYER` objects and `State.Score` is 2.
4. Hold Right in either client. Only its owned player moves, and both clients
   observe the same position.
5. Hold Space in a client. This intentionally performs illegal local X and
   `State.Score` edits; the next client lifecycle boundary restores both to the
   authoritative values and the other client never observes either edit.
6. Close one client normally. Its player disappears and score becomes 1. Start
   that client again to exercise reconnect; the player returns and score becomes 2.
7. End a client process abruptly. The remaining client stays connected, the
   departed player disappears, and score becomes 1 without a server crash.
8. Close the server preview. Both clients transition to disconnected and port
   9208 becomes available for an immediate server restart.

For a second-machine check, set the server machine's reachable host while
preparing the generated copies, then export the client and repeat the test:

```text
THNK_FIXTURE_SERVER_HOST=192.168.1.50 yarn fixture:m1:prepare
yarn fixture:m1:export-client
```

Allow port 9208 through the development firewall when one is active. The
tracked fixture remains configured for `127.0.0.1`; the override affects only
the ignored generated client copy.

For an automated local check, launch two Chrome instances with remote debugging
ports 9222 and 9223, then run `yarn fixture:m1:runtime-check`. It verifies join,
authoritative movement, rejection of a local position edit, and abrupt client
cleanup. The check intentionally closes the client on port 9223.

The server remains a GDevelop desktop preview in M1 because the inherited
Geckos server adapter requires Electron. M2 replaces that launch step with the
headless server export CLI.

## Run through the M2 artifact

```text
yarn fixture:m2:export
yarn fixture:m2:validate
cd .generated/m2/server-bundle
yarn install --frozen-lockfile --production=true --non-interactive
cd ../../..
yarn thnk server run --bundle .generated/m2/server-bundle
```

With the server running, `yarn fixture:m2:multi-client` performs the automated
eight-client join, ownership, selective-disconnect, and reconnect check. The
server uses a hidden Electron renderer rather than a visible GDevelop preview.
Set `THNK_M2_CLIENTS=16` to repeat the same lifecycle proof with 16 isolated
clients. See `docs/project/M2-SERVER-EXPORT.md` for the validated Ubuntu/Xvfb
setup, guarantees, and capacity boundary.
