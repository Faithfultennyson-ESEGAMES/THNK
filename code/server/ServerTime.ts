/**
 * The Authority process's own clock, in milliseconds since the Unix epoch.
 * This is the single trusted time primitive: time-gated systems (daily
 * rewards, cooldowns, streaks) compare this value against plain numeric
 * document fields in server-tagged event logic instead of ever trusting a
 * client-reported time.
 */
export const getServerTimestamp = (): number => Date.now();
