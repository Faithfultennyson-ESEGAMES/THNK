const { spawnSync } = require("child_process");

const yarnPath = process.env.npm_execpath;
if (!yarnPath) throw new Error("Run this check through Yarn.");
const result = spawnSync(
  process.execPath,
  [yarnPath, "audit", "--groups", "dependencies", "--json"],
  { encoding: "utf8" }
);
const records = result.stdout
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return undefined;
    }
  })
  .filter(Boolean);
const summary = records.find((record) => record.type === "auditSummary")?.data;
if (!summary) {
  process.stderr.write(result.stderr || result.stdout);
  throw new Error("The package registry did not return an audit summary.");
}
const vulnerabilities = summary.vulnerabilities;
const blocking =
  vulnerabilities.moderate + vulnerabilities.high + vulnerabilities.critical;
if (blocking > 0)
  throw new Error(
    `Production audit failed: ${vulnerabilities.moderate} moderate, ${vulnerabilities.high} high, ${vulnerabilities.critical} critical.`
  );
console.log(
  `Production audit passed: ${summary.totalDependencies} packages, zero moderate/high/critical vulnerabilities.`
);
