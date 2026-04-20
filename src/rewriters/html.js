import { rewriteUrl } from "./url.js";
import { rewriteCss } from "./css.js";

const URL_ATTRS = new Set([
  "href", "src", "action", "formaction", "poster", "data",
  "background", "ping", "manifest", "xlink:href",
]);
const SRCSET_ATTRS = new Set(["srcset", "imagesrcset"]);

function rewriteSrcset(val, base) {
  return val.split(",").map(part => {
    const m = part.trim().match(/^(\S+)(\s.*)?$/);
    return m ? rewriteUrl(m[1], base) + (m[2] || "") : part;
  }).join(", ");
}

function processAttrs(attrs, base) {
  return attrs.replace(
    /(\s+)([\w:-]+)(\s*=\s*)(["'])([\s\S]*?)\4/g,
    (m, sp, name, eq, q, val) => {
      const n = name.toLowerCase();
      if (n === "integrity") return "";
      if (n === "style") return sp + name + eq + q + rewriteCss(val, base) + q;
      if (URL_ATTRS.has(n)) return sp + name + eq + q + rewriteUrl(val.trim(), base) + q;
      if (SRCSET_ATTRS.has(n)) return sp + name + eq + q + rewriteSrcset(val, base) + q;
      if (n === "content") {
        const refreshed = val.replace(/^(\d[^;]*;\s*url\s*=\s*)(\S+)/i, (_, pre, url) => pre + rewriteUrl(url, base));
        if (refreshed !== val) return sp + name + eq + q + refreshed + q;
      }
      return m;
    }
  );
}

function findTagEnd(html, from) {
  let q = 0;
  for (let i = from; i < html.length; i++) {
    const c = html.charCodeAt(i);
    if (q) { if (c === q) q = 0; }
    else if (c === 34 || c === 39) { q = c; }
    else if (c === 62) return i;
  }
  return -1;
}

const INJECT = (base) =>
  `<script>!function(){` +
  `var c=window.__atlas={prefix:"/atlas/",base:${JSON.stringify(base)},` +
  `encode:function(u){try{return btoa(encodeURIComponent(u)).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=/g,"")}catch(e){return u}},` +
  `decode:function(e){try{var p=e+"=".repeat((4-e.length%4)%4);return decodeURIComponent(atob(p.replace(/-/g,"+").replace(/_/g,"/")))}catch(e){return e}},` +
  `rewrite:function(u,b){if(!u)return u;var t=String(u).trim();` +
  `if(/^(javascript:|data:|blob:|#|mailto:|tel:|about:|\\/atlas\\/)/.test(t))return u;` +
  `try{var r=b?new URL(t,b).href:new URL(t).href;return"/atlas/"+c.encode(r)}catch(e){return u}}};` +
  `var _po=location.origin,_rl=window.location;c._rl=_rl;` +
  `function _pn(v){v=String(v);if(v.startsWith(_po+"/atlas/")||v.startsWith("/atlas/"))return v;` +
  `try{var _u=new URL(v);var _sp=location.port||(location.protocol==="https:"?"443":"80");var _up=_u.port||(_u.protocol==="https:"?"443":"80");` +
  `if(_up===_sp&&_u.pathname.startsWith("/atlas/")&&(_u.hostname==="localhost"||_u.hostname.endsWith(".localhost")))return _u.pathname+_u.search+_u.hash;}catch(e){}` +
  `return c.rewrite(v,c.base);}` +
  `try{var _d=Object.getOwnPropertyDescriptor(Location.prototype,"href");if(_d&&_d.set){var _oh=_d.set;Object.defineProperty(Location.prototype,"href",{get:_d.get,set:function(v){_oh.call(this,_pn(v));},configurable:true});}}catch(e){}` +
  `try{var _lp=new Proxy(_rl,{set:function(t,p,v){if(p==="href"){_rl.href=_pn(String(v));return true;}t[p]=v;return true;},get:function(t,p){var v=t[p];return typeof v==="function"?v.bind(t):v;}});Object.defineProperty(window,"location",{get:function(){return _lp;},set:function(v){_rl.href=_pn(String(v));},configurable:true});}catch(e){}` +
  `if(window.navigation){window.navigation.addEventListener("navigate",function(e){if(!e.canIntercept||e.hashChange||e.downloadRequest!==null)return;var d=e.destination.url;if(d.startsWith(_po+"/atlas/"))return;try{if(new URL(d).origin===_po)return;}catch(err){return;}e.intercept({handler:function(){return Promise.resolve();}});_rl.href=_pn(d);});}` +
  `var _nwo=window.open;window.open=function(u,t,f){if(typeof u==="string")u=_pn(u);return _nwo.call(window,u,t,f);};` +
  `try{_rl.assign=function(u){_rl.href=_pn(u);};_rl.replace=function(u){_rl.href=_pn(u);};}catch(e){}` +
  `document.addEventListener("mousedown",function(e){var el=e.target&&e.target.closest&&e.target.closest("a[href]");if(!el)return;var h=el.getAttribute("href");if(!h)return;var r=c.rewrite(h,c.base);if(r!==h)el.setAttribute("href",r);},true);` +
  `document.addEventListener("click",function(e){var el=e.target&&e.target.closest&&e.target.closest("a[href]");if(!el)return;var h=el.getAttribute("href");if(!h||h.startsWith("javascript:")||h.startsWith("#"))return;e.preventDefault();var p=_pn(c.rewrite(h,c.base));if(el.target==="_blank"||el.target==="_new")window.open(p,"_blank");else _rl.href=p;},true);` +
  `document.addEventListener("submit",function(e){var f=e.target;if(!f||!f.action)return;if(f.action.startsWith(_po+"/atlas/"))return;e.preventDefault();f.action=_pn(f.action);f.submit();},true);` +
  `}();</script>` +
  `<script src="/atlas.client.js"></script>`;

export function rewriteHtml(html, base) {
  const out = [];
  let i = 0;
  let inScript = false;
  let inStyle = false;
  let styleBuf = "";
  let injected = false;

  while (i < html.length) {
    if (html.charCodeAt(i) !== 60) {
      const next = html.indexOf("<", i);
      if (next === -1) {
        (inStyle ? (styleBuf += html.slice(i)) : out.push(html.slice(i)));
        break;
      }
      inStyle ? (styleBuf += html.slice(i, next)) : out.push(html.slice(i, next));
      i = next;
      continue;
    }

    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      if (end === -1) { out.push(html.slice(i)); break; }
      out.push(html.slice(i, end + 3));
      i = end + 3;
      continue;
    }

    if (html.charCodeAt(i + 1) === 33) {
      const end = html.indexOf(">", i + 2);
      if (end === -1) { out.push(html.slice(i)); break; }
      out.push(html.slice(i, end + 1));
      i = end + 1;
      continue;
    }

    const tagEnd = findTagEnd(html, i + 1);
    if (tagEnd === -1) { out.push(html.slice(i)); break; }

    const inner = html.slice(i + 1, tagEnd);
    const nm = inner.match(/^(\/?)([\w-]+)/);
    const tag = nm?.[2]?.toLowerCase() ?? "";
    const isClose = nm?.[1] === "/";

    if (inScript) {
      if (isClose && tag === "script") { inScript = false; out.push("</script>"); }
      else out.push(html.slice(i, tagEnd + 1));
      i = tagEnd + 1;
      continue;
    }

    if (inStyle) {
      if (isClose && tag === "style") {
        inStyle = false;
        out.push(rewriteCss(styleBuf, base));
        styleBuf = "";
        out.push("</style>");
      } else {
        styleBuf += html.slice(i, tagEnd + 1);
      }
      i = tagEnd + 1;
      continue;
    }

    if (isClose) {
      if (!injected && tag === "head") { out.push(INJECT(base)); injected = true; }
      out.push(`</${tag}>`);
      i = tagEnd + 1;
      continue;
    }

    if (tag === "meta") {
      if (/content-security-policy/i.test(inner)) { i = tagEnd + 1; continue; }
    }

    if (tag === "base") {
      const m = inner.match(/\shref\s*=\s*(["'])([^"']*)\1/i);
      if (m) try { base = new URL(m[2], base).href; } catch {}
    }

    const attrStr = inner.slice(nm?.[0]?.length ?? 0);
    const selfClose = /\/\s*$/.test(attrStr);
    const attrs = processAttrs(attrStr.replace(/\/\s*$/, ""), base);
    out.push(`<${tag}${attrs}${selfClose ? " /" : ""}>`);

    if (tag === "head" && !injected) { out.push(INJECT(base)); injected = true; }
    if (tag === "script") inScript = true;
    if (tag === "style") inStyle = true;

    i = tagEnd + 1;
  }

  if (!injected) out.unshift(INJECT(base));
  return out.join("");
}
