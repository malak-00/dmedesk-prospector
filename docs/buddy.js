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
    wink: "bd-wink.webp",
    encourage: "bd-encourage.webp",
    halloween: "bd-halloween.webp",
    thanksgiving: "bd-thanksgiving.webp",
    christmas: "bd-christmas.webp",
    newyear: "bd-newyear.webp",
    valentine: "bd-valentine.webp",
    birthday: "bd-birthday.webp",
    friday: "bd-friday.webp",
    monday: "bd-monday.webp",
    rainy: "bd-rainy.webp",
    easter: "bd-easter.webp",
    ramadan: "bd-ramadan.webp",
    eid: "bd-eid.webp",
    july4: "bd-july4.webp",
    stpatrick: "bd-stpatrick.webp",
    armedforces: "bd-armedforces.webp",
  };
  const SURPRISE_POSES = ["wave", "thumbs", "party", "thinking", "note", "phone", "neutral", "wink", "encourage", "rainy"];
  const MODE_KEY = "dmeBuddyMode"; // all | big | off
  const SHOWN_KEY = "dmeBuddyShown"; // { day, n, keys: [] }
  const LAST_SEEN_KEY = "dmeBuddyLastSeen";
  const BADGES_KEY = "dmeBuddyBadges"; // { id: date earned }, on this device
  const CHALLENGE_KEY = "dmeBuddyChallenge"; // { day, done }
  const NAME = "Caro";
  const POSES_KEY = "dmeBuddyPoses"; // { pose: date first seen }, on this device
  const PREF_KEY = "dmeBuddyPose"; // the resting pose this person chose
  const SOUND_KEY = "dmeBuddySound";
  const QUIET_KEY = "dmeBuddyQuiet"; // { from, to } in minutes since midnight
  const MOOD_KEY_FUN = "dmeFunMood"; // written by buddy-fun.js: { day, mood }
  const LINE_CAP = 5; // little remarks after logging a call, per day
  const LINE_GAP = 20 * 60 * 1000;
  const ON_CALL_QUIET_MS = 10 * 60 * 1000; // after tapping a phone number, assume you're on a call
  const POSE_LABELS = {
    neutral: "Hello", wave: "Wave", thumbs: "Thumbs up", party: "Party", thinking: "Thinking", sleepy: "Sleepy", note: "Note", phone: "On the phone",
    wink: "Wink", encourage: "Encouraging", halloween: "Halloween", thanksgiving: "Thanksgiving", christmas: "Christmas", newyear: "New Year",
    valentine: "Valentine's", birthday: "Birthday", friday: "Friday", monday: "Monday", rainy: "Rainy day", easter: "Easter",
    ramadan: "Ramadan", eid: "Eid", july4: "4th of July", stpatrick: "St. Patrick's", armedforces: "6th of October",
  };
  const DAILY_CAP = 3;
  const AWAY_DAYS = 3;
  const IDLE_MS = 10 * 60 * 1000;
  const REACTIONS = [["like", "thumb", "Like"], ["love", "heart", "Love"], ["cheer", "party", "Cheer"]];

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
  // The team's shift, 3:30pm to 11:30pm Cairo time, as minutes since midnight on the person's own clock.
  // Challenges and the end-of-day wrap-up are measured from it, not from the clock's morning.
  const SHIFT = { start: 15 * 60 + 30, end: 23 * 60 + 30 };
  const CHALLENGES = [
    { id: "hour3", text: "Make 3 calls in your first hour", target: 3, after: 60 },
    { id: "two5", text: "Make 5 calls by {time}", target: 5, after: 120 },
    { id: "half8", text: "Get 8 calls in by {time}", target: 8, after: 240 },
    { id: "ten", text: "Reach 10 calls by {time}", target: 10, after: 360 },
    { id: "plus3", text: "Beat your daily goal by 3 calls", target: 0, plus: 3 },
    { id: "six", text: "Make 6 calls this shift", target: 6 },
  ];
  const BADGES = [
    { id: "early", icon: "sunrise", label: "Early bird", how: "Make your first call within 30 minutes of your shift starting" },
    { id: "streak5", icon: "flame", label: "On fire", how: "Call 5 days in a row" },
    { id: "streak10", icon: "rocket", label: "Unstoppable", how: "Call 10 days in a row" },
    { id: "power", icon: "bolt", label: "Power week", how: "50 calls in one week" },
    { id: "booked", icon: "calendar", label: "Booked it", how: "Book your first meeting" },
    { id: "closer", icon: "trophy", label: "Closer", how: "Onboard a lead" },
    { id: "challenge", icon: "target", label: "Challenger", how: "Finish a daily challenge" },
    { id: "riddler", icon: "puzzle", label: "Gamer", how: "Win the game of the day 5 times" },
    { id: "cheer", icon: "megaphone", label: "Cheerleader", how: "Send a teammate kudos" },
    { id: "bingo", icon: "sparkle", label: "Bingo", how: "Get a line on the weekly bingo card" },
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
  let quietUntil = 0;
  let lastLineAt = 0;
  let audio = null;

  // The extra fun (riddle, kudos, wheel, mood...) lives in buddy-fun.js, which plugs into the hooks below.
  const fun = () => window.dmeBuddyFun || null;

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
  const gameOpen = () => document.documentElement.classList.contains("game-open"); // a game window hides her, so she waits
  const minutesNow = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  const clockText = (min) => {
    const h = Math.floor(min / 60) % 24;
    const m = min % 60;
    return `${h % 12 || 12}${m ? `:${pad(m)}` : ""}${h < 12 ? "am" : "pm"}`;
  };

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
    return s && s.day === today() ? s : { day: today(), n: 0, keys: [], lines: 0 };
  }

  /* ---------- poses she has shown (the gallery) ---------- */

  const seenPoses = () => ({ neutral: "start", wave: "start", ...read(POSES_KEY, {}) });
  function unlockPose(pose) {
    if (!pose || !POSES[pose]) return;
    const have = read(POSES_KEY, {});
    if (have[pose] || pose === "neutral" || pose === "wave") return;
    have[pose] = today();
    write(POSES_KEY, have);
  }

  /* ---------- quiet time and sound ---------- */

  function quietHours() {
    const q = read(QUIET_KEY, null);
    return q && Number.isFinite(q.from) && Number.isFinite(q.to) && q.from !== q.to ? q : null;
  }
  function isQuiet() {
    if (Date.now() < quietUntil) return true;
    const q = quietHours();
    if (!q) return false;
    const m = minutesNow();
    return q.from < q.to ? m >= q.from && m < q.to : m >= q.from || m < q.to; // a window may cross midnight
  }
  const toMinutes = (hhmm) => { const [h, m] = String(hhmm || "").split(":").map(Number); return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN; };
  const toTime = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

  // A soft three-note chime for a win; off unless the person turned sound on in the panel.
  function chime() {
    if (!read(SOUND_KEY, false)) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audio = audio || new Ctx();
      const t = audio.currentTime;
      [[660, 0], [880, 0.12], [1175, 0.24]].forEach(([freq, delay]) => {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t + delay);
        gain.gain.exponentialRampToValueAtTime(0.12, t + delay + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.35);
        osc.connect(gain).connect(audio.destination);
        osc.start(t + delay);
        osc.stop(t + delay + 0.4);
      });
    } catch { /* sound isn't available */ }
  }

  const roughToday = () => { const m = read(MOOD_KEY_FUN, {}); return m.day === today() && m.mood === 1; };

  /* ---------- badges (kept on this device) ---------- */

  const earned = () => read(BADGES_KEY, {});

  function earn(id) {
    const have = earned();
    if (have[id]) return;
    have[id] = today();
    write(BADGES_KEY, have);
    const badge = BADGES.find((b) => b.id === id);
    if (badge) say({ key: `badge:${id}`, kind: "event", pose: "party", title: `New badge: ${badge.label}`, text: badge.how + ". You've got it!", confetti: true });
    renderPanel();
  }

  /* ---------- the corner ---------- */

  // Her outfit for the time of year, or "" for her usual look: the holiday holidays.js says it is (the same dates as the
  // header decorations), for the holidays she has a picture for. ?holiday=halloween previews one.
  function seasonPose() {
    const key = window.dmeHolidays && window.dmeHolidays.active && window.dmeHolidays.active();
    return key && POSES[key] ? key : "";
  }
  // Her usual look today: her birthday outfit on the person's own birthday, then the holiday, then Friday's sunglasses and Monday's coffee,
  // then the pose this person picked in her gallery.
  const restPose = () => {
    if (occasions.some((o) => o.mine && o.kind === "birthday")) return "birthday";
    const season = seasonPose();
    if (season) return season;
    if (new Date().getDay() === 5) return "friday";
    if (new Date().getDay() === 1) return "monday";
    const pref = read(PREF_KEY, "");
    return pref && POSES[pref] && seenPoses()[pref] ? pref : "neutral";
  };

  // A little extra on her corner for the one occasion she has no outfit for yet: a work anniversary.
  function accessory() {
    const mine = occasions.find((o) => o.mine && o.kind === "anniversary");
    return mine ? ["party", "Happy work anniversary!"] : ["", ""];
  }

  function applyAccessory() {
    const el = $("buddyAcc");
    if (!el) return;
    const [name, label] = accessory();
    el.innerHTML = name ? uiIcon(name) : "";
    el.title = label;
    el.hidden = !name;
  }

  function setLaunchPose(pose) {
    const img = host && host.querySelector(".buddy-launch img");
    if (img) img.src = IMG + (POSES[pose] || POSES.neutral);
    const launch = host && host.querySelector(".buddy-launch");
    if (launch) launch.classList.toggle("is-outfit", pose !== "neutral");
    unlockPose(pose);
  }

  function build() {
    if (host) return;
    host = document.createElement("div");
    host.className = "buddy";
    host.hidden = true;
    host.innerHTML = `
      <div class="buddy-bubble" id="buddyBubble" role="status" aria-live="polite" hidden></div>
      <div class="buddy-panel" id="buddyPanel" hidden></div>
      <button type="button" class="buddy-launch" id="buddyLaunch" aria-label="Open ${NAME}" aria-expanded="false">
        <img src="${IMG}${POSES[restPose()]}" alt="" width="88" height="88">
        <span class="buddy-acc" id="buddyAcc" aria-hidden="true" hidden></span>
        <span class="buddy-dot" id="buddyDot" hidden></span>
      </button>`;
    document.body.append(host);
    host.addEventListener("click", onClick);
    host.addEventListener("dblclick", (e) => { if (e.target.closest("#buddyLaunch")) cornerSurprise(); });
    host.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("[data-buddy-reply-input]")) sendReply(e.target); });
    applyAccessory();
    setLaunchPose(restPose());
  }

  const isRecurring = (n) => n.repeatWeekday !== null && n.repeatWeekday !== undefined;
  const unseen = () => notes.filter((n) => !n.seen && !isRecurring(n) && n.kind !== "win");

  function updateDot() {
    const dot = $("buddyDot");
    if (dot) dot.hidden = unseen().length === 0;
  }

  /* ---------- pop-ups ---------- */

  // kind: "note" (waits for "Got it"), "event" (a win or occasion, always shown), "big" (milestones), "small" (greetings, tips).
  function say({ key, kind = "small", pose = "neutral", title = "", text, noteId = "", from = "", react = null, confetti = false, choices = null, onChoice = null, onSeen = null, who = null }) {
    if (!getSession() || mode() === "off") return;
    if (mode() === "big" && (kind === "small" || kind === "line")) return;
    const s = shownToday();
    if (key && s.keys.includes(key)) return;
    if (kind === "line") {
      // A passing remark: rare, never queued behind something else, never while she is busy or you're on a call.
      if ((s.lines || 0) >= LINE_CAP || Date.now() - lastLineAt < LINE_GAP || showing || queue.length || isQuiet() || callOpen() || gameOpen()) return;
    } else if (kind !== "note" && kind !== "event" && s.n >= DAILY_CAP) return;
    if (queue.some((q) => q.key && q.key === key)) return;
    queue.push({ key, kind, pose, title, text, noteId, from, react, confetti, choices, onChoice, onSeen, who });
    next();
  }

  function next() {
    if (showing || !queue.length || !host) return;
    if (callOpen() || gameOpen() || document.hidden) { setTimeout(next, 2500); return; } // never in the middle of a call or a game
    if (isQuiet()) { setTimeout(next, 30000); return; } // quiet hours, or you're probably on the phone
    const item = queue.shift();
    if (mode() === "off") return next();
    showing = item;
    const s = shownToday();
    if (item.kind === "small" || item.kind === "big") s.n += 1;
    if (item.kind === "line") { s.lines = (s.lines || 0) + 1; lastLineAt = Date.now(); }
    if (item.key) s.keys.push(item.key);
    write(SHOWN_KEY, s);
    wake();
    renderBubble(item);
    host.hidden = false;
    clearTimeout(hideTimer);
    if (item.kind !== "note") hideTimer = setTimeout(dismiss, item.react || item.choices ? 30000 : item.kind === "line" ? 7000 : 14000);
  }

  function reactHtml(n) {
    return `<div class="buddy-react" data-note="${escapeHtml(n.id)}">
      <span class="buddy-react-row">${REACTIONS.map(([key, icon, label]) => `<button type="button" class="buddy-emoji${n.reaction === key ? " is-on" : ""}" data-buddy-react="${key}" aria-label="${label}" title="${label}" aria-pressed="${n.reaction === key}">${uiIcon(icon)}</button>`).join("")}</span>
      <span class="buddy-reply"><input type="text" maxlength="200" data-buddy-reply-input placeholder="${n.reply ? "Edit your reply" : "Reply…"}" value="${escapeHtml(n.reply || "")}" aria-label="Reply to this note"><button type="button" class="link-btn" data-buddy-reply>Send</button></span>
    </div>`;
  }

  function renderBubble(item) {
    const bubble = $("buddyBubble");
    const n = item.react ? notes.find((x) => x.id === item.react) : null;
    const pair = Boolean(item.who && window.dmeAvatars);
    bubble.classList.toggle("has-who", pair);
    bubble.innerHTML = `
      <span class="buddy-pose-wrap${pair ? " is-pair" : ""}"><img class="buddy-pose" src="${IMG}${POSES[item.pose] || POSES.neutral}" alt="" width="128" height="128">${pair ? `<span class="buddy-who-big">${window.dmeAvatars.html(item.who, 128)}<em>${escapeHtml(item.who.name || "")}</em></span>` : ""}</span>
      <div class="buddy-body">
        <div class="buddy-name">${NAME}</div>
        ${item.title ? `<div class="buddy-title">${escapeHtml(item.title)}</div>` : ""}
        <div class="buddy-text">${escapeHtml(item.text).replace(/\n/g, "<br>")}</div>
        ${item.from ? `<div class="buddy-from">From ${escapeHtml(item.from)}</div>` : ""}
        ${n ? reactHtml(n) : ""}
        ${item.choices ? `<div class="buddy-choices">${item.choices.map((c, i) => `<button type="button" class="btn btn-ghost btn-small" data-buddy-choice="${i}">${c.icon ? uiIcon(c.icon) : ""}${escapeHtml(c.label)}</button>`).join("")}</div>` : ""}
        <div class="buddy-actions">
          <button type="button" class="btn btn-primary btn-small" data-buddy="dismiss">${item.kind === "note" ? "Got it" : item.choices ? "Not now" : "Thanks"}</button>
          ${item.kind === "small" || item.kind === "big" ? '<button type="button" class="link-btn" data-buddy="quiet" title="Show only big moments">Quieter</button>' : ""}
        </div>
      </div>`;
    bubble.hidden = false;
    bubble.classList.remove("is-in");
    void bubble.offsetWidth; // restart the little entrance
    bubble.classList.add("is-in");
    if (item.confetti || item.pose === "party") confetti(bubble);
    unlockPose(item.pose);
    if (item.confetti || item.pose === "party" || item.kind === "event") chime();
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
    if (item && item.onSeen) item.onSeen();
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
    const text = c.plus ? `Beat your daily goal by ${c.plus} calls (${target} calls)` : c.text.replace("{time}", clockText(SHIFT.start + (c.after || 0)));
    const done = read(CHALLENGE_KEY, {});
    return { ...c, target, text, done: done.day === today() && done.done, late: Boolean(c.after) && minutesNow() > SHIFT.start + c.after };
  }

  function challengeHtml() {
    if (roughToday()) return `<div class="buddy-challenge"><strong>Today</strong><span>No challenge today. Just do what you can, and be kind to yourself.</span></div>`;
    const c = challengeToday();
    const calls = lastStats.callsToday || 0;
    const progress = c.done ? `Done! ${uiIcon("check")}` : escapeHtml(c.late ? "Time's up for this one. Back tomorrow." : `${Math.min(calls, c.target)} / ${c.target}`);
    return `<div class="buddy-challenge${c.done ? " is-done" : ""}"><strong>Today's challenge</strong><span>${escapeHtml(c.text)}</span><span class="buddy-progress">${progress}</span></div>`;
  }

  function badgesHtml() {
    const have = earned();
    return `<div class="buddy-badges" aria-label="Badges (kept on this device)">${BADGES.map((b) => `<span class="buddy-badge${have[b.id] ? " is-on" : ""}" title="${escapeHtml(b.label)}: ${escapeHtml(b.how)}${have[b.id] ? ` (earned ${escapeHtml(have[b.id])})` : ""}">${uiIcon(b.icon)}</span>`).join("")}</div>`;
  }

  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function renderPanel() {
    const panel = $("buddyPanel");
    if (!panel || panel.hidden) return;
    const m = mode();
    const list = notes.slice(0, 6);
    panel.innerHTML = `
      <div class="buddy-panel-name">${NAME}</div>
      <div class="buddy-panel-head">
        <button type="button" class="buddy-surprise" data-buddy="surprise" title="Click me!"><img id="buddyPanelImg" src="${IMG}${POSES[panel.dataset.pose] || POSES.thinking}" alt="" width="96" height="96"></button>
        <div class="buddy-panel-tip"><strong>${escapeHtml(panel.dataset.label || "Tip")}</strong><br>${escapeHtml(panel.dataset.line || pick(TIPS))}<div class="buddy-hint">Click my picture for a surprise. Double-click my face for one in the corner.</div></div>
      </div>
      ${challengeHtml()}
      ${badgesHtml()}
      ${fun()?.panelHtml?.() || ""}
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
        <div class="buddy-seg" role="group" aria-label="How often she pops up">
          ${[["all", "All"], ["big", "Big moments"], ["off", "Off"]].map(([v, label]) => `<button type="button" class="buddy-seg-btn${m === v ? " is-on" : ""}" data-buddy-mode="${v}" aria-pressed="${m === v}">${label}</button>`).join("")}
        </div>
      </div>
      <div class="buddy-panel-foot buddy-settings">
        <label class="buddy-quiet">Quiet from <input type="time" data-buddy-quiet="from" value="${quietHours() ? toTime(quietHours().from) : ""}" aria-label="Quiet hours start">
          to <input type="time" data-buddy-quiet="to" value="${quietHours() ? toTime(quietHours().to) : ""}" aria-label="Quiet hours end"></label>
        <label class="buddy-sound"><input type="checkbox" data-buddy-sound ${read(SOUND_KEY, false) ? "checked" : ""}> Sound</label>
        ${window.dmeHolidays && window.dmeHolidays.active && window.dmeHolidays.active() ? `<label class="buddy-sound" title="The little ornaments in the header around a holiday"><input type="checkbox" data-holiday-toggle ${window.dmeHolidays.enabled() ? "checked" : ""}> Decorations</label>` : ""}
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
  const surprisePose = () => (Math.random() < 0.35 ? "wink" : pick(SURPRISE_POSES));

  // Double-click her face in the corner: she answers with a pose and a line, no panel needed.
  function cornerSurprise() {
    if (!getSession() || mode() === "off") return;
    const pose = surprisePose();
    const [title, text] = pick([["Tip", pick(TIPS)], ["Pep talk", pick(PEP)], ["Fun", pick(JOKES)]]);
    closePanel();
    queue.unshift({ kind: "event", pose, title, text, confetti: pose === "party" });
    if (showing) dismiss(); else next();
  }

  function surprise() {
    const panel = $("buddyPanel");
    const pose = surprisePose();
    const options = [["Tip", pick(TIPS)], ["Pep talk", pick(PEP)], ["Fun", pick(JOKES)]];
    const [label, line] = pick(options);
    panel.dataset.pose = pose;
    panel.dataset.label = label;
    panel.dataset.line = line;
    unlockPose(pose);
    renderPanel();
    if (pose === "party") confetti(panel.querySelector(".buddy-panel-head"));
  }

  function onClick(e) {
    const choice = e.target.closest("[data-buddy-choice]");
    if (choice && showing && showing.choices) {
      const picked = showing.choices[Number(choice.dataset.buddyChoice)];
      const handler = showing.onChoice;
      dismiss();
      if (picked && handler) handler(picked.value);
      return;
    }
    if (fun()?.onClick?.(e)) return;
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

  // Quiet hours and the sound switch live in her panel.
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (!t.matches) return;
    if (t.matches("[data-buddy-sound]")) { write(SOUND_KEY, t.checked); if (t.checked) chime(); return; }
    if (t.matches("[data-buddy-quiet]")) {
      const panel = $("buddyPanel");
      const from = toMinutes(panel.querySelector('[data-buddy-quiet="from"]').value);
      const to = toMinutes(panel.querySelector('[data-buddy-quiet="to"]').value);
      if (Number.isNaN(from) || Number.isNaN(to) || from === to) { try { localStorage.removeItem(QUIET_KEY); } catch { /* nothing to clear */ } showToast("Quiet hours are off"); }
      else { write(QUIET_KEY, { from, to }); showToast(`${NAME} will stay quiet from ${clockText(from)} to ${clockText(to)}`); }
    }
  });

  // Tapping a phone number means you're about to be on a call: stay quiet for a while.
  document.addEventListener("click", (e) => {
    if (e.target.closest && e.target.closest('a[href^="tel:"]')) quietUntil = Date.now() + ON_CALL_QUIET_MS;
    // A goodbye on the way out.
    if (e.target.closest && e.target.closest("#signOutBtn") && getSession() && mode() !== "off") {
      const calls = lastStats.callsToday || 0;
      const name = firstName();
      showToast(`${NAME}: see you tomorrow${name ? `, ${name}` : ""}.${calls ? ` ${plural(calls, "call")} today. Nice work!` : ""}`);
    }
  }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePanel(); });

  /* ---------- naps ---------- */

  function wake() {
    lastActive = Date.now();
    if (napping) { napping = false; setLaunchPose(restPose()); }
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
      <div class="buddy-call-extra" id="buddyCallExtra"></div>
      <img src="${IMG}${POSES.phone}" alt="" width="120" height="120">
      <button type="button" class="link-btn" id="buddyCallNext">Another tip</button>`;
    document.body.append(callHelper);
    callHelper.querySelector("#buddyCallNext").addEventListener("click", () => { $("buddyCallTip").textContent = pick(CALL_TIPS); });
    callHelper.addEventListener("click", (e) => {
      if (fun()?.onClick?.(e)) $("buddyCallExtra").innerHTML = fun()?.callHelperHtml?.() || "";
    });
  }

  function syncCallHelper() {
    const show = getSession() && callOpen() && mode() !== "off";
    if (show) {
      buildCallHelper();
      $("buddyCallTip").textContent = pick(CALL_TIPS);
      $("buddyCallExtra").innerHTML = fun()?.callHelperHtml?.() || "";
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
      pose: restPose() === "neutral" ? "wave" : restPose(),
      title: `${part}${name ? `, ${name}` : ""}!`,
      text: waiting.length ? `${waiting.join(" · ")}. ${extra}`.trim() : `Nothing urgent waiting. ${extra || "A good day to open some new leads."}`.trim(),
    });
  }

  function endOfDay(stats, view) {
    if (minutesNow() < SHIFT.end - 60) return; // the last hour of the shift
    const key = `wrap:${today()}`;
    if (stats.callsToday > 0) {
      say({ key, kind: "small", pose: "sleepy", title: "That's a wrap", text: `${plural(stats.callsToday, "call")} today${view.meetingsToday.length ? ` and ${plural(view.meetingsToday.length, "meeting")}` : ""}. Nice work. Rest up!` });
    } else {
      say({ key, kind: "small", pose: "encourage", title: "End of day", text: "No calls today, and that's okay. Tomorrow's a fresh start." });
    }
  }

  function weeklyRecap(stats) {
    const d = new Date();
    if (d.getDay() !== 5 || minutesNow() < SHIFT.end - 150 || !stats.callsWeek) return; // Friday, in the last hours of the shift
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
      const into = minutesNow() - SHIFT.start;
      if (into >= 0 && into <= 30) earn("early");
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
    fun()?.onToday?.(view, lastGoal);
  }

  /* ---------- wins: a meeting booked, a lead onboarded ---------- */

  const companyName = (npi) => {
    const lead = (state.claimedLeads || []).find((l) => l.npi === String(npi));
    return (lead && lead.name) || "";
  };

  const event = (name, info) => { try { fun()?.onEvent?.(name, info); } catch (err) { console.log("[buddy] " + err.message); } };

  function meetingBooked(npi) {
    event("meeting", { npi });
    const name = companyName(npi);
    say({ key: `meeting:${npi}:${today()}`, kind: "event", pose: "thumbs", title: "Meeting booked!", text: `${name ? `${name}. ` : ""}That's a real step forward.` });
    earn("booked");
  }

  const REMARKS = {
    voicemail: ["Voicemail left. Nice and tidy.", "Another voicemail down. The callback will land."],
    interested: ["Interested! Strike while it's warm.", "They're interested. Set a callback so it doesn't cool."],
    "not interested": ["On to the next one.", "A no is just a not-yet. Next!"],
    "no answer": ["No answer. Try again tomorrow."],
    note: ["Logged. Future you says thanks.", "Nice note. That's how deals get remembered."],
    _: ["Logged!", "Noted. Keep it rolling."],
  };
  function remark(kind) {
    const list = REMARKS[kind] || REMARKS._;
    say({ kind: "line", pose: kind === "interested" ? "thumbs" : "wink", text: pick(list) });
  }

  function onboarded(npi) {
    event("won", { npi });
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
        else if (path === "leads/status") { event("result", { npi: body.npi }); remark(String(result && result.status || "").trim().toLowerCase()); }
        else if (path === "leads/notes") { event("result", { npi: body.npi }); remark("note"); }
        else if (path === "leads/reminder" && body && body.reminderAt) event("callback", { npi: body.npi });
        else if (path === "export/sheets" && result && (result.claimedNpis || []).length) event("claim", { count: result.claimedNpis.length });
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
      const who = { userId: o.userId, name: o.name };
      if (o.mine && o.kind === "birthday") say({ key, kind: "event", pose: "birthday", who, title: `Happy birthday${firstName() ? `, ${firstName()}` : ""}!`, text: "Hope it's a great one. The team is lucky to have you.", confetti: true });
      else if (o.mine) say({ key, kind: "event", pose: "party", who, title: `${plural(o.years, "year")} with the team!`, text: "Happy work anniversary. Thank you for everything you do.", confetti: true });
      else if (o.kind === "birthday") say({ key, kind: "event", pose: "birthday", who, title: "A birthday today", text: `It's ${o.name}'s birthday. Say hi!` });
      else say({ key, kind: "event", pose: "thumbs", who, title: "A work anniversary", text: `${o.name} is celebrating ${plural(o.years, "year")} with the team today.` });
    }
  }

  async function loadNotes() {
    try {
      const data = await apiGet("buddy/notes", { day: today() });
      try { await (window.dmeAvatars && window.dmeAvatars.ready && window.dmeAvatars.ready()); } catch { /* pictures are optional */ }
      notes = data.notes || [];
      occasions = data.occasions || [];
      fun()?.onKudos?.(data.kudos || []);
      fun()?.onUpcoming?.(data.upcoming || []);
    } catch (err) {
      notes = [];
      occasions = [];
      console.log("[buddy] " + err.message);
    }
    updateDot();
    applyAccessory();
    setLaunchPose(restPose());
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
    fun()?.start?.();
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
    fun()?.stop?.();
    if (host) { host.remove(); host = null; }
    if (callHelper) callHelper.hidden = true;
  };

  window.dmeBuddy = {
    onToday, say, reload: loadNotes,
    api: {
      say, earn, mode, pick, read, write, today, dayNumber, minutesNow, clockText, SHIFT, weekKey, confetti, NAME, POSES, POSE_LABELS,
      rerender: renderPanel, stats: () => lastStats, goal: () => lastGoal, idleMs: () => Date.now() - lastActive,
      seenPoses, restPose, roughToday, isQuiet, openPanel: () => { if ($("buddyPanel") && $("buddyPanel").hidden) togglePanel(); },
      setPreferred: (pose) => { write(PREF_KEY, pose); setLaunchPose(restPose()); renderPanel(); },
      preferred: () => read(PREF_KEY, ""),
    },
  };
  if (getSession()) start();
})();
