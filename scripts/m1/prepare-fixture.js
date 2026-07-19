const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const repositoryRoot = path.resolve(__dirname, "../..");
const sourceProjectPath = path.join(
  repositoryRoot,
  "fixtures/m1-remote-authority/game.json"
);
const generatedRoot = path.join(repositoryRoot, ".generated/m1");
const extensionPaths = [
  "extensions/THNK.json",
  "extensions/THNK_GeckosServer.json",
  "extensions/THNK_GeckosClient.json",
].map((relativePath) => path.join(repositoryRoot, relativePath));

const commonWindowsCandidates = [
  "D:/Apps/GDevelop/GDevelop.exe",
  `${process.env.LOCALAPPDATA || ""}/Programs/GDevelop/GDevelop.exe`,
];
const gdevelopBin =
  process.env.GDEVELOP_BIN ||
  commonWindowsCandidates.find((candidate) => fs.existsSync(candidate)) ||
  "gdevelop";

const sourceProject = JSON.parse(fs.readFileSync(sourceProjectPath, "utf8"));
const serverHost = process.env.THNK_FIXTURE_SERVER_HOST || "127.0.0.1";
const gdevelopEnvironment = { ...process.env };
// VS Code's extension host sets this globally, which would make Electron run
// GDevelop.exe as a plain Node binary and reject all GDevelop CLI arguments.
delete gdevelopEnvironment.ELECTRON_RUN_AS_NODE;

const setClientServerHost = (project) => {
  let connectionActions = 0;
  const visitEvents = (events = []) => {
    for (const event of events) {
      for (const action of event.actions || []) {
        if (action.type?.value !== "THNK_GeckosClient::ConnectToServer")
          continue;
        action.parameters[1] = JSON.stringify(serverHost);
        connectionActions++;
      }
      visitEvents(event.events);
    }
  };
  for (const layout of project.layouts || []) visitEvents(layout.events);
  if (connectionActions !== 1)
    throw new Error(
      `Expected exactly one Geckos ConnectToServer action, found ${connectionActions}.`
    );
};

const writeVariant = (name, firstLayout, configure = () => {}) => {
  const variantDirectory = path.join(generatedRoot, name);
  const projectPath = path.join(variantDirectory, "game.json");
  const project = structuredClone(sourceProject);
  configure(project);
  project.firstLayout = firstLayout;
  project.layouts.sort((left, right) => {
    if (left.name === firstLayout) return -1;
    if (right.name === firstLayout) return 1;
    return 0;
  });
  project.properties.latestCompilationDirectory = path.join(
    variantDirectory,
    "build"
  );

  fs.mkdirSync(variantDirectory, { recursive: true });
  fs.writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`);

  const result = spawnSync(
    gdevelopBin,
    [
      "--no-sandbox",
      "--disable-update-check",
      `--user-data-dir=${path.join(generatedRoot, `gdevelop-${name}`)}`,
      "--run-command",
      "IMPORT_EXTENSION_AND_SAVE",
      ...extensionPaths.flatMap((extensionPath) => [
        "--cmd-args",
        extensionPath,
      ]),
      projectPath,
    ],
    { encoding: "utf8", stdio: "inherit", env: gdevelopEnvironment }
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `GDevelop failed to prepare ${name} (exit ${result.status}).`
    );

  return projectPath;
};

const serverProject = writeVariant("server", "ServerBootstrap");
const clientProject = writeVariant(
  "client",
  "ClientBootstrap",
  setClientServerHost
);

console.log(`Prepared server fixture: ${serverProject}`);
console.log(`Prepared client fixture: ${clientProject}`);
