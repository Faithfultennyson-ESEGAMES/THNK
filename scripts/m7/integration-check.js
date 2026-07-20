const { spawn } = require("child_process");
const path = require("path");

const repositoryRoot = path.resolve(__dirname, "../..");
const child = spawn(
  process.execPath,
  [path.join(__dirname, "../m3/integration-check.js")],
  {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      THNK_M7_CHECK: "true",
      THNK_TEST_BUNDLE: path.join(
        repositoryRoot,
        ".generated/m7/server-bundle"
      ),
      THNK_TEST_CLIENT_BUILD: path.join(
        repositoryRoot,
        ".generated/m7/client/build"
      ),
      THNK_AUTHORITY_ID: "duel",
    },
    stdio: "inherit",
  }
);
child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
