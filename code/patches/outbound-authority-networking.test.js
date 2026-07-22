const {
  MatchmakingAuthorityClient,
  validateBaseUrl,
} = require("../../scripts/m2/runtime/matchmaking-authority-client.cjs");

const identity = {
  gameId: "game-1",
  modeId: "duel",
  authorityId: "duel-authority",
  serverBuildId: `sha256:${"a".repeat(64)}`,
  compatibilityVersion: "m7-v1",
  clientBuildId: "client-1",
  protocolVersion: "protocol-1",
};

test("production Authority claims and acknowledges through outbound-only Matchmaking calls", async () => {
  const requests = [];
  const fetchImpl = jest.fn(async (url, request) => {
    requests.push({ url: String(url), request });
    if (String(url).endsWith("/sessions/claim"))
      return {
        ok: true,
        json: async () => ({ session: { sessionId: "session-production" } }),
      };
    return { ok: true, json: async () => ({ status: "ready" }) };
  });
  const client = new MatchmakingAuthorityClient({
    baseUrl: "https://matchmaking.example",
    serviceToken: "p".repeat(32),
    fetchImpl,
  });
  expect(await client.claim(identity)).toEqual({
    sessionId: "session-production",
  });
  await client.ready("session-production");
  expect(requests.map(({ url }) => url)).toEqual([
    "https://matchmaking.example/v1/authorities/sessions/claim",
    "https://matchmaking.example/v1/authorities/sessions/ready",
  ]);
  expect(JSON.parse(requests[0].request.body)).toEqual(identity);
  expect(requests[0].request.headers.authorization).toBe(
    `Bearer ${"p".repeat(32)}`
  );
});

test("dev Authority registers its Client-reachable address without Matchmaking reaching into it", async () => {
  const requests = [];
  const fetchImpl = jest.fn(async (url, request) => {
    requests.push({ url: String(url), request });
    return {
      ok: true,
      json: async () => ({ status: "registered", expiresAt: "later" }),
    };
  });
  const client = new MatchmakingAuthorityClient({
    baseUrl: "https://shared-matchmaking.example",
    serviceToken: "d".repeat(32),
    fetchImpl,
  });
  await client.registerDev({
    ...identity,
    gameServerUrl: "http://192.168.1.50:9208",
  });
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe(
    "https://shared-matchmaking.example/v1/authorities/dev/registration"
  );
  expect(requests[0].url).not.toContain("192.168.1.50");
  expect(JSON.parse(requests[0].request.body).gameServerUrl).toBe(
    "http://192.168.1.50:9208"
  );
});

test("Authority pull URL rejects plaintext public services but supports explicit local development", () => {
  expect(() => validateBaseUrl("http://matchmaking.example", true)).toThrow(
    "must use HTTPS"
  );
  expect(() => validateBaseUrl("http://192.168.1.196:9300", false)).toThrow(
    "must use HTTPS"
  );
  expect(validateBaseUrl("http://192.168.1.196:9300", true)).toBe(
    "http://192.168.1.196:9300"
  );
});
