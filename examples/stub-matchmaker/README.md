# THNK development stub

This is a local-only stand-in for the future THNK Matchmaking and THNK Player
Profile repositories. It starts sessions, issues short-lived per-player RS256
admission JWTs, verifies signed lifecycle callbacks, and serves in-memory
blocked/document endpoints. It is not an account system, durable database, or
production matchmaker.

Run it after starting an exported bridge bundle:

```text
set THNK_CONTROL_TOKEN=<32+ random characters>
set THNK_WEBHOOK_SECRET=<different 32+ random characters>
set THNK_PLAYER_PROFILE_TOKEN=<different 32+ random characters>
node examples/stub-matchmaker/server.cjs .generated/m7/server-bundle/manifest.json
```

Set `THNK_CLIENT_BUILD=.generated/m7/client/build` to have the stub serve the
exported client and inject a fresh admission token into each returned `/play`
URL. Without it, `/start` returns JSON `/join` URLs instead.

Configure the bundle with the same three values plus:

```text
THNK_AUTHORITY_ID=duel
THNK_BRIDGE_ENABLED=true
THNK_PLAYER_PROFILE_URL=http://127.0.0.1:9210/
THNK_ALLOW_INSECURE_CALLBACKS=true
THNK_ALLOW_INSECURE_PLAYER_PROFILE_URL=true
```

Then create and inspect a session:

```text
curl -X POST http://127.0.0.1:9210/start -H "content-type: application/json" -d "{\"players\":[\"alice\",\"bob\"]}"
curl http://127.0.0.1:9210/join?playerId=alice
curl http://127.0.0.1:9210/state
curl -X POST http://127.0.0.1:9210/end
```

Use PowerShell's `Invoke-RestMethod` equivalents on Windows if `curl` is not
available. Admission tokens are deliberately returned only by `/join`; never
place the control, webhook, or Player Profile service credentials in a client.
