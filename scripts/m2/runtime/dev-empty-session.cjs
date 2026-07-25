class DevEmptySessionController {
  constructor({
    enabled,
    timeoutMs,
    sessionManager,
    shutdown,
    logger,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
  }) {
    this.enabled = enabled;
    this.timeoutMs = timeoutMs;
    this.sessionManager = sessionManager;
    this.shutdown = shutdown;
    this.logger = logger;
    this.setTimeoutImpl = setTimeoutImpl;
    this.clearTimeoutImpl = clearTimeoutImpl;
    this.timer = undefined;
    this.onPlayerConnected = () => this.cancel();
    this.onPlayersDrained = () => this.schedule();
  }

  start() {
    if (!this.enabled) return;
    this.sessionManager.on("player-connected", this.onPlayerConnected);
    this.sessionManager.on("players-drained", this.onPlayersDrained);
  }

  schedule() {
    if (!this.enabled) return;
    this.cancel();
    const state = this.sessionManager.getPublicState?.();
    if (!state || state.status !== "active") return;
    this.logger.info("dev.session_empty_grace_started", {
      sessionId: state.sessionId,
      timeoutMs: this.timeoutMs,
    });
    this.timer = this.setTimeoutImpl(() => {
      this.timer = undefined;
      const latest = this.sessionManager.getPublicState?.();
      if (
        !latest ||
        latest.status !== "active" ||
        latest.connectedPlayers?.length !== 0
      )
        return;
      this.logger.info("dev.session_empty_shutdown", {
        sessionId: latest.sessionId,
      });
      void this.shutdown("dev_players_drained");
    }, this.timeoutMs);
    this.timer?.unref?.();
  }

  cancel() {
    if (!this.timer) return;
    this.clearTimeoutImpl(this.timer);
    this.timer = undefined;
  }

  stop() {
    this.cancel();
    if (!this.enabled) return;
    this.sessionManager.off("player-connected", this.onPlayerConnected);
    this.sessionManager.off("players-drained", this.onPlayersDrained);
  }
}

module.exports = { DevEmptySessionController };
