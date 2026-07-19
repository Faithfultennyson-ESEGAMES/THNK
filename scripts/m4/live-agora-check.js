const fs = require("fs");
const path = require("path");

const secretPath = path.resolve(
  process.env.THNK_AGORA_SECRET_FILE || "D:/CodexTools/THNK-v1/agora-m4.json"
);
if (!fs.existsSync(secretPath))
  throw new Error(
    `Agora secret file not found at ${secretPath}. Keep it outside the repository.`
  );

let secret;
try {
  const buffer = fs.readFileSync(secretPath);
  const contents = (
    buffer[0] === 0xff && buffer[1] === 0xfe
      ? buffer.subarray(2).toString("utf16le")
      : buffer.toString("utf8")
  ).replace(/^\uFEFF/, "");
  if (contents.trimStart().startsWith("{")) secret = JSON.parse(contents);
  else {
    const values = {};
    for (const line of contents.split(/\r?\n/)) {
      if (!line.trim() || line.trimStart().startsWith("#")) continue;
      const match =
        /^\s*(AGORA_APP_ID|AGORA_APP_CERTIFICATE)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match) throw new Error("invalid_line");
      values[match[1]] = match[2]
        .replace(/,\s*$/, "")
        .replace(/^(?:"(.*)"|'(.*)')$/, "$1$2");
    }
    secret = {
      appId: values.AGORA_APP_ID,
      appCertificate: values.AGORA_APP_CERTIFICATE,
    };
  }
  secret = {
    appId: secret.appId || secret.AGORA_APP_ID,
    appCertificate:
      secret.appCertificate || secret.AGORA_APP_CERTIFICATE,
  };
} catch {
  throw new Error(
    "Agora secret file must contain valid JSON or AGORA_APP_ID/AGORA_APP_CERTIFICATE lines."
  );
}
if (!/^[a-f0-9]{32}$/i.test(secret.appId || ""))
  throw new Error("Agora secret file contains an invalid appId.");
if (!/^[a-f0-9]{32}$/i.test(secret.appCertificate || ""))
  throw new Error("Agora secret file contains an invalid appCertificate.");

process.env.AGORA_APP_ID = secret.appId;
process.env.AGORA_APP_CERTIFICATE = secret.appCertificate;
process.env.THNK_M4_CHECK = "true";
process.env.THNK_M4_LIVE = "true";
secret = undefined;

require("../m3/integration-check.js");
