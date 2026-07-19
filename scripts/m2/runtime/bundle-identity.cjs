const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const validIdentifier = (value) =>
  typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);

const listContentFiles = (root, current = root) => {
  const files = [];
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const absolutePath = path.join(current, entry.name);
    const relativePath = path.relative(root, absolutePath).replace(/\\/g, "/");
    if (
      relativePath === "manifest.json" ||
      relativePath === "node_modules" ||
      relativePath.startsWith("node_modules/")
    )
      continue;
    if (entry.isDirectory())
      files.push(...listContentFiles(root, absolutePath));
    else if (entry.isFile()) files.push(relativePath);
    else throw new Error(`Unsupported bundle entry: ${relativePath}.`);
  }
  return files.sort();
};

const hashBundleContent = (root) => {
  const hash = crypto.createHash("sha256");
  for (const relativePath of listContentFiles(root)) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(root, relativePath)));
    hash.update("\0");
  }
  return hash.digest("hex");
};

const loadBundleIdentity = ({
  bundleRoot,
  requestedAuthorityId,
  requestedMapId,
  expectedServerBuildId,
}) => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(bundleRoot, "manifest.json"), "utf8")
  );
  if (manifest.formatVersion !== 4)
    throw new Error(`Unsupported bundle format: ${manifest.formatVersion}.`);

  const actualHash = hashBundleContent(bundleRoot);
  if (manifest.contentHash?.value !== actualHash)
    throw new Error("Bundle content hash verification failed.");
  const serverBuildId = `sha256:${actualHash}`;
  if (manifest.build?.serverBuildId !== serverBuildId)
    throw new Error("Bundle server build ID verification failed.");
  if (
    expectedServerBuildId &&
    expectedServerBuildId !== manifest.build.serverBuildId
  )
    throw new Error(
      "THNK_EXPECTED_SERVER_BUILD_ID does not match this bundle."
    );

  const authorityIds = Object.keys(manifest.authorities || {});
  if (!authorityIds.length) throw new Error("Bundle has no authorities.");
  const authorityId =
    requestedAuthorityId || (authorityIds.length === 1 ? authorityIds[0] : "");
  if (!authorityId)
    throw new Error(
      "THNK_AUTHORITY_ID is required when a bundle declares multiple authorities."
    );
  if (!validIdentifier(authorityId) || !manifest.authorities[authorityId])
    throw new Error(`Unknown THNK authority ID '${authorityId}'.`);
  if (requestedMapId && !validIdentifier(requestedMapId))
    throw new Error("THNK_MAP_ID must be a valid identifier.");

  for (const value of [
    manifest.project?.gameId,
    manifest.build?.compatibilityVersion,
    manifest.build?.clientBuildId,
    manifest.build?.protocolVersion,
  ])
    if (!validIdentifier(value))
      throw new Error("Bundle contains invalid compatibility identity.");

  return Object.freeze({
    manifest,
    gameId: manifest.project.gameId,
    authorityId,
    mapId: requestedMapId || "",
    bootstrapScene: manifest.authorities[authorityId].bootstrapScene,
    gameScene: manifest.authorities[authorityId].gameScene,
    serverBuildId,
    compatibilityVersion: manifest.build.compatibilityVersion,
    clientBuildId: manifest.build.clientBuildId,
    protocolVersion: manifest.build.protocolVersion,
  });
};

module.exports = { hashBundleContent, loadBundleIdentity, validIdentifier };
