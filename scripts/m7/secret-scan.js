const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const repositoryRoot = path.resolve(__dirname, "../..");
const listed = spawnSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  { cwd: repositoryRoot, encoding: "utf8" }
);
if (listed.status !== 0)
  throw new Error("Could not enumerate repository files.");

const externalValues = new Set(
  String(process.env.THNK_SECRET_SCAN_VALUES || "")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => value.length >= 8)
);
const valuesFileIndex = process.argv.indexOf("--values-file");
if (valuesFileIndex >= 0) {
  const valuesPath = process.argv[valuesFileIndex + 1];
  if (!valuesPath) throw new Error("--values-file requires a path.");
  const raw = fs.readFileSync(path.resolve(valuesPath), "utf8");
  try {
    const visit = (value) => {
      if (typeof value === "string" && value.length >= 8)
        externalValues.add(value);
      else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object")
        Object.values(value).forEach(visit);
    };
    visit(JSON.parse(raw));
  } catch {
    raw
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter((value) => value.length >= 8)
      .forEach((value) => externalValues.add(value));
  }
}

const rules = [
  {
    name: "private_key_block",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    name: "agora_certificate_literal",
    pattern: /AGORA_APP_CERTIFICATE\s*[:=]\s*["']?[a-f\d]{32}["']?/i,
  },
  {
    name: "nonempty_env_secret",
    pattern:
      /^(?:THNK_CONTROL_TOKEN|THNK_WEBHOOK_SECRET|THNK_PLAYER_PROFILE_TOKEN|AGORA_APP_CERTIFICATE)=[^\s<][^\r\n]*$/m,
    envOnly: true,
  },
];
const findings = [];
for (const relativePath of listed.stdout.split(/\r?\n/).filter(Boolean)) {
  const absolutePath = path.join(repositoryRoot, relativePath);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile())
    continue;
  let contents;
  try {
    contents = fs.readFileSync(absolutePath, "utf8");
  } catch {
    continue;
  }
  for (const rule of rules) {
    if (rule.envOnly && !/(?:^|\.)env(?:\.|$)/i.test(relativePath)) continue;
    if (rule.pattern.test(contents))
      findings.push({ path: relativePath, rule: rule.name });
  }
  for (const value of externalValues)
    if (contents.includes(value)) {
      findings.push({ path: relativePath, rule: "supplied_secret_value" });
      break;
    }
}

if (findings.length) {
  for (const finding of findings)
    console.error(`${finding.path}: ${finding.rule}`);
  throw new Error(`Secret scan found ${findings.length} potential leak(s).`);
}
console.log(
  `Secret scan passed: ${
    listed.stdout.split(/\r?\n/).filter(Boolean).length
  } files, ${externalValues.size} supplied value(s).`
);
