const fs = require("fs");
const http = require("http");
const path = require("path");

const buildRoot = path.resolve(__dirname, "../../.generated/m1/client/build");
const port = Number(process.env.THNK_FIXTURE_CLIENT_PORT || 8080);
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".wasm": "application/wasm",
};

if (!fs.existsSync(path.join(buildRoot, "index.html")))
  throw new Error(
    "Run yarn fixture:m1:export-client before serving the client."
  );

const server = http.createServer((request, response) => {
  const requestPath = decodeURIComponent((request.url || "/").split("?")[0]);
  const relativePath =
    requestPath === "/" ? "index.html" : requestPath.slice(1);
  const filePath = path.resolve(buildRoot, relativePath);
  if (!filePath.startsWith(`${buildRoot}${path.sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, contents) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500).end();
      return;
    }
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type":
        contentTypes[path.extname(filePath)] || "application/octet-stream",
    });
    response.end(contents);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`THNK M1 client available at http://127.0.0.1:${port}`);
});

const stop = () => server.close(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
