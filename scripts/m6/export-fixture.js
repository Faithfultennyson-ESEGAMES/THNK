const path = require("path");
const { exportServer } = require("../m2/server-bundle");
const { prepareFixture } = require("./prepare-fixture");

const generatedRoot = path.resolve(__dirname, "../../.generated/m6");
const result = exportServer({
  projectPath: prepareFixture(),
  outputPath: path.join(generatedRoot, "server-bundle"),
  compatibilityVersion: "m6-v1",
  clientBuildId: "m6-client-v1",
});
console.log(`Exported M6 fixture: ${result.bundlePath}`);
console.log(`Server build ID: ${result.manifest.build.serverBuildId}`);
