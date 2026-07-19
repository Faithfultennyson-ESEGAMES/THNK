const fs = require("fs");
const path = require("path");
const { exportServer } = require("../m2/server-bundle");
const { prepareFixture } = require("./prepare-fixture");

const repositoryRoot = path.resolve(__dirname, "../..");
const generatedRoot = path.join(repositoryRoot, ".generated/m5");
const outputPath = path.join(generatedRoot, "server-bundle");

if (!outputPath.startsWith(`${generatedRoot}${path.sep}`))
  throw new Error("Refusing to replace a fixture outside .generated/m5.");
fs.rmSync(outputPath, { recursive: true, force: true });

const result = exportServer({
  projectPath: prepareFixture(),
  outputPath,
  compatibilityVersion: "m5-v1",
  clientBuildId: "m5-client-v1",
});
console.log(`M5 multi-authority bundle ready: ${result.bundlePath}`);
console.log(`Server build ID: ${result.manifest.build.serverBuildId}`);
