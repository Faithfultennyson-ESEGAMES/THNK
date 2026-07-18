const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const FORMAT_VERSION = 1;
const ELECTRON_VERSION = "32.3.3";
const ELECTRON_REMOTE_VERSION = "2.1.2";
const GECKOS_VERSION = "^2.2.3";
const repositoryRoot = path.resolve(__dirname, "../..");
const runtimeTemplate = path.join(__dirname, "runtime");
const extensionPaths = [
  "extensions/THNK.json",
  "extensions/THNK_GeckosServer.json",
  "extensions/THNK_GeckosClient.json",
].map((relativePath) => path.join(repositoryRoot, relativePath));

const getGDevelopBin = () => {
  const candidates = [
    process.env.GDEVELOP_BIN,
    "D:/Apps/GDevelop/GDevelop.exe",
    `${process.env.LOCALAPPDATA || ""}/Programs/GDevelop/GDevelop.exe`,
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || "gdevelop";
};

const instructionType = (instruction) => instruction?.type?.value;
const walkEvents = function* (events = []) {
  for (const event of events) {
    yield event;
    yield* walkEvents(event.events);
  }
};

const findServerEntry = (project) => {
  const matches = [];
  for (const layout of project.layouts || []) {
    for (const event of walkEvents(layout.events)) {
      for (const action of event.actions || []) {
        if (instructionType(action) !== "THNK_GeckosServer::HostServer")
          continue;
        const port = Number(action.parameters?.[1]);
        const gameScene = String(action.parameters?.[2] || "").replace(
          /^"|"$/g,
          ""
        );
        matches.push({ bootstrapScene: layout.name, gameScene, port });
      }
    }
  }
  if (matches.length !== 1)
    throw new Error(
      `Expected exactly one Geckos HostServer action, found ${matches.length}.`
    );
  const entry = matches[0];
  if (!Number.isInteger(entry.port) || entry.port < 1 || entry.port > 65_535)
    throw new Error(
      "The Geckos HostServer port must be a literal from 1 to 65535."
    );
  if (!project.layouts.some((layout) => layout.name === entry.gameScene))
    throw new Error(`Server game scene '${entry.gameScene}' does not exist.`);
  return entry;
};

const listFiles = (root, current = root) => {
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
    if (entry.isDirectory()) files.push(...listFiles(root, absolutePath));
    else if (entry.isFile()) files.push(relativePath);
    else throw new Error(`Unsupported bundle entry: ${relativePath}.`);
  }
  return files.sort();
};

const hashBundleContent = (bundlePath) => {
  const hash = crypto.createHash("sha256");
  for (const relativePath of listFiles(bundlePath)) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(bundlePath, relativePath)));
    hash.update("\0");
  }
  return hash.digest("hex");
};

const runGDevelop = (arguments_, cwd) => {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(getGDevelopBin(), arguments_, {
    cwd,
    encoding: "utf8",
    env: environment,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  if (output) process.stdout.write(output);
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`GDevelop exited with code ${result.status}.`);
  if (output.includes('[renderer:info] Error: "'))
    throw new Error("GDevelop reported an event compilation error.");
  return output;
};

const assertGeneratedCode = (serverDirectory) => {
  const indexPath = path.join(serverDirectory, "index.html");
  if (!fs.existsSync(indexPath))
    throw new Error("GDevelop did not create server/index.html.");
  for (const fileName of fs.readdirSync(serverDirectory)) {
    if (!/^code\d+\.js$/.test(fileName)) continue;
    const code = fs.readFileSync(path.join(serverDirectory, fileName), "utf8");
    if (code.includes("Unknown instruction - skipped"))
      throw new Error(
        `GDevelop skipped an unknown instruction in ${fileName}.`
      );
  }
};

const normalizeGeneratedIdentifiers = (serverDirectory) => {
  for (const fileName of fs.readdirSync(serverDirectory)) {
    if (!fileName.endsWith(".js")) continue;
    const filePath = path.join(serverDirectory, fileName);
    const source = fs.readFileSync(filePath, "utf8");
    const identifiers = new Map();
    const normalized = source.replace(
      /\buserFunc0x[0-9a-fA-F]+\b/g,
      (identifier) => {
        if (!identifiers.has(identifier))
          identifiers.set(identifier, `userFunc${identifiers.size}`);
        return identifiers.get(identifier);
      }
    );
    if (normalized !== source) fs.writeFileSync(filePath, normalized);
  }
};

const patchRuntimeOptions = (serverDirectory) => {
  const dataPath = path.join(serverDirectory, "data.js");
  const source = fs.readFileSync(dataPath, "utf8");
  const marker = "gdjs.runtimeGameOptions = {};";
  if (!source.includes(marker))
    throw new Error("Could not locate GDevelop runtime options in data.js.");
  const patched = source
    .replace(
      marker,
      "gdjs.runtimeGameOptions = { thnkGeckosBridgePath: process.env.THNK_GECKOS_BRIDGE_PATH };"
    )
    .replace(
      /"latestCompilationDirectory":"(?:\\.|[^"\\])*"/,
      '"latestCompilationDirectory":""'
    );
  fs.writeFileSync(dataPath, patched);

  const indexPath = path.join(serverDirectory, "index.html");
  const indexSource = fs.readFileSync(indexPath, "utf8");
  const constructor = "new gdjs.RuntimeGame(gdjs.projectData, {});";
  if (!indexSource.includes(constructor))
    throw new Error("Could not locate the GDevelop RuntimeGame bootstrap.");
  fs.writeFileSync(
    indexPath,
    indexSource.replace(
      constructor,
      "new gdjs.RuntimeGame(gdjs.projectData, gdjs.runtimeGameOptions);"
    )
  );
};

