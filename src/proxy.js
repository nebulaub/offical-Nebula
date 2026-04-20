import https from "node:https";
import http from "node:http";
import zlib from "node:zlib";
import { URL } from "node:url";
import { decode } from "./rewriters/url.js";
import { rewriteHtml } from "./rewriters/html.js";
import { rewriteJs } from "./rewriters/js.js";
import { rewriteCss } from "./rewriters/css.js";

const PREFIX = "/atlas/";
const MAX_REDIRECTS = 10;

const CACHE = new Map();
let cacheBytes = 0;
const CACHE_MAX_BYTES = 64 * 1024 * 1024;
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_ENTRY_MAX = 4 * 1024 * 1024;
const CACHEABLE_CT = /^(image\/|font\/|text\/css|application\/javascript|text\/javascript)/;

function cacheGet(key) {
  const e = CACHE.get(key);
  if (!e) return null;
  if (Date.now() > e.exp) { cacheBytes -= e.body.length; CACHE.delete(key); return null; }
  return e;
}

function cacheSet(key, status, headers, body) {
  if (body.length > CACHE_ENTRY_MAX) return;
  if (CACHE.has(key)) { cacheBytes -= CACHE.get(key).body.length; CACHE.delete(key); }
  while (cacheBytes + body.length > CACHE_MAX_BYTES && CACHE.size) {
    const oldest = CACHE.keys().next().value;
    cacheBytes -= CACHE.get(oldest).body.length;
    CACHE.delete(oldest);
  }
  cacheBytes += body.length;
  CACHE.set(key, { status, headers, body, exp: Date.now() + CACHE_TTL });
}

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 256, scheduling: "fifo" });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 256, rejectUnauthorized: false, scheduling: "fifo" });

const DROP_REQ = new Set([
  "host", "origin", "connection", "keep-alive", "te", "trailer",
  "upgrade", "proxy-authorization", "transfer-encoding", "accept-encoding",
]);

const DROP_RES = new Set([
  "connection", "keep-alive", "transfer-encoding", "te", "trailer",
  "upgrade", "content-encoding", "content-security-policy",
  "content-security-policy-report-only", "x-frame-options",
  "strict-transport-security",
]);

const BASE_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.5",
  "accept-encoding": "identity",
};

function rawFetch(targetUrl, options, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;

    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: options.method || "GET",
      headers: options.headers || {},
      agent: isHttps ? httpsAgent : httpAgent,
      timeout: 20000,
    }, (res) => {
      const { statusCode: status, headers } = res;
      const location = headers["location"];

      if (status >= 300 && status < 400 && location && redirectCount < MAX_REDIRECTS) {
        res.resume();
        resolve(rawFetch(new URL(location, targetUrl).href, options, redirectCount + 1));
        return;
      }

      resolve({ status, headers, body: res, url: targetUrl });
    });

    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });

    if (options.body) req.write(options.body);
    req.end();
  });
}

function decompressStream(stream, encoding) {
  const enc = (encoding || "").toLowerCase();
  if (enc === "gzip" || enc === "x-gzip") return stream.pipe(zlib.createGunzip());
  if (enc === "deflate") return stream.pipe(zlib.createInflate());
  if (enc === "br") return stream.pipe(zlib.createBrotliDecompress());
  return stream;
}

