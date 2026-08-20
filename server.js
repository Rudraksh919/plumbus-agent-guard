const http = require("http");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: ".env.local" });
const { propose } = require("./lib/llm-policy");

const PORT = 4173;
const DIST = path.join(__dirname, "dist");

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function serveFile(request, response) {
  const urlPath = request.url === "/" ? "/index.html" : request.url;
  const filePath = path.resolve(DIST, `.${decodeURIComponent(urlPath)}`);
  if (!filePath.startsWith(DIST) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    response.writeHead(404).end("Not found");
    return;
  }
  const contentType = filePath.endsWith(".js") ? "text/javascript" : filePath.endsWith(".css") ? "text/css" : "text/html";
  response.writeHead(200, { "Content-Type": contentType });
  fs.createReadStream(filePath).pipe(response);
}

http.createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/api/propose") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", async () => {
      try {
        const goal = String(JSON.parse(body).goal || "").trim();
        if (!goal || goal.length > 2_000) throw new Error("Enter an agent goal up to 2,000 characters.");
        sendJson(response, 200, await propose(goal));
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }
    });
    return;
  }
  serveFile(request, response);
}).listen(PORT, "127.0.0.1", () => console.log(`Plumbus Guard app: http://127.0.0.1:${PORT}`));