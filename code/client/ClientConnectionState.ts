export type ClientConnectionState =
  | "disconnected"
  | "connecting"
  | "loading"
  | "connected"
  | "failed";

type ConnectionEvent = "connected" | "disconnected" | "reconnected" | "failed";

let currentState: ClientConnectionState = "disconnected";
let lastError = "";
let hasConnected = false;
const generations: Record<ConnectionEvent, number> = {
  connected: 0,
  disconnected: 0,
  reconnected: 0,
  failed: 0,
};
const observations = new WeakMap<
  gdjs.RuntimeScene,
  Partial<Record<ConnectionEvent, { generation: number; frame: number }>>
>();

export const setConnectionState = (
  newState: ClientConnectionState,
  error = ""
) => {
  const previousState = currentState;
  currentState = newState;
  if (newState === "failed") {
    lastError = error || "connection_failed";
    generations.failed += 1;
    return;
  }
  if (newState === "connecting") lastError = "";
  if (newState === "connected" && previousState !== "connected") {
    const event = hasConnected ? "reconnected" : "connected";
    hasConnected = true;
    generations[event] += 1;
  }
  if (
    newState === "disconnected" &&
    previousState !== "disconnected" &&
    previousState !== "failed"
  ) {
    lastError = error || "transport_disconnected";
    generations.disconnected += 1;
  }
};

export const getConnectionState = () => currentState;
export const getConnectionError = () => lastError;

export const connectionEventPulsed = (
  runtimeScene: gdjs.RuntimeScene,
  event: ConnectionEvent
): boolean => {
  let sceneObservations = observations.get(runtimeScene);
  if (!sceneObservations) {
    sceneObservations = {};
    observations.set(runtimeScene, sceneObservations);
  }
  const frame = runtimeScene.getTimeManager().getTimeFromStart();
  const currentGeneration = generations[event];
  const observed = sceneObservations[event];
  if (!observed || observed.generation < currentGeneration) {
    sceneObservations[event] = {
      generation: currentGeneration,
      frame,
    };
    return currentGeneration > 0;
  }
  return observed.frame === frame && currentGeneration > 0;
};

export const resetConnectionStateForTests = () => {
  currentState = "disconnected";
  lastError = "";
  hasConnected = false;
  for (const event of Object.keys(generations) as ConnectionEvent[])
    generations[event] = 0;
};
