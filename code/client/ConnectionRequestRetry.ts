import { type ClientAdapter } from "adapters/Adapter";
import { sendConnectionRequest } from "client/ClientMessageSender";

export const startConnectionRequestRetry = (
  adapter: ClientAdapter,
  retryInterval = 500
) => {
  const requestConnection = () => sendConnectionRequest(adapter);
  requestConnection();
  const intervalID = setInterval(requestConnection, retryInterval);
  return () => clearInterval(intervalID);
};
