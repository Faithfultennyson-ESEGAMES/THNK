import { clearMessages } from "server/ClientMessagesQueue";

export const closeServer = (runtimeScene: gdjs.RuntimeScene) => {
  if (!runtimeScene.thnkServer) return;
  runtimeScene.thnkServer.adapter.close();
  runtimeScene.thnkServer.playerManager.clear();
  clearMessages();
  delete runtimeScene.thnkServer;
};
