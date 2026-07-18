const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const repositoryRoot = path.resolve(__dirname, "../..");
const projectPath = path.join(repositoryRoot, ".generated/m1/client/game.json");
const commonWindowsCandidates = [
  "D:/Apps/GDevelop/GDevelop.exe",
  `${process.env.LOCALAPPDATA || ""}/Programs/GDevelop/GDevelop.exe`,
];
const gdevelopBin =
  process.env.GDEVELOP_BIN ||
  commonWindowsCandidates.find((candidate) => fs.existsSync(candidate)) ||
  "gdevelop";

if (!fs.existsSync(projectPath))
  throw new Error("Run yarn fixture:m1:prepare before exporting the client.");

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const result = spawnSync(
  gdevelopBin,
  [
    "--no-sandbox",
    "--disable-update-check",
    `--user-data-dir=${path.join(
      repositoryRoot,
      ".generated/m1/gdevelop-export"
    )}`,
    "--run-command",
    "EXPORT_HTML5_EXTERNAL",
    projectPath,
  ],
  { encoding: "utf8", env: environment }
);

const output = `${result.stdout || ""}${result.stderr || ""}`;
process.stdout.write(output);
if (result.error) throw result.error;
if (result.status !== 0)
  throw new Error(`GDevelop client export failed (exit ${result.status}).`);

const compilationErrors = output
  .split(/\r?\n/)
  .filter((line) => line.includes('[renderer:info] Error: "'));
if (compilationErrors.length)
  throw new Error(
    `GDevelop reported ${compilationErrors.length} event compilation error(s).`
  );

const indexPath = path.join(
  repositoryRoot,
  ".generated/m1/client/build/index.html"
);
if (!fs.existsSync(indexPath))
  throw new Error(
    "GDevelop reported success but did not create client build/index.html."
  );

const generatedCodeFiles = fs
  .readdirSync(path.dirname(indexPath))
  .filter((fileName) => /^code\d+\.js$/.test(fileName));
for (const fileName of generatedCodeFiles) {
  const generatedCode = fs.readFileSync(
    path.join(path.dirname(indexPath), fileName),
    "utf8"
  );
  if (generatedCode.includes("Unknown instruction - skipped"))
    throw new Error(`GDevelop skipped an unknown instruction in ${fileName}.`);
}

console.log(`Exported client fixture: ${indexPath}`);
