const crypto = require("crypto");

class AdmissionError extends Error {
  constructor(code, status = 401) {
    super(code);
    this.name = "AdmissionError";
    this.code = code;
    this.status = status;
  }
}

const decodeJson = (segment, label) => {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    throw new AdmissionError(`invalid_${label}`);
  }
};

const validIdentifier = (value) =>
  typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);

const validClaimNamespace = (value) =>
  typeof value === "string" &&
  value.length >= 1 &&
  value.length <= 512 &&
  !/[\u0000-\u001f\u007f]/.test(value);

const normalizeTags = (value, ErrorType = AdmissionError) => {
  if (value === undefined) return Object.freeze({});
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ErrorType("invalid_tags");
  const entries = Object.entries(value);
  if (entries.length > 32) throw new ErrorType("too_many_tags");
  const tags = {};
  for (const [key, tagValue] of entries) {
    if (!validIdentifier(key) || key.length > 64)
      throw new ErrorType("invalid_tag_key");
    if (
      !["string", "number", "boolean"].includes(typeof tagValue) ||
      (typeof tagValue === "string" && tagValue.length > 256) ||
      (typeof tagValue === "number" && !Number.isFinite(tagValue))
    )
      throw new ErrorType("invalid_tag_value");
    tags[key] = tagValue;
  }
  return Object.freeze(tags);
};

const audienceMatches = (claim, expected) =>
  typeof claim === "string"
    ? claim === expected
    : Array.isArray(claim) && claim.includes(expected);

const createJwtVerifier = ({
  publicKey,
  keyId,
  issuer,
  audience,
  algorithm = "RS256",
  clockSkewSeconds = 30,
  maxTokenLifetimeSeconds = 300,
  now = () => Date.now(),
}) => {
  if (algorithm !== "RS256")
    throw new AdmissionError("unsupported_algorithm", 400);
  if (!validIdentifier(keyId)) throw new AdmissionError("invalid_key_id", 400);
  if (!validClaimNamespace(issuer))
    throw new AdmissionError("invalid_issuer", 400);
  if (!validClaimNamespace(audience))
    throw new AdmissionError("invalid_audience", 400);

  let verificationKey;
  try {
    verificationKey = crypto.createPublicKey(publicKey);
  } catch {
    throw new AdmissionError("invalid_public_key", 400);
  }
  if (verificationKey.asymmetricKeyType !== "rsa")
    throw new AdmissionError("public_key_must_be_rsa", 400);
  if ((verificationKey.asymmetricKeyDetails?.modulusLength || 0) < 2048)
    throw new AdmissionError("rsa_key_too_small", 400);

  return (token) => {
    if (typeof token !== "string" || token.length < 32 || token.length > 8192)
      throw new AdmissionError("invalid_token");
    const segments = token.split(".");
    if (segments.length !== 3) throw new AdmissionError("invalid_token");

    const [encodedHeader, encodedPayload, encodedSignature] = segments;
    const header = decodeJson(encodedHeader, "header");
    const claims = decodeJson(encodedPayload, "claims");
    if (header.alg !== algorithm)
      throw new AdmissionError("algorithm_rejected");
    if (header.kid !== keyId) throw new AdmissionError("key_id_rejected");
    if (header.typ !== undefined && header.typ !== "JWT")
      throw new AdmissionError("token_type_rejected");

    let signature;
    try {
      signature = Buffer.from(encodedSignature, "base64url");
    } catch {
      throw new AdmissionError("invalid_signature");
    }
    const signatureValid = crypto.verify(
      "RSA-SHA256",
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      verificationKey,
      signature
    );
    if (!signatureValid) throw new AdmissionError("invalid_signature");

    const currentSeconds = Math.floor(now() / 1000);
    if (!Number.isInteger(claims.iat)) throw new AdmissionError("iat_required");
    if (!Number.isInteger(claims.exp)) throw new AdmissionError("exp_required");
    if (claims.iat > currentSeconds + clockSkewSeconds)
      throw new AdmissionError("issued_in_future");
    if (claims.exp <= currentSeconds - clockSkewSeconds)
      throw new AdmissionError("token_expired");
    if (claims.exp <= claims.iat)
      throw new AdmissionError("invalid_token_window");
    if (claims.exp - claims.iat > maxTokenLifetimeSeconds)
      throw new AdmissionError("token_lifetime_exceeded");
    if (
      claims.nbf !== undefined &&
      (!Number.isInteger(claims.nbf) ||
        claims.nbf > currentSeconds + clockSkewSeconds)
    )
      throw new AdmissionError("token_not_active");
    if (claims.iss !== issuer) throw new AdmissionError("issuer_rejected");
    if (!audienceMatches(claims.aud, audience))
      throw new AdmissionError("audience_rejected");
    if (!validIdentifier(claims.sessionId))
      throw new AdmissionError("invalid_session_id");
    if (!validIdentifier(claims.playerId))
      throw new AdmissionError("invalid_player_id");
    if (!validIdentifier(claims.jti)) throw new AdmissionError("jti_required");
    for (const [claimName, errorCode] of [
      ["gameId", "invalid_game_id"],
      ["authorityId", "invalid_authority_id"],
      ["serverBuildId", "invalid_server_build_id"],
      ["compatibilityVersion", "invalid_compatibility_version"],
      ["clientBuildId", "invalid_client_build_id"],
      ["protocolVersion", "invalid_protocol_version"],
    ])
      if (!validIdentifier(claims[claimName]))
        throw new AdmissionError(errorCode);
    if (claims.mapId !== undefined && !validIdentifier(claims.mapId))
      throw new AdmissionError("invalid_map_id");

    return Object.freeze({
      sessionId: claims.sessionId,
      playerId: claims.playerId,
      jti: claims.jti,
      issuedAt: claims.iat,
      expiresAt: claims.exp,
      gameId: claims.gameId,
      authorityId: claims.authorityId,
      mapId: claims.mapId || "",
      serverBuildId: claims.serverBuildId,
      compatibilityVersion: claims.compatibilityVersion,
      clientBuildId: claims.clientBuildId,
      protocolVersion: claims.protocolVersion,
      tags: normalizeTags(claims.tags),
    });
  };
};

module.exports = {
  AdmissionError,
  createJwtVerifier,
  normalizeTags,
  validIdentifier,
};
