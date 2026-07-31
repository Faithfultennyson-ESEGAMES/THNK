import { type ClientAdapter } from "adapters/Adapter";
import {
  ServerMessage,
  ServerMessageContent,
  ConnectionStartMessage,
} from "t-h-n-k";
import { applyGameStateSnapshotToScene } from "client/ApplyGameStateSnapshot";
import {
  getConnectionState,
  setConnectionState,
} from "client/ClientConnectionState";
import { THNKClientContext } from "client/THNKClientContext";
import { loadScene } from "utils/LoadScene";
import { startConnectionRequestRetry } from "client/ConnectionRequestRetry";
import { resetAuthorityLatency } from "client/AuthorityLatency";

const logger = new gdjs.Logger("THNK - Client");
let activeAdapter: ClientAdapter | undefined;
let startupGeneration = 0;
let stopStartup: (() => void) | undefined;

const clearStartup = () => {
  stopStartup?.();
  stopStartup = undefined;
};

const fail = (reason: string) => {
  clearStartup();
  activeAdapter = undefined;
  setConnectionState("failed", reason);
  logger.error("Connection failed: " + reason);
};

export const stopClient = (runtimeScene: gdjs.RuntimeScene): boolean => {
  const adapter = runtimeScene.thnkClient?.adapter || activeAdapter;
  startupGeneration += 1;
  clearStartup();
  if (runtimeScene.thnkClient) delete runtimeScene.thnkClient;
  if (adapter) {
    adapter.markPendingMessagesAsRead();
    adapter.close();
  }
  activeAdapter = undefined;
  resetAuthorityLatency();
  setConnectionState("disconnected", "client_stopped");
  return Boolean(adapter);
};

export const startClient = async (
  runtimeScene: gdjs.RuntimeScene,
  adapter: ClientAdapter
) => {
  const connectionState = getConnectionState();
  if (
    connectionState === "connecting" ||
    connectionState === "loading" ||
    connectionState === "connected"
  ) {
    adapter.close();
    logger.warn(
      `Ignored duplicate client start while connection state is ${connectionState}.`
    );
    return;
  }
  if (activeAdapter && activeAdapter !== adapter) activeAdapter.close();
  activeAdapter = adapter;
  const generation = ++startupGeneration;
  clearStartup();
  setConnectionState("connecting");
  try {
    await adapter.prepare(runtimeScene);
  } catch {
    if (generation !== startupGeneration) return;
    adapter.close();
    fail("Adapter crashed while connecting to the server!");
    // Abort client startup
    return;
  }
  if (generation !== startupGeneration) {
    adapter.close();
    return;
  }

  setConnectionState("loading");
  const stopConnectionRequestRetry = startConnectionRequestRetry(adapter);

  const intervalID = setInterval(async () => {
    if (generation !== startupGeneration) return;
    const message = (adapter.getPendingMessages() as ServerMessage[]).shift();
    if (!message) return;
    const messageType = message.contentType();
    if (messageType === ServerMessageContent.ConnectionStartMessage) {
      clearStartup();
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
  stopStartup = () => {
    clearInterval(intervalID);
    stopConnectionRequestRetry();
  };
};
