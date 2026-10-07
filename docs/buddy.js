/* The avatar: a small friendly face in the corner that says hello, cheers on milestones and shows notes
   from the admin (message of the day, or a note for one person).
   - Greets once a day, and says welcome back after a few days away.
   - Reacts to the first call of the day, 10 calls, the daily goal, and call streaks.
   - Wraps up the day after 5pm.
   - Shows notes written in Admin > Controls (sql/031); each person sees a note pop up once.
   Quiet by design: at most three pop-ups a day (notes excepted), none during call mode, and each person
   can set it to "All", "Big moments only" or "Off". Loaded after today.js; today.js calls dmeBuddy.onToday(view, goal). */
(function () {
  "use strict";

  const IMG = "avatar/";
  const POSES = {
    neutral: "bd-neutral.webp",
    wave: "bd-wave.webp",
    thumbs: "bd-thumbs-up.webp",
    party: "bd-party.webp",
    thinking: "bd-thinking.webp",
    sleepy: "bd-sleepy.webp",
    note: "bd-note.webp",
    phone: "bd-phone.webp",
  };
  const MODE_KEY = "dmeBuddyMode"; // all | big | off
  const SHOWN_KEY = "dmeBuddyShown"; // { day, n, keys: [] }
  const LAST_SEEN_KEY = "dmeBuddyLastSeen"; // YYYY-MM-DD of the last visit
  const DAILY_CAP = 3;
  const AWAY_DAYS = 3;

  const TIPS = [
    "Ask who handles supplier orders. They're often not the person who answers.",
    "Mention you're local. People are friendlier to someone nearby.",
    "A short voicemail beats a long one: who you are, why, your number, twice.",
    "Best times to call: mid-morning and mid-afternoon. The 'good time to call' dot helps.",
    "Log a quick note after each call. Future you will thank you.",
    "No answer? Set a callback for tomorrow before you forget.",
    "Two calls to the same office on different days beat two in one day.",
    "End every call with the next step: a callback, a meeting, or a time.",
    "Smile when you dial. It really does come through in your voice.",
    "Going cold leads are the cheapest ones to win back. Try them first.",
  ];
  const PEP = [
    "You've got this.",
    "One call at a time.",
    "Every no is one step closer to a yes.",
    "Small steps still count.",
    "Nice and steady wins this.",
  ];

  let host = null;
  let queue = [];
  let showing = null; // the pop-up on screen
  let hideTimer = null;
  let notes = [];
  let lastCalls = null; // calls today at the previous look, so a milestone is only said when crossed
  let started = false;

  /* ---------- little helpers ---------- */

  const read = (key, fallback) => {
    try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
  };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ } };
  const pad = (n) => String(n).padStart(2, "0");
  const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => dayOf(new Date());
  const firstName = () => String(getSession()?.displayName || "").trim().split(/\s+/)[0];
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

  function mode() {
    const m = read(MODE_KEY, "all");
    return m === "big" || m === "off" ? m : "all";
  }

  function shownToday() {
    const s = read(SHOWN_KEY, null);
    return s && s.day === today() ? s : { day: today(), n: 0, keys: [] };
  }

  const callOpen = () => document.documentElement.classList.contains("call-open");

  /* ---------- the corner ---------- */

  function build() {
    if (host) return;
    host = document.createElement("div");
    host.className = "buddy";
    host.hidden = true;
    host.innerHTML = `
      <div class="buddy-bubble" id="buddyBubble" role="status" aria-live="polite" hidden></div>
      <div class="buddy-panel" id="buddyPanel" hidden></div>
      <button type="button" class="buddy-launch" id="buddyLaunch" aria-label="Open your avatar" aria-expanded="false">
        <img src="${IMG}${POSES.neutral}" alt="" width="56" height="56">
        <span class="buddy-dot" id="buddyDot" hidden></span>
      </button>`;
    document.body.append(host);
    host.addEventListener("click", onClick);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closePanel(); } });
  }

  const $ = (id) => document.getElementById(id);
  const unseen = () => notes.filter((n) => !n.seen);

  function updateDot() {
    const dot = $("buddyDot");
    if (dot) dot.hidden = unseen().length === 0;
  }

  /* ---------- pop-ups ---------- */

  // kind: "note" (always shown), "big" (milestones), "small" (greetings and tips).
  function say({ key, kind = "small", pose = "neutral", title = "", text, noteId = "", from = "" }) {
    if (!getSession() || mode() === "off") return; // Off: no pop-ups at all (notes still wait under the face)
    if (mode() === "big" && kind === "small") return;
    const s = shownToday();
    if (key && s.keys.includes(key)) return;
    if (kind !== "note" && s.n >= DAILY_CAP) return;
    if (queue.some((q) => q.key && q.key === key)) return;
    queue.push({ key, kind, pose, title, text, noteId, from });
    next();
  }

  function next() {
    if (showing || !queue.length || !host) return;
    if (callOpen() || document.hidden) { setTimeout(next, 4000); return; } // never in the middle of a call
    const item = queue.shift();
    if (mode() === "off") return next();
    showing = item;
    if (item.kind !== "note") {
      const s = shownToday();
      s.n += 1;
      if (item.key) s.keys.push(item.key);
      write(SHOWN_KEY, s);
    } else if (item.key) {
      const s = shownToday();
      s.keys.push(item.key);
      write(SHOWN_KEY, s);
    }
    renderBubble(item);
    host.hidden = false;
    clearTimeout(hideTimer);
    // Notes wait for "Got it"; everything else tidies itself away.
    if (item.kind !== "note") hideTimer = setTimeout(dismiss, 14000);
  }

  function renderBubble(item) {
    const bubble = $("buddyBubble");
    bubble.innerHTML = `
      <img class="buddy-pose" src="${IMG}${POSES[item.pose] || POSES.neutral}" alt="" width="84" height="84">
      <div class="buddy-body">
        ${item.title ? `<div class="buddy-title">${escapeHtml(item.title)}</div>` : ""}
        <div class="buddy-text">${escapeHtml(item.text).replace(/\n/g, "<br>")}</div>
        ${item.from ? `<div class="buddy-from">From ${escapeHtml(item.from)}</div>` : ""}
        <div class="buddy-actions">
          <button type="button" class="btn btn-primary btn-small" data-buddy="dismiss">${item.kind === "note" ? "Got it" : "Thanks"}</button>
          ${item.kind !== "note" ? '<button type="button" class="link-btn" data-buddy="quiet" title="Show only big moments">Quieter</button>' : ""}
        </div>
      </div>`;
    bubble.hidden = false;
    bubble.classList.remove("is-in");
    void bubble.offsetWidth; // restart the little entrance
    bubble.classList.add("is-in");
  }

  function dismiss() {
    clearTimeout(hideTimer);
    const item = showing;
    showing = null;
    const bubble = $("buddyBubble");
    if (bubble) { bubble.hidden = true; bubble.innerHTML = ""; }
    if (item && item.noteId) markSeen(item.noteId);
    setTimeout(next, 600);
  }

  async function markSeen(id) {
    const n = notes.find((x) => x.id === id);
    if (n) n.seen = true;
    updateDot();
    renderPanel();
    try { await apiPost("buddy/seen", { id }); } catch (err) { console.log("[buddy] " + err.message); }
  }

  /* ---------- the panel (click the face) ---------- */

  function closePanel() {
    const panel = $("buddyPanel");
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    $("buddyLaunch")?.setAttribute("aria-expanded", "false");
  }

  function renderPanel() {
    const panel = $("buddyPanel");
    if (!panel || panel.hidden) return;
    const m = mode();
    const list = notes.slice(0, 5);
    panel.innerHTML = `
      <div class="buddy-panel-head">
        <img src="${IMG}${POSES.thinking}" alt="" width="64" height="64">
        <div class="buddy-panel-tip"><strong>Tip</strong><br>${escapeHtml(panel.dataset.tip || pick(TIPS))}</div>
      </div>
      <div class="buddy-panel-notes">
        ${list.length
          ? list.map((n) => `<div class="buddy-note${n.seen ? "" : " is-new"}">
              <div class="buddy-note-text">${escapeHtml(n.body).replace(/\n/g, "<br>")}</div>
              <div class="buddy-note-meta">${n.personal ? "Just for you" : "For everyone"}${n.from ? ` · ${escapeHtml(n.from)}` : ""} · ${escapeHtml(new Date(n.at).toLocaleDateString(undefined, { month: "short", day: "numeric" }))}</div>
            </div>`).join("")
          : '<div class="muted-note">No notes right now.</div>'}
      </div>
      <div class="buddy-panel-foot">
        <span class="muted-note">Pop-ups</span>
        <div class="buddy-seg" role="group" aria-label="How often your avatar pops up">
          ${[["all", "All"], ["big", "Big moments"], ["off", "Off"]].map(([v, label]) => `<button type="button" class="buddy-seg-btn${m === v ? " is-on" : ""}" data-buddy-mode="${v}" aria-pressed="${m === v}">${label}</button>`).join("")}
        </div>
      </div>`;
  }

  function togglePanel() {
    const panel = $("buddyPanel");
    if (!panel.hidden) { closePanel(); return; }
    panel.dataset.tip = pick([...TIPS, ...PEP]);
    panel.hidden = false;
    $("buddyLaunch").setAttribute("aria-expanded", "true");
    renderPanel();
    // Opening the panel counts as having looked at the notes in it.
    unseen().slice(0, 5).forEach((n) => markSeen(n.id));
  }

  function onClick(e) {
    const act = e.target.closest("[data-buddy]");
    if (act) {
      if (act.dataset.buddy === "dismiss") dismiss();
      else if (act.dataset.buddy === "quiet") { write(MODE_KEY, "big"); dismiss(); showToast("Your avatar will only pop up for big moments. Change it by clicking her face."); }
      return;
    }
    const m = e.target.closest("[data-buddy-mode]");
    if (m) { write(MODE_KEY, m.dataset.buddyMode); renderPanel(); return; }
    if (e.target.closest("#buddyLaunch")) togglePanel();
  }

  document.addEventListener("click", (e) => {
    if (host && !host.contains(e.target)) closePanel();
  });

  /* ---------- what she says ---------- */

  function hello(view) {
    const key = `hello:${today()}`;
    const name = firstName();
    const h = new Date().getHours();
    const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    const lastSeen = read(LAST_SEEN_KEY, "");
    write(LAST_SEEN_KEY, today());
    const waiting = [
      view.review.length ? `${plural(view.review.length, "meeting")} to wrap up` : "",
      view.callbacksTotal ? `${plural(view.callbacksTotal, "callback")} due` : "",
      view.stale.total ? `${view.stale.total} going cold` : "",
    ].filter(Boolean);

    const away = lastSeen ? Math.floor((Date.parse(today()) - Date.parse(lastSeen)) / 86_400_000) : 0;
    if (away >= AWAY_DAYS) {
      say({ key, kind: "small", pose: "sleepy", title: `Welcome back${name ? `, ${name}` : ""}`, text: `It's been ${away} days.${view.stale.total ? ` ${plural(view.stale.total, "lead")} could use a nudge, so start there.` : " Ease back in with a few easy calls."}` });
      return;
    }
    const day = new Date().getDay();
    const extra = day === 1 ? "Fresh week, fresh start." : day === 5 ? "Last push before the weekend." : "";
    say({
      key,
      kind: "small",
      pose: "wave",
      title: `${part}${name ? `, ${name}` : ""}!`,
      text: waiting.length ? `${waiting.join(" · ")}. ${extra}`.trim() : `Nothing urgent waiting. ${extra || "A good day to open some new leads."}`.trim(),
    });
  }

  function endOfDay(stats, view) {
    if (new Date().getHours() < 17) return;
    const key = `wrap:${today()}`;
    const calls = stats.callsToday;
    if (calls > 0) {
      say({ key, kind: "small", pose: "sleepy", title: "That's a wrap", text: `${plural(calls, "call")} today${view.meetingsToday.length ? ` and ${plural(view.meetingsToday.length, "meeting")}` : ""}. Nice work. Rest up!` });
    } else {
      say({ key, kind: "small", pose: "sleepy", title: "End of day", text: "No calls today, and that's okay. Tomorrow's a fresh start." });
    }
  }

  function milestones(stats, goal) {
    const calls = stats.callsToday || 0;
    const prev = lastCalls;
    lastCalls = calls;
    // First look of this visit: only record where things stand; don't announce what was already true.
    if (prev === null) return;
    const crossed = (n) => prev < n && calls >= n;
    if (goal && crossed(goal)) say({ key: `goal:${today()}`, kind: "big", pose: "party", title: "Goal hit!", text: `${plural(goal, "call")} done. You crushed it today.` });
    else if (crossed(10) && goal > 10) say({ key: `ten:${today()}`, kind: "big", pose: "thumbs", title: "10 calls", text: "Double digits. Keep that rhythm going." });
    else if (crossed(1)) say({ key: `first:${today()}`, kind: "big", pose: "thumbs", title: "First call of the day", text: "Nice start. The first one is always the hardest." });
    if (calls > 0 && [5, 10, 20, 30].includes(stats.streak)) {
      say({ key: `streak${stats.streak}:${today()}`, kind: "big", pose: "party", title: `${stats.streak}-day streak`, text: "Calling every day adds up. That's real consistency." });
    }
  }

  // today.js calls this every time it has fresh numbers.
  function onToday(view, goal) {
    if (!view || !getSession() || !view.stats) return;
    build();
    host.hidden = false;
    hello(view);
    milestones(view.stats, goal);
    endOfDay(view.stats, view);
  }

  /* ---------- notes from the admin ---------- */

  async function loadNotes() {
    try {
      const data = await apiGet("buddy/notes");
      notes = data.notes || [];
    } catch (err) {
      notes = [];
      console.log("[buddy] " + err.message);
    }
    updateDot();
    // Newest unseen first; each note is shown once.
    unseen().slice().reverse().forEach((n) => say({ key: `note:${n.id}`, kind: "note", pose: "note", title: n.personal ? "A note for you" : "Message of the day", text: n.body, noteId: n.id, from: n.from }));
  }

  /* ---------- sign in and out ---------- */

  function start() {
    if (started || !getSession() || getSession()?.mustChangePassword) return;
    started = true;
    build();
    host.hidden = false;
    loadNotes();
  }

  const hooks = window.dmeHooks;
  const previousSignedIn = hooks.onSignedIn;
  hooks.onSignedIn = () => { previousSignedIn?.(); start(); };
  const previousSignedOut = hooks.onSignedOut;
  hooks.onSignedOut = () => {
    previousSignedOut?.();
    started = false;
    queue = [];
    showing = null;
    notes = [];
    lastCalls = null;
    clearTimeout(hideTimer);
    if (host) { host.remove(); host = null; }
  };

  window.dmeBuddy = { onToday, say, reload: loadNotes };
  if (getSession()) start();
})();
