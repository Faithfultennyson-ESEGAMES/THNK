const { EventEmitter } = require("events");
const {
  DevEmptySessionController,
} = require("../../scripts/m2/runtime/dev-empty-session.cjs");

afterEach(() => {
  jest.useRealTimers();
});

test("development Authority ends an empty completed session after a reconnect grace", async () => {
  jest.useFakeTimers();
  const sessionManager = new EventEmitter();
  const state = {
    sessionId: "session-dev",
    status: "active",
    connectedPlayers: [],
  };
  sessionManager.getPublicState = () => state;
  const shutdown = jest.fn(async () => {});
  const logger = { info: jest.fn() };
  const controller = new DevEmptySessionController({
    enabled: true,
    timeoutMs: 5_000,
    sessionManager,
    shutdown,
    logger,
  });
  controller.start();

  sessionManager.emit("players-drained");
  await jest.advanceTimersByTimeAsync(4_000);
  expect(shutdown).not.toHaveBeenCalled();

  state.connectedPlayers = ["alice"];
  sessionManager.emit("player-connected");
  await jest.advanceTimersByTimeAsync(2_000);
  expect(shutdown).not.toHaveBeenCalled();

  state.connectedPlayers = [];
  sessionManager.emit("players-drained");
  await jest.advanceTimersByTimeAsync(5_000);
  expect(shutdown).toHaveBeenCalledWith("dev_players_drained");
  expect(logger.info).toHaveBeenCalledWith(
    "dev.session_empty_shutdown",
    { sessionId: "session-dev" }
  );
  controller.stop();
});

test("production and explicitly disabled Authorities never install the empty-session policy", async () => {
  jest.useFakeTimers();
  const sessionManager = new EventEmitter();
  sessionManager.getPublicState = () => ({
    sessionId: "session-production",
    status: "active",
    connectedPlayers: [],
  });
  const shutdown = jest.fn();
  const controller = new DevEmptySessionController({
    enabled: false,
    timeoutMs: 1_000,
    sessionManager,
    shutdown,
    logger: { info: jest.fn() },
  });
  controller.start();
  sessionManager.emit("players-drained");
  await jest.advanceTimersByTimeAsync(2_000);
  expect(shutdown).not.toHaveBeenCalled();
});
