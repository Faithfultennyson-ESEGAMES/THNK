const fs = require("fs");
const path = require("path");
const { exportServer } = require("./server-bundle");

const repositoryRoot = path.resolve(__dirname, "../..");
const generatedRoot = path.resolve(repositoryRoot, ".generated/m2");
const outputPath = path.resolve(generatedRoot, "server-bundle");

if (!outputPath.startsWith(`${generatedRoot}${path.sep}`))
  throw new Error("Refusing to replace a fixture outside .generated/m2.");
fs.rmSync(outputPath, { recursive: true, force: true });

const result = exportServer({
  projectPath: path.join(
    repositoryRoot,
    "fixtures/m1-remote-authority/game.json"
  ),
  outputPath,
});
console.log(`M2 fixture bundle ready: ${result.bundlePath}`);
