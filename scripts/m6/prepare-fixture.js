const fs = require("fs");
const path = require("path");
const { prepareFixture: prepareM5Fixture } = require("../m5/prepare-fixture");

const repositoryRoot = path.resolve(__dirname, "../..");
const generatedRoot = path.join(repositoryRoot, ".generated/m6");
const projectPath = path.join(generatedRoot, "game.json");

const addPlayerDocumentProbe = (layout) => {
  layout.variables.push({ name: "ProfileWrite", type: "number", value: 8 });
  const state = layout.variables.find((variable) => variable.name === "State");
  state.children.push({ name: "LastProfileXP", type: "number", value: 0 });
  const connectionEvent = layout.events.find((event) =>
    (event.conditions || []).some(
      (condition) => condition.type?.value === "THNK::OnClientConnect"
    )
  );
  if (!connectionEvent)
    throw new Error(`Could not find OnClientConnect in ${layout.name}.`);
  connectionEvent.actions.push({
    type: { inverted: false, value: "THNK::SetPlayerVariable" },
    parameters: ["", '"progression.xp"', "ProfileWrite"],
    subInstructions: [],
  });
  connectionEvent.events.push({
    disabled: false,
    folded: false,
    type: "BuiltinCommonInstructions::JsCode",
    inlineCode:
      'runtimeScene.getVariables().get("State").getChild("LastProfileXP").setNumber(THNK.players.getCurrentPlayerVariableNumber("progression.xp"));',
    parameterObjects: "",
    useStrict: true,
    eventsSheetExpanded: false,
  });
};

const prepareFixture = () => {
  const m5Project = prepareM5Fixture();
  const project = JSON.parse(fs.readFileSync(m5Project, "utf8"));
  for (const layout of project.layouts.filter((candidate) =>
    ["DuelAuthority", "RacingAuthority"].includes(candidate.name)
  ))
    addPlayerDocumentProbe(layout);
  project.properties.name = "THNK M6 Cross Service Hooks";
  project.properties.packageName = "com.thnk.m6crossservice";
  fs.mkdirSync(generatedRoot, { recursive: true });
  fs.writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`);
  return projectPath;
};

module.exports = { prepareFixture };

if (require.main === module)
  console.log(`Prepared M6 fixture: ${prepareFixture()}`);
