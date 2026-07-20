class FixedWindowRateLimiter {
  constructor({
    limit,
    windowMs = 60_000,
    maxEntries = 10_000,
    now = () => Date.now(),
  }) {
    this.limit = Number(limit);
    this.windowMs = Number(windowMs);
    this.now = now;
    this.maxEntries = Number(maxEntries);
    this.windows = new Map();
    if (!Number.isInteger(this.limit) || this.limit < 1 || this.limit > 100_000)
      throw new Error("Rate limit must be an integer from 1 to 100000.");
    if (
      !Number.isInteger(this.windowMs) ||
      this.windowMs < 1_000 ||
      this.windowMs > 3_600_000
    )
      throw new Error("Rate-limit window must be 1000 to 3600000 ms.");
    if (
      !Number.isInteger(this.maxEntries) ||
      this.maxEntries < 100 ||
      this.maxEntries > 1_000_000
    )
      throw new Error("Rate-limit capacity must be 100 to 1000000 entries.");
  }

  prune(now) {
    if (this.windows.size < this.maxEntries) return;
    for (const [key, record] of this.windows) {
      if (record.resetAt <= now) this.windows.delete(key);
    }
    while (this.windows.size >= this.maxEntries)
      this.windows.delete(this.windows.keys().next().value);
  }

  check(key) {
    const now = this.now();
    let record = this.windows.get(key);
    if (!record || record.resetAt <= now) {
      if (!record) this.prune(now);
      record = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, record);
    }
    record.count += 1;
    if (record.count <= this.limit)
      return {
        allowed: true,
        remaining: this.limit - record.count,
        retryAfterSeconds: 0,
      };
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((record.resetAt - now) / 1_000)),
    };
  }
}

module.exports = { FixedWindowRateLimiter };
