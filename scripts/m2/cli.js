const { exportServer, runBundle, validateBundle } = require("./server-bundle");

const usage = `THNK server platform CLI

Usage:
  thnk export-server --project <game.json> --output <directory> [--compatibility-version <id>] [--client-build-id <id>] [--protocol-version <id>]
  thnk server validate --bundle <directory>
  thnk server run --bundle <directory>`;

const option = (arguments_, name) => {
  const index = arguments_.indexOf(name);
  if (index === -1 || !arguments_[index + 1])
    throw new Error(`Missing required option ${name}.\n\n${usage}`);
  return arguments_[index + 1];
};

const optionalOption = (arguments_, name) => {
  const index = arguments_.indexOf(name);
  if (index === -1) return undefined;
  if (!arguments_[index + 1])
    throw new Error(`Missing value for option ${name}.\n\n${usage}`);
  return arguments_[index + 1];
};

const main = async (arguments_) => {
  if (!arguments_.length || arguments_.includes("--help")) {
    console.log(usage);
    return;
  }

  if (arguments_[0] === "export-server") {
    const result = exportServer({
      projectPath: option(arguments_, "--project"),
      outputPath: option(arguments_, "--output"),
      compatibilityVersion: optionalOption(
        arguments_,
        "--compatibility-version"
      ),
      clientBuildId: optionalOption(arguments_, "--client-build-id"),
      protocolVersion: optionalOption(arguments_, "--protocol-version"),
    });
    console.log(
      `Exported THNK server bundle: ${result.bundlePath}\n` +
        `Content hash: ${result.manifest.contentHash.value}`
    );
    return;
  }

  if (arguments_[0] === "server" && arguments_[1] === "validate") {
    const result = validateBundle(option(arguments_, "--bundle"));
    console.log(
      `THNK server bundle is valid: ${result.bundlePath}\n` +
        `Content hash: ${result.contentHash}`
    );
    return;
  }

  if (arguments_[0] === "server" && arguments_[1] === "run") {
    const exitCode = await runBundle(option(arguments_, "--bundle"));
    process.exitCode = exitCode;
    return;
  }

  throw new Error(`Unknown command.\n\n${usage}`);
};

module.exports = { main, usage };
