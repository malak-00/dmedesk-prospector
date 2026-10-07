// Tells people when a new version of the app has been deployed, so they don't
// need to know to hard-refresh. It compares the versioned files this page is
// running (the ?v=N on each script and stylesheet in index.html) with the ones
// in the live index.html. Bumping a ?v=N, which a deploy already requires for
// browsers to pick up the change, is what triggers the message. Nothing
// reloads by itself, so nobody loses what they are typing.
(function () {
  "use strict";

  var CHECK_EVERY_MS = 5 * 60 * 1000; // background check
  var MIN_GAP_MS = 60 * 1000; // never check more often than this (focus/visibility events)
  var LATER_MS = 30 * 60 * 1000; // how long "Later" hides the message
  var lastCheck = Date.now();
  var hiddenUntil = 0;
  var banner = null;

  // "app.js?v=61" for every local script/stylesheet that carries a version.
  function signature(root) {
    var found = [];
    root.querySelectorAll("script[src], link[rel~='stylesheet'][href]").forEach(function (el) {
      var url = el.getAttribute("src") || el.getAttribute("href") || "";
      if (/^(https?:)?\/\//i.test(url) || url.indexOf("?v=") === -1) return;
      found.push(url);
    });
    return found.sort().join("|");
  }

  var running = signature(document);
  if (!running) return; // nothing versioned to compare

  function injectStyles() {
    if (document.getElementById("updateBannerStyles")) return;
    var style = document.createElement("style");
    style.id = "updateBannerStyles";
    style.textContent =
      "#updateBanner{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:80;" +
      "display:flex;align-items:center;gap:12px;max-width:calc(100vw - 32px);padding:10px 14px;" +
      "background:var(--surface-2,#2B303A);color:var(--ink,#EDEFF3);border:1px solid var(--accent,#4CB8C4);" +
      "border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.35);font-size:14px}" +
      "#updateBanner button{font:inherit;cursor:pointer;border-radius:8px;padding:6px 12px;border:1px solid transparent}" +
      "#updateBanner .update-reload{background:var(--accent,#4CB8C4);color:var(--on-accent,#08151A);font-weight:600}" +
      "#updateBanner .update-later{background:transparent;color:var(--muted,#9AA2B1);border-color:var(--hairline,#333A45)}";
    document.head.appendChild(style);
  }

  function showBanner() {
    if (Date.now() < hiddenUntil) return;
    if (banner) {
      banner.hidden = false;
      return;
    }
    injectStyles();
    banner = document.createElement("div");
    banner.id = "updateBanner";
    banner.setAttribute("role", "status");
    banner.innerHTML =
      "<span>An update has been added.</span>" +
      '<button type="button" class="update-reload">Click to reload</button>' +
      '<button type="button" class="update-later">Later</button>';
    banner.querySelector(".update-reload").addEventListener("click", function () {
      window.location.reload();
    });
    banner.querySelector(".update-later").addEventListener("click", function () {
      hiddenUntil = Date.now() + LATER_MS;
      banner.hidden = true;
    });
    document.body.appendChild(banner);
  }

  function check() {
    lastCheck = Date.now();
    // no-store plus a throwaway query so neither the browser nor the host's
    // cache can answer with the copy this page already has.
    fetch(window.location.pathname + "?_=" + Date.now(), { cache: "no-store", credentials: "same-origin" })
      .then(function (res) {
        if (!res.ok) throw new Error("status " + res.status);
        return res.text();
      })
      .then(function (html) {
        var live = signature(new DOMParser().parseFromString(html, "text/html"));
        // An empty signature means we didn't get the app's page (an error page, say).
        if (live && live !== running) showBanner();
      })
      .catch(function () {
        /* offline or a blip: try again at the next check */
      });
  }

  function checkIfDue() {
    if (document.visibilityState === "visible" && Date.now() - lastCheck >= MIN_GAP_MS) check();
  }

  setInterval(checkIfDue, CHECK_EVERY_MS);
  document.addEventListener("visibilitychange", checkIfDue);
  window.addEventListener("focus", checkIfDue);
})();
