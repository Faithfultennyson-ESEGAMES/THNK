const fs = require("fs");
const path = require("path");
const { prepareFixture: prepareM6Fixture } = require("../m6/prepare-fixture");

const repositoryRoot = path.resolve(__dirname, "../..");
const generatedRoot = path.join(repositoryRoot, ".generated/m7");
const projectPath = path.join(generatedRoot, "game.json");

const prepareFixture = () => {
  const m6Project = prepareM6Fixture();
  const project = JSON.parse(fs.readFileSync(m6Project, "utf8"));
  project.properties.name = "THNK M7 Release Candidate";
  project.properties.packageName = "com.thnk.m7releasecandidate";
  fs.mkdirSync(generatedRoot, { recursive: true });
  fs.writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`);
  return projectPath;
};

module.exports = { prepareFixture };

if (require.main === module)
  console.log(`Prepared M7 fixture: ${prepareFixture()}`);
