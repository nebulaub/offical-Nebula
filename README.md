<div align="center">
  
# Atlas (beta 1.0.2)
by Bromine Network

[![Discord](https://img.shields.io/badge/discord-unblockings-5865F2?style=flat-square)](https://discord.gg/unblockings)
[![Telegram](https://img.shields.io/badge/telegram-@qatual-26A5E4?style=flat-square)](https://t.me/@qatual)

</div>

---

a web proxy. runs in node, uses a service worker to intercept requests, rewrites the page, done.

## running it

needs node 18+.

```bash
git clone https://github.com/brominenetwork/Atlas
cd Atlas
node server.js
```

goes on port 3000. change it with `PORT=8080 node server.js` if you want.

## how it works

you type a url. it gets encoded and the browser goes to `/atlas/[encoded]`. the service worker catches that, asks the server to fetch it, server rewrites the html and sends it back. every image, script, and css file goes through the same thing automatically.

you can also just go to `/atlas/https://example.com` directly in the address bar and it works.

if you type something that isn't a url it searches duckduckgo.

## structure

```
server.js           — starts the server
src/
  proxy.js          — fetches the url and rewrites it
  rewriters/
    url.js          — encodes/decodes urls
    html.js         — rewrites html (fast, single pass)
    css.js          — rewrites css url() and @import
static/
  index.html        — the front page
  atlas.sw.js       — service worker
  atlas.client.js   — patches fetch, xhr, history etc at runtime
```

## community

- discord: [discord.gg/unblockings](https://discord.gg/unblockings)
- telegram: [t.me/@qatual](https://t.me/@qatual)
- github: [github.com/brominenetwork/Atlas](https://github.com/brominenetwork/Atlas)

if something breaks, report it in the discord.
