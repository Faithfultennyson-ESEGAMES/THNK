import fs from "fs";
import path from "path";

type ExtensionFunction = {
  name: string;
  events: Array<{ inlineCode?: string | string[] }>;
};

const extension = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../extensions/THNK.json"), "utf8")
) as { eventsFunctions: ExtensionFunction[] };

const codeFor = (name: string) => {
  const entry = extension.eventsFunctions.find((value) => value.name === name);
  expect(entry).toBeDefined();
  const inlineCode = entry!.events[0]?.inlineCode;
  expect(inlineCode).toBeDefined();
  return Array.isArray(inlineCode) ? inlineCode.join("\n") : inlineCode!;
};

const run = (name: string, runtimeScene: object = {}) => {
  const context = { returnValue: undefined as unknown };
  new Function("runtimeScene", "eventsFunctionContext", codeFor(name))(
    runtimeScene,
    context
  );
  return context.returnValue;
};

test("GDevelop wrappers expose the complete Authority connection lifecycle", () => {
  const pulses: string[] = [];
  (globalThis as any).THNK = {
    client: {
      getConnectionState: () => "connected",
      getConnectionError: () => "transport_closed",
      connectionEventPulsed: (_scene: unknown, event: string) => {
        pulses.push(event);
        return event === "reconnected";
      },
      getAuthorityLatencyMs: () => 42,
      authorityLatencyUpdated: () => true,
    },
  };

  expect(run("IsConnectedToServer")).toBe(true);
  expect(run("ConnectingToServer")).toBe(false);
  expect(run("ConnectionFailed")).toBe(false);
  expect(run("AuthorityConnectionStatus")).toBe("connected");
  expect(run("ServerConnectionError")).toBe("transport_closed");
  expect(run("ConnectedToServer")).toBe(false);
  expect(run("DisconnectedFromServer")).toBe(false);
  expect(run("ReconnectedToServer")).toBe(true);
  expect(pulses).toEqual(["connected", "disconnected", "reconnected"]);
  expect(run("AuthorityLatency")).toBe(42);
  expect(run("AuthorityLatencyUpdated")).toBe(true);
});
