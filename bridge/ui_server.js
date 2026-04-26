const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 5175;

// ★ UIのdistは bridge/ui/dist にする
const DIST_DIR = path.join(__dirname, "ui", "dist");

const server = http.createServer((req, res) => {
  const rawUrl = req.url || "/";
  const urlPath = rawUrl.split("?")[0];

  // SPA対応：存在しないパスは index.html にフォールバック
  const relPath = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  let filePath = path.join(DIST_DIR, relPath);

  // パス安全対策
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  // ファイルが無い時は index.html（Reactルーティング用）
  if (!fs.existsSync(filePath)) {
    filePath = path.join(DIST_DIR, "index.html");
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime =
      ext === ".html"
        ? "text/html; charset=utf-8"
        : ext === ".js"
        ? "text/javascript; charset=utf-8"
        : ext === ".css"
        ? "text/css; charset=utf-8"
        : ext === ".svg"
        ? "image/svg+xml"
        : "application/octet-stream";

    res.writeHead(200, { "Content-Type": mime });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`[UI] http://localhost:${PORT}`);
  console.log(`[UI] dist = ${DIST_DIR}`);
});
