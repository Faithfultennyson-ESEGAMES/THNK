/// <reference path="../types/global.d.ts"/>

// The browser half of WebRTC transport configuration.
//
// geckos carries gameplay over a UDP data channel. A Client needs the same ICE
// servers the Authority uses, or the two cannot agree on a usable candidate
// pair: STUN so each side can discover its own public address, and TURN so a
// player whose network blocks outbound UDP can still be relayed. Without a
// relay those players are admitted and then never connect, which looks to them
// like the game hanging rather than an error.
//
// Supplied the same way as THNK_ADMISSION_TOKEN: injected on globalThis so a
// deployment or a game's own configuration can set it without every game having
// to thread it through its event sheet.

export interface IceServerConfiguration {
  urls: string | string[];
  username?: string;
  credential?: string;
}

const ICE_URL = /^(stuns?|turns?):/;

const logger = new gdjs.Logger("THNK - ICE configuration");

const parseEntry = (entry: unknown): IceServerConfiguration | undefined => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry))
    return undefined;
  const candidate = entry as Record<string, unknown>;
  const urls = Array.isArray(candidate.urls) ? candidate.urls : [candidate.urls];
  if (
    urls.length === 0 ||
    urls.some((url) => typeof url !== "string" || !ICE_URL.test(url))
  )
    return undefined;
  const needsCredential = (urls as string[]).some((url) =>
    /^turns?:/.test(url)
  );
  // A relay missing half its credentials fails later as an opaque ICE error, so
  // it is dropped here with a log rather than silently producing a dead relay.
  if (
    needsCredential &&
    (candidate.username !== undefined || candidate.credential !== undefined) &&
    (typeof candidate.username !== "string" ||
      typeof candidate.credential !== "string")
  )
    return undefined;
  return {
    urls: Array.isArray(candidate.urls)
      ? (urls as string[])
      : (urls[0] as string),
    ...(typeof candidate.username === "string"
      ? { username: candidate.username }
      : {}),
    ...(typeof candidate.credential === "string"
      ? { credential: candidate.credential }
      : {}),
  };
};

export const parseIceServers = (
  value: unknown
): IceServerConfiguration[] | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      logger.warn("Ignoring ICE configuration: not valid JSON.");
      return undefined;
    }
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    logger.warn("Ignoring ICE configuration: expected a non-empty array.");
    return undefined;
  }
  const parsed = raw
    .map(parseEntry)
    .filter((entry): entry is IceServerConfiguration => entry !== undefined);
  if (parsed.length !== raw.length)
    logger.warn(
      `Ignored ${raw.length - parsed.length} invalid ICE server entr${
        raw.length - parsed.length === 1 ? "y" : "ies"
      }.`
    );
  return parsed.length > 0 ? parsed : undefined;
};

export const resolveClientIceServers = ():
  | IceServerConfiguration[]
  | undefined =>
  parseIceServers(
    (
      globalThis as typeof globalThis & {
        THNK_ICE_SERVERS?: unknown;
      }
    ).THNK_ICE_SERVERS
  );
