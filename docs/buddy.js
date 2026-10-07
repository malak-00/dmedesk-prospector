/* The avatar: a friendly face in the corner that says hello, cheers on wins and shows notes from the admin.
   - Greets once a day (welcome back after a few days away), wraps up the day after 5pm, and recaps the week on Friday.
   - Reacts to the first call of the day, 10 calls, the daily goal, streaks, a booked meeting and an onboarded lead.
   - Marks birthdays and work anniversaries, and tells the team when someone onboards a lead (if the admin switched that on).
   - Shows notes written in Admin > Controls (message of the day, a note for one person, repeating weekly notes); people can
     react with an emoji or send a one-line reply.
   - A daily mini-challenge, badges (kept on this device), a tip, a joke of the day, and a click-me surprise.
   - Naps after ten idle minutes, wears a seasonal accessory, and keeps you company in call mode (no pop-ups there).
   Quiet by design: at most three routine pop-ups a day, and each person can set All / Big moments only / Off.
   Loaded after today.js; today.js calls dmeBuddy.onToday(view, goal). Notes and extras need sql/031 and sql/032. */
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
  const SURPRISE_POSES = ["wave", "thumbs", "party", "thinking", "note", "phone", "neutral"];
  const MODE_KEY = "dmeBuddyMode"; // all | big | off
  const SHOWN_KEY = "dmeBuddyShown"; // { day, n, keys: [] }
  const LAST_SEEN_KEY = "dmeBuddyLastSeen";
  const BADGES_KEY = "dmeBuddyBadges"; // { id: date earned }, on this device
  const CHALLENGE_KEY = "dmeBuddyChallenge"; // { day, done }
  const DAILY_CAP = 3;
  const AWAY_DAYS = 3;
  const IDLE_MS = 10 * 60 * 1000;
  const REACTIONS = ["\u{1F44D}", "❤️", "\u{1F389}"];

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
  const CALL_TIPS = [
    "Open with who you are and one reason to stay on the line.",
    "Ask: \"Who handles your supplier orders?\" Then wait.",
    "Stuck at the front desk? Ask for the best time to reach the owner.",
    "Voicemail: name, company, why, number. Say the number twice.",
    "Take a breath before you dial. Slow and warm beats fast.",
    "Finish with the next step: a callback time or a meeting.",
    "Note one detail they mention. It's the opener for next time.",
  ];
  const PEP = ["You've got this.", "One call at a time.", "Every no is one step closer to a yes.", "Small steps still count.", "Nice and steady wins this."];
  const JOKES = [
    "Why did the phone go to therapy? It had too many unresolved calls.",
    "Fun fact: a smile can be heard on the phone. Try it on the next one.",
    "What do you call a salesperson who never gives up? Employed.",
    "Fun fact: honey never spoils. Neither does a good relationship with a customer.",
    "Why was the lead so calm? It had a lot of good connections.",
    "Fun fact: the first phone call was \"Mr. Watson, come here.\" Short and to the point.",
    "How does a follow-up end? With a next step.",
    "Fun fact: octopuses have three hearts. Your lead list has at least one that wants to hear from you.",
    "Why don't calendars ever get lonely? They're always full of dates.",
    "Fun fact: the average person says \"um\" about 10 times a minute. Pauses are fine.",
    "What's a closer's favourite drink? A double-shot of confidence.",
    "Fun fact: it takes about 8 touches to land a new customer. You're on your way.",
    "Why did the sticky note get promoted? It stayed on top of everything.",
    "Fun fact: Tuesdays and Thursdays are often the best days to reach busy offices.",
  ];
  const CHALLENGES = [
    { id: "early5", text: "Make 5 calls before 11am", target: 5, by: 11 },
    { id: "three", text: "Make 3 calls before 10am", target: 3, by: 10 },
    { id: "eight", text: "Get 8 calls in before lunch", target: 8, by: 12 },
    { id: "ten", text: "Reach 10 calls by 2pm", target: 10, by: 14 },
    { id: "plus3", text: "Beat your daily goal by 3 calls", target: 0, plus: 3 },
    { id: "six", text: "Make 6 calls today", target: 6 },
  ];
  const BADGES = [
    { id: "early", icon: "\u{1F305}", label: "Early bird", how: "Make your first call of the day before 9am" },
    { id: "streak5", icon: "\u{1F525}", label: "On fire", how: "Call 5 days in a row" },
    { id: "streak10", icon: "\u{1F680}", label: "Unstoppable", how: "Call 10 days in a row" },
    { id: "power", icon: "⚡", label: "Power week", how: "50 calls in one week" },
    { id: "booked", icon: "\u{1F4C5}", label: "Booked it", how: "Book your first meeting" },
    { id: "closer", icon: "\u{1F3C6}", label: "Closer", how: "Onboard a lead" },
    { id: "challenge", icon: "\u{1F3AF}", label: "Challenger", how: "Finish a daily challenge" },
  ];

  let host = null;
  let callHelper = null;
  let queue = [];
  let showing = null;
  let hideTimer = null;
  let notes = [];
  let occasions = [];
  let lastCalls = null; // calls today at the previous look, so a milestone is only said when crossed
  let lastGoal = 15;
  let lastStats = { callsToday: 0, callsWeek: 0, streak: 0 };
  let lastActive = Date.now();
  let napping = false;
  let started = false;

  /* ---------- helpers ---------- */

  const read = (key, fallback) => {
    try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
  };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ } };
  const pad = (n) => String(n).padStart(2, "0");
  const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => dayOf(new Date());
  const dayNumber = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000);
  const firstName = () => String(getSession()?.displayName || "").trim().split(/\s+/)[0];
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const $ = (id) => document.getElementById(id);
  const callOpen = () => document.documentElement.classList.contains("call-open");

  function weekKey() {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return dayOf(d);
  }

  function mode() {
    const m = read(MODE_KEY, "all");
    return m === "big" || m === "off" ? m : "all";
  }

  function shownToday() {
    const s = read(SHOWN_KEY, null);
    return s && s.day === today() ? s : { day: today(), n: 0, keys: [] };
  }

  /* ---------- badges (kept on this device) ---------- */

  const earned = () => read(BADGES_KEY, {});

  function earn(id) {
    const have = earned();
    if (have[id]) return;
    have[id] = today();
    write(BADGES_KEY, have);
    const badge = BADGES.find((b) => b.id === id);
    if (badge) say({ key: `badge:${id}`, kind: "event", pose: "party", title: `New badge: ${badge.label} ${badge.icon}`, text: badge.how + ". You've got it!", confetti: true });
    renderPanel();
  }

  /* ---------- the corner ---------- */

  // A little seasonal extra on her corner: birthdays and anniversaries first, then the calendar.
  function accessory() {
    const mine = occasions.find((o) => o.mine);
    if (mine) return mine.kind === "birthday" ? ["\u{1F382}", "It's your birthday!"] : ["\u{1F389}", "Happy work anniversary!"];
    const d = new Date();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    if (m === 12 && day <= 26) return ["\u{1F385}", "Happy holidays!"];
    if (m === 10 && day >= 24) return ["\u{1F383}", "Happy Halloween!"];
    if (m === 2 && day >= 10 && day <= 14) return ["\u{1F49D}", "Happy Valentine's week!"];
    if ((m === 12 && day >= 27) || (m === 1 && day <= 2)) return ["\u{1F386}", "Happy New Year!"];
    if (d.getDay() === 5) return ["\u{1F60E}", "It's Friday!"];
    return ["", ""];
  }

  function applyAccessory() {
    const el = $("buddyAcc");
    if (!el) return;
    const [emoji, label] = accessory();
    el.textContent = emoji;
    el.title = label;
    el.hidden = !emoji;
  }

  function setLaunchPose(pose) {
    const img = host && host.querySelector(".buddy-launch img");
    if (img) img.src = IMG + (POSES[pose] || POSES.neutral);
  }

  function build() {
    if (host) return;
    host = document.createElement("div");
    host.className = "buddy";
    host.hidden = true;
    host.innerHTML = `
      <div class="buddy-bubble" id="buddyBubble" role="status" aria-live="polite" hidden></div>
      <div class="buddy-panel" id="buddyPanel" hidden></div>
      <button type="button" class="buddy-launch" id="buddyLaunch" aria-label="Open your avatar" aria-expanded="false">
        <img src="${IMG}${POSES.neutral}" alt="" width="88" height="88">
        <span class="buddy-acc" id="buddyAcc" aria-hidden="true" hidden></span>
        <span class="buddy-dot" id="buddyDot" hidden></span>
      </button>`;
    document.body.append(host);
    host.addEventListener("click", onClick);
    host.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("[data-buddy-reply-input]")) sendReply(e.target); });
    applyAccessory();
  }

  const isRecurring = (n) => n.repeatWeekday !== null && n.repeatWeekday !== undefined;
  const unseen = () => notes.filter((n) => !n.seen && !isRecurring(n) && n.kind !== "win");

  function updateDot() {
    const dot = $("buddyDot");
    if (dot) dot.hidden = unseen().length === 0;
  }

  /* ---------- pop-ups ---------- */

  // kind: "note" (waits for "Got it"), "event" (a win or occasion, always shown), "big" (milestones), "small" (greetings, tips).
  function say({ key, kind = "small", pose = "neutral", title = "", text, noteId = "", from = "", react = null, confetti = false }) {
    if (!getSession() || mode() === "off") return;
    if (mode() === "big" && kind === "small") return;
    const s = shownToday();
    if (key && s.keys.includes(key)) return;
    if (kind !== "note" && kind !== "event" && s.n >= DAILY_CAP) return;
    if (queue.some((q) => q.key && q.key === key)) return;
    queue.push({ key, kind, pose, title, text, noteId, from, react, confetti });
    next();
  }

  function next() {
    if (showing || !queue.length || !host) return;
    if (callOpen() || document.hidden) { setTimeout(next, 4000); return; } // never in the middle of a call
    const item = queue.shift();
    if (mode() === "off") return next();
    showing = item;
    const s = shownToday();
    if (item.kind === "small" || item.kind === "big") s.n += 1;
    if (item.key) s.keys.push(item.key);
    write(SHOWN_KEY, s);
    wake();
    renderBubble(item);
    host.hidden = false;
    clearTimeout(hideTimer);
    if (item.kind !== "note") hideTimer = setTimeout(dismiss, item.react ? 30000 : 14000);
  }

  function reactHtml(n) {
    return `<div class="buddy-react" data-note="${escapeHtml(n.id)}">
      <span class="buddy-react-row">${REACTIONS.map((r) => `<button type="button" class="buddy-emoji${n.reaction === r ? " is-on" : ""}" data-buddy-react="${r}" aria-label="React ${r}" aria-pressed="${n.reaction === r}">${r}</button>`).join("")}</span>
      <span class="buddy-reply"><input type="text" maxlength="200" data-buddy-reply-input placeholder="${n.reply ? "Edit your reply" : "Reply…"}" value="${escapeHtml(n.reply || "")}" aria-label="Reply to this note"><button type="button" class="link-btn" data-buddy-reply>Send</button></span>
    </div>`;
  }

  function renderBubble(item) {
    const bubble = $("buddyBubble");
    const n = item.react ? notes.find((x) => x.id === item.react) : null;
    bubble.innerHTML = `
      <img class="buddy-pose" src="${IMG}${POSES[item.pose] || POSES.neutral}" alt="" width="128" height="128">
      <div class="buddy-body">
        ${item.title ? `<div class="buddy-title">${escapeHtml(item.title)}</div>` : ""}
        <div class="buddy-text">${escapeHtml(item.text).replace(/\n/g, "<br>")}</div>
        ${item.from ? `<div class="buddy-from">From ${escapeHtml(item.from)}</div>` : ""}
        ${n ? reactHtml(n) : ""}
        <div class="buddy-actions">
          <button type="button" class="btn btn-primary btn-small" data-buddy="dismiss">${item.kind === "note" ? "Got it" : "Thanks"}</button>
          ${item.kind === "small" || item.kind === "big" ? '<button type="button" class="link-btn" data-buddy="quiet" title="Show only big moments">Quieter</button>' : ""}
        </div>
      </div>`;
    bubble.hidden = false;
    bubble.classList.remove("is-in");
    void bubble.offsetWidth; // restart the little entrance
    bubble.classList.add("is-in");
    if (item.confetti || item.pose === "party") confetti(bubble);
  }

  function confetti(parent) {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const colors = ["var(--accent)", "var(--score-mid)", "var(--score-high)", "var(--score-low)"];
    for (let i = 0; i < 26; i += 1) {
      const bit = document.createElement("i");
      bit.className = "confetti-bit";
      bit.style.cssText = `left:${10 + Math.random() * 80}%;background:${colors[i % colors.length]};--dx:${(Math.random() - 0.5) * 160}px;--rot:${Math.round(Math.random() * 720)}deg;animation-delay:${(Math.random() * 0.25).toFixed(2)}s`;
      parent.append(bit);
      setTimeout(() => bit.remove(), 1800);
    }
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

  async function react(id, patch) {
    const n = notes.find((x) => x.id === id);
    if (!n) return;
    try {
      const saved = await apiPost("buddy/react", { id, ...patch });
      n.reaction = saved.reaction;
      n.reply = saved.reply;
      renderPanel();
      const bubble = $("buddyBubble");
      if (bubble && !bubble.hidden && showing && showing.react === id) {
        const slot = bubble.querySelector(".buddy-react");
        if (slot) slot.outerHTML = reactHtml(n);
      }
      showToast(patch.reply !== undefined ? "Reply sent" : "Sent");
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function sendReply(input) {
    const box = input.closest("[data-note]");
    const text = input.value.trim();
    if (!box || !text) return;
    react(box.dataset.note, { reply: text });
  }

  /* ---------- the panel (click the face) ---------- */

  function closePanel() {
    const panel = $("buddyPanel");
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    $("buddyLaunch")?.setAttribute("aria-expanded", "false");
  }

  function challengeToday() {
    const c = CHALLENGES[dayNumber() % CHALLENGES.length];
    const target = c.plus ? lastGoal + c.plus : c.target;
    const text = c.plus ? `Beat your daily goal by ${c.plus} calls (${target} calls)` : c.text;
    const done = read(CHALLENGE_KEY, {});
    return { ...c, target, text, done: done.day === today() && done.done, late: Boolean(c.by) && new Date().getHours() >= c.by };
  }

  function challengeHtml() {
    const c = challengeToday();
    const calls = lastStats.callsToday || 0;
    const progress = c.done ? "Done! ✅" : c.late ? "Time's up for this one. Back tomorrow." : `${Math.min(calls, c.target)} / ${c.target}`;
    return `<div class="buddy-challenge${c.done ? " is-done" : ""}"><strong>Today's challenge</strong><span>${escapeHtml(c.text)}</span><span class="buddy-progress">${escapeHtml(progress)}</span></div>`;
  }

  function badgesHtml() {
    const have = earned();
    return `<div class="buddy-badges" aria-label="Badges (kept on this device)">${BADGES.map((b) => `<span class="buddy-badge${have[b.id] ? " is-on" : ""}" title="${escapeHtml(b.label)}: ${escapeHtml(b.how)}${have[b.id] ? ` (earned ${escapeHtml(have[b.id])})` : ""}">${b.icon}</span>`).join("")}</div>`;
  }

  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function renderPanel() {
    const panel = $("buddyPanel");
    if (!panel || panel.hidden) return;
    const m = mode();
    const list = notes.slice(0, 6);
    panel.innerHTML = `
      <div class="buddy-panel-head">
        <button type="button" class="buddy-surprise" data-buddy="surprise" title="Click me!"><img id="buddyPanelImg" src="${IMG}${POSES[panel.dataset.pose] || POSES.thinking}" alt="" width="96" height="96"></button>
        <div class="buddy-panel-tip"><strong>${escapeHtml(panel.dataset.label || "Tip")}</strong><br>${escapeHtml(panel.dataset.line || pick(TIPS))}</div>
      </div>
      ${challengeHtml()}
      ${badgesHtml()}
      <div class="buddy-panel-notes">
        ${list.length
          ? list.map((n) => `<div class="buddy-note${n.seen || isRecurring(n) ? "" : " is-new"}">
              <div class="buddy-note-text">${escapeHtml(n.body).replace(/\n/g, "<br>")}</div>
              <div class="buddy-note-meta">${n.kind === "win" ? "Team win" : n.personal ? "Just for you" : "For everyone"}${isRecurring(n) ? ` · every ${WEEKDAYS[n.repeatWeekday]}` : ""}${n.from ? ` · ${escapeHtml(n.from)}` : ""} · ${escapeHtml(new Date(n.at).toLocaleDateString(undefined, { month: "short", day: "numeric" }))}</div>
              ${n.kind === "win" ? "" : reactHtml(n)}
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
    panel.dataset.pose = "thinking";
    panel.dataset.label = "Joke of the day";
    panel.dataset.line = JOKES[dayNumber() % JOKES.length];
    panel.hidden = false;
    $("buddyLaunch").setAttribute("aria-expanded", "true");
    renderPanel();
    // Opening the panel counts as having looked at the notes in it.
    unseen().slice(0, 6).forEach((n) => markSeen(n.id));
  }

  // Click her picture for a random pose and line.
  function surprise() {
    const panel = $("buddyPanel");
    const pose = pick(SURPRISE_POSES);
    const options = [["Tip", pick(TIPS)], ["Pep talk", pick(PEP)], ["Fun", pick(JOKES)]];
    const [label, line] = pick(options);
    panel.dataset.pose = pose;
    panel.dataset.label = label;
    panel.dataset.line = line;
    renderPanel();
    if (pose === "party") confetti(panel.querySelector(".buddy-panel-head"));
  }

  function onClick(e) {
    const act = e.target.closest("[data-buddy]");
    if (act) {
      const what = act.dataset.buddy;
      if (what === "dismiss") dismiss();
      else if (what === "surprise") surprise();
      else if (what === "quiet") { write(MODE_KEY, "big"); dismiss(); showToast("Your avatar will only pop up for big moments. Change it by clicking her face."); }
      return;
    }
    const emoji = e.target.closest("[data-buddy-react]");
    if (emoji) {
      const box = emoji.closest("[data-note]");
      const n = notes.find((x) => x.id === box.dataset.note);
      react(box.dataset.note, { reaction: n && n.reaction === emoji.dataset.buddyReact ? "" : emoji.dataset.buddyReact });
      return;
    }
    const reply = e.target.closest("[data-buddy-reply]");
    if (reply) { sendReply(reply.parentElement.querySelector("[data-buddy-reply-input]")); return; }
    const m = e.target.closest("[data-buddy-mode]");
    if (m) { write(MODE_KEY, m.dataset.buddyMode); renderPanel(); syncCallHelper(); return; }
    if (e.target.closest("#buddyLaunch")) togglePanel();
  }

  document.addEventListener("click", (e) => {
    if (host && !host.contains(e.target)) closePanel();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePanel(); });

  /* ---------- naps ---------- */

  function wake() {
    lastActive = Date.now();
    if (napping) { napping = false; setLaunchPose("neutral"); }
  }

  ["mousemove", "keydown", "click", "touchstart", "scroll"].forEach((type) => {
    let last = 0;
    window.addEventListener(type, () => {
      const now = Date.now();
      if (now - last < 2000) return; // cheap: look at most every 2 seconds
      last = now;
      wake();
    }, { passive: true, capture: true });
  });
  setInterval(() => {
    if (!host || napping || Date.now() - lastActive < IDLE_MS) return;
    napping = true;
    setLaunchPose("sleepy");
  }, 30000);

  /* ---------- keeping you company in call mode ---------- */

  function buildCallHelper() {
    if (callHelper) return;
    callHelper = document.createElement("div");
    callHelper.className = "buddy-call";
    callHelper.hidden = true;
    callHelper.innerHTML = `
      <div class="buddy-call-tip" id="buddyCallTip"></div>
      <img src="${IMG}${POSES.phone}" alt="" width="120" height="120">
      <button type="button" class="link-btn" id="buddyCallNext">Another tip</button>`;
    document.body.append(callHelper);
    callHelper.querySelector("#buddyCallNext").addEventListener("click", () => { $("buddyCallTip").textContent = pick(CALL_TIPS); });
  }

  function syncCallHelper() {
    const show = getSession() && callOpen() && mode() !== "off";
    if (show) {
      buildCallHelper();
      $("buddyCallTip").textContent = pick(CALL_TIPS);
      callHelper.hidden = false;
    } else if (callHelper) {
      callHelper.hidden = true;
    }
  }
  new MutationObserver(syncCallHelper).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

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
    if (stats.callsToday > 0) {
      say({ key, kind: "small", pose: "sleepy", title: "That's a wrap", text: `${plural(stats.callsToday, "call")} today${view.meetingsToday.length ? ` and ${plural(view.meetingsToday.length, "meeting")}` : ""}. Nice work. Rest up!` });
    } else {
      say({ key, kind: "small", pose: "sleepy", title: "End of day", text: "No calls today, and that's okay. Tomorrow's a fresh start." });
    }
  }

  function weeklyRecap(stats) {
    const d = new Date();
    if (d.getDay() !== 5 || d.getHours() < 15 || !stats.callsWeek) return;
    say({
      key: `recap:${weekKey()}`,
      kind: "big",
      pose: "thumbs",
      title: "Your week",
      text: `${plural(stats.callsWeek, "call")}${stats.heldWeek ? `, ${plural(stats.heldWeek, "meeting")} held` : ""}${stats.streak ? `, ${stats.streak}-day streak` : ""}. Enjoy the weekend, you earned it.`,
    });
  }

  function challengeCheck(calls) {
    const c = challengeToday();
    if (c.done || c.late || calls < c.target) return;
    write(CHALLENGE_KEY, { day: today(), done: true });
    say({ key: `challenge:${today()}`, kind: "event", pose: "party", title: "Challenge complete!", text: `${c.text}. Done.`, confetti: true });
    earn("challenge");
    renderPanel();
  }

  function milestones(stats, goal) {
    const calls = stats.callsToday || 0;
    const prev = lastCalls;
    lastCalls = calls;
    if (stats.streak >= 5) earn("streak5");
    if (stats.streak >= 10) earn("streak10");
    if ((stats.callsWeek || 0) >= 50) earn("power");
    // First look of this visit: only record where things stand; don't announce what was already true.
    if (prev === null) return;
    challengeCheck(calls);
    const crossed = (n) => prev < n && calls >= n;
    if (goal && crossed(goal)) say({ key: `goal:${today()}`, kind: "big", pose: "party", title: "Goal hit!", text: `${plural(goal, "call")} done. You crushed it today.` });
    else if (crossed(10) && goal > 10) say({ key: `ten:${today()}`, kind: "big", pose: "thumbs", title: "10 calls", text: "Double digits. Keep that rhythm going." });
    else if (crossed(1)) {
      say({ key: `first:${today()}`, kind: "big", pose: "thumbs", title: "First call of the day", text: "Nice start. The first one is always the hardest." });
      if (new Date().getHours() < 9) earn("early");
    }
    if (calls > 0 && [5, 10, 20, 30].includes(stats.streak)) {
      say({ key: `streak${stats.streak}:${today()}`, kind: "big", pose: "party", title: `${stats.streak}-day streak`, text: "Calling every day adds up. That's real consistency." });
    }
  }

  // today.js calls this every time it has fresh numbers.
  function onToday(view, goal) {
    if (!view || !getSession() || !view.stats) return;
    build();
    host.hidden = false;
    lastGoal = goal || lastGoal;
    lastStats = view.stats;
    hello(view);
    milestones(view.stats, lastGoal);
    weeklyRecap(view.stats);
    endOfDay(view.stats, view);
  }

  /* ---------- wins: a meeting booked, a lead onboarded ---------- */

  const companyName = (npi) => {
    const lead = (state.claimedLeads || []).find((l) => l.npi === String(npi));
    return (lead && lead.name) || "";
  };

  function meetingBooked(npi) {
    const name = companyName(npi);
    say({ key: `meeting:${npi}:${today()}`, kind: "event", pose: "thumbs", title: "Meeting booked!", text: `${name ? `${name}. ` : ""}That's a real step forward.` });
    earn("booked");
  }

  function onboarded(npi) {
    const name = companyName(npi);
    say({ key: `won:${npi}:${today()}`, kind: "event", pose: "party", title: "Onboarded!", text: `${name ? `${name} is a customer. ` : ""}Huge. Well done!`, confetti: true });
    earn("closer");
  }

  // Wins are noticed where they're saved, so every screen (call mode, Today, Claimed) is covered without
  // each one having to remember to tell her.
  function watchWins() {
    const original = window.apiPost;
    if (typeof original !== "function" || original.__buddy) return;
    const wrapped = async function (path, body) {
      const result = await original.apply(this, arguments);
      try {
        if ((path === "leads/book-meeting" || path === "leads/meeting") && body && (body.meetingAt || body.startTime)) meetingBooked(body.npi);
        else if (path === "leads/status" && String(result && result.status || "").trim().toLowerCase() === "onboarded") onboarded(body.npi);
      } catch (err) { console.log("[buddy] " + err.message); }
      return result;
    };
    wrapped.__buddy = true;
    window.apiPost = wrapped;
  }

  /* ---------- notes and occasions from the server ---------- */

  function occasionsToSay() {
    for (const o of occasions) {
      const key = `occasion:${o.kind}:${o.userId}:${today()}`;
      if (o.mine && o.kind === "birthday") say({ key, kind: "event", pose: "party", title: `Happy birthday${firstName() ? `, ${firstName()}` : ""}!`, text: "Hope it's a great one. The team is lucky to have you.", confetti: true });
      else if (o.mine) say({ key, kind: "event", pose: "party", title: `${plural(o.years, "year")} with the team!`, text: "Happy work anniversary. Thank you for everything you do.", confetti: true });
      else if (o.kind === "birthday") say({ key, kind: "event", pose: "wave", title: "A birthday today", text: `It's ${o.name}'s birthday. Say hi!` });
      else say({ key, kind: "event", pose: "thumbs", title: "A work anniversary", text: `${o.name} is celebrating ${plural(o.years, "year")} with the team today.` });
    }
  }

  async function loadNotes() {
    try {
      const data = await apiGet("buddy/notes", { day: today() });
      notes = data.notes || [];
      occasions = data.occasions || [];
    } catch (err) {
      notes = [];
      occasions = [];
      console.log("[buddy] " + err.message);
    }
    updateDot();
    applyAccessory();
    renderPanel();
    const weekday = new Date().getDay();
    // Newest unseen first; each note is shown once (a weekly note once each day it applies).
    notes.slice().reverse().forEach((n) => {
      if (n.kind === "win") {
        if (!n.seen) say({ key: `note:${n.id}`, kind: "event", pose: "party", title: "Team win", text: n.body, noteId: n.id, confetti: true });
      } else if (isRecurring(n)) {
        if (n.repeatWeekday === weekday) say({ key: `note:${n.id}:${today()}`, kind: "note", pose: "note", title: "A weekly note", text: n.body, from: n.from, react: n.id });
      } else if (!n.seen) {
        say({ key: `note:${n.id}`, kind: "note", pose: "note", title: n.personal ? "A note for you" : "Message of the day", text: n.body, noteId: n.id, from: n.from, react: n.id });
      }
    });
    occasionsToSay();
  }

  /* ---------- sign in and out ---------- */

  function start() {
    if (started || !getSession() || getSession()?.mustChangePassword) return;
    started = true;
    build();
    host.hidden = false;
    watchWins();
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
    occasions = [];
    lastCalls = null;
    napping = false;
    clearTimeout(hideTimer);
    if (host) { host.remove(); host = null; }
    if (callHelper) callHelper.hidden = true;
  };

  window.dmeBuddy = { onToday, say, reload: loadNotes };
  if (getSession()) start();
})();
