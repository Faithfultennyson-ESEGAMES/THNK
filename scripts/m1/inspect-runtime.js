const WebSocket = require("ws");

const sendCommand = async (debugPort, method, params = {}) => {
  const targets = await fetch(`http://127.0.0.1:${debugPort}/json`).then(
    (response) => response.json()
  );
  const target = targets.find(
    (candidate) =>
      candidate.type === "page" &&
      candidate.url.startsWith("http://127.0.0.1:8080")
  );
  if (!target) throw new Error(`Client page not found on port ${debugPort}.`);

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });

  const response = await new Promise((resolve, reject) => {
    socket.once("message", (data) => resolve(JSON.parse(data.toString())));
    socket.once("error", reject);
    socket.send(
      JSON.stringify({
        id: 1,
        method,
        params,
      })
    );
  });
  socket.close();
  if (response.error) throw new Error(response.error.message);
  return response.result;
};

const evaluate = async (debugPort, expression) => {
  const result = await sendCommand(debugPort, "Runtime.evaluate", {
    expression,
    returnByValue: true,
  });
  if (result?.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result?.result?.value;
};

const inspect = async () => {
  const ports = process.argv.slice(2).map(Number).filter(Number.isFinite);
  const clientPorts = ports.length ? ports : [9222, 9223];
  for (const port of clientPorts) {
    await evaluate(
      port,
      `window.__thnkInspectionInstalled || (
        gdjs.registerRuntimeScenePreEventsCallback(
          runtimeScene => window.__thnkRuntimeScene = runtimeScene
        ),
        window.__thnkInspectionInstalled = true
      )`
    );
  }

  await new Promise((resolve) => setTimeout(resolve, 250));
  for (const port of clientPorts) {
    const result = await evaluate(
      port,
      `(() => {
        const scene = window.__thnkRuntimeScene;
        return {
          state: window.THNK?.client?.getConnectionState?.(),
          scene: scene?.getName(),
          score: scene?.getVariables().get("State").getChild("Score").getAsNumber(),
          players: (scene?.getObjects("Player") || []).map(player => ({
            id: player.thnkID,
            x: player.getX(),
            y: player.getY()
          }))
        };
      })()`
    );
    console.log(`Client ${port}:`, JSON.stringify(result, null, 2));
  }
};

module.exports = { evaluate, sendCommand };

if (require.main === module)
  inspect().catch((error) => {
    console.error(error);
    process.exit(1);
  });
