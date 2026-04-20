(function () {
  var cfg = window.__atlas;
  if (!cfg) return;

  var base = cfg.base || location.href;
  var _rl = cfg._rl || window.location;

  var nativeFetch = window.fetch;
  window.fetch = function (input, init) {
    if (typeof input === "string") {
      input = cfg.rewrite(input, base);
    } else if (input && typeof input === "object" && input.url) {
      var rewrittenUrl = cfg.rewrite(input.url, base);
      if (rewrittenUrl !== input.url) {
        input = new Request(rewrittenUrl, input);
      }
    }
    return nativeFetch.apply(this, [input, init]);
  };

  var nativeXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var args = Array.prototype.slice.call(arguments);
    if (typeof url === "string") {
      args[1] = cfg.rewrite(url, base);
    }
    return nativeXhrOpen.apply(this, args);
  };

  var nativePushState = history.pushState;
  history.pushState = function (state, title, url) {
    if (typeof url === "string") url = cfg.rewrite(url, base);
    return nativePushState.call(history, state, title, url);
  };

  var nativeReplaceState = history.replaceState;
  history.replaceState = function (state, title, url) {
    if (typeof url === "string") url = cfg.rewrite(url, base);
    return nativeReplaceState.call(history, state, title, url);
  };

  function preRewriteAnchor(el) {
    var href = el.getAttribute("href");
    if (!href) return;
    var rewritten = cfg.rewrite(href, base);
    if (rewritten !== href) el.setAttribute("href", rewritten);
  }

  function preRewriteAll(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.tagName === "A") { preRewriteAnchor(root); return; }
    var anchors = root.querySelectorAll ? root.querySelectorAll("a[href]") : [];
    for (var i = 0; i < anchors.length; i++) preRewriteAnchor(anchors[i]);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { preRewriteAll(document.body); });
  } else {
    preRewriteAll(document.body);
  }

  if (typeof MutationObserver !== "undefined") {
    var _mo = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.type === "childList") {
          for (var j = 0; j < m.addedNodes.length; j++) preRewriteAll(m.addedNodes[j]);
        } else if (m.type === "attributes" && m.target && m.target.tagName === "A") {
          preRewriteAnchor(m.target);
        }
      }
    });
    _mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
  }
})();
