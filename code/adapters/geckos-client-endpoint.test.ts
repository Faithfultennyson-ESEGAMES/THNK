import {
  endpointPort,
  normalizeGeckosEndpoint,
} from "adapters/geckos-client-endpoint";

describe("Geckos client endpoint normalization", () => {
  test("keeps the legacy host and port form", () => {
    expect(normalizeGeckosEndpoint("127.0.0.1", 9208)).toEqual({
      url: "http://127.0.0.1",
      port: 9208,
    });
  });

  test("keeps a complete HTTPS matchmaking assignment intact", () => {
    const endpoint = normalizeGeckosEndpoint(
      "https://authority.example:9443/session",
      null
    );
    expect(endpoint).toEqual({
      url: "https://authority.example:9443/session",
      port: null,
    });
    expect(endpointPort(endpoint)).toBe(9443);
  });

  test("derives standard ports and rejects unsafe URL components", () => {
    expect(endpointPort(normalizeGeckosEndpoint("https://authority.example", null))).toBe(
      443
    );
    expect(() =>
      normalizeGeckosEndpoint("https://user:pass@authority.example", null)
    ).toThrow("must not contain credentials");
    expect(() =>
      normalizeGeckosEndpoint("https://authority.example/?token=secret", null)
    ).toThrow("must not contain a query or fragment");
  });
});
