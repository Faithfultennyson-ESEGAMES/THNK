import { createConnection, createServer } from "node:net";

const ubuntuHost = process.env.THNK_CERT_UBUNTU_HOST || "192.168.1.196";
// The certification host runs FFA and Teams sequentially on the same Linux
// Authority port. Override THNK_CERT_TEAMS_HOST when validating a genuinely
// separate second Authority host.
const teamsHost = process.env.THNK_CERT_TEAMS_HOST || ubuntuHost;
const teamsPort = Number(process.env.THNK_CERT_TEAMS_PORT || 9208);

const routes = [
  { name: "feature-lab", listenPort: 18080, targetHost: ubuntuHost, targetPort: 8080 },
  { name: "player-profile", listenPort: 19400, targetHost: ubuntuHost, targetPort: 9400 },
  { name: "matchmaking", listenPort: 19300, targetHost: ubuntuHost, targetPort: 9300 },
  { name: "authority-ffa", listenPort: 19208, targetHost: ubuntuHost, targetPort: 9208 },
  { name: "authority-teams", listenPort: 19210, targetHost: teamsHost, targetPort: teamsPort },
];

if (
  routes.some(
    ({ listenPort, targetPort }) =>
      !Number.isInteger(listenPort) ||
      listenPort < 1 ||
      listenPort > 65_535 ||
      !Number.isInteger(targetPort) ||
      targetPort < 1 ||
      targetPort > 65_535
  )
)
  throw new Error("certification_forwarder_port_invalid");

const servers = routes.map((route) => {
  const server = createServer((incoming) => {
    const upstream = createConnection({
      host: route.targetHost,
      port: route.targetPort,
    });
    incoming.on("error", () => upstream.destroy());
    upstream.on("error", () => incoming.destroy());
    incoming.pipe(upstream);
    upstream.pipe(incoming);
  });
  server.on("error", (error) => {
    process.stderr.write(
      `${JSON.stringify({
        event: "certification.forwarder_failed",
        name: route.name,
        listenPort: route.listenPort,
        code: error.code || "unknown",
      })}\n`
    );
    process.exitCode = 1;
  });
  server.listen(route.listenPort, "127.0.0.1", () => {
    process.stdout.write(
      `${JSON.stringify({
        event: "certification.forwarder_ready",
        name: route.name,
        listenAddress: `127.0.0.1:${route.listenPort}`,
        targetAddress: `${route.targetHost}:${route.targetPort}`,
      })}\n`
    );
  });
  return server;
});

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  let remaining = servers.length;
  const done = () => {
    remaining -= 1;
    if (remaining === 0) process.exit(process.exitCode || 0);
  };
  for (const server of servers) server.close(done);
  setTimeout(() => process.exit(process.exitCode || 0), 5_000).unref();
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
