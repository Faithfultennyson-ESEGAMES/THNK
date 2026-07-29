import {
  chmodSync,
  copyFileSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";

const [oauthPath, environmentPath, expectedRedirectUri, expectedOrigin] =
  process.argv.slice(2);
if (
  !oauthPath ||
  !environmentPath ||
  !expectedRedirectUri ||
  !expectedOrigin
)
  throw new Error(
    "Usage: install-playerprofile-google-oauth.mjs <oauth.json> <environment> <redirect-uri> <origin>",
  );

const oauth = JSON.parse(readFileSync(oauthPath, "utf8"));
const clientId = oauth?.web?.client_id;
const clientSecret = oauth?.web?.client_secret;
const redirectUris = oauth?.web?.redirect_uris;
const javascriptOrigins = oauth?.web?.javascript_origins;
if (
  typeof clientId !== "string" ||
  !clientId.endsWith(".apps.googleusercontent.com") ||
  typeof clientSecret !== "string" ||
  clientSecret.length < 20
)
  throw new Error("The OAuth JSON does not contain a valid web client.");
if (!redirectUris?.includes(expectedRedirectUri))
  throw new Error("The OAuth client is missing the production redirect URI.");
if (!javascriptOrigins?.includes(expectedOrigin))
  throw new Error("The OAuth client is missing the production JavaScript origin.");

const source = readFileSync(environmentPath, "utf8");
const values = new Map([
  ["THNK_PP_GOOGLE_CLIENT_ID", clientId],
  ["THNK_PP_GOOGLE_CLIENT_SECRET", clientSecret],
  ["THNK_PP_GOOGLE_REDIRECT_URI", expectedRedirectUri],
]);
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
const backupPath = `${environmentPath}.before-google-${stamp}`;
const temporaryPath = `${environmentPath}.google-${process.pid}.tmp`;
copyFileSync(environmentPath, backupPath);
chmodSync(backupPath, 0o600);
writeFileSync(temporaryPath, `${lines.filter(Boolean).join("\n")}\n`, {
  mode: 0o600,
});
renameSync(temporaryPath, environmentPath);
chmodSync(environmentPath, 0o600);
chmodSync(oauthPath, 0o600);

console.log(
  JSON.stringify({
    status: "configured",
    backupPath,
    redirectUri: expectedRedirectUri,
    origin: expectedOrigin,
    secretPrinted: false,
  }),
);
