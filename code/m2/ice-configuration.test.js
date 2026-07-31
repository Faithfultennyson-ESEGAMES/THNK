const {
  relayCredentialsAreIgnored,
  resolveIceConfiguration,
} = require("../../scripts/m2/runtime/ice-configuration.cjs");

test("an unconfigured deployment adds no transport options", () => {
  expect(resolveIceConfiguration({})).toEqual({});
});

test("a STUN server lets an Authority behind NAT advertise a public candidate", () => {
  expect(
    resolveIceConfiguration({
      THNK_ICE_SERVERS: '[{"urls":"stun:stun.example:3478"}]',
    })
  ).toEqual({ iceServers: [{ urls: "stun:stun.example:3478" }] });
});

test("each url becomes its own entry with a plain string", () => {
  // geckos forwards these as iceServers.map(ice => ice.urls). An entry holding
  // an array of urls would therefore arrive at node-datachannel as a nested
  // array it cannot parse, and every connection attempt fails with a 500 while
  // the player is admitted and never connects. Observed live before this split.
  expect(
    resolveIceConfiguration({
      THNK_ICE_SERVERS: JSON.stringify([
        {
          urls: ["turn:relay.example:3478", "turns:relay.example:5349"],
          username: "player",
          credential: "secret",
        },
      ]),
    })
  ).toEqual({
    iceServers: [
      { urls: "turn:relay.example:3478", username: "player", credential: "secret" },
      { urls: "turns:relay.example:5349", username: "player", credential: "secret" },
    ],
  });
});

test("every emitted url is a string, which is what the geckos mapping needs", () => {
  const { iceServers } = resolveIceConfiguration({
    THNK_ICE_SERVERS: JSON.stringify([
      { urls: ["stun:a.example:3478", "stun:b.example:3478"] },
      { urls: "stun:c.example:3478" },
    ]),
  });
  expect(iceServers).toHaveLength(3);
  for (const server of iceServers) expect(typeof server.urls).toBe("string");
  // This is the value geckos actually forwards; a nested array here is the bug.
  expect(iceServers.map((server) => server.urls)).toEqual([
    "stun:a.example:3478",
    "stun:b.example:3478",
    "stun:c.example:3478",
  ]);
});

test("a relay's credentials are reported as unusable by the Authority itself", () => {
  const { iceServers } = resolveIceConfiguration({
    THNK_ICE_SERVERS: JSON.stringify([
      { urls: "turn:relay.example:3478", username: "player", credential: "secret" },
    ]),
  });
  expect(relayCredentialsAreIgnored(iceServers)).toBe(true);
  expect(
    relayCredentialsAreIgnored([{ urls: "stun:stun.example:3478" }])
  ).toBe(false);
});

test("a relay missing half its credentials is rejected at startup", () => {
  // Left to connection time this surfaces as an opaque ICE failure that looks
  // like the game hanging, so it must fail loudly while starting instead.
  expect(() =>
    resolveIceConfiguration({
      THNK_ICE_SERVERS: '[{"urls":"turn:relay.example:3478","username":"player"}]',
    })
  ).toThrow(/username and credential/);
});

test("a non-ICE url is rejected", () => {
  expect(() =>
    resolveIceConfiguration({
      THNK_ICE_SERVERS: '[{"urls":"https://relay.example"}]',
    })
  ).toThrow(/stun:, stuns:, turn: or turns:/);
});

test("malformed or empty ICE configuration is rejected", () => {
  expect(() =>
    resolveIceConfiguration({ THNK_ICE_SERVERS: "not json" })
  ).toThrow(/valid JSON/);
  expect(() => resolveIceConfiguration({ THNK_ICE_SERVERS: "[]" })).toThrow(
    /non-empty array/
  );
});

test("a UDP port range is published so a firewall rule can be written for it", () => {
  expect(
    resolveIceConfiguration({
      THNK_WEBRTC_UDP_PORT_MIN: "20000",
      THNK_WEBRTC_UDP_PORT_MAX: "20100",
    })
  ).toEqual({ portRange: { min: 20_000, max: 20_100 } });
});

test("a half-configured or impossible port range is rejected", () => {
  expect(() =>
    resolveIceConfiguration({ THNK_WEBRTC_UDP_PORT_MIN: "20000" })
  ).toThrow(/or neither/);
  expect(() =>
    resolveIceConfiguration({
      THNK_WEBRTC_UDP_PORT_MIN: "20100",
      THNK_WEBRTC_UDP_PORT_MAX: "20000",
    })
  ).toThrow(/greater than or equal/);
  expect(() =>
    resolveIceConfiguration({
      THNK_WEBRTC_UDP_PORT_MIN: "80",
      THNK_WEBRTC_UDP_PORT_MAX: "90",
    })
  ).toThrow(/1024 to 65535/);
});
