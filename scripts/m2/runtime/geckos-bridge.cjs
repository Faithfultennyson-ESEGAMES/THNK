let geckosModule;
const { AdmissionError } = require("./jwt-verifier.cjs");
const { sessionManager } = require("./session-manager.cjs");
const { structuredLogger } = require("./structured-logger.cjs");

exports.loadGeckos = async () => {
  try {
    geckosModule ||= await import("@geckos.io/server");
  } catch (error) {
    structuredLogger.error("geckos.import_failed", {
      errorMessage: error?.message,
    });
    throw error;
  }
};

exports.createServer = (options) => {
  if (!geckosModule) throw new Error("Geckos was not loaded before use.");
  const bridgeOptions = { ...options };
  if (sessionManager.enabled) {
    bridgeOptions.authorization = async (authorization) => {
      try {
        return sessionManager.authorize(authorization);
      } catch (error) {
        if (error instanceof AdmissionError) return error.status;
        structuredLogger.error("player.admission_failed", {
          errorCode: error?.code || "internal_error",
        });
        return 500;
      }
    };
  }
  return geckosModule.geckos(bridgeOptions);
};

exports.playerConnected = (identity, connectionId) =>
  sessionManager.playerConnected(identity, connectionId);

exports.playerDisconnected = (identity, connectionId, document) =>
  sessionManager.playerDisconnected(identity, connectionId, document);

exports.playerDocumentChanged = (identity, document) =>
  sessionManager.playerDocumentChanged(identity, document);

exports.reportTrustViolation = (playerId, violationType) =>
  sessionManager.reportTrustViolation(playerId, violationType);

exports.onSessionEnding = (callback) => {
  sessionManager.on("session-ending", callback);
  return () => sessionManager.off("session-ending", callback);
};

exports.setVoiceChannel = (playerId, channelId) =>
  sessionManager.setVoiceChannel(playerId, channelId);

exports.getPlayerVoiceChannel = (playerId) =>
  sessionManager.getPlayerVoiceChannel(playerId);

exports.onVoiceGrantUpdated = (callback) => {
  sessionManager.on("voice-grant-updated", callback);
  return () => sessionManager.off("voice-grant-updated", callback);
};
