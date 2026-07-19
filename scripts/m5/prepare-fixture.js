const fs = require("fs");
const path = require("path");

const repositoryRoot = path.resolve(__dirname, "../..");
const sourcePath = path.join(
  repositoryRoot,
  "fixtures/m1-remote-authority/game.json"
);
const generatedRoot = path.join(repositoryRoot, ".generated/m5");
const projectPath = path.join(generatedRoot, "game.json");

const markerEvent = (authorityId) => ({
  disabled: false,
  folded: false,
  type: "BuiltinCommonInstructions::JsCode",
  inlineCode: `if (!runtimeScene.__thnkAuthorityMarkerLogged) { runtimeScene.__thnkAuthorityMarkerLogged = true; console.log(${JSON.stringify(
    `THNK_AUTHORITY_SCENE_STARTED ${authorityId}`
  )}); }`,
  parameterObjects: "",
  useStrict: true,
  eventsSheetExpanded: false,
});

const configureBootstrap = (layout, authorityId, gameScene) => {
  let hosts = 0;
  for (const event of layout.events || []) {
    for (const action of event.actions || []) {
      if (action.type?.value !== "THNK_GeckosServer::HostServer") continue;
      action.parameters[2] = JSON.stringify(gameScene);
      action.parameters[3] = JSON.stringify(authorityId);
      hosts++;
    }
  }
  if (hosts !== 1)
    throw new Error(`Expected one HostServer action in ${layout.name}.`);
};

const addSignedTagProbe = (layout) => {
  const state = (layout.variables || []).find(
    (variable) => variable.name === "State" && variable.type === "structure"
  );
  if (!state) throw new Error(`Could not find State in ${layout.name}.`);
  state.children.push({ name: "LastTeam", type: "string", value: "" });
  const connectionEvent = (layout.events || []).find((event) =>
    (event.conditions || []).some(
      (condition) => condition.type?.value === "THNK::OnClientConnect"
    )
  );
  if (!connectionEvent)
    throw new Error(`Could not find OnClientConnect in ${layout.name}.`);
  connectionEvent.events.push({
    disabled: false,
    folded: false,
    type: "BuiltinCommonInstructions::JsCode",
    inlineCode:
      'runtimeScene.getVariables().get("State").getChild("LastTeam").setString(THNK.players.getCurrentPlayerTag("team"));',
    parameterObjects: "",
    useStrict: true,
    eventsSheetExpanded: false,
  });
};

const prepareFixture = () => {
  const project = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const sourceBootstrap = project.layouts.find(
    (layout) => layout.name === "ServerBootstrap"
  );
  const sourceAuthority = project.layouts.find(
    (layout) => layout.name === "Authority"
  );
  if (!sourceBootstrap || !sourceAuthority)
    throw new Error("The M1 fixture no longer has its expected server scenes.");

  const duelBootstrap = structuredClone(sourceBootstrap);
  duelBootstrap.name = "DuelBootstrap";
  configureBootstrap(duelBootstrap, "duel", "DuelAuthority");
  const racingBootstrap = structuredClone(sourceBootstrap);
  racingBootstrap.name = "RacingBootstrap";
  configureBootstrap(racingBootstrap, "racing", "RacingAuthority");

  const duelAuthority = structuredClone(sourceAuthority);
  duelAuthority.name = "DuelAuthority";
  duelAuthority.events.unshift(markerEvent("duel"));
  addSignedTagProbe(duelAuthority);
  const racingAuthority = structuredClone(sourceAuthority);
  racingAuthority.name = "RacingAuthority";
  racingAuthority.events.unshift(markerEvent("racing"));
  addSignedTagProbe(racingAuthority);

  project.properties.name = "THNK M5 Multi Authority";
  project.properties.packageName = "com.thnk.m5multiauthority";
  project.firstLayout = "DuelBootstrap";
  project.layouts = [
    ...project.layouts.filter(
      (layout) => !["ServerBootstrap", "Authority"].includes(layout.name)
    ),
    duelBootstrap,
    racingBootstrap,
    duelAuthority,
    racingAuthority,
  ];
  fs.mkdirSync(generatedRoot, { recursive: true });
  fs.writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`);
  return projectPath;
};

module.exports = { prepareFixture };

if (require.main === module)
  console.log(`Prepared M5 fixture: ${prepareFixture()}`);
