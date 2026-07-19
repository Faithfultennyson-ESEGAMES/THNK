const assert = require("assert");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { evaluate, sendCommand } = require("../m1/inspect-runtime");

const repositoryRoot = path.resolve(__dirname, "../..");
const clientCount = Number(process.env.THNK_M2_CLIENTS || 8);
const debugPorts = Array.from(
  { length: clientCount },
  (_, index) => 9320 + index
);
const chromePath =
  process.env.CHROME_BIN ||
  "C:/Program Files/Google/Chrome/Application/chrome.exe";
const generatedRoot = path.join(repositoryRoot, ".generated/m2/multi-client");
const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

if (!Number.isInteger(clientCount) || clientCount < 3 || clientCount > 32)
  throw new Error("THNK_M2_CLIENTS must be an integer from 3 to 32.");
if (!fs.existsSync(chromePath))
  throw new Error(`Chrome executable not found: ${chromePath}`);
if (
  !fs.existsSync(
    path.join(repositoryRoot, ".generated/m1/client/build/index.html")
  )
)
  throw new Error("Run yarn fixture:m1:export-client before this check.");

const waitFor = async (read, predicate, description, timeout = 60_000) => {
  const deadline = Date.now() + timeout;
  let value;
  do {
    try {
      value = await read();
      if (predicate(value)) return value;
    } catch {}
    await delay(200);
  } while (Date.now() < deadline);
  throw new Error(
    `Timed out waiting for ${description}: ${JSON.stringify(value)}`
  );
};

const installInspector = (port) =>
  evaluate(
    port,
    `window.__thnkInspectionInstalled || (
      gdjs.registerRuntimeScenePreEventsCallback(
        runtimeScene => window.__thnkRuntimeScene = runtimeScene
      ),
      window.__thnkInspectionInstalled = true
    )`
  );

const snapshot = (port) =>
  evaluate(
    port,
    `(() => {
      const scene = window.__thnkRuntimeScene;
      return {
        connection: window.THNK?.client?.getConnectionState?.(),
        score: scene?.getVariables().get("State").getChild("Score").getAsNumber(),
        players: (scene?.getObjects("Player") || []).map(player => ({
          id: player.thnkID,
          x: player.getX(),
          y: player.getY()
        })).sort((left, right) => left.id - right.id)
      };
    })()`
  );

const setKey = (port, isPressed, keyCode) =>
  evaluate(
    port,
    `window.__thnkRuntimeScene.getGame().getInputManager().${
      isPressed ? "onKeyPressed" : "onKeyReleased"
    }(${keyCode})`
  );

const assertConverged = (snapshots, expectedPlayers) => {
  const canonical = JSON.stringify(snapshots[0]);
  snapshots.forEach((value) =>
    assert.strictEqual(JSON.stringify(value), canonical)
  );
  assert.strictEqual(snapshots[0].connection, "connected");
  assert.strictEqual(snapshots[0].score, expectedPlayers);
  assert.strictEqual(snapshots[0].players.length, expectedPlayers);
  assert.strictEqual(
    new Set(snapshots[0].players.map((player) => player.id)).size,
    expectedPlayers,
    "Synchronized object IDs must be unique."
  );
};

const launchClient = async (port, generation) => {
  const profile = path.join(generatedRoot, `client-${port}-${generation}`);
  spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--disable-background-networking",
      "--no-first-run",
      "--remote-allow-origins=*",
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      "http://127.0.0.1:8080",
    ],
    { detached: false, stdio: "ignore" }
  ).unref();
  await waitFor(
    () => fetch(`http://127.0.0.1:${port}/json/version`),
    (response) => response.ok,
    `Chrome client ${port}`
  );
  await waitFor(
    () =>
      evaluate(
        port,
        "typeof gdjs?.registerRuntimeScenePreEventsCallback === 'function'"
      ),
    Boolean,
    `GDevelop runtime in client ${port}`
  );
  await installInspector(port);
};

const closeClient = async (port) => {
  try {
    await sendCommand(port, "Browser.close");
  } catch {}
  await waitFor(
    async () => {
      try {
        await fetch(`http://127.0.0.1:${port}/json/version`);
        return false;
      } catch {
        return true;
      }
    },
    Boolean,
    `Chrome client ${port} to close`,
    20_000
  );
};

const waitForWorld = (ports, expectedPlayers) =>
  waitFor(
    () => Promise.all(ports.map(snapshot)),
    (snapshots) => {
      try {
        assertConverged(snapshots, expectedPlayers);
        return true;
      } catch {
        return false;
      }
    },
    `${ports.length} clients to converge on ${expectedPlayers} players`
  );

const assertSingleOwnerMoves = async (ports, controllingPort) => {
  const before = await waitForWorld(ports, ports.length);
  await setKey(controllingPort, true, 39);
  await delay(180);
  await setKey(controllingPort, false, 39);
  const after = await waitFor(
    () => Promise.all(ports.map(snapshot)),
    (snapshots) => {
      try {
        assertConverged(snapshots, ports.length);
        const changed = snapshots[0].players.filter(
          (player, index) => player.x !== before[0].players[index].x
        );
        return changed.length === 1;
      } catch {
        return false;
      }
    },
    `only client ${controllingPort}'s owned player to move`
  );
  return after[0];
};

(async () => {
  fs.mkdirSync(generatedRoot, { recursive: true });
  const clientServer = spawn(
    process.execPath,
    [path.join(repositoryRoot, "scripts/m1/serve-client.js")],
    { cwd: repositoryRoot, stdio: "ignore" }
  );

  try {
    await waitFor(
      () => fetch("http://127.0.0.1:8080"),
      (response) => response.ok,
      "the exported client HTTP server"
    );
    await Promise.all(debugPorts.map((port) => launchClient(port, 0)));
    const initial = await waitForWorld(debugPorts, clientCount);
    await assertSingleOwnerMoves(debugPorts, debugPorts[0]);

    const closingPorts = debugPorts.filter((_, index) => index % 2 === 1);
    const remainingPorts = debugPorts.filter((_, index) => index % 2 === 0);
    await Promise.all(closingPorts.map(closeClient));
    const afterDisconnect = await waitForWorld(
      remainingPorts,
      remainingPorts.length
    );
    const initialIDs = new Set(initial[0].players.map((player) => player.id));
    afterDisconnect[0].players.forEach((player) =>
      assert.ok(
        initialIDs.has(player.id),
        "A surviving player changed identity."
      )
    );

    await Promise.all(closingPorts.map((port) => launchClient(port, 1)));
    const afterReconnect = await waitForWorld(debugPorts, clientCount);
    await assertSingleOwnerMoves(debugPorts, closingPorts[0]);

    console.log(
      JSON.stringify(
        {
          clients: clientCount,
          initialObjectIDs: initial[0].players.map((player) => player.id),
          survivingObjectIDs: afterDisconnect[0].players.map(
            (player) => player.id
          ),
          reconnectedObjectIDs: afterReconnect[0].players.map(
            (player) => player.id
          ),
        },
        null,
        2
      )
    );
    console.log("M2 multi-client identity and reconnect check passed.");
  } finally {
    await Promise.all(debugPorts.map(closeClient));
    clientServer.kill();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
