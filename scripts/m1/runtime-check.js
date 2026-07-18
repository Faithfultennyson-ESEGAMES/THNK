const assert = require("assert");
const { evaluate, sendCommand } = require("./inspect-runtime");

const clientPorts = [9222, 9223];
const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
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
        scene: scene?.getName(),
        score: scene?.getVariables().get("State").getChild("Score").getAsNumber(),
        players: (scene?.getObjects("Player") || []).map(player => ({
          id: player.thnkID,
          x: player.getX(),
          y: player.getY()
        })).sort((left, right) => left.id - right.id)
      };
    })()`
  );
const waitFor = async (read, predicate, description, timeout = 10_000) => {
  const deadline = Date.now() + timeout;
  let value;
  do {
    value = await read();
    if (predicate(value)) return value;
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error(
    `Timed out waiting for ${description}: ${JSON.stringify(value)}`
  );
};
const setKey = (port, isPressed, keyCode) =>
  evaluate(
    port,
    `window.__thnkRuntimeScene.getGame().getInputManager().${
      isPressed ? "onKeyPressed" : "onKeyReleased"
    }(${keyCode})`
  );

(async () => {
  await Promise.all(clientPorts.map(installInspector));
  const initial = await Promise.all(
    clientPorts.map((port) =>
      waitFor(
        () => snapshot(port),
        (value) =>
          value.connection === "connected" &&
          value.scene === "Authority" &&
          value.score === 2 &&
          value.players.length === 2,
        `client ${port} to join the two-player authority world`
      )
    )
  );
  assert.deepStrictEqual(initial[0], initial[1]);

  await setKey(9222, true, 39);
  await delay(350);
  await setKey(9222, false, 39);
  const moved = await waitFor(
    () => Promise.all(clientPorts.map(snapshot)),
    ([client1, client2]) =>
      JSON.stringify(client1) === JSON.stringify(client2) &&
      client1.players.some(
        (player, index) => player.x > initial[0].players[index].x
      ),
    "server-authoritative movement to converge on both clients"
  );
  assert.strictEqual(moved[0].score, 2);

  const beforeCheat = moved[1];
  await setKey(9222, true, 32);
  await delay(250);
  await setKey(9222, false, 32);
  const afterCheat = await waitFor(
    () => Promise.all(clientPorts.map(snapshot)),
    ([client1, client2]) => JSON.stringify(client1) === JSON.stringify(client2),
    "illegal local position and score edits to be overwritten"
  );
  assert.strictEqual(afterCheat[1].score, beforeCheat.score);
  afterCheat[1].players.forEach((player, index) =>
    assert.ok(
      player.x < beforeCheat.players[index].x + 1000,
      "A client-local 1000px edit escaped into authoritative state."
    )
  );

  await sendCommand(9223, "Browser.close");
  const afterDisconnect = await waitFor(
    () => snapshot(9222),
    (value) => value.score === 1 && value.players.length === 1,
    "abrupt disconnect cleanup",
    45_000
  );

  console.log(
    JSON.stringify(
      {
        initial: initial[0],
        afterMovement: moved[0],
        afterDisconnect,
      },
      null,
      2
    )
  );
  console.log("M1 two-client authority and disconnect checks passed.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
