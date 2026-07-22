const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  FORMAT_VERSION,
  findServerAuthorities,
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

test("all generated server runtime files parse as CommonJS", () => {
  const runtimeDirectory = path.resolve(__dirname, "../../scripts/m2/runtime");
  for (const filename of fs.readdirSync(runtimeDirectory)) {
    if (!filename.endsWith(".cjs")) continue;
    const result = spawnSync(process.execPath, [
      "--check",
      path.join(runtimeDirectory, filename),
    ]);
    expect(result.status).toBe(0);
  }
});

test("maps Chromium console warnings without escalating them to errors", () => {
  const { consoleMethodForLevel } = require("../../scripts/m2/runtime/console-level.cjs");

  expect(consoleMethodForLevel(0)).toBe("info");
  expect(consoleMethodForLevel(1)).toBe("info");
  expect(consoleMethodForLevel(2)).toBe("warn");
  expect(consoleMethodForLevel(3)).toBe("error");
});

test("normalizes GDevelop inline function identifiers deterministically", () => {
  const serverDirectory = makeTemporaryDirectory();
  fs.writeFileSync(
    path.join(serverDirectory, "code0.js"),
    "x.userFunc0x9fae80 = 1; x.userFunc0x9fae80(); x.userFunc0xab12 = 2; x.userFunc7 = 3; y.userFunc9 = 4;\n"
  );

  normalizeGeneratedIdentifiers(serverDirectory);

  expect(fs.readFileSync(path.join(serverDirectory, "code0.js"), "utf8")).toBe(
    "x.userFunc0 = 1; x.userFunc0(); x.userFunc1 = 2; x.userFunc2 = 3; y.userFunc0 = 4;\n"
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
  ).toContain(
    "const game = ((gdjs.projectData.firstLayout = gdjs.runtimeGameOptions.thnkAuthorityBootstrapScene"
  );
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

test("rejects the legacy single-entry helper for a multi-authority project", () => {
  const hostAction = (authorityId) => ({
    type: { value: "THNK_GeckosServer::HostServer" },
    parameters: ["", "9208", '"Authority"', `"${authorityId}"`],
  });
  expect(() =>
    findServerEntry({
      layouts: [
        { name: "One", events: [{ actions: [hostAction("one")] }] },
        { name: "Two", events: [{ actions: [hostAction("two")] }] },
        { name: "Authority", events: [] },
      ],
    })
  ).toThrow("exactly one");
});

test("catalogs multiple named authorities deterministically", () => {
  const host = (scene, authorityId) => ({
    type: { value: "THNK_GeckosServer::HostServer" },
    parameters: ["", "9208", `"${scene}"`, `"${authorityId}"`],
  });
  expect(
    findServerAuthorities({
      layouts: [
        {
          name: "RacingBootstrap",
          events: [{ actions: [host("Racing", "racing")] }],
        },
        {
          name: "DuelBootstrap",
          events: [{ actions: [host("Duel", "duel")] }],
        },
        { name: "Duel", events: [] },
        { name: "Racing", events: [] },
      ],
    })
  ).toEqual({
    authorities: {
      duel: { bootstrapScene: "DuelBootstrap", gameScene: "Duel" },
      racing: { bootstrapScene: "RacingBootstrap", gameScene: "Racing" },
    },
    port: 9208,
  });
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
  for (const runtimeFile of [
    "bundle-identity.cjs",
    "control-server.cjs",
    "jwt-verifier.cjs",
    "matchmaking-authority-client.cjs",
    "player-profile-client.cjs",
    "rate-limiter.cjs",
    "session-manager.cjs",
    "structured-logger.cjs",
    "voice-token-manager.cjs",
    "webhook-outbox.cjs",
  ])
    fs.writeFileSync(path.join(bundle, "runtime", runtimeFile), "// runtime\n");
  fs.writeFileSync(path.join(bundle, "server/index.html"), "server\n");
  fs.writeFileSync(path.join(bundle, ".dockerignore"), "node_modules\n");
  fs.writeFileSync(path.join(bundle, "yarn.lock"), "# lock\n");
  fs.writeFileSync(
    path.join(bundle, "package.json"),
    `${JSON.stringify({
      main: "runtime/main.cjs",
      engines: { node: "24.18.x" },
      dependencies: {
        "@electron/remote": "2.1.3",
        "@geckos.io/server": "3.1.0",
        "agora-token": "2.0.5",
        electron: "43.1.1",
      },
    })}\n`
  );
  const manifest = {
    formatVersion: FORMAT_VERSION,
    transport: "geckos",
    project: {
      name: "Fixture",
      uuid: "game-1",
      gameId: "game-1",
      version: "1.0.0",
    },
    authorities: {
      duel: { bootstrapScene: "Bootstrap", gameScene: "Authority" },
    },
    build: {
      serverBuildId: "",
      compatibilityVersion: "1",
      clientBuildId: "client-1",
      protocolVersion: "thnk-flatbuffers-v1",
    },
    runtime: {
      kind: "hidden-electron",
      entryPoint: "runtime/main.cjs",
      serverDirectory: "server",
      port: 9208,
      electronVersion: "43.1.1",
      nodeVersion: "24.18.x",
    },
    control: {
      apiVersion: "v1",
      defaultHost: "127.0.0.1",
      defaultPort: 9209,
      admissionTransport: "authorization-header",
      enabledByEnvironment: "THNK_BRIDGE_ENABLED",
      healthEndpoints: ["/health/live", "/health/ready"],
      logFormat: "ndjson-v1",
    },
    voice: {
      provider: "agora",
      tokenEndpoint: "/v1/voice/token",
      enabledByEnvironment: "THNK_VOICE_ENABLED",
    },
    playerProfile: {
      documentApi: "/internal/players/:id/document?gameId=",
      blockedApi: "/internal/players/:id/blocked",
      enabledByEnvironment: "THNK_PLAYER_PROFILE_URL",
      credentialEnvironment: "THNK_PLAYER_PROFILE_TOKEN",
    },
    contentHash: { algorithm: "sha256", value: "" },
  };
  fs.writeFileSync(
    path.join(bundle, "manifest.json"),
    `${JSON.stringify(manifest)}\n`
  );
  manifest.contentHash.value = hashBundleContent(bundle);
  manifest.build.serverBuildId = `sha256:${manifest.contentHash.value}`;
  fs.writeFileSync(
    path.join(bundle, "manifest.json"),
    `${JSON.stringify(manifest)}\n`
  );

  expect(validateBundle(bundle).contentHash).toBe(manifest.contentHash.value);
  fs.appendFileSync(path.join(bundle, "server/index.html"), "tampered\n");
  expect(() => validateBundle(bundle)).toThrow("hash mismatch");
});
