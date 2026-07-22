const fs = require("fs");
const path = require("path");

const extensionPath = path.resolve(__dirname, "../../extensions/THNK_Local.json");

const loadSoloAction = () => {
  const extension = JSON.parse(fs.readFileSync(extensionPath, "utf8"));
  const action = extension.eventsFunctions.find(
    (candidate) => candidate.name === "StartSoloMode"
  );
  if (!action) throw new Error("StartSoloMode action is missing");
  return {
    action,
    run: new Function(
      "runtimeScene",
      "eventsFunctionContext",
      "THNK",
      action.events[0].inlineCode.join("\n")
    ),
  };
};

describe("explicit solo mode", () => {
  test("starts the real local Authority before its in-process client", async () => {
    const { action, run } = loadSoloAction();
    const calls = [];
    class LocalServerAdapter {}
    class LocalClientAdapter {}
    const runtimeScene = {};
    const THNK = {
      LocalServerAdapter,
      LocalClientAdapter,
      server: {
        startServer: async (adapter, scene, authorityScene) => {
          calls.push(["authority", adapter, scene, authorityScene]);
        },
      },
      client: {
        startClient: async (scene, adapter) => {
          calls.push(["client", scene, adapter]);
        },
      },
    };
    const eventsFunctionContext = {
      getArgument: (name) => (name === "Scene" ? "SoloAuthority" : undefined),
    };

    run(runtimeScene, eventsFunctionContext, THNK);
    await new Promise((resolve) => setImmediate(resolve));

    expect(action.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Scene" })])
    );
    expect(calls[0][0]).toBe("authority");
    expect(calls[0][1]).toBeInstanceOf(LocalServerAdapter);
    expect(calls[0][3]).toBe("SoloAuthority");
    expect(calls[1][0]).toBe("client");
    expect(calls[1][2]).toBeInstanceOf(LocalClientAdapter);

    run(runtimeScene, eventsFunctionContext, THNK);
    await new Promise((resolve) => setImmediate(resolve));
    expect(calls).toHaveLength(2);
  });

  test("the local transport explicitly delivers within the same process", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../adapters/local.ts"),
      "utf8"
    );
    expect(source).toContain("inProcessListeners");
    expect(source).toContain("queueMicrotask");
    expect(source).toContain("inProcessListeners.add(listener)");
  });
});
