import "client/ClientLifetimeFunctions";

import { sendClientMessage } from "client/ClientMessageSender";
const messages = { sendClientMessage };
export { messages };

export {
  connectionEventPulsed,
  getConnectionError,
  getConnectionState,
} from "client/ClientConnectionState";
export { startClient, stopClient } from "client/StartClient";
export {
  authorityLatencyUpdated,
  getAuthorityLatencyMs,
} from "client/AuthorityLatency";
