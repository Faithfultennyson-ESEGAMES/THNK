class DevAuthorityRegistration {
  constructor({ client, registration, logger }) {
    if (!client || !registration || !logger)
      throw new Error("Dev Authority registration dependencies are required.");
    this.client = client;
    this.registration = Object.freeze({ ...registration });
    this.logger = logger;
    this.registering = undefined;
  }

  async register(event = "authority.dev_registered") {
    if (!this.registering)
      this.registering = this.client
        .registerDev(this.registration)
        .then(() => {
          this.logger.info(event, {
            authorityId: this.registration.authorityId,
            serverBuildId: this.registration.serverBuildId,
          });
        })
        .finally(() => {
          this.registering = undefined;
        });
    return this.registering;
  }

  async heartbeat() {
    try {
      await this.client.heartbeatDev();
    } catch (error) {
      if (error?.code !== "dev_authority_not_registered") {
        this.logger.warn("authority.heartbeat_failed", {
          errorCode: error?.code || "matchmaking_unavailable",
        });
        return;
      }
      try {
        await this.register("authority.dev_re_registered");
      } catch (registrationError) {
        this.logger.warn("authority.re_registration_failed", {
          errorCode:
            registrationError?.code || "matchmaking_unavailable",
        });
      }
    }
  }
}

module.exports = { DevAuthorityRegistration };
