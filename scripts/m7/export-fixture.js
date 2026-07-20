const fs = require("fs");
const path = require("path");
const { exportServer } = require("../m2/server-bundle");
const { prepareFixture } = require("./prepare-fixture");

const generatedRoot = path.resolve(__dirname, "../../.generated/m7");
const bundlePath = path.join(generatedRoot, "server-bundle");
fs.rmSync(bundlePath, { recursive: true, force: true });
const result = exportServer({
  projectPath: prepareFixture(),
  outputPath: bundlePath,
  compatibilityVersion: "m7-v1",
  clientBuildId: "m7-client-v1",
});
console.log(`Exported M7 fixture: ${result.bundlePath}`);
console.log(`Server build ID: ${result.manifest.build.serverBuildId}`);