function collectStream(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (c) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

function getReqBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function buildOutHeaders(resHeaders) {
  const out = { "cross-origin-resource-policy": "cross-origin" };
  for (const [k, v] of Object.entries(resHeaders)) {
    if (!DROP_RES.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

function errorPage(res, status, title, message) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Atlas \u2014 ${title}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#111;color:#ccc;font-family:monospace;height:100vh;display:flex;align-items:center;justify-content:center}
.box{width:480px;padding:0 1rem}
.code{font-size:3rem;font-weight:700;color:#333;margin-bottom:.5rem}
.title{font-size:1rem;color:#fff;margin-bottom:.75rem}
.msg{font-size:.8rem;color:#555;line-height:1.6;word-break:break-all;margin-bottom:1.5rem}
.actions{display:flex;gap:1rem;font-size:.75rem}
.actions a{color:#444;text-decoration:none}
.actions a:hover{color:#888}
</style>
</head>
<body>
<div class="box">
  <div class="code">${status}</div>
  <div class="title">${title}</div>
  <div class="msg">${message}</div>
  <div class="actions">
    <a href="/">home</a>
    <a href="https://discord.gg/unblockings" target="_blank">get help</a>
    <a href="https://github.com/brominenetwork/Atlas/issues" target="_blank">report issue</a>
  </div>
</div>
</body>
</html>`;
  if (!res.headersSent) res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

export async function handleProxy(req, res, url) {
  const encoded = url.searchParams.get("url");
  if (!encoded) {
    errorPage(res, 400, "Missing URL", "No URL was provided to proxy.");
    return;
  }

  let targetUrl;
  try {
    targetUrl = decode(encoded);
    const { protocol } = new URL(targetUrl);
    if (protocol !== "http:" && protocol !== "https:") throw 0;
  } catch {
    errorPage(res, 400, "Invalid URL", "The provided URL could not be decoded or is not a valid http/https address.");
    return;
  }

  const fwdHeaders = { ...BASE_HEADERS };
  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (DROP_REQ.has(lower)) continue;
    if (lower === "referer") {
      try {
        const ref = new URL(value);
        if (ref.pathname.startsWith(PREFIX)) {
          fwdHeaders["referer"] = decode(ref.pathname.slice(PREFIX.length).split("?")[0]);
        }
      } catch {}
      continue;
    }
    fwdHeaders[key] = value;
  }

  try {
    const method = req.method || "GET";
    const body = (method !== "GET" && method !== "HEAD") ? await getReqBody(req) : undefined;

    if (method === "GET") {
      const hit = cacheGet(targetUrl);
      if (hit) {
        res.writeHead(hit.status, hit.headers);
        res.end(hit.body);
        return;
      }
    }

    const response = await rawFetch(targetUrl, { method, headers: fwdHeaders, body });
    const ct = (response.headers["content-type"] || "").toLowerCase();
    const enc = response.headers["content-encoding"] || "";
    const finalUrl = response.url;
    const outHeaders = buildOutHeaders(response.headers);

    if (ct.includes("text/html")) {
      const buf = await collectStream(decompressStream(response.body, enc));
      const charset = (ct.match(/charset=([\w-]+)/i) || [])[1] || "utf-8";
      const text = buf.toString(/utf-?8/i.test(charset) ? "utf8" : "latin1");
      const out = rewriteHtml(text, finalUrl);
      outHeaders["content-type"] = "text/html; charset=utf-8";
      delete outHeaders["content-length"];
      res.writeHead(response.status, outHeaders);
      res.end(out);
      return;
    }

    if (ct.includes("javascript") || ct.includes("ecmascript")) {
      const buf = await collectStream(decompressStream(response.body, enc));
      const out = rewriteJs(buf.toString("utf8"), finalUrl);
      delete outHeaders["content-length"];
      res.writeHead(response.status, outHeaders);
      res.end(out);
      return;
    }

    if (ct.includes("text/css")) {
      const buf = await collectStream(decompressStream(response.body, enc));
      const out = rewriteCss(buf.toString("utf8"), finalUrl);
      delete outHeaders["content-length"];
      res.writeHead(response.status, outHeaders);
      res.end(out);
      return;
    }

    delete outHeaders["content-length"];
    const rawBuf = await collectStream(decompressStream(response.body, enc));
    if (CACHEABLE_CT.test(ct) && response.status === 200) {
      cacheSet(targetUrl, response.status, outHeaders, rawBuf);
    }
    res.writeHead(response.status, outHeaders);
    res.end(rawBuf);
  } catch (err) {
    errorPage(res, 502, "Connection Failed", err.message);
  }
}
