/* Wheel prizes at work. A prize from the wheel (see wheel.js) becomes a "perk" kept on this device for the person who won it:
   a profile frame, a title by your name, a Caro look, a header sparkle, an app colour (all shown on the page through attributes
   on <html> and a small label in the header), Caro's lead pick on Today, an extra snooze and a golden kudos (used by app.js and
   buddy-fun.js). Perks run out by themselves at the end of their day. Loaded after buddy-fun.js. */
(function () {
  "use strict";

  const W = window.dmeWheel;
  const buddy = window.dmeBuddy;
  if (!W || !buddy || !buddy.api) return;
  const api = buddy.api;

  const root = document.documentElement;
  const who = () => String((getSession() || {}).username || "").toLowerCase();
  const KEY = () => `dmePerks:${who()}`;

  function load() {
    if (!who()) return {};
    try {
      const raw = JSON.parse(localStorage.getItem(KEY()) || "{}");
      const perks = W.prune(raw && typeof raw === "object" ? raw : {});
      if (Object.keys(perks).length !== Object.keys(raw || {}).length) store(perks);
      return perks;
    } catch { return {}; }
  }
  function store(perks) { try { localStorage.setItem(KEY(), JSON.stringify(perks)); } catch { /* not remembered */ } }

  const value = (kind) => W.activeValue(load(), kind);
  const has = (kind) => value(kind) != null;

  function setAttr(name, v) { if (v) root.dataset[name] = v; else delete root.dataset[name]; }

  function paintTitle(text) {
    const name = document.getElementById("userName");
    if (!name) return;
    let el = name.parentElement.querySelector(".user-title");
    if (!text) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement("span"); el.className = "user-title"; name.after(el); }
    el.textContent = text;
    el.title = "A prize from the wheel, until tomorrow";
  }

  function clearDom() {
    ["accent", "frame", "deco"].forEach((n) => setAttr(n, ""));
    paintTitle("");
  }

  // Shows whatever is active, and puts Caro's resting pose back once a won look has run out.
  function apply() {
    if (!who()) { clearDom(); return; }
    const perks = load();
    setAttr("accent", W.activeValue(perks, "accent"));
    setAttr("frame", W.activeValue(perks, "frame"));
    setAttr("deco", W.activeValue(perks, "deco"));
    paintTitle(W.activeValue(perks, "title") || "");
    if (perks.lookRestore && !W.activeValue(perks, "look")) {
      api.setPreferred(perks.lookRestore.pose || "");
      const next = W.consume(perks, "lookRestore");
      store(next);
    }
  }

  // index is the slice that won, value what it gives (see wheel.js).
  function grant(index, val) {
    let perks = load();
    const kind = W.PRIZES[index].kind;
    if (kind === "look") {
      if (!perks.lookRestore) perks = { ...perks, lookRestore: { pose: api.preferred() || "" } };
      api.unlockPose(val);
      api.setPreferred(val);
    }
    store(W.grant(perks, index, val));
    apply();
  }

  function consume(kind) {
    store(W.consume(load(), kind));
    apply();
    api.rerender();
  }

  // What is active right now, for the wheel's panel.
  function list() {
    const perks = load();
    return W.PRIZES.filter((p) => perks[p.kind] && W.activeValue(perks, p.kind) != null).map((p, i) => {
      const index = W.PRIZES.indexOf(p);
      return { kind: p.kind, label: p.label, value: perks[p.kind].value, until: perks[p.kind].until, text: W.describe(index, perks[p.kind].value) };
    });
  }

  window.dmePerks = { value, has, grant, consume, list, apply };

  const hooks = window.dmeHooks;
  if (hooks) {
    const previousView = hooks.onView;
    hooks.onView = (view) => { previousView?.(view); apply(); };
    const previousSignedOut = hooks.onSignedOut;
    hooks.onSignedOut = () => { previousSignedOut?.(); clearDom(); };
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) apply(); });
  setInterval(apply, 5 * 60 * 1000);
  apply();
})();
