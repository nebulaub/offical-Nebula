import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleProxy } from "./src/proxy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC = path.join(__dirname, "static");

const MIMES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".txt": "text/plain",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

const SW_SHELL = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Atlas</title>
<script src="/atlas.register.js"></script>
</head>
<body>
<script>
if (navigator.serviceWorker.controller) {
  location.reload();
} else {
  navigator.serviceWorker.ready.then(function() { location.reload(); });
}
</script>
</body>
</html>`;

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIMES[ext] || "application/octet-stream";
  res.setHeader("Content-Type", mime);
  res.setHeader("Cache-Control", "no-store");
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");

  if (url.pathname === "/api/fetch") {
    return handleProxy(req, res, url);
  }

  if (url.pathname.startsWith("/atlas/")) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(SW_SHELL);
    return;
  }

  const reqPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.join(STATIC, reqPath);

  if (!filePath.startsWith(STATIC + path.sep) && filePath !== STATIC) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    serveFile(res, filePath);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

const PORT = parseInt(process.env.PORT || "3000", 10);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`your clone of atlas is running on http://localhost:${PORT}, have fun :)`);
});
