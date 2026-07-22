const consoleMethodForLevel = (level) =>
  level >= 3 ? "error" : level === 2 ? "warn" : "info";

module.exports = { consoleMethodForLevel };
