//@ts-check
const fs = require("fs");
const path = require("path");

const extensionPath = path.resolve(__dirname, "..", "extensions", "THNK.json");
const extension = JSON.parse(fs.readFileSync(extensionPath, "utf8"));

/** @param {string} code */
const inlineEvent = (code) => ({
  type: "BuiltinCommonInstructions::JsCode",
  inlineCode: [code, ""],
  parameterObjects: "",
  useStrict: true,
  eventsSheetExpanded: false,
});
/**
 * @param {{
 *   name: string,
 *   fullName: string,
 *   functionType: "Action" | "Condition" | "Expression" | "StringExpression",
 *   description: string,
 *   sentence?: string,
 *   code: string,
 * }} definition
 */
const upsert = ({
  name,
  fullName,
  functionType,
  description,
  sentence = "",
  code,
}) => {
  const value = {
    description,
    fullName,
    functionType,
    group: "Client connection",
    name,
    sentence,
    events: [inlineEvent(code)],
    parameters: [],
    objectGroups: [],
    ...(functionType === "StringExpression"
      ? { expressionType: { type: "string" } }
      : {}),
  };
  const index = extension.eventsFunctions.findIndex(
    /** @param {{name: string}} entry */ (entry) => entry.name === name
  );
  if (index >= 0) extension.eventsFunctions[index] = value;
  else extension.eventsFunctions.push(value);
};

upsert({
  name: "ConnectingToServer",
  fullName: "Connecting to server",
  functionType: "Condition",
  description:
    "True while the client transport is connecting or waiting for the Authority scene snapshot.",
  sentence: "Connecting to server",
  code:
    "eventsFunctionContext.returnValue = ['connecting', 'loading'].includes(THNK.client.getConnectionState());",
});
upsert({
  name: "ConnectionFailed",
  fullName: "Connection to server failed",
  functionType: "Condition",
  description:
    "True while the latest client-to-Authority connection attempt is in the failed state.",
  sentence: "Connection to the server has failed",
  code:
    "eventsFunctionContext.returnValue = THNK.client.getConnectionState() === 'failed';",
});
upsert({
  name: "ServerConnectionError",
  fullName: "Server connection error code",
  functionType: "StringExpression",
  description:
    "Stable error code for the latest failed or disconnected Authority connection.",
  code:
    "eventsFunctionContext.returnValue = THNK.client.getConnectionError();",
});
upsert({
  name: "AuthorityConnectionStatus",
  fullName: "Authority connection status",
  functionType: "StringExpression",
  description:
    "Current state: disconnected, connecting, loading, connected, or failed.",
  code:
    "eventsFunctionContext.returnValue = THNK.client.getConnectionState();",
});
upsert({
  name: "IsConnectedToServer",
  fullName: "Connected to Authority",
  functionType: "Condition",
  description: "True while the client is connected to an Authority.",
  sentence: "Connected to Authority",
  code:
    "eventsFunctionContext.returnValue = THNK.client.getConnectionState() === 'connected';",
});
for (const [name, fullName, event] of [
  ["ConnectedToServer", "Connected to Authority", "connected"],
  ["DisconnectedFromServer", "Disconnected from Authority", "disconnected"],
  ["ReconnectedToServer", "Reconnected to Authority", "reconnected"],
]) {
  upsert({
    name,
    fullName,
    functionType: "Condition",
    description: `True for the event frame when the client ${event} the Authority.`,
    sentence: fullName,
    code: `eventsFunctionContext.returnValue = THNK.client.connectionEventPulsed(runtimeScene, '${event}');`,
  });
}
upsert({
  name: "AuthorityLatency",
  fullName: "Authority latency",
  functionType: "Expression",
  description:
    "Smoothed live application round-trip latency to the connected Authority in milliseconds.",
  code:
    "eventsFunctionContext.returnValue = THNK.client.getAuthorityLatencyMs();",
});
upsert({
  name: "AuthorityLatencyUpdated",
  fullName: "Authority latency updated",
  functionType: "Condition",
  description:
    "True for the event frame when a new Authority round-trip sample arrives.",
  sentence: "Authority latency updated",
  code:
    "eventsFunctionContext.returnValue = THNK.client.authorityLatencyUpdated(runtimeScene);",
});

fs.writeFileSync(extensionPath, `${JSON.stringify(extension, null, 2)}\n`);
