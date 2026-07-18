const fs = require("fs");
const path = require("path");

const projectPath = path.resolve(
  __dirname,
  "../../fixtures/m1-remote-authority/game.json"
);
const project = JSON.parse(fs.readFileSync(projectPath, "utf8"));
const scene = (name) => {
  const layout = project.layouts.find((candidate) => candidate.name === name);
  if (!layout) throw new Error(`Missing scene: ${name}`);
  return layout;
};
const allInstructions = (events) =>
  events.flatMap((event) => [
    ...(event.conditions || []).map((instruction) => instruction.type.value),
    ...(event.actions || []).map((instruction) => instruction.type.value),
    ...allInstructions(event.events || []),
  ]);

const authority = scene("Authority");
scene("ServerBootstrap");
scene("ClientBootstrap");

const state = authority.variables.find((variable) => variable.name === "State");
if (!state?.children?.some((variable) => variable.name === "Score"))
  throw new Error("Authority scene must define State.Score.");

const player = authority.objects.find((object) => object.name === "Player");
if (
  !player?.behaviors?.some(
    (behavior) => behavior.type === "THNK::SynchronizedObject"
  )
)
  throw new Error("Player must use THNK::SynchronizedObject.");

const instructions = new Set(allInstructions(authority.events));
for (const instruction of [
  "THNK::StartClientCode",
  "THNK::StartServerCode",
  "THNK::SendMessage",
  "THNK::OnMessage",
  "THNK::OnClientConnect",
  "THNK::OnClientDisconnect",
  "THNK::LinkObjectToPlayer",
  "THNK::UseLinkedObjects",
]) {
  if (!instructions.has(instruction))
    throw new Error(`Authority fixture is missing ${instruction}.`);
}

const cheatEvent = authority.events.find((event) =>
  event.conditions?.some(
    (condition) =>
      condition.type.value === "KeyPressed" &&
      condition.parameters?.includes("Space")
  )
);
if (
  !cheatEvent?.actions?.some(
    (action) =>
      action.type.value === "SetX" && action.parameters?.includes("1000")
  ) ||
  !cheatEvent.actions.some(
    (action) =>
      action.type.value === "ModVarScene" &&
      action.parameters?.[0] === "State.Score" &&
      action.parameters?.[2] === "999"
  )
)
  throw new Error(
    "Space must attempt unauthorized local position and State.Score edits."
  );

console.log("M1 fixture contract is valid.");
