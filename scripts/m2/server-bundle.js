const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const FORMAT_VERSION = 3;
const ELECTRON_VERSION = "32.3.3";
const ELECTRON_REMOTE_VERSION = "2.1.2";
const GECKOS_VERSION = "3.1.0";
const AGORA_TOKEN_VERSION = "2.0.5";
const NODE_VERSION_RANGE = "18.20.x";
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
    const identifiersByPrefix = new Map();
    const normalized = source.replace(
      /(\b(?:[A-Za-z_$][\w$]*\.)+)(userFunc(?:0x[0-9a-fA-F]+|[0-9]+))\b/g,
      (_qualifiedIdentifier, prefix, identifier) => {
        let identifiers = identifiersByPrefix.get(prefix);
        if (!identifiers) {
          identifiers = new Map();
          identifiersByPrefix.set(prefix, identifiers);
        }
        if (!identifiers.has(identifier))
          identifiers.set(identifier, `userFunc${identifiers.size}`);
        return `${prefix}${identifiers.get(identifier)}`;
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

const getDefaultControlPort = (serverPort) =>
  serverPort < 65_535 ? serverPort + 1 : 9209;

const writeBundleFiles = (bundlePath, project, entry) => {
  fs.cpSync(runtimeTemplate, path.join(bundlePath, "runtime"), {
    recursive: true,
  });
  const packageData = {
    name: makePackageName(project.properties?.name),
    private: true,
    version: project.properties?.version || "1.0.0",
    main: "runtime/main.cjs",
    engines: { node: NODE_VERSION_RANGE },
    scripts: { start: "electron ." },
    dependencies: {
      "@electron/remote": ELECTRON_REMOTE_VERSION,
      "@geckos.io/server": GECKOS_VERSION,
      "agora-token": AGORA_TOKEN_VERSION,
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
    `THNK_SERVER_START_TIMEOUT_MS=30000\n` +
      `THNK_BRIDGE_ENABLED=false\n` +
      `THNK_CONTROL_HOST=127.0.0.1\n` +
      `THNK_CONTROL_PORT=${getDefaultControlPort(entry.port)}\n` +
      `THNK_CONTROL_TOKEN=\n` +
      `THNK_WEBHOOK_SECRET=\n` +
      `THNK_ALLOW_INSECURE_CALLBACKS=false\n` +
      `THNK_VOICE_ENABLED=false\n` +
      `AGORA_APP_ID=\n` +
      `AGORA_APP_CERTIFICATE=\n` +
      `THNK_VOICE_TOKEN_URL=\n` +
      `THNK_ALLOW_INSECURE_VOICE_TOKEN_URL=false\n` +
      `THNK_VOICE_TOKEN_TTL_SECONDS=600\n` +
      `THNK_VOICE_MIN_REFRESH_INTERVAL_MS=5000\n` +
      `THNK_VOICE_MAX_REFRESHES_PER_MINUTE=8\n`
  );
  fs.writeFileSync(
    path.join(bundlePath, "README.md"),
    `# ${project.properties?.name || "GDevelop"} THNK server\n\n` +
      `Generated server entry: \`${entry.bootstrapScene}\` -> \`${entry.gameScene}\`.\n\n` +
      `Use Node ${NODE_VERSION_RANGE} and Yarn 1.22.x.\n\n` +
      "```text\ncorepack yarn install --frozen-lockfile --production=true\nyarn start\n```\n\n" +
      "On a displayless Ubuntu 24.04 host, install Electron's runtime libraries and Xvfb, configure Electron's sandbox, then launch inside the virtual display:\n\n" +
      "```text\nsudo apt-get update\nsudo apt-get install -y xvfb libgtk-3-0 libnss3 libasound2t64 libgbm1 libxss1 libx11-xcb1 libdrm2 libxkbcommon0 libatk-bridge2.0-0 libcups2 libatspi2.0-0 fonts-liberation\nsudo chown root:root node_modules/electron/dist/chrome-sandbox\nsudo chmod 4755 node_modules/electron/dist/chrome-sandbox\nxvfb-run -a --server-args='-screen 0 1024x768x24' yarn start\n```\n\n" +
      `The authoritative Geckos server listens on port ${entry.port}. ` +
      "The Electron window is created hidden; stop with SIGINT or SIGTERM.\n\n" +
      "## Matchmaking bridge\n\n" +
      "The bridge is disabled by default, preserving direct THNK connections. To enable it, copy the values from `config.example.env` into the server environment, set `THNK_BRIDGE_ENABLED=true`, and provide independently generated random values of at least 32 characters for `THNK_CONTROL_TOKEN` and `THNK_WEBHOOK_SECRET`. Never place either secret in a game client.\n\n" +
      `The v1 control API defaults to \`127.0.0.1:${getDefaultControlPort(
        entry.port
      )}\`. Bind its control routes only to a private or otherwise protected interface. Player admission JWTs are sent to Geckos in the HTTP \`Authorization\` header, never in a URL. Plain HTTP callback URLs are accepted only for loopback development when \`THNK_ALLOW_INSECURE_CALLBACKS=true\`.\n\n` +
      "## Agora session voice\n\n" +
      "Voice is opt-in. Set `THNK_VOICE_ENABLED=true`, inject `AGORA_APP_ID` and `AGORA_APP_CERTIFICATE` as server secrets, and set the public HTTPS `THNK_VOICE_TOKEN_URL` to the externally routed `/v1/voice/token` endpoint. Expose only that route to game clients; keep the other control routes private. The App Certificate must never be placed in a client export, URL, log, or source file. Loopback HTTP is available only for development with `THNK_ALLOW_INSECURE_VOICE_TOKEN_URL=true`.\n"
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
        nodeVersion: NODE_VERSION_RANGE,
      },
      control: {
        apiVersion: "v1",
        defaultHost: "127.0.0.1",
        defaultPort: getDefaultControlPort(entry.port),
        admissionTransport: "authorization-header",
        enabledByEnvironment: "THNK_BRIDGE_ENABLED",
      },
      voice: {
        provider: "agora",
        tokenEndpoint: "/v1/voice/token",
        enabledByEnvironment: "THNK_VOICE_ENABLED",
        credentials: ["AGORA_APP_ID", "AGORA_APP_CERTIFICATE"],
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
  if (
    manifest.control?.apiVersion !== "v1" ||
    manifest.control?.admissionTransport !== "authorization-header" ||
    manifest.control?.enabledByEnvironment !== "THNK_BRIDGE_ENABLED" ||
    !Number.isInteger(manifest.control?.defaultPort) ||
    manifest.control.defaultPort < 1 ||
    manifest.control.defaultPort > 65_535 ||
    manifest.control.defaultPort === manifest.runtime.port
  )
    throw new Error("Bundle contains an invalid control API configuration.");
  const resolveInsideBundle = (relativePath) => {
    const absolutePath = path.resolve(root, relativePath || "");
    if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`))
      throw new Error(`Bundle path escapes its root: ${relativePath}.`);
    return absolutePath;
  };
  for (const relativePath of [
    manifest.runtime?.entryPoint,
    `${manifest.runtime?.serverDirectory}/index.html`,
    "runtime/control-server.cjs",
    "runtime/geckos-bridge.cjs",
    "runtime/jwt-verifier.cjs",
    "runtime/session-manager.cjs",
    "runtime/voice-token-manager.cjs",
    "runtime/webhook-outbox.cjs",
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
    "agora-token",
    "electron",
  ])
    if (!packageData.dependencies?.[dependency])
      throw new Error(`Bundle is missing runtime dependency ${dependency}.`);
  if (packageData.dependencies.electron !== manifest.runtime.electronVersion)
    throw new Error(
      "Bundle Electron dependency does not match its manifest version."
    );
  if (
    manifest.voice?.provider !== "agora" ||
    manifest.voice?.tokenEndpoint !== "/v1/voice/token" ||
    manifest.voice?.enabledByEnvironment !== "THNK_VOICE_ENABLED" ||
    packageData.dependencies["agora-token"] !== AGORA_TOKEN_VERSION
  )
    throw new Error("Bundle contains an invalid Agora voice configuration.");
  if (
    manifest.runtime.nodeVersion !== NODE_VERSION_RANGE ||
    packageData.engines?.node !== manifest.runtime.nodeVersion
  )
    throw new Error(
      `Bundle requires the supported Node runtime ${NODE_VERSION_RANGE}.`
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
