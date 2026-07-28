import {
  connectionEventPulsed,
  getConnectionError,
  getConnectionState,
  resetConnectionStateForTests,
  setConnectionState,
} from "client/ClientConnectionState";

const sceneAt = (time: number) =>
  ({
    getTimeManager: () => ({ getTimeFromStart: () => time }),
  }) as gdjs.RuntimeScene;

beforeEach(resetConnectionStateForTests);

test("connection lifecycle distinguishes first connection from reconnection", () => {
  let frame = 100;
  const runtimeScene = {
    getTimeManager: () => ({ getTimeFromStart: () => frame }),
  } as gdjs.RuntimeScene;
  setConnectionState("connecting");
  setConnectionState("connected");
  expect(getConnectionState()).toBe("connected");
  expect(connectionEventPulsed(runtimeScene, "connected")).toBe(true);
  expect(connectionEventPulsed(runtimeScene, "connected")).toBe(true);

  setConnectionState("disconnected", "network_lost");
  frame = 200;
  expect(connectionEventPulsed(runtimeScene, "disconnected")).toBe(true);
  expect(getConnectionError()).toBe("network_lost");

  setConnectionState("connecting");
  setConnectionState("connected");
  frame = 300;
  expect(connectionEventPulsed(runtimeScene, "reconnected")).toBe(true);
  expect(connectionEventPulsed(runtimeScene, "connected")).toBe(false);
  expect(getConnectionError()).toBe("");
});

test("failed connection exposes a stable error and event", () => {
  setConnectionState("connecting");
  setConnectionState("failed", "admission_rejected");
  const frame = sceneAt(100);
  expect(getConnectionState()).toBe("failed");
  expect(getConnectionError()).toBe("admission_rejected");
  expect(connectionEventPulsed(frame, "failed")).toBe(true);
});
