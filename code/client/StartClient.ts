import { type ClientAdapter } from "adapters/Adapter";
import {
  ServerMessage,
  ServerMessageContent,
  ConnectionStartMessage,
} from "t-h-n-k";
import { applyGameStateSnapshotToScene } from "client/ApplyGameStateSnapshot";
import { setConnectionState } from "client/ClientConnectionState";
import { THNKClientContext } from "client/THNKClientContext";
import { loadScene } from "utils/LoadScene";
import { startConnectionRequestRetry } from "client/ConnectionRequestRetry";

const logger = new gdjs.Logger("THNK - Client");
const fail = (reason: string) => {
  setConnectionState("failed");
  logger.error("Connection failed: " + reason);
};

export const startClient = async (
  runtimeScene: gdjs.RuntimeScene,
  adapter: ClientAdapter
) => {
  setConnectionState("connecting");
  const sceneStack = runtimeScene.getGame().getSceneStack();
  try {
    await adapter.prepare(runtimeScene);
  } catch {
    adapter.close();
    fail("Adapter crashed while connecting to the server!");
    // Abort client startup
    return;
  }

  setConnectionState("loading");
  const stopConnectionRequestRetry = startConnectionRequestRetry(adapter);

  const intervalID = setInterval(async () => {
    const message = (adapter.getPendingMessages() as ServerMessage[]).shift();
    if (!message) return;
    const messageType = message.contentType();
    if (messageType === ServerMessageContent.ConnectionStartMessage) {
      clearInterval(intervalID);
      stopConnectionRequestRetry();
      const connectionStartMessage = message.content(
        new ConnectionStartMessage()
      ) as ConnectionStartMessage;

      const sceneName = connectionStartMessage.sceneName();
      const sceneSnapshot = connectionStartMessage.sceneSnapshot();
      if (!sceneName || !sceneSnapshot) {
        adapter.close();
        fail(
          "Server Connection Start Message was invalid, couldn't finish setting up the connection."
        );
        return;
      }

      const newScene = await loadScene(runtimeScene.getGame(), sceneName);
      newScene.thnkClient = new THNKClientContext(adapter, newScene);

      applyGameStateSnapshotToScene(sceneSnapshot, newScene);

      setConnectionState("connected");
    }
  }, 100);
};
