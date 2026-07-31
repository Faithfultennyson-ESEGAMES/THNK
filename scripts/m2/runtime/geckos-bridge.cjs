let geckosModule;
const { AdmissionError } = require("./jwt-verifier.cjs");
const {
  relayCredentialsAreIgnored,
  resolveIceConfiguration,
} = require("./ice-configuration.cjs");
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
  // Deployment-level WebRTC transport settings are merged here, in the process
  // that can see the environment. The caller keeps deciding gameplay options.
  const iceConfiguration = resolveIceConfiguration();
  const bridgeOptions = { ...iceConfiguration, ...options };
  if (iceConfiguration.iceServers || iceConfiguration.portRange)
    structuredLogger.info("geckos.transport_configured", {
      iceServerCount: iceConfiguration.iceServers?.length ?? 0,
      relayConfigured: Boolean(
        iceConfiguration.iceServers?.some((server) =>
          /^turns?:/.test(String(server.urls))
        )
      ),
      // geckos forwards only the url to node-datachannel, so the Authority
      // cannot authenticate to a relay even though the browser side can.
      relayCredentialsIgnored: relayCredentialsAreIgnored(
        iceConfiguration.iceServers
      ),
      portRange: iceConfiguration.portRange,
    });
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
