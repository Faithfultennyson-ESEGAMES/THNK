import {
  chmodSync,
  copyFileSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";

const [credentialsPath, environmentPath, publicResetUrl] =
  process.argv.slice(2);
if (!credentialsPath || !environmentPath || !publicResetUrl)
  throw new Error(
    "Usage: install-playerprofile-smtp.mjs <smtp.json> <environment> <public-reset-url>",
  );

const credentials = JSON.parse(readFileSync(credentialsPath, "utf8"));
const host = credentials?.smtp?.host;
const port = credentials?.smtp?.port;
const encryption = String(credentials?.smtp?.encryption || "").toLowerCase();
const user = credentials?.smtp?.username;
const password = credentials?.smtp?.password;
const fromAddress = credentials?.from?.address;
const fromName = credentials?.from?.name;
if (
  typeof host !== "string" ||
  !/^[A-Za-z0-9.-]+$/.test(host) ||
  !Number.isInteger(port) ||
  port < 1 ||
  port > 65_535 ||
  typeof user !== "string" ||
  user.length < 1 ||
  typeof password !== "string" ||
  password.length < 1 ||
  typeof fromAddress !== "string" ||
  !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fromAddress) ||
  typeof fromName !== "string" ||
  fromName.length < 1 ||
  fromName.length > 100 ||
  /[\r\n]/.test(fromName)
)
  throw new Error("The SMTP JSON is incomplete or invalid.");
if (!["tls", "starttls", "ssl", "smtps"].includes(encryption))
  throw new Error("SMTP encryption must be tls, starttls, ssl, or smtps.");

const resetUrl = new URL(publicResetUrl);
if (resetUrl.protocol !== "https:")
  throw new Error("The public password-reset URL must use HTTPS.");
const secure = ["ssl", "smtps"].includes(encryption) || port === 465;
const quote = (value) =>
  `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
const values = new Map([
  ["THNK_PP_SMTP_HOST", quote(host)],
  ["THNK_PP_SMTP_PORT", String(port)],
  ["THNK_PP_SMTP_SECURE", String(secure)],
  ["THNK_PP_SMTP_REQUIRE_TLS", "true"],
  ["THNK_PP_SMTP_USER", quote(user)],
  ["THNK_PP_SMTP_PASSWORD", quote(password)],
  ["THNK_PP_SMTP_FROM", quote(`${fromName} <${fromAddress}>`)],
  ["THNK_PP_PASSWORD_RESET_PUBLIC_URL", quote(resetUrl.href)],
]);

const source = readFileSync(environmentPath, "utf8");
const seen = new Set();
const lines = source.split(/\r?\n/).map((line) => {
  const match = line.match(/^([A-Z0-9_]+)=/);
  if (!match || !values.has(match[1])) return line;
  seen.add(match[1]);
  return `${match[1]}=${values.get(match[1])}`;
});
for (const [name, value] of values)
  if (!seen.has(name)) lines.push(`${name}=${value}`);

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
const backupPath = `${environmentPath}.before-smtp-${stamp}`;
const temporaryPath = `${environmentPath}.smtp-${process.pid}.tmp`;
copyFileSync(environmentPath, backupPath);
chmodSync(backupPath, 0o600);
writeFileSync(temporaryPath, `${lines.filter(Boolean).join("\n")}\n`, {
  mode: 0o600,
});
renameSync(temporaryPath, environmentPath);
chmodSync(environmentPath, 0o600);
chmodSync(credentialsPath, 0o600);

console.log(
  JSON.stringify({
    status: "configured",
    backupPath,
    host,
    port,
    secure,
    requireTls: true,
    publicResetUrl: resetUrl.href,
    secretPrinted: false,
  }),
);