const makePackageName = (name) =>
  `${
    String(name || "game")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "game"
  }-thnk-server`;

const writeBundleFiles = (bundlePath, project, entry) => {
  fs.cpSync(runtimeTemplate, path.join(bundlePath, "runtime"), {
    recursive: true,
  });
  const packageData = {
    name: makePackageName(project.properties?.name),
    private: true,
    version: project.properties?.version || "1.0.0",
    main: "runtime/main.cjs",
    engines: { node: ">=18" },
    scripts: { start: "electron ." },
    dependencies: {
      "@electron/remote": ELECTRON_REMOTE_VERSION,
      "@geckos.io/server": GECKOS_VERSION,
      electron: ELECTRON_VERSION,
    },
  };
  fs.writeFileSync(
    path.join(bundlePath, "package.json"),
    `${JSON.stringify(packageData, null, 2)}\n`
  );
  fs.copyFileSync(
    path.join(repositoryRoot, "yarn.lock"),
    path.join(bundlePath, "yarn.lock")
  );
  fs.writeFileSync(
    path.join(bundlePath, "config.example.env"),
    "THNK_SERVER_START_TIMEOUT_MS=30000\n"
  );
  fs.writeFileSync(
    path.join(bundlePath, "README.md"),
    `# ${project.properties?.name || "GDevelop"} THNK server\n\n` +
      `Generated server entry: \`${entry.bootstrapScene}\` -> \`${entry.gameScene}\`.\n\n` +
      "```text\ncorepack yarn install --frozen-lockfile --production=true\nyarn start\n```\n\n" +
      `The authoritative Geckos server listens on port ${entry.port}. ` +
      "The Electron window is created hidden; stop with SIGINT or SIGTERM.\n"
  );
};

