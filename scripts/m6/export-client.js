const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { prepareFixture } = require("./prepare-fixture");

const repositoryRoot = path.resolve(__dirname, "../..");
const clientRoot = path.join(repositoryRoot, ".generated/m6/client");
const projectPath = path.join(clientRoot, "game.json");
const buildPath = path.join(clientRoot, "build");
const extensionPaths = [
  "extensions/THNK.json",
  "extensions/THNK_GeckosServer.json",
  "extensions/THNK_GeckosClient.json",
].map((relativePath) => path.join(repositoryRoot, relativePath));
const gdevelopBin =
  process.env.GDEVELOP_BIN ||
  [
    "D:/Apps/GDevelop/GDevelop.exe",
    `${process.env.LOCALAPPDATA || ""}/Programs/GDevelop/GDevelop.exe`,
  ].find((candidate) => fs.existsSync(candidate)) ||
  "gdevelop";
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

const project = JSON.parse(fs.readFileSync(prepareFixture(), "utf8"));
project.firstLayout = "ClientBootstrap";
project.layouts.sort((left, right) => {
  if (left.name === project.firstLayout) return -1;
  if (right.name === project.firstLayout) return 1;
  return 0;
});
project.properties.latestCompilationDirectory = buildPath;
fs.mkdirSync(clientRoot, { recursive: true });
fs.rmSync(buildPath, { recursive: true, force: true });
fs.writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`);

const run = (command, arguments_ = []) => {
  const result = spawnSync(
    gdevelopBin,
    [
      "--no-sandbox",
      "--disable-update-check",
      `--user-data-dir=${path.join(clientRoot, ".gdevelop")}`,
      "--run-command",
      command,
      ...arguments_,
      projectPath,
    ],
    { encoding: "utf8", env: environment }
  );
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  process.stdout.write(output);
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`GDevelop ${command} failed (exit ${result.status}).`);
  if (output.includes('[renderer:info] Error: "'))
    throw new Error(`GDevelop ${command} reported an event compilation error.`);
};

run(
  "IMPORT_EXTENSION_AND_SAVE",
  extensionPaths.flatMap((extensionPath) => ["--cmd-args", extensionPath])
);
run("EXPORT_HTML5_EXTERNAL");

const indexPath = path.join(buildPath, "index.html");
if (!fs.existsSync(indexPath))
  throw new Error("GDevelop did not create the M6 client index.html.");
for (const fileName of fs.readdirSync(buildPath)) {
  if (!/^code\d+\.js$/.test(fileName)) continue;
  if (
    fs
      .readFileSync(path.join(buildPath, fileName), "utf8")
      .includes("Unknown instruction - skipped")
  )
    throw new Error(`GDevelop skipped an instruction in ${fileName}.`);
}
console.log(`Exported M6 client fixture: ${indexPath}`);
