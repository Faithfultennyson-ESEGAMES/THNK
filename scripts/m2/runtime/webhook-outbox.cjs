const crypto = require("crypto");
const { structuredLogger } = require("./structured-logger.cjs");

const delay = (milliseconds) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
  });

class WebhookOutbox {
  constructor({
    callbackUrl,
    secret,
    fetchImpl = globalThis.fetch,
    now = () => new Date(),
    randomUUID = () => crypto.randomUUID(),
    sleep = delay,
    maxAttempts = 5,
    initialDelayMs = 200,
    maxDelayMs = 5_000,
    requestTimeoutMs = 3_000,
    logger = structuredLogger,
  }) {
    if (typeof fetchImpl !== "function")
      throw new Error("A fetch implementation is required for webhooks.");
    this.callbackUrl = callbackUrl;
    this.secret = secret;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.randomUUID = randomUUID;
    this.sleep = sleep;
    this.maxAttempts = maxAttempts;
    this.initialDelayMs = initialDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.requestTimeoutMs = requestTimeoutMs;
    this.logger = logger;
    this.records = new Map();
    this.deliveries = new Set();
  }

  enqueue(eventType, sessionId, details = {}) {
    const event = Object.freeze({
      version: 1,
      eventId: this.randomUUID(),
      eventType,
      timestamp: this.now().toISOString(),
      sessionId,
      ...details,
    });
    const record = {
      event,
      attempts: 0,
      delivered: false,
      lastError: undefined,
    };
    this.records.set(event.eventId, record);
    this.logger.info("webhook.queued", {
      eventId: event.eventId,
      lifecycleEvent: event.eventType,
      sessionId: event.sessionId,
      playerId: event.playerId,
      connectionId: event.connectionId,
    });
    const delivery = this.deliver(record).finally(() =>
      this.deliveries.delete(delivery)
    );
    this.deliveries.add(delivery);
    return { event, delivery };
  }

  async deliver(record) {
    const body = JSON.stringify(record.event);
    const signature = crypto
      .createHmac("sha256", this.secret)
      .update(body)
      .digest("hex");

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      record.attempts = attempt;
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.requestTimeoutMs
      );
      timeout.unref?.();
      try {
        const response = await this.fetchImpl(this.callbackUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-thnk-event-id": record.event.eventId,
            "x-thnk-timestamp": record.event.timestamp,
            "x-thnk-signature": `sha256=${signature}`,
          },
          body,
          signal: controller.signal,
        });
        if (response.ok) {
          record.delivered = true;
          record.lastError = undefined;
          this.logger.info("webhook.delivered", {
            eventId: record.event.eventId,
            lifecycleEvent: record.event.eventType,
            sessionId: record.event.sessionId,
            playerId: record.event.playerId,
            connectionId: record.event.connectionId,
            attempt,
          });
          return true;
        }
        record.lastError = `http_${response.status}`;
      } catch {
        record.lastError = "network_error";
      } finally {
        clearTimeout(timeout);
      }

      this.logger.warn("webhook.delivery_failed", {
        eventId: record.event.eventId,
        lifecycleEvent: record.event.eventType,
        sessionId: record.event.sessionId,
        playerId: record.event.playerId,
        connectionId: record.event.connectionId,
        attempt,
        errorCode: record.lastError,
      });

      if (attempt < this.maxAttempts) {
        const backoff = Math.min(
          this.initialDelayMs * 2 ** (attempt - 1),
          this.maxDelayMs
        );
        await this.sleep(backoff);
      }
    }
    this.logger.error("webhook.exhausted", {
      eventId: record.event.eventId,
      lifecycleEvent: record.event.eventType,
      sessionId: record.event.sessionId,
      playerId: record.event.playerId,
      connectionId: record.event.connectionId,
      attempts: record.attempts,
      errorCode: record.lastError,
    });
    return false;
  }

  async drain(timeoutMs = 5_000) {
    const deliveries = [...this.deliveries];
    if (!deliveries.length) return true;
    let timeout;
    const timedOut = new Promise((resolve) => {
      timeout = setTimeout(() => resolve(false), timeoutMs);
      timeout.unref?.();
    });
    const completed = Promise.allSettled(deliveries).then(() => true);
    const result = await Promise.race([completed, timedOut]);
    clearTimeout(timeout);
    return result;
  }

  stats() {
    const records = [...this.records.values()];
    return {
      total: records.length,
      delivered: records.filter((record) => record.delivered).length,
      failed: records.filter(
        (record) => !record.delivered && record.attempts >= this.maxAttempts
      ).length,
      pending: this.deliveries.size,
    };
  }
}

module.exports = { WebhookOutbox };
