import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import handler from "../api/chat.js";

const root = process.cwd();
const port = Number(process.env.PORT || 4173);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

const server = http.createServer(async (req, res) => {
  if (req.url?.startsWith("/api/chat")) {
    return handler(req, decorateRes(res));
  }

  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.join(root, "public", requested);

  if (!filePath.startsWith(path.join(root, "public"))) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  try {
    const body = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": mime[path.extname(filePath)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Local QA server: http://127.0.0.1:${port}`);
});

function decorateRes(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (value) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(value));
    return res;
  };
  return res;
}
