const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  FORMAT_VERSION,
  findServerEntry,
  hashBundleContent,
  normalizeGeneratedIdentifiers,
  patchRuntimeOptions,
  validateBundle,
} = require("../../scripts/m2/server-bundle");

const temporaryDirectories = [];
const makeTemporaryDirectory = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "thnk-m2-test-"));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

test("normalizes GDevelop inline function identifiers deterministically", () => {
  const serverDirectory = makeTemporaryDirectory();
  fs.writeFileSync(
    path.join(serverDirectory, "code0.js"),
    "x.userFunc0x9fae80 = 1; x.userFunc0x9fae80(); x.userFunc0xab12 = 2;\n"
  );

  normalizeGeneratedIdentifiers(serverDirectory);

  expect(fs.readFileSync(path.join(serverDirectory, "code0.js"), "utf8")).toBe(
    "x.userFunc0 = 1; x.userFunc0(); x.userFunc1 = 2;\n"
  );
});

test("passes the Geckos bridge path into the generated runtime", () => {
  const serverDirectory = makeTemporaryDirectory();
  fs.writeFileSync(
    path.join(serverDirectory, "data.js"),
    'gdjs.runtimeGameOptions = {};\ngdjs.projectData = {"properties":{"latestCompilationDirectory":"C:\\\\build"}};\n'
  );
  fs.writeFileSync(
    path.join(serverDirectory, "index.html"),
    "const game = new gdjs.RuntimeGame(gdjs.projectData, {});\n"
  );

  patchRuntimeOptions(serverDirectory);

  expect(
    fs.readFileSync(path.join(serverDirectory, "data.js"), "utf8")
  ).toContain("process.env.THNK_GECKOS_BRIDGE_PATH");
  expect(
    fs.readFileSync(path.join(serverDirectory, "index.html"), "utf8")
  ).toContain("gdjs.RuntimeGame(gdjs.projectData, gdjs.runtimeGameOptions)");
});

test("finds one literal Geckos server entry", () => {
  const project = {
    layouts: [
      {
        name: "Bootstrap",
        events: [
          {
            actions: [
              {
                type: { value: "THNK_GeckosServer::HostServer" },
                parameters: ["", "9208", '"Authority"'],
              },
            ],
          },
        ],
      },
      { name: "Authority", events: [] },
    ],
  };

  expect(findServerEntry(project)).toEqual({
    bootstrapScene: "Bootstrap",
    gameScene: "Authority",
    port: 9208,
  });
});

test("rejects ambiguous server entries", () => {
  const hostAction = {
    type: { value: "THNK_GeckosServer::HostServer" },
    parameters: ["", "9208", '"Authority"'],
  };
  expect(() =>
    findServerEntry({
      layouts: [
        { name: "One", events: [{ actions: [hostAction] }] },
        { name: "Two", events: [{ actions: [hostAction] }] },
        { name: "Authority", events: [] },
      ],
    })
  ).toThrow("exactly one");
});

test("validates the bundle hash and detects tampering", () => {
  const bundle = makeTemporaryDirectory();
  fs.mkdirSync(path.join(bundle, "runtime"));
  fs.mkdirSync(path.join(bundle, "server"));
  fs.writeFileSync(path.join(bundle, "runtime/main.cjs"), "// runtime\n");
  fs.writeFileSync(
    path.join(bundle, "runtime/geckos-bridge.cjs"),
    "// bridge\n"
  );
  fs.writeFileSync(path.join(bundle, "server/index.html"), "server\n");
  fs.writeFileSync(path.join(bundle, "yarn.lock"), "# lock\n");
  fs.writeFileSync(
    path.join(bundle, "package.json"),
    `${JSON.stringify({
      main: "runtime/main.cjs",
      engines: { node: "18.20.x" },
      dependencies: {
        "@electron/remote": "2.1.2",
        "@geckos.io/server": "3.1.0",
        electron: "32.3.3",
      },
    })}\n`
  );
  const manifest = {
    formatVersion: FORMAT_VERSION,
    transport: "geckos",
    entry: { port: 9208 },
    runtime: {
      kind: "hidden-electron",
      entryPoint: "runtime/main.cjs",
      serverDirectory: "server",
      port: 9208,
      electronVersion: "32.3.3",
      nodeVersion: "18.20.x",
    },
    contentHash: { algorithm: "sha256", value: "" },
  };
  fs.writeFileSync(
    path.join(bundle, "manifest.json"),
    `${JSON.stringify(manifest)}\n`
  );
  manifest.contentHash.value = hashBundleContent(bundle);
  fs.writeFileSync(
    path.join(bundle, "manifest.json"),
    `${JSON.stringify(manifest)}\n`
  );

  expect(validateBundle(bundle).contentHash).toBe(manifest.contentHash.value);
  fs.appendFileSync(path.join(bundle, "server/index.html"), "tampered\n");
  expect(() => validateBundle(bundle)).toThrow("hash mismatch");
});
