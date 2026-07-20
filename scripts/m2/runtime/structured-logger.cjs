const REDACTED = "[REDACTED]";
const MAX_STRING_LENGTH = 4_096;
const sensitiveKey =
  /authorization|cookie|token|secret|certificate|capability|password|private.?key|player.?document/i;

const redactString = (value) =>
  value
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, `Bearer ${REDACTED}`)
    .replace(
      /\b(authorization|token|secret|certificate|capability|password|private[_ -]?key)\s*[:=]\s*[^\s,;]+/gi,
      (_match, name) => `${name}=${REDACTED}`
    )
    .slice(0, MAX_STRING_LENGTH);

const redact = (value, key = "", seen = new WeakSet()) => {
  if (sensitiveKey.test(key)) return REDACTED;
  if (typeof value === "string") return redactString(value);
  if (
    value === null ||
    value === undefined ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value))
    return value.slice(0, 256).map((entry) => redact(entry, "", seen));
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 256)
      .map(([name, entry]) => [name, redact(entry, name, seen)])
  );
};

const levels = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });

const createStructuredLogger = ({
  level = process.env.THNK_LOG_LEVEL || "info",
  now = () => new Date(),
  write = (line) => process.stdout.write(`${line}\n`),
  base = {},
} = {}) => {
  if (!Object.hasOwn(levels, level))
    throw new Error("THNK_LOG_LEVEL must be debug, info, warn, or error.");
  const threshold = levels[level];
  const emit = (entryLevel, event, fields = {}) => {
    if (levels[entryLevel] < threshold) return;
    const record = {
      ...redact(base),
      ...redact(fields),
      timestamp: now().toISOString(),
      level: entryLevel,
      event,
    };
    write(JSON.stringify(record));
  };
  return Object.freeze({
    debug: (event, fields) => emit("debug", event, fields),
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
    child: (fields) =>
      createStructuredLogger({
        level,
        now,
        write,
        base: { ...base, ...fields },
      }),
  });
};

const structuredLogger = createStructuredLogger({
  write:
    process.env.NODE_ENV === "test"
      ? () => {}
      : (line) => process.stdout.write(`${line}\n`),
});

module.exports = {
  REDACTED,
  createStructuredLogger,
  redact,
  structuredLogger,
};
