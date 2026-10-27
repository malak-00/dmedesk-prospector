/* "What tipped it?" and "Why not?": when a lead is marked onboarded or not interested, a small bar offers the
   likely reasons as one-tap buttons. It never blocks the next call and goes away on its own. A win's reason is kept
   as "Why they signed" (sql/056) and a no's reason as the lead's main objection (sql/050), both through
   POST /leads/intel, so Insights can show what wins and what loses.
   Wins and noes are noticed where the status is saved (a wrapper on apiPost), so every screen is covered. */
(function (root) {
  "use strict";

  const WIN = [
    ["savings", "Saves them money"],
    ["trust", "Trust or a referral"],
    ["bad experience", "Bad experience with the old biller"],
    ["growth", "Growth or capacity"],
    ["compliance", "Compliance help"],
    ["timing", "Right timing"],
    ["other", "Something else"],
  ];
  const LOSS = [
    ["price", "Price"],
    ["in-house", "Do it in-house"],
    ["happy with current", "Happy with current"],
    ["bad timing", "Bad timing"],
    ["not the decision maker", "Not the decision maker"],
    ["no need", "No need"],
    ["other", "Something else"],
  ];
  const SHOW_MS = 25000;

  // Which question a saved status asks, if any.
  function questionFor(status) {
    const s = String(status || "").trim().toLowerCase();
    if (s === "onboarded") return { kind: "win", title: "Signed! What tipped it?", field: "winReason", options: WIN };
    if (s === "not interested") return { kind: "loss", title: "Why not?", field: "objection", options: LOSS };
    return null;
  }

  if (typeof document === "undefined") {
    if (typeof module !== "undefined" && module.exports) module.exports = { questionFor, WIN, LOSS };
    return;
  }

  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  let bar = null;
  let timer = 0;

  function hide() {
    clearTimeout(timer);
    if (bar) bar.hidden = true;
  }

  function show(npi, q) {
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "reason-bar";
      bar.setAttribute("role", "group");
      document.body.appendChild(bar);
      bar.addEventListener("click", async (e) => {
        const close = e.target.closest("[data-reason-close]");
        if (close) { hide(); return; }
        const btn = e.target.closest("[data-reason]");
        if (!btn) return;
        const { npi: forNpi, field } = bar.dataset;
        hide();
        try {
          await root.apiPost("leads/intel", { npi: forNpi, fields: { [field]: btn.dataset.reason } });
          if (root.dmeHooks && root.dmeHooks.intelOpened) root.dmeHooks.intelOpened(forNpi, true);
          if (typeof root.showToast === "function") root.showToast("Thanks, saved");
        } catch (err) {
          if (typeof root.showToast === "function") root.showToast(err.message, true);
        }
      });
    }
    bar.dataset.npi = npi;
    bar.dataset.field = q.field;
    bar.setAttribute("aria-label", q.title);
    bar.innerHTML = `<span class="reason-title">${esc(q.title)}</span>${q.options.map(([value, label]) =>
      `<button type="button" class="reason-opt" data-reason="${esc(value)}">${esc(label)}</button>`).join("")}<button type="button" class="reason-x" data-reason-close aria-label="Skip">&times;</button>`;
    bar.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(hide, SHOW_MS);
  }

  function watch() {
    const original = root.apiPost;
    if (typeof original !== "function" || original.__reasons) return;
    const wrapped = async function (path, body) {
      const result = await original.apply(this, arguments);
      try {
        if (path === "leads/status" && body && body.npi) {
          const q = questionFor(result && result.status);
          if (q) show(String(body.npi), q);
        }
      } catch (err) { console.log("[closereason] " + err.message); }
      return result;
    };
    wrapped.__reasons = true;
    // Keep the flags of any wrapper already in place (buddy.js), so neither is wrapped twice.
    Object.keys(original).forEach((k) => { if (k.startsWith("__")) wrapped[k] = original[k]; });
    root.apiPost = wrapped;
  }

  // apiPost is defined by app.js and wrapped by buddy.js once the app is ready; wrap after both.
  if (document.readyState === "complete") setTimeout(watch, 1500);
  else root.addEventListener("load", () => setTimeout(watch, 1500));
})(typeof window !== "undefined" ? window : globalThis);
