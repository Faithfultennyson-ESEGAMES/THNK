import {
  GameStateUpdateMessage,
  ResumePreviousSceneMessage,
  SceneSwitchMessage,
  ServerMessageContent,
  ServerPongMessage,
} from "t-h-n-k";
import { applyGameStateSnapshotToScene } from "client/ApplyGameStateSnapshot";
import { applySceneUpdateToScene } from "client/ApplySceneUpdate";
import { THNKClientContext } from "./THNKClientContext";
import { loadScene, pauseScene } from "utils/LoadScene";
import { sendClientMessage } from "client/ClientMessageSender";
import { AUTHORITATIVE_EDIT_MESSAGE } from "utils/TrustProtocol";
import {
  acceptAuthorityLatencyPong,
  maybeSendAuthorityLatencyProbe,
} from "client/AuthorityLatency";

const logger = new gdjs.Logger("THNK - Client");
const runClientTickPreEvent = async (runtimeScene: gdjs.RuntimeScene) => {
  if (!runtimeScene.thnkClient) return;
  const { adapter } = runtimeScene.thnkClient;
  const game = runtimeScene.getGame();
  maybeSendAuthorityLatencyProbe(adapter);
  for (const message of adapter.getPendingMessages()) {
    const messageType = message.contentType();
    switch (messageType) {
      case ServerMessageContent.ConnectionStartMessage:
        logger.warn(
          "A second ConnectionStartMessage was received from the server. This is likely a bug, please open an issue on the THNK GitHub!"
        );
        continue;
      case ServerMessageContent.GameStateUpdateMessage:
        const gameStateUpdateMessage = message.content(
          new GameStateUpdateMessage()
        ) as GameStateUpdateMessage;
        const scene = gameStateUpdateMessage.scene();
        if (scene) applySceneUpdateToScene(scene, runtimeScene);
        continue;
      case ServerMessageContent.SceneSwitchMessage:
        const sceneSwitchMessage = message.content(
          new SceneSwitchMessage()
        ) as SceneSwitchMessage;
        const sceneName = sceneSwitchMessage.sceneName();
        if (!sceneName) {
          console.error(
            "Server requested scene switch, but no scene name was sent! This is likely a bug, please open an issue on the THNK GitHub!"
          );
          continue;
        }

        const newScene = await (sceneSwitchMessage.isPause()
          ? pauseScene(game, sceneName)
          : loadScene(game, sceneName));

        //newScene.thnkClient = runtimeScene.thnkClient; //runtimeScene.thnkClient holds the old scene
        newScene.thnkClient = new THNKClientContext(
          runtimeScene.thnkClient!.adapter,
          newScene
        );

        // Make sure next messages are applied to the new scene.
        runtimeScene = newScene;

        continue;
      case ServerMessageContent.ResumePreviousSceneMessage:
        const resumedSceneMessage = message.content(
          new ResumePreviousSceneMessage()
        ) as ResumePreviousSceneMessage;

        const resumedSceneName = resumedSceneMessage.name();
        const resumedScene = resumedSceneName
          ? await loadScene(game, resumedSceneName)
          : game.getSceneStack().pop();

        if (!resumedScene) continue;

        const resumedSceneSnapshot = resumedSceneMessage.snapshot();
        if (resumedSceneSnapshot) {
          applyGameStateSnapshotToScene(resumedSceneSnapshot, resumedScene);
        }

        // In the case the scene was just created it is necessary to keep it in client mode.
        resumedScene.thnkClient = new THNKClientContext(
          runtimeScene.thnkClient!.adapter,
          resumedScene
        );

        // Make sure next messages are applied to the new scene.
        runtimeScene = resumedScene;

        continue;
      case ServerMessageContent.ServerPongMessage:
        const pong = message.content(new ServerPongMessage()) as ServerPongMessage;
        acceptAuthorityLatencyPong(pong.sentAt());
        continue;
      default:
        logger.error(
          `Received message with unknown type '${message.contentType()}'`
        );
    }
  }

  adapter.markPendingMessagesAsRead();
  runtimeScene.thnkClient?.captureAuthoritativeState();
};

const restoreAuthoritativeStatePostEvent = (
  runtimeScene: gdjs.RuntimeScene
) => {
  if (runtimeScene.thnkClient?.consumeAuthoritativeEditViolation())
    sendClientMessage(
      runtimeScene.thnkClient.adapter,
      AUTHORITATIVE_EDIT_MESSAGE,
      new gdjs.Variable()
    );
  runtimeScene.thnkClient?.restoreAuthoritativeState();
};

gdjs.registerRuntimeScenePreEventsCallback(runClientTickPreEvent);
gdjs.registerRuntimeScenePostEventsCallback(restoreAuthoritativeStatePostEvent);
