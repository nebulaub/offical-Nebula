const PROXY_ENDPOINT = "/api/fetch";
const ATLAS_PREFIX = "/atlas/";
const PASSTHROUGH = new Set([
  "/atlas.sw.js",
  "/atlas.client.js",
  "/atlas.register.js",
  "/api/fetch",
]);

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) return;
  if (PASSTHROUGH.has(url.pathname)) return;

  if (!url.pathname.startsWith(ATLAS_PREFIX)) {
    if (event.request.mode === "navigate" && event.request.referrer) {
      try {
        const ref = new URL(event.request.referrer);
        if (ref.origin === self.location.origin && ref.pathname.startsWith(ATLAS_PREFIX)) {
          const refRaw = decodeURIComponent(ref.pathname.slice(ATLAS_PREFIX.length));
          const baseUrl = /^https?:\/\//i.test(refRaw) ? refRaw : swDecode(refRaw);
          if (baseUrl) {
            const fullUrl = new URL(url.pathname + url.search, baseUrl).href;
            const encoded = swEncode(fullUrl);
            if (encoded) {
              event.respondWith(Response.redirect(ATLAS_PREFIX + encoded, 302));
              return;
            }
          }
        }
      } catch {}
    }
    return;
  }

  event.respondWith(handleRequest(event.request));
});

function swEncode(url) {
  try {
    return btoa(encodeURIComponent(url))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  } catch {
    return null;
  }
}

function swDecode(encoded) {
  try {
    const padded = encoded + "=".repeat((4 - (encoded.length % 4)) % 4);
    return decodeURIComponent(atob(padded.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

function errorPage(title, message, status) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Atlas &mdash; ${title}</title>
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
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function handleRequest(request) {
  const url = new URL(request.url);
  let raw = url.pathname.slice(ATLAS_PREFIX.length);

  if (!raw) {
    return errorPage("Missing URL", "No URL was provided to proxy.", 400);
  }

  try { raw = decodeURIComponent(raw); } catch {}

  let encoded;
  if (/^https?:\/\//i.test(raw)) {
    encoded = swEncode(raw);
  } else {
    encoded = raw;
  }

  if (!encoded) {
    return errorPage("Invalid URL", "The URL could not be encoded.", 400);
  }

  const apiUrl = new URL(PROXY_ENDPOINT, self.location.origin);
  apiUrl.searchParams.set("url", encoded);

  const forwardHeaders = {};
  for (const [key, value] of request.headers) {
    const lower = key.toLowerCase();
    if (lower === "host" || lower === "origin") continue;
    forwardHeaders[key] = value;
  }

  try {
    const response = await fetch(apiUrl.href, {
      method: request.method,
      headers: forwardHeaders,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.blob(),
    });
    return response;
  } catch (err) {
    return errorPage("Connection Failed", err.message, 502);
  }
}
