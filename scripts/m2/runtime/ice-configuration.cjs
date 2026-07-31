// WebRTC transport configuration for the Authority's geckos server.
//
// geckos carries gameplay over a UDP data channel. Two deployment facts need to
// be configurable and previously were not:
//
//   * Which UDP ports the Authority uses, so a firewall or NAT rule can be
//     written for it deterministically instead of guessing at a default range.
//   * Which ICE servers to offer, so an Authority behind NAT can discover its
//     own public candidate (STUN) and so a relay can be provided (TURN) for
//     players whose network blocks outbound UDP entirely.
//
// Without a relay those players are admitted and then never connect, which
// presents as the game hanging rather than as an error.

const ICE_URL = /^(stuns?|turns?):/;

const parseIceServers = (raw) => {
  if (!raw) return undefined;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("THNK_ICE_SERVERS must be valid JSON.");
  }
  if (!Array.isArray(parsed) || parsed.length === 0)
    throw new Error("THNK_ICE_SERVERS must be a non-empty array.");
  return parsed.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new Error("Each THNK_ICE_SERVERS entry must be an object.");
    const urls = Array.isArray(entry.urls) ? entry.urls : [entry.urls];
    if (urls.length === 0 || urls.some((url) => typeof url !== "string"))
      throw new Error("Each THNK_ICE_SERVERS entry needs a urls string.");
    for (const url of urls)
      if (!ICE_URL.test(url))
        throw new Error(
          `THNK_ICE_SERVERS url must be stun:, stuns:, turn: or turns: (${url})`
        );
    // A relay that needs credentials but is missing one fails at connection
    // time with an opaque ICE error, so it is rejected at startup instead.
    const needsCredential = urls.some((url) => /^turns?:/.test(url));
    if (needsCredential && (entry.username || entry.credential)) {
      if (typeof entry.username !== "string" || typeof entry.credential !== "string")
        throw new Error(
          "A TURN THNK_ICE_SERVERS entry needs both username and credential."
        );
    }
    // geckos hands these to node-datachannel as `iceServers.map(ice => ice.urls)`,
    // so a multi-url entry would arrive as a nested array that node-datachannel
    // cannot parse: every connection attempt then fails with a 500 and players
    // are admitted and never connect. Each url therefore becomes its own entry
    // with a plain string, which is what that mapping produces correctly.
    return urls.map((url) => ({
      urls: url,
      ...(entry.username ? { username: entry.username } : {}),
      ...(entry.credential ? { credential: entry.credential } : {}),
    }));
  }).flat();
};

const parsePortRange = (min, max) => {
  if (!min && !max) return undefined;
  if (!min || !max)
    throw new Error(
      "Set both THNK_WEBRTC_UDP_PORT_MIN and THNK_WEBRTC_UDP_PORT_MAX, or neither."
    );
  const low = Number(min);
  const high = Number(max);
  for (const value of [low, high])
    if (!Number.isInteger(value) || value < 1_024 || value > 65_535)
      throw new Error(
        "THNK_WEBRTC_UDP_PORT_MIN/MAX must be integers from 1024 to 65535."
      );
  if (high < low)
    throw new Error(
      "THNK_WEBRTC_UDP_PORT_MAX must be greater than or equal to THNK_WEBRTC_UDP_PORT_MIN."
    );
  return { min: low, max: high };
};

// geckos forwards only `ice.urls` to node-datachannel, so a username and
// credential never reach the Authority's own ICE agent. A relay therefore works
// for the browser side, which does honour credentials, but the Authority cannot
// itself authenticate to one. Surfaced rather than left to be discovered as a
// relay that silently does nothing.
const relayCredentialsAreIgnored = (iceServers) =>
  (iceServers ?? []).some(
    (server) =>
      /^turns?:/.test(String(server.urls)) &&
      (server.username || server.credential)
  );

const resolveIceConfiguration = (environment = process.env) => {
  const iceServers = parseIceServers(environment.THNK_ICE_SERVERS);
  const portRange = parsePortRange(
    environment.THNK_WEBRTC_UDP_PORT_MIN,
    environment.THNK_WEBRTC_UDP_PORT_MAX
  );
  // Only geckos options belong in here; an unknown key would be forwarded on.
  return {
    ...(iceServers ? { iceServers } : {}),
    ...(portRange ? { portRange } : {}),
  };
};

module.exports = { resolveIceConfiguration, relayCredentialsAreIgnored };
