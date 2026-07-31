(globalThis as unknown as { gdjs: unknown }).gdjs = {
  Logger: class {
    warn() {}
  },
};

const { parseIceServers, resolveClientIceServers } =
  require("./ice-servers") as typeof import("./ice-servers");

afterEach(() => {
  delete (globalThis as typeof globalThis & { THNK_ICE_SERVERS?: unknown })
    .THNK_ICE_SERVERS;
});

test("an unconfigured Client offers no ICE servers", () => {
  expect(resolveClientIceServers()).toBeUndefined();
  expect(parseIceServers(undefined)).toBeUndefined();
  expect(parseIceServers("")).toBeUndefined();
});

test("STUN and TURN entries survive as the browser expects them", () => {
  expect(
    parseIceServers([
      { urls: "stun:stun.example:3478" },
      {
        urls: ["turn:relay.example:3478", "turns:relay.example:5349"],
        username: "player",
        credential: "secret",
      },
    ])
  ).toEqual([
    { urls: "stun:stun.example:3478" },
    {
      urls: ["turn:relay.example:3478", "turns:relay.example:5349"],
      username: "player",
      credential: "secret",
    },
  ]);
});

test("a JSON string is accepted, since the value arrives injected", () => {
  (
    globalThis as typeof globalThis & { THNK_ICE_SERVERS?: unknown }
  ).THNK_ICE_SERVERS = '[{"urls":"stun:stun.example:3478"}]';
  expect(resolveClientIceServers()).toEqual([
    { urls: "stun:stun.example:3478" },
  ]);
});

test("invalid entries are dropped without discarding the usable ones", () => {
  // A misconfigured relay must not take a working STUN server down with it, and
  // must never reach the browser as a dead relay that stalls the connection.
  expect(
    parseIceServers([
      { urls: "stun:stun.example:3478" },
      { urls: "https://not-an-ice-server.example" },
      { urls: "turn:relay.example:3478", username: "player" },
    ])
  ).toEqual([{ urls: "stun:stun.example:3478" }]);
});

test("configuration that is entirely unusable resolves to nothing", () => {
  expect(parseIceServers("not json")).toBeUndefined();
  expect(parseIceServers([])).toBeUndefined();
  expect(parseIceServers([{ urls: "ftp://relay.example" }])).toBeUndefined();
});
