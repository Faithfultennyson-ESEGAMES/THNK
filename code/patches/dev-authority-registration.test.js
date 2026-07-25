const {
  DevAuthorityRegistration,
} = require("../../scripts/m2/runtime/dev-authority-registration.cjs");

const registration = {
  authorityId: "feature-lab-ffa",
  modeId: "feature-lab-ffa",
  serverBuildId: `sha256:${"a".repeat(64)}`,
  compatibilityVersion: "m7-v1",
  clientBuildId: "feature-lab-client-1",
  protocolVersion: "thnk-flatbuffers-v1",
  gameServerUrl: "https://game.example",
};

const logger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
});

test("dev Authority re-registers after Matchmaking loses volatile registration", async () => {
  const client = {
    registerDev: jest.fn(async () => undefined),
    heartbeatDev: jest
      .fn()
      .mockRejectedValueOnce({ code: "dev_authority_not_registered" })
      .mockResolvedValueOnce(undefined),
  };
  const logs = logger();
  const manager = new DevAuthorityRegistration({
    client,
    registration,
    logger: logs,
  });

  await manager.register();
  await manager.heartbeat();
  await manager.heartbeat();

  expect(client.registerDev).toHaveBeenCalledTimes(2);
  expect(client.registerDev).toHaveBeenNthCalledWith(1, registration);
  expect(client.registerDev).toHaveBeenNthCalledWith(2, registration);
  expect(logs.info).toHaveBeenCalledWith(
    "authority.dev_re_registered",
    expect.objectContaining({ authorityId: registration.authorityId })
  );
  expect(logs.warn).not.toHaveBeenCalled();
});

test("dev Authority reports unrelated heartbeat and failed re-registration errors", async () => {
  const logs = logger();
  const client = {
    registerDev: jest
      .fn()
      .mockRejectedValue({ code: "matchmaking_unavailable" }),
    heartbeatDev: jest
      .fn()
      .mockRejectedValueOnce({ code: "matchmaking_unavailable" })
      .mockRejectedValueOnce({ code: "dev_authority_not_registered" }),
  };
  const manager = new DevAuthorityRegistration({
    client,
    registration,
    logger: logs,
  });

  await manager.heartbeat();
  await manager.heartbeat();

  expect(logs.warn).toHaveBeenNthCalledWith(1, "authority.heartbeat_failed", {
    errorCode: "matchmaking_unavailable",
  });
  expect(logs.warn).toHaveBeenNthCalledWith(
    2,
    "authority.re_registration_failed",
    { errorCode: "matchmaking_unavailable" }
  );
});
