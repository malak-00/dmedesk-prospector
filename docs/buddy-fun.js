/* The avatar's extra fun and team features, plugged into buddy.js:
   - A game of the day (seven short ones: memory, a sliding picture, copy the pattern, catch the stars, timing,
     tic-tac-toe against her, odd one out), plus any of them to play for fun; winning today's keeps a streak.
   - Spin the wheel after a goal day, a "lead of the day", and kudos between teammates.
   - A one-tap daily mood (only anonymous totals are shared), a stretch reminder,
     and call scripts beside call mode.
   Also: a weekly bingo card, a gallery of her poses (pick her resting pose), a nudge when leads are
   in a good time to call, a reminder before a callback or meeting, a note to tomorrow's you, a team calendar card on
   Today, and "on a roll" / lull remarks.
   Loaded after buddy.js. Kudos, mood and scripts need sql/033, the handover note sql/034. */
(function () {
  "use strict";

  const buddy = window.dmeBuddy;
  if (!buddy || !buddy.api) return;
  const api = buddy.api;

  const GAME_KEY = "dmeFunGame"; // { day, won, tries }
  const GAME_STATS_KEY = "dmeFunGameStats"; // { won, streak, last }
  const WHEEL_KEY = "dmeFunWheel"; // { day, prize }
  const MOOD_KEY = "dmeFunMood"; // { day }

  /* ---------- the game of the day ---------- */

  const WIN_LINES = ["Nailed it!", "Sharp.", "That's how it's done.", "Brilliant.", "Easy for you."];

  // Everyone gets the same game each day; the rest can still be played any time for fun.
  const todaysGame = () => window.dmeGames.list[api.dayNumber() % window.dmeGames.list.length];

  const gameState = () => {
    const g = api.read(GAME_KEY, null);
    return g && g.day === api.today() ? g : { day: api.today(), won: false, tries: 0 };
  };

  function onGameFinished(result, daily) {
    if (!result.won) {
      if (daily) { const g = gameState(); g.tries += 1; api.write(GAME_KEY, g); }
      api.rerender();
      return;
    }
    if (!daily || gameState().won) { api.rerender(); return; } // fun games don't count; today's counts once
    const g = gameState();
    g.won = true;
    api.write(GAME_KEY, g);
    const stats = api.read(GAME_STATS_KEY, { won: 0, streak: 0, last: "" });
    const yesterday = new Date(Date.now() - 86400000);
    const y = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
    stats.streak = stats.last === y ? stats.streak + 1 : stats.last === api.today() ? stats.streak : 1;
    stats.last = api.today();
    stats.won += 1;
    api.write(GAME_STATS_KEY, stats);
    api.say({ key: `game:${api.today()}`, kind: "event", pose: "thumbs", title: "You won today's game!", text: `${api.pick(WIN_LINES)}${stats.streak > 1 ? ` ${stats.streak} days in a row.` : ""}`, confetti: stats.streak > 1 });
    if (stats.won >= 5) api.earn("riddler");
    bingoMark("puzzle");
    api.rerender();
  }

  function gameSection() {
    if (!window.dmeGames) return "";
    const today = todaysGame();
    const g = gameState();
    const stats = api.read(GAME_STATS_KEY, { won: 0, streak: 0 });
    const others = window.dmeGames.list.filter((x) => x.id !== today.id);
    const status = g.won
      ? `<div class="buddy-fun-note">Won! ${stats.streak > 1 ? `${stats.streak} days in a row. ` : ""}A new one tomorrow. Play it again for fun if you like.</div>`
      : `<div class="buddy-fun-note">${g.tries ? "So close. Have another go." : "Win it for a streak, a bingo square and a badge."}</div>`;
    return section("game", `${uiIcon("puzzle")} Game of the day${g.won ? ` ${uiIcon("check")}` : ""}`,
      `<div class="buddy-fun-label">${escapeHtml(today.title)}</div><div class="buddy-fun-q">${escapeHtml(today.blurb)}</div>${status}
       <button type="button" class="btn btn-primary btn-small" data-fun="game-play" data-game="${escapeHtml(today.id)}" data-daily="1">${uiIcon(today.icon)} ${g.won ? "Play again" : "Play"}</button>
       <div class="buddy-fun-label" style="margin-top:6px">More to play, just for fun</div>
       <div class="buddy-games-more">${others.map((x) => `<button type="button" class="buddy-game-chip" data-fun="game-play" data-game="${escapeHtml(x.id)}" title="${escapeHtml(x.blurb)}">${uiIcon(x.icon)}<span>${escapeHtml(x.title)}</span></button>`).join("")}</div>`);
  }

  /* ---------- spin the wheel ---------- */

  const W = window.dmeWheel;
  const WHEEL_COLORS = ["#4cb8c4", "#e0b84a", "#e75a8f", "#7a6be0", "#3aa862", "#f08a24", "#4f8ff7", "#d64545"];
  const reducedMotion = () => Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  let spinning = false;

  const goalHit = () => (api.stats().callsToday || 0) >= api.goal();
  // Today's spin: { day, index, value, angle, granted }. It is written before the wheel turns, so a reload cannot give a second spin.
  const wheelState = () => {
    const w = api.read(WHEEL_KEY, null);
    return w && w.day === api.today() && Number.isInteger(w.index) ? w : null;
  };

  // The disc: eight coloured slices with a short name each, turned by `angle` degrees. The pointer is drawn separately at the top.
  function wheelHtml(angle, { dim = false, go = false } = {}) {
    const n = W.PRIZES.length;
    const seg = 360 / n;
    const r = 100;
    const c = 110;
    const slices = W.PRIZES.map((p, i) => {
      const a0 = ((i * seg - 90) * Math.PI) / 180;
      const a1 = (((i + 1) * seg - 90) * Math.PI) / 180;
      const pt = (a) => `${(c + r * Math.cos(a)).toFixed(2)} ${(c + r * Math.sin(a)).toFixed(2)}`;
      return `<path d="M${c} ${c}L${pt(a0)}A${r} ${r} 0 0 1 ${pt(a1)}Z" fill="${WHEEL_COLORS[i % WHEEL_COLORS.length]}" stroke="rgba(255,255,255,0.9)" stroke-width="1.5"/>
        <text x="${c}" y="${c - r + 27}" transform="rotate(${((i + 0.5) * seg).toFixed(2)} ${c} ${c})" text-anchor="middle" class="wheel-label">${escapeHtml(p.short)}</text>`;
    }).join("");
    return `<div class="wheel-wrap${dim ? " is-dim" : ""}" aria-hidden="true">
      <div class="wheel-pointer"></div>
      <div class="wheel-disc" ${go ? "data-go" : ""} style="transform:rotate(${angle}deg)"><svg viewBox="0 0 220 220">${slices}<circle cx="${c}" cy="${c}" r="14" fill="var(--surface, #fff)" stroke="rgba(0,0,0,0.25)" stroke-width="2"/></svg></div>
    </div>`;
  }

  function perksHtml() {
    const perks = window.dmePerks ? window.dmePerks.list() : [];
    if (!perks.length) return "";
    const until = (ms) => { const days = Math.ceil((ms - Date.now()) / 86400000); return days <= 1 ? "until tomorrow" : `${days} days left`; };
    return `<div class="buddy-fun-label">Your prizes</div><ul class="wheel-perks">${perks.map((p) => `<li><strong>${escapeHtml(p.label)}</strong> <span>${escapeHtml(until(p.until))}</span><div class="buddy-fun-note">${escapeHtml(p.text)}</div></li>`).join("")}</ul>`;
  }

  // The prize becomes a perk, once, and Caro says so.
  function award(w, quiet) {
    if (!w || w.granted || !window.dmePerks) return;
    w.granted = true;
    api.write(WHEEL_KEY, w);
    window.dmePerks.grant(w.index, w.value);
    if (!quiet) api.say({ key: `spin:${api.today()}`, kind: "event", pose: "party", title: `The wheel says: ${W.PRIZES[w.index].label}!`, text: W.describe(w.index, w.value), confetti: true });
  }

  function wheelSection() {
    const w = wheelState();
    let body;
    if (w && !spinning) {
      award(w, true); // a spin that was cut short by a reload still pays out
      body = `${wheelHtml(w.angle % 360)}<div class="buddy-fun-note">Today's spin: <strong>${escapeHtml(W.PRIZES[w.index].label)}</strong>. ${escapeHtml(W.describe(w.index, w.value))}</div>${perksHtml()}`;
    } else if (spinning) {
      body = `${wheelHtml(0, { go: true })}<div class="buddy-fun-note">Spinning…</div>`;
    } else if (goalHit()) {
      body = `${wheelHtml(0)}<div class="buddy-fun-note">You hit your goal, so you earned a spin! The rarer prizes come up less often.</div><button type="button" class="btn btn-primary btn-small" data-fun="spin">${uiIcon("wheel")} Spin</button>${perksHtml()}`;
    } else {
      body = `${wheelHtml(0, { dim: true })}<div class="buddy-fun-note">Hit your daily goal (${api.goal()} calls) to unlock a spin. Prizes: a frame, a title, a Caro look, a sparkle, an app colour, Caro's lead pick, a snooze, or golden kudos.</div>${perksHtml()}`;
    }
    return section("wheel", `${uiIcon("wheel")} Spin the wheel${w ? ` ${uiIcon("check")}` : ""}`, body);
  }

  function spin() {
    if (spinning || wheelState() || !goalHit()) return;
    const index = W.weightedIndex();
    const value = W.resolve(index);
    const angle = W.spinAngle(index);
    api.write(WHEEL_KEY, { day: api.today(), index, value, angle, granted: false });
    spinning = true;
    api.rerender();
    const ms = reducedMotion() ? 500 : 4200;
    // Next tick: the disc is on screen at 0, so turning it now animates.
    setTimeout(() => {
      const disc = document.querySelector(".wheel-disc[data-go]");
      if (!disc) return;
      disc.style.transition = `transform ${ms}ms cubic-bezier(0.12, 0.62, 0.08, 1)`;
      disc.style.transform = `rotate(${angle}deg)`;
    }, 80);
    setTimeout(() => {
      spinning = false;
      award(wheelState(), false);
      api.rerender();
    }, ms + 350);
  }

  /* ---------- lead of the day ---------- */

  let lead = null;

  function pickLead(view) {
    const list = (view.stale && view.stale.items && view.stale.items.length ? view.stale.items : (view.firstCalls && view.firstCalls.items) || []);
    lead = list.length ? list[api.dayNumber() % list.length] : null;
  }

  function leadSection() {
    if (!lead) return "";
    const where = [lead.city, lead.state].filter(Boolean).join(", ");
    const why = lead.quietDays ? `Quiet for ${lead.quietDays} days. A friendly check-in could wake it up.` : "Waiting for a first call. A fresh start.";
    return section("lead", `${uiIcon("phone")} Lead of the day`, `<div class="buddy-fun-q">${escapeHtml(lead.name)}</div><div class="buddy-fun-note">${escapeHtml(where)}${where ? " · " : ""}${escapeHtml(why)}</div><button type="button" class="btn btn-ghost btn-small" data-fun="lead-open">Find it in Claimed</button>`);
  }

  /* ---------- kudos ---------- */

  let team = { people: [] };
  let lastTeamFetch = 0;

  async function loadTeam(force) {
    if (!force && Date.now() - lastTeamFetch < 5 * 60 * 1000) return;
    lastTeamFetch = Date.now();
    try {
      team = await apiGet("buddy/team");
    } catch (err) {
      console.log("[buddy] " + err.message);
      return;
    }
    api.rerender();
  }

  function kudosSection() {
    if (!team.people.length) return "";
    const golden = window.dmePerks && window.dmePerks.has("golden");
    return section("kudos", `${uiIcon("megaphone")} Give kudos`, `<div class="buddy-fun-note">${golden ? "You have a golden kudos from the wheel: your next thank-you pops up for them with confetti. " : ""}Thank a teammate. They'll see it pop up once.</div>
      <div class="buddy-fun-row"><select data-fun-kudos-to aria-label="Who to thank">${team.people.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("")}</select></div>
      <div class="buddy-fun-row"><input type="text" data-fun-kudos-body maxlength="140" placeholder="Thanks for covering my callbacks!" aria-label="Your thank-you"><button type="button" class="btn btn-primary btn-small" data-fun="kudos-send">Send</button></div>`);
  }

  async function sendKudos(root) {
    const to = root.querySelector("[data-fun-kudos-to]");
    const input = root.querySelector("[data-fun-kudos-body]");
    const body = input.value.trim();
    if (!body) { showToast("Write a few words first", true); return; }
    const golden = window.dmePerks && window.dmePerks.has("golden");
    try {
      await apiPost("buddy/kudos", { toUserId: to.value, body: golden ? `Golden kudos: ${body}`.slice(0, 160) : body });
      if (golden) window.dmePerks.consume("golden");
      showToast(golden ? "Golden kudos sent" : "Thank-you sent");
      input.value = "";
      api.earn("cheer");
      bingoMark("kudos");
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function onKudos(list) {
    list.forEach((k) => api.say({
      key: `kudos:${k.id}`, kind: "event", pose: "thumbs", who: { name: k.from }, title: `${k.from} says thanks`, text: k.body, confetti: /^Golden kudos:/.test(k.body),
      onSeen: () => apiPost("buddy/kudos/seen", { id: k.id }).catch((err) => console.log("[buddy] " + err.message)),
    }));
  }

  /* ---------- one-tap mood ---------- */

  const MOOD_REPLY = {
    3: { pose: "thumbs", text: "Love to hear it. Let's make it a great shift." },
    2: { pose: "neutral", text: "Steady wins it. Take a breath between calls." },
    1: { pose: "rainy", text: "Sorry it's a rough one. Be kind to yourself, one call at a time. I'm in your corner." },
  };

  function askMood() {
    const m = api.minutesNow();
    if (m < api.SHIFT.start || m > api.SHIFT.end) return;
    if (api.read(MOOD_KEY, {}).day === api.today()) return;
    api.say({
      key: `mood:${api.today()}`, kind: "small", pose: "wave", title: "How's your day going?",
      text: "One tap, so I know how the team is doing. Only anonymous totals are shared, never names.",
      choices: [{ label: "Great", value: 3, icon: "smile" }, { label: "Okay", value: 2, icon: "meh" }, { label: "Rough", value: 1, icon: "frown" }],
      onChoice: async (mood) => {
        api.write(MOOD_KEY, { day: api.today(), mood });
        try { await apiPost("buddy/mood", { mood, day: api.today() }); } catch (err) { console.log("[buddy] " + err.message); }
        const reply = MOOD_REPLY[mood];
        api.say({ key: `moodreply:${api.today()}`, kind: "event", pose: reply.pose, title: "Thanks for telling me", text: reply.text });
      },
    });
  }

  /* ---------- stretch reminder ---------- */

  let workedSince = null;
  let lastBreak = 0;
  let breaksToday = { day: "", n: 0 };

  function breakTick() {
    if (api.idleMs() > 5 * 60 * 1000) { workedSince = null; return; }
    const now = Date.now();
    if (!workedSince) workedSince = now;
    const m = api.minutesNow();
    if (m < api.SHIFT.start || m > api.SHIFT.end - 20) return;
    if (breaksToday.day !== api.today()) breaksToday = { day: api.today(), n: 0 };
    if (breaksToday.n >= 2 || now - workedSince < 120 * 60 * 1000 || now - lastBreak < 100 * 60 * 1000) return;
    lastBreak = now;
    workedSince = now;
    breaksToday.n += 1;
    api.say({ key: `break:${api.today()}:${breaksToday.n}`, kind: "event", pose: "sleepy", title: "Time to stretch", text: "You've been at it for two hours. Stand up, roll your shoulders and have some water. The leads will wait." });
  }

  /* ---------- call scripts beside call mode ---------- */

  let scripts = [];
  let scriptIndex = 0;

  async function loadScripts() {
    try { scripts = (await apiGet("buddy/scripts")).scripts || []; } catch (err) { scripts = []; console.log("[buddy] " + err.message); }
  }

  function currentSpecialty() {
    const cur = window.dmeCall && window.dmeCall.current && window.dmeCall.current();
    if (!cur) return "";
    const t = cur.taxonomy;
    return String((t && typeof t === "object" ? t.description : t) || cur.specialty || "").toLowerCase();
  }

  function matchingScripts() {
    const spec = currentSpecialty();
    const hits = scripts.filter((s) => !s.specialty || (spec && spec.includes(s.specialty.toLowerCase())));
    return hits.sort((a, b) => (b.specialty ? 1 : 0) - (a.specialty ? 1 : 0));
  }

  function callHelperHtml() {
    const list = matchingScripts();
    if (!list.length) return "";
    const s = list[scriptIndex % list.length];
    return `<div class="buddy-script"><div class="buddy-script-title">${escapeHtml(s.title)}${s.specialty ? ` <span>${escapeHtml(s.specialty)}</span>` : ""}</div>
      <div class="buddy-script-body">${escapeHtml(s.body)}</div>
      ${list.length > 1 ? `<button type="button" class="link-btn" data-fun="script-next">Next script (${(scriptIndex % list.length) + 1}/${list.length})</button>` : ""}</div>`;
  }

  /* ---------- weekly bingo ---------- */

  const BINGO_KEY = "dmeFunBingo"; // { week, done: { id: true }, lines: n }
  const BINGO_POOL = [
    { id: "calls10", text: "Make 10 calls in a day", icon: "phone" },
    { id: "goal", text: "Hit your daily goal", icon: "target" },
    { id: "meeting", text: "Book a meeting", icon: "calendar" },
    { id: "won", text: "Onboard a lead", icon: "trophy" },
    { id: "result", text: "Log a result on a lead", icon: "check" },
    { id: "callback", text: "Set a callback", icon: "bell" },
    { id: "kudos", text: "Send kudos", icon: "megaphone" },
    { id: "puzzle", text: "Win the game of the day", icon: "puzzle" },
    { id: "claim", text: "Claim a new lead", icon: "sparkle" },
    { id: "cold", text: "Work a going-cold lead", icon: "flame" },
    { id: "streak3", text: "Call 3 days in a row", icon: "sunrise" },
    { id: "late", text: "Make a call after 8pm", icon: "bolt" },
  ];
  const BINGO_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

  // The same nine squares for everyone this week, mixed from the week's start date.
  function bingoCard() {
    let seed = 0;
    for (const ch of api.weekKey()) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const rand = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const pool = BINGO_POOL.slice();
    const card = [];
    while (card.length < 9) card.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
    return card;
  }

  function bingoState() {
    const b = api.read(BINGO_KEY, null);
    return b && b.week === api.weekKey() ? b : { week: api.weekKey(), done: {}, lines: 0 };
  }

  function bingoMark(id) {
    const card = bingoCard();
    if (!card.some((c) => c.id === id)) return;
    const b = bingoState();
    if (b.done[id]) return;
    b.done[id] = true;
    const lines = BINGO_LINES.filter((l) => l.every((i) => b.done[card[i].id])).length;
    const full = card.every((c) => b.done[c.id]);
    const newLine = lines > b.lines;
    b.lines = lines;
    api.write(BINGO_KEY, b);
    if (full) {
      api.say({ key: `bingofull:${b.week}`, kind: "event", pose: "party", title: "Full card!", text: "Every square on this week's bingo. That's a perfect week.", confetti: true });
      api.earn("bingo");
    } else if (newLine) {
      api.say({ key: `bingoline:${b.week}:${lines}`, kind: "event", pose: "party", title: "Bingo!", text: `A line on this week's card${lines > 1 ? ` (${lines} lines)` : ""}.`, confetti: true });
      api.earn("bingo");
    } else {
      api.rerender();
    }
  }

  function bingoSection() {
    const card = bingoCard();
    const b = bingoState();
    const n = card.filter((c) => b.done[c.id]).length;
    return section("bingo", `${uiIcon("target")} Weekly bingo (${n}/9)`, `<div class="buddy-bingo">${card.map((c) => `<div class="buddy-bingo-cell${b.done[c.id] ? " is-done" : ""}">${uiIcon(b.done[c.id] ? "check" : c.icon)}${escapeHtml(c.text)}</div>`).join("")}</div>
      <div class="buddy-fun-note">Three in a row earns a cheer. A new card every Monday.</div>`);
  }

  // Squares that follow from the numbers rather than from one action.
  function bingoFromStats(stats, late) {
    if ((stats.callsToday || 0) >= 10) bingoMark("calls10");
    if ((stats.callsToday || 0) >= api.goal()) bingoMark("goal");
    if ((stats.streak || 0) >= 3) bingoMark("streak3");
    if (late) bingoMark("late");
  }

  function onEvent(name, info) {
    if (["meeting", "won", "callback", "claim"].includes(name)) bingoMark(name);
    if (name === "result") {
      bingoMark("result");
      if (info && info.npi && coldNpis.has(String(info.npi))) bingoMark("cold");
    }
  }

  /* ---------- her poses: a collection, and pick her resting pose ---------- */

  function gallerySection() {
    const seen = api.seenPoses();
    const chosen = api.preferred();
    const cells = Object.keys(api.POSES).map((p) => {
      const have = Boolean(seen[p]);
      return `<button type="button" class="buddy-pose-btn${have ? "" : " is-locked"}${have && chosen === p ? " is-chosen" : ""}" ${have ? `data-fun="pose" data-pose="${p}"` : "disabled"} title="${have ? `${escapeHtml(api.POSE_LABELS[p] || p)}${chosen === p ? " (her resting pose)" : ""}` : "Not seen yet"}"><img src="avatar/${api.POSES[p]}" alt="" width="52" height="52"><span>${have ? escapeHtml(api.POSE_LABELS[p] || p) : "?"}</span></button>`;
    }).join("");
    const count = Object.keys(api.POSES).filter((p) => seen[p]).length;
    return section("gallery", `${uiIcon("sparkle")} Her looks (${count}/${Object.keys(api.POSES).length})`, `<div class="buddy-gallery">${cells}</div>
      <div class="buddy-fun-note">She shows each look at the right moment. Pick one to be her resting pose; your pick stays, except on your birthday. A holiday or Friday look unlocks while it is on.</div>`);
  }

  /* ---------- a note to tomorrow's you ---------- */

  function handoverSection() {
    return section("handover", `${uiIcon("calendar")} Note to tomorrow's you`, `<div class="buddy-fun-note">Leave yourself a reminder. ${escapeHtml(api.NAME)} will show it at the start of your next shift.</div>
      <textarea data-fun-handover maxlength="300" rows="3" class="buddy-fun-text" placeholder="e.g. Call Acme first, they said after 4pm" aria-label="Note to tomorrow's you"></textarea>
      <div class="buddy-fun-row"><button type="button" class="btn btn-primary btn-small" data-fun="handover-save">Save note</button></div>`);
  }

  async function saveHandover(root) {
    const box = root.querySelector("[data-fun-handover]");
    const body = box.value.trim();
    if (!body) { showToast("Write the note first", true); return; }
    try {
      await apiPost("buddy/handover", { body });
      showToast("Saved. I'll remind you next shift.");
      box.value = "";
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function loadHandover() {
    try {
      const data = await apiGet("buddy/handover");
      if (!data.note) return;
      api.say({
        key: `handover:${api.today()}`, kind: "event", pose: "note", title: "A note from yesterday's you", text: data.note.body,
        onSeen: () => apiPost("buddy/handover/seen", {}).catch((err) => console.log("[buddy] " + err.message)),
      });
    } catch (err) {
      console.log("[buddy] " + err.message);
    }
  }

  function promptHandover() {
    const m = api.minutesNow();
    if (m < api.SHIFT.end - 30 || m >= api.SHIFT.end) return;
    if ((api.stats().callsToday || 0) < 1) return;
    api.say({
      key: `handoverprompt:${api.today()}`, kind: "small", pose: "note", title: "Leave a note for tomorrow?",
      text: "Anything you want to pick up first next shift? I'll remind you.",
      choices: [{ label: "Write one", value: "write" }],
      onChoice: () => { open.add("handover"); api.openPanel(); api.rerender(); },
    });
  }

  /* ---------- the team calendar (a card on Today) ---------- */

  let upcoming = [];

  function onUpcoming(list) {
    const changed = JSON.stringify(list) !== JSON.stringify(upcoming);
    upcoming = list || [];
    if (changed && upcoming.length && window.dmeToday && window.dmeToday.refresh) window.dmeToday.refresh();
  }

  function todayCardHtml() {
    if (!upcoming.length) return "";
    const when = (o) => (o.inDays === 1 ? "tomorrow" : new Date(`${o.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long" }));
    const rows = upcoming.slice(0, 6).map((o) => {
      const who = o.mine ? "Your" : `${escapeHtml(o.name)}'s`;
      const what = o.kind === "birthday" ? "birthday" : `${o.years}-year work anniversary`;
      return `<div class="team-cal-row"><span class="team-cal-who">${window.dmeAvatars ? window.dmeAvatars.html({ userId: o.userId, name: o.name }, 24) : ""}<span>${who} ${what}</span></span><span>${when(o)}</span></div>`;
    }).join("");
    return `<section class="today-card side-card"><header class="today-card-head"><h3>Team calendar</h3></header><div class="side-body">${rows}</div></section>`;
  }

  /* ---------- the panel ---------- */

  const open = new Set();

  function section(id, title, body) {
    return `<details class="buddy-sec" data-sec="${id}" ${open.has(id) ? "open" : ""}><summary>${title}</summary><div class="buddy-sec-body">${body}</div></details>`;
  }

  function panelHtml() {
    return `<div class="buddy-secs">${gameSection()}${bingoSection()}${wheelSection()}${leadSection()}${kudosSection()}${handoverSection()}${gallerySection()}</div>`;
  }

  document.addEventListener("toggle", (e) => {
    const d = e.target;
    if (d && d.matches && d.matches("details.buddy-sec")) {
      if (d.open) open.add(d.dataset.sec); else open.delete(d.dataset.sec);
    }
  }, true);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches && e.target.matches("[data-fun-kudos-body]")) sendKudos(e.target.closest(".buddy-sec-body"));
  });

  // Returns true when the click was one of ours, so buddy.js leaves it alone.
  function onClick(e) {
    const el = e.target.closest && e.target.closest("[data-fun]");
    if (!el) return false;
    const act = el.dataset.fun;
    if (act === "game-play" && window.dmeGames) {
      const daily = Boolean(el.dataset.daily);
      window.dmeGames.play(el.dataset.game, (result) => onGameFinished(result, daily));
    } else if (act === "spin") spin();
    else if (act === "kudos-send") sendKudos(el.closest(".buddy-sec-body"));
    else if (act === "lead-open" && lead) {
      state.claimedSearchQuery = lead.name;
      els.claimedSearchInput.value = lead.name;
      state.claimedPage = 1;
      switchView("claimed");
    } else if (act === "script-next") scriptIndex += 1;
    else if (act === "handover-save") saveHandover(el.closest(".buddy-sec-body"));
    else if (act === "pose") api.setPreferred(el.dataset.pose === api.preferred() ? "" : el.dataset.pose);
    return true;
  }

  /* ---------- lifecycle ---------- */

  let lastCalls = null;
  let timer = null;
  let lastView = null;
  let coldNpis = new Set();
  const samples = []; // { t, calls }: how fast calls are going
  const asked = { goodTime: 0, lull: 0, lullCount: 0, refresh: 0 };
  const reminded = new Set();

  function onToday(view) {
    const stats = view.stats || {};
    const calls = stats.callsToday || 0;
    pickLead(view);
    lastView = view;
    coldNpis = new Set(((view.stale && view.stale.items) || []).map((l) => String(l.npi)));
    bingoFromStats(stats, calls > (lastCalls ?? calls) && api.minutesNow() >= 20 * 60);
    paceCheck(calls);
    goodTimeNudge(view);
    if (lastCalls === 0 && calls >= 1 && window.dmeGames && !gameState().won) {
      api.say({ key: `gameinvite:${api.today()}`, kind: "small", pose: "wink", title: "Game break?", text: `Nice first call. Today's game is ${todaysGame().title}, waiting in my panel whenever you want a short break.` });
    }
    lastCalls = calls;
    askMood();
    loadTeam(false);
  }

  // Three or more calls in the last fifteen minutes is worth a word, once an hour at most.
  function paceCheck(calls) {
    const now = Date.now();
    samples.push({ t: now, calls });
    while (samples.length && now - samples[0].t > 20 * 60 * 1000) samples.shift();
    const old = samples.find((x) => now - x.t >= 5 * 60 * 1000 && now - x.t <= 16 * 60 * 1000);
    if (old && calls - old.calls >= 3) {
      api.say({ key: `roll:${api.today()}:${new Date().getHours()}`, kind: "event", pose: "thumbs", title: "You're on a roll", text: `${calls - old.calls} calls in the last quarter of an hour. Keep that rhythm.` });
    }
  }

  // Leads whose local time is in a good window right now, picked from what Today already holds.
  function goodTimeNudge(view) {
    const m = api.minutesNow();
    if (m < api.SHIFT.start + 20 || m > api.SHIFT.end - 40 || !window.dmeTime || !window.dmeTime.localInfo) return;
    if (Date.now() - asked.goodTime < 2 * 60 * 60 * 1000) return;
    const all = [...(view.callbacks || []), ...((view.firstCalls && view.firstCalls.items) || []), ...((view.stale && view.stale.items) || [])];
    const seenNpi = new Set();
    const open = all.filter((l) => { const ok = window.dmeTime.localInfo(l.state)?.good && !seenNpi.has(l.npi); seenNpi.add(l.npi); return ok; });
    if (open.length < 3) return;
    asked.goodTime = Date.now();
    const names = open.slice(0, 2).map((l) => l.name).join(" and ");
    api.say({
      key: `goodtime:${api.today()}:${new Date().getHours()}`, kind: "small", pose: "phone", title: "A good time to call",
      text: `${open.length} of your leads are open for calls right now, like ${names}.`,
      choices: [{ label: "Call them", value: "go" }],
      onChoice: () => window.dmeCall && window.dmeCall.start(open.slice(0, 15), "claimed"),
    });
  }

  // A minute-by-minute tick: stretch break, a quiet spell, and a heads-up before a callback or meeting.
  function reminderTick() {
    const now = Date.now();
    if (api.idleMs() < 5 * 60 * 1000 && now - asked.refresh > 10 * 60 * 1000 && window.dmeToday && window.dmeToday.refresh) {
      asked.refresh = now;
      window.dmeToday.refresh();
    }
    if (lastView) {
      const soon = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) && t - now > 0 && t - now <= 15 * 60 * 1000 ? Math.round((t - now) / 60000) : null; };
      for (const l of lastView.callbacks || []) {
        const mins = soon(l.reminderAt);
        if (mins !== null && !reminded.has(`cb:${l.npi}:${l.reminderAt}`)) {
          reminded.add(`cb:${l.npi}:${l.reminderAt}`);
          api.say({ key: `cb:${l.npi}:${l.reminderAt}`, kind: "event", pose: "phone", title: "Callback coming up", text: `${l.name} in about ${mins} minute${mins === 1 ? "" : "s"}.`, choices: [{ label: "Open it", value: "go" }], onChoice: () => window.dmeCall && window.dmeCall.start([l], "claimed") });
        }
      }
      for (const l of lastView.meetingsToday || []) {
        const mins = soon(l.meetingAt);
        if (mins !== null && !reminded.has(`mt:${l.npi}:${l.meetingAt}`)) {
          reminded.add(`mt:${l.npi}:${l.meetingAt}`);
          api.say({ key: `mt:${l.npi}:${l.meetingAt}`, kind: "event", pose: "note", title: "Meeting coming up", text: `${l.name} in about ${mins} minute${mins === 1 ? "" : "s"}. Take a look at your opener notes.`, choices: [{ label: "Open it", value: "go" }], onChoice: () => window.dmeCall && window.dmeCall.start([l], "claimed") });
        }
      }
    }
    // Quiet for half an hour during the shift: a gentle nudge, never more than twice a day.
    const m = api.minutesNow();
    if (m > api.SHIFT.start + 30 && m < api.SHIFT.end - 30 && api.idleMs() > 30 * 60 * 1000 && now - asked.lull > 90 * 60 * 1000 && asked.lullCount < 2) {
      asked.lull = now;
      asked.lullCount += 1;
      api.say({
        key: `lull:${api.today()}:${asked.lullCount}`, kind: "event", pose: "encourage", title: "Still with me?",
        text: lead ? `It's been quiet for a while. A good lead to start with: ${lead.name}.` : "It's been quiet for a while. Whenever you're ready, one call gets the rhythm back.",
        choices: lead ? [{ label: "Find it", value: "go" }] : null,
        onChoice: () => { if (lead) { state.claimedSearchQuery = lead.name; els.claimedSearchInput.value = lead.name; state.claimedPage = 1; switchView("claimed"); } },
      });
    }
    breakTick();
    promptHandover();
  }

  function start() {
    loadTeam(true);
    loadScripts();
    loadHandover();
    clearInterval(timer);
    timer = setInterval(reminderTick, 60000);
  }

  function stop() {
    clearInterval(timer);
    timer = null;
    team = { people: [] };
    scripts = [];
    lead = null;
    upcoming = [];
    lastView = null;
    coldNpis = new Set();
    samples.length = 0;
    asked.goodTime = 0; asked.lull = 0; asked.lullCount = 0; asked.refresh = 0;
    lastCalls = null;
    workedSince = null;
    lastTeamFetch = 0;
  }

  window.dmeBuddyFun = { panelHtml, onClick, onToday, onKudos, onUpcoming, onEvent, todayCardHtml, callHelperHtml, start, stop };
  // buddy.js may already be signed in and showing; catch up.
  if (typeof getSession === "function" && getSession() && document.getElementById("buddyLaunch")) start();
})();
