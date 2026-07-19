const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  hashBundleContent,
  loadBundleIdentity,
} = require("../../scripts/m2/runtime/bundle-identity.cjs");

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

const makeBundle = () => {
  const bundleRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "thnk-m5-identity-")
  );
  temporaryDirectories.push(bundleRoot);
  fs.mkdirSync(path.join(bundleRoot, "server"));
  fs.writeFileSync(path.join(bundleRoot, "server", "index.html"), "fixture\n");
  const manifest = {
    formatVersion: 4,
    project: { gameId: "game-1" },
    authorities: {
      duel: { bootstrapScene: "DuelBootstrap", gameScene: "Duel" },
      racing: { bootstrapScene: "RacingBootstrap", gameScene: "Racing" },
    },
    build: {
      serverBuildId: "",
      compatibilityVersion: "1",
      clientBuildId: "client-1",
      protocolVersion: "thnk-flatbuffers-v1",
    },
    contentHash: { algorithm: "sha256", value: "" },
  };
  manifest.contentHash.value = hashBundleContent(bundleRoot);
  manifest.build.serverBuildId = `sha256:${manifest.contentHash.value}`;
  fs.writeFileSync(
    path.join(bundleRoot, "manifest.json"),
    `${JSON.stringify(manifest)}\n`
  );
  return { bundleRoot, manifest };
};

test.each([
  ["duel", "DuelBootstrap", "Duel"],
  ["racing", "RacingBootstrap", "Racing"],
])(
  "selects only the requested %s authority",
  (authorityId, bootstrapScene, gameScene) => {
    const { bundleRoot, manifest } = makeBundle();
    expect(
      loadBundleIdentity({
        bundleRoot,
        requestedAuthorityId: authorityId,
        requestedMapId: "arena-1",
        expectedServerBuildId: manifest.build.serverBuildId,
      })
    ).toMatchObject({
      authorityId,
      mapId: "arena-1",
      bootstrapScene,
      gameScene,
      serverBuildId: manifest.build.serverBuildId,
    });
  }
);

test("requires an authority for a multi-authority artifact and rejects unknown IDs", () => {
  const { bundleRoot } = makeBundle();
  expect(() => loadBundleIdentity({ bundleRoot })).toThrow(
    "THNK_AUTHORITY_ID is required"
  );
  expect(() =>
    loadBundleIdentity({ bundleRoot, requestedAuthorityId: "battle-royale" })
  ).toThrow("Unknown THNK authority ID");
});

test("enforces both bundle integrity and the externally trusted build ID", () => {
  const { bundleRoot } = makeBundle();
  expect(() =>
    loadBundleIdentity({
      bundleRoot,
      requestedAuthorityId: "duel",
      expectedServerBuildId: `sha256:${"b".repeat(64)}`,
    })
  ).toThrow("THNK_EXPECTED_SERVER_BUILD_ID does not match");

  fs.appendFileSync(
    path.join(bundleRoot, "server", "index.html"),
    "tampered\n"
  );
  expect(() =>
    loadBundleIdentity({ bundleRoot, requestedAuthorityId: "duel" })
  ).toThrow("content hash verification failed");
});