const exportServer = ({ projectPath, outputPath }) => {
  const sourcePath = path.resolve(projectPath);
  const destination = path.resolve(outputPath);
  if (!fs.existsSync(sourcePath))
    throw new Error(`Project does not exist: ${sourcePath}`);
  if (fs.existsSync(destination))
    throw new Error(`Output already exists: ${destination}`);

  const project = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const entry = findServerEntry(project);
  project.firstLayout = entry.bootstrapScene;
  project.layouts.sort((left, right) =>
    left.name === entry.bootstrapScene
      ? -1
      : right.name === entry.bootstrapScene
      ? 1
      : 0
  );

  const parent = path.dirname(destination);
  fs.mkdirSync(parent, { recursive: true });
  const staging = fs.mkdtempSync(path.join(parent, ".thnk-export-"));
  const projectBuildPath = path.join(staging, "game.json");
  const serverDirectory = path.join(staging, "server");
  const gdevelopProfile = path.join(staging, ".gdevelop");
  project.properties.latestCompilationDirectory = "server";

  try {
    fs.writeFileSync(projectBuildPath, `${JSON.stringify(project, null, 2)}\n`);
    runGDevelop(
      [
        "--no-sandbox",
        "--disable-update-check",
        `--user-data-dir=${gdevelopProfile}`,
        "--run-command",
        "IMPORT_EXTENSION_AND_SAVE",
        ...extensionPaths.flatMap((extensionPath) => [
          "--cmd-args",
          extensionPath,
        ]),
        projectBuildPath,
      ],
      staging
    );
    runGDevelop(
      [
        "--no-sandbox",
        "--disable-update-check",
        `--user-data-dir=${gdevelopProfile}`,
        "--run-command",
        "EXPORT_HTML5_EXTERNAL",
        projectBuildPath,
      ],
      staging
    );
    assertGeneratedCode(serverDirectory);
    normalizeGeneratedIdentifiers(serverDirectory);
    patchRuntimeOptions(serverDirectory);
    writeBundleFiles(staging, project, entry);
    fs.rmSync(projectBuildPath, { force: true });
    fs.rmSync(gdevelopProfile, { recursive: true, force: true });

    const buildTime = process.env.SOURCE_DATE_EPOCH
      ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
      : new Date().toISOString();
    const manifest = {
      formatVersion: FORMAT_VERSION,
      project: {
        name: project.properties?.name || "",
        uuid: project.properties?.projectUuid || "",
        version: project.properties?.version || "1.0.0",
      },
      buildTime,
      transport: "geckos",
      entry,
      runtime: {
        kind: "hidden-electron",
        entryPoint: "runtime/main.cjs",
        serverDirectory: "server",
        port: entry.port,
        electronVersion: ELECTRON_VERSION,
      },
      contentHash: { algorithm: "sha256", value: "" },
    };
    fs.writeFileSync(
      path.join(staging, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`
    );
    manifest.contentHash.value = hashBundleContent(staging);
    fs.writeFileSync(
      path.join(staging, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`
    );
    fs.renameSync(staging, destination);
    return { bundlePath: destination, manifest };
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
};

const validateBundle = (bundlePath) => {
  const root = path.resolve(bundlePath);
  const manifestPath = path.join(root, "manifest.json");
  if (!fs.existsSync(manifestPath))
    throw new Error("Bundle is missing manifest.json.");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.formatVersion !== FORMAT_VERSION)
    throw new Error(`Unsupported bundle format: ${manifest.formatVersion}.`);
  if (manifest.transport !== "geckos")
    throw new Error(`Unsupported transport: ${manifest.transport}.`);
  if (manifest.runtime?.kind !== "hidden-electron")
    throw new Error(`Unsupported runtime: ${manifest.runtime?.kind}.`);
  if (manifest.contentHash?.algorithm !== "sha256")
    throw new Error("Bundle must use a SHA-256 content hash.");
  if (
    !Number.isInteger(manifest.runtime?.port) ||
    manifest.runtime.port < 1 ||
    manifest.runtime.port > 65_535
  )
    throw new Error("Bundle contains an invalid server port.");
  if (manifest.entry?.port !== manifest.runtime.port)
    throw new Error("Bundle entry port does not match its runtime port.");
  const resolveInsideBundle = (relativePath) => {
    const absolutePath = path.resolve(root, relativePath || "");
    if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`))
      throw new Error(`Bundle path escapes its root: ${relativePath}.`);
    return absolutePath;
  };
  for (const relativePath of [
    manifest.runtime?.entryPoint,
    `${manifest.runtime?.serverDirectory}/index.html`,
    "runtime/geckos-bridge.cjs",
    "package.json",
    "yarn.lock",
  ]) {
    if (!relativePath || !fs.existsSync(resolveInsideBundle(relativePath)))
      throw new Error(`Bundle is missing ${relativePath || "a runtime path"}.`);
  }
  const packageData = JSON.parse(
    fs.readFileSync(resolveInsideBundle("package.json"), "utf8")
  );
  if (packageData.main !== manifest.runtime.entryPoint)
    throw new Error("Bundle package entry point does not match its manifest.");
  for (const dependency of [
    "@electron/remote",
    "@geckos.io/server",
    "electron",
  ])
    if (!packageData.dependencies?.[dependency])
      throw new Error(`Bundle is missing runtime dependency ${dependency}.`);
  if (packageData.dependencies.electron !== manifest.runtime.electronVersion)
    throw new Error(
      "Bundle Electron dependency does not match its manifest version."
    );
  const actualHash = hashBundleContent(root);
  if (actualHash !== manifest.contentHash?.value)
    throw new Error(
      `Bundle content hash mismatch: expected ${manifest.contentHash?.value}, got ${actualHash}.`
    );
  return { bundlePath: root, manifest, contentHash: actualHash };
};

const runBundle = (bundlePath) => {
  const validation = validateBundle(bundlePath);
  let electronModule;
  try {
    electronModule = require.resolve("electron", {
      paths: [validation.bundlePath],
    });
  } catch {
    throw new Error(
      "Electron is not installed in the bundle. Run npm install first."
    );
  }
  const electronPath = require(electronModule);
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronPath, [validation.bundlePath], {
    env: environment,
    stdio: "inherit",
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => child.kill(signal));
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Server stopped by ${signal}.`));
      else resolve(code || 0);
    });
  });
};

module.exports = {
  FORMAT_VERSION,
  exportServer,
  findServerEntry,
  hashBundleContent,
  normalizeGeneratedIdentifiers,
  patchRuntimeOptions,
  runBundle,
  validateBundle,
};
