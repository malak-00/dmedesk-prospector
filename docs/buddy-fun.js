/* The avatar's extra fun and team features, plugged into buddy.js:
   - A daily puzzle (riddle, word scramble, quick maths or trivia, rotating), with a solve streak.
   - Spin the wheel after a goal day, a "lead of the day", and kudos between teammates.
   - A shared weekly team call goal, a one-tap daily mood (only anonymous totals are shared), a stretch reminder,
     call scripts beside call mode, and a sidekick that grows with the call streak.
   Loaded after buddy.js. Kudos, mood and scripts need sql/033; the team goal needs sql/032 and an admin to set it. */
(function () {
  "use strict";

  const buddy = window.dmeBuddy;
  if (!buddy || !buddy.api) return;
  const api = buddy.api;

  const RIDDLE_KEY = "dmeFunRiddle"; // { day, solved, revealed, tries }
  const RIDDLE_STATS_KEY = "dmeFunRiddleStats"; // { solved, streak, last }
  const WHEEL_KEY = "dmeFunWheel"; // { day, prize }
  const MOOD_KEY = "dmeFunMood"; // { day }
  const GOAL_KEY = "dmeFunTeamGoal"; // { week }
  const STREAK_KEY = "dmeFunStreak";

  /* ---------- the daily puzzle ---------- */

  const PUZZLES = {
    riddle: [
      { q: "I speak without a mouth and hear without ears. I have no body, but I come alive with the wind. What am I?", a: ["echo", "an echo"] },
      { q: "What has hands but can't clap?", a: ["clock", "a clock", "watch"] },
      { q: "What gets wetter the more it dries?", a: ["towel", "a towel"] },
      { q: "What has keys but can't open a single lock?", a: ["piano", "keyboard", "a piano", "a keyboard"] },
      { q: "The more of me you take, the more you leave behind. What am I?", a: ["footsteps", "steps", "footprints"] },
      { q: "What can you catch but never throw?", a: ["cold", "a cold"] },
      { q: "What has a neck but no head?", a: ["bottle", "a bottle", "shirt"] },
      { q: "I have cities but no houses, mountains but no trees, and water but no fish. What am I?", a: ["map", "a map"] },
      { q: "What has one eye but cannot see?", a: ["needle", "a needle"] },
      { q: "What comes once in a minute, twice in a moment, but never in a thousand years?", a: ["m", "the letter m", "letter m"] },
      { q: "What can travel around the world while staying in one corner?", a: ["stamp", "a stamp"] },
      { q: "What has teeth but cannot bite?", a: ["comb", "a comb", "zipper", "saw"] },
      { q: "What is full of holes but still holds water?", a: ["sponge", "a sponge"] },
      { q: "What can fill a room but takes up no space?", a: ["light", "air", "sound"] },
      { q: "What has words but never speaks?", a: ["book", "a book"] },
      { q: "What begins with T, ends with T, and has T inside it?", a: ["teapot", "a teapot"] },
      { q: "What belongs to you, but other people use it more than you do?", a: ["name", "your name"] },
      { q: "I'm light as a feather, yet the strongest person can't hold me for more than a few minutes. What am I?", a: ["breath", "your breath"] },
      { q: "What rings but is never worn on a finger?", a: ["phone", "a phone", "telephone", "bell", "a bell"] },
      { q: "What has to be broken before you can use it?", a: ["egg", "an egg"] },
      { q: "What gets bigger the more you take away?", a: ["hole", "a hole"] },
      { q: "What kind of room has no doors or windows?", a: ["mushroom", "a mushroom"] },
    ],
    scramble: [
      { q: "Unscramble this word: LCAL", a: ["call"], hint: "What you do all shift" },
      { q: "Unscramble this word: DAEL", a: ["lead"], hint: "What you're chasing" },
      { q: "Unscramble this word: ESLAS", a: ["sales"], hint: "The name of the game" },
      { q: "Unscramble this word: NIETMGE", a: ["meeting"], hint: "A great outcome" },
      { q: "Unscramble this word: CLTIEN", a: ["client"], hint: "Who we serve" },
      { q: "Unscramble this word: PSOCTERP", a: ["prospect"], hint: "A lead you haven't won yet" },
      { q: "Unscramble this word: KCABLLAC", a: ["callback"], hint: "Set one before you forget" },
      { q: "Unscramble this word: DIOCRAMEE", a: ["medicare"], hint: "Federal health insurance" },
      { q: "Unscramble this word: ECVOIIN", a: ["invoice"], hint: "Sent after the contract" },
      { q: "Unscramble this word: TNCCOTRA", a: ["contract"], hint: "Signed before onboarding" },
      { q: "Unscramble this word: LLOFWOU", a: ["followup", "follow up"], hint: "Two words, one idea" },
      { q: "Unscramble this word: RGTEA", a: ["great"], hint: "How today will go" },
    ],
    math: [
      { q: "A rep makes 12 calls an hour. How many calls in a 4-hour stretch?", a: ["48"] },
      { q: "If 3 of every 10 calls get answered, how many answers come from 50 calls?", a: ["15"] },
      { q: "A meeting gets booked every 8 calls. How many meetings from 40 calls?", a: ["5", "five"] },
      { q: "What is 15% of 200?", a: ["30", "thirty"] },
      { q: "I'm thinking of a number. Double it, add 6, then halve it, and you get 10. What's my number?", a: ["7", "seven"] },
      { q: "How many minutes are in an 8-hour shift?", a: ["480"] },
      { q: "What comes next? 2, 4, 8, 16, ...", a: ["32"] },
      { q: "What comes next? 1, 1, 2, 3, 5, 8, ...", a: ["13"] },
      { q: "If a call lasts 6 minutes, how many fit in one hour?", a: ["10", "ten"] },
      { q: "What is 7 x 8?", a: ["56"] },
      { q: "You make 5 calls and book 1 meeting. At that rate, how many meetings from 35 calls?", a: ["7", "seven"] },
      { q: "What is 25% of 80?", a: ["20", "twenty"] },
    ],
    trivia: [
      { q: "Which planet is known as the Red Planet?", a: ["mars"] },
      { q: "How many continents are there?", a: ["7", "seven"] },
      { q: "What is the capital of Egypt?", a: ["cairo"] },
      { q: "Which river runs through Egypt?", a: ["nile", "the nile"] },
      { q: "How many sides does a hexagon have?", a: ["6", "six"] },
      { q: "What is the largest ocean on Earth?", a: ["pacific", "the pacific", "pacific ocean"] },
      { q: "What is the chemical formula for water?", a: ["h2o"] },
      { q: "What is the capital of the US state of Georgia?", a: ["atlanta"] },
      { q: "How many days are in a leap year?", a: ["366"] },
      { q: "Which US state is nicknamed the Sunshine State?", a: ["florida"] },
      { q: "What does DME stand for?", a: ["durable medical equipment"] },
      { q: "How many hours are in a day?", a: ["24", "twenty four", "twenty-four"] },
    ],
  };
  const TYPES = ["riddle", "scramble", "math", "trivia"];
  const TYPE_LABEL = { riddle: "Riddle", scramble: "Word scramble", math: "Quick maths", trivia: "Trivia" };
  const SOLVE_LINES = ["Nailed it!", "Sharp mind.", "Got it in one.", "Brilliant.", "That's the one!"];

  const norm = (text) => String(text || "").toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/^(a|an|the|your) /, "").replace(/\s+/g, " ").trim();

  function todaysPuzzle() {
    const d = api.dayNumber();
    const type = TYPES[d % TYPES.length];
    const list = PUZZLES[type];
    return { type, ...list[Math.floor(d / TYPES.length) % list.length] };
  }

  const riddleState = () => {
    const s = api.read(RIDDLE_KEY, null);
    return s && s.day === api.today() ? s : { day: api.today(), solved: false, revealed: false, tries: 0 };
  };
  let riddleMessage = "";

  function checkRiddle(guess) {
    const p = todaysPuzzle();
    const s = riddleState();
    const g = norm(guess);
    if (!g) return;
    if (p.a.map(norm).includes(g)) {
      s.solved = true;
      api.write(RIDDLE_KEY, s);
      const stats = api.read(RIDDLE_STATS_KEY, { solved: 0, streak: 0, last: "" });
      const yesterday = new Date(Date.now() - 86400000);
      const y = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
      stats.streak = stats.last === y ? stats.streak + 1 : stats.last === api.today() ? stats.streak : 1;
      stats.last = api.today();
      stats.solved += 1;
      api.write(RIDDLE_STATS_KEY, stats);
      riddleMessage = "";
      api.say({ key: `puzzle:${api.today()}`, kind: "event", pose: "thumbs", title: "Solved!", text: `${api.pick(SOLVE_LINES)}${stats.streak > 1 ? ` ${stats.streak} puzzles in a row.` : ""}`, confetti: stats.streak > 1 });
      if (stats.solved >= 5) api.earn("riddler");
    } else {
      s.tries += 1;
      api.write(RIDDLE_KEY, s);
      riddleMessage = s.tries >= 2 ? "Not quite. There's a hint if you want it." : "Not quite, try again.";
    }
    api.rerender();
  }

  function riddleSection() {
    const p = todaysPuzzle();
    const s = riddleState();
    const stats = api.read(RIDDLE_STATS_KEY, { solved: 0, streak: 0 });
    let body;
    if (s.solved) body = `<div class="buddy-fun-note">Solved! ${stats.streak > 1 ? `${stats.streak} in a row. ` : ""}Come back tomorrow for a new one.</div>`;
    else if (s.revealed) body = `<div class="buddy-fun-note">The answer was <strong>${escapeHtml(p.a[0])}</strong>. Tomorrow's a fresh one.</div>`;
    else {
      const hint = p.hint || `Starts with "${String(p.a[0]).charAt(0).toUpperCase()}"`;
      body = `<div class="buddy-fun-row"><input type="text" data-fun-riddle-input maxlength="60" placeholder="Your answer" aria-label="Your answer" autocomplete="off"><button type="button" class="btn btn-primary btn-small" data-fun="riddle-check">Check</button></div>
        ${riddleMessage ? `<div class="buddy-fun-note">${escapeHtml(riddleMessage)}</div>` : ""}
        ${s.tries >= 2 ? `<div class="buddy-fun-note">Hint: ${escapeHtml(hint)}</div>` : ""}
        <button type="button" class="link-btn" data-fun="riddle-reveal">Show answer</button>`;
    }
    return section("riddle", `\u{1F9E9} Daily puzzle${s.solved ? " ✓" : ""}`, `<div class="buddy-fun-label">${TYPE_LABEL[p.type]}</div><div class="buddy-fun-q">${escapeHtml(p.q)}</div>${body}`);
  }

  /* ---------- spin the wheel ---------- */

  const PRIZES = [
    "You pick the next playlist. Everyone else has to listen.",
    "A well-earned 5-minute stretch break. Go!",
    "Compliment of the day: you make hard calls look easy.",
    "Fun fact: you've outworked the alarm clock today.",
    "Your next callback is guaranteed to go well. (Trust me.)",
    "A virtual high five from me. \u{1F64C}",
    "Treat yourself to your favourite snack. You earned it.",
    "You're excused from small talk for the next 10 minutes.",
    "Today's superpower: persistence. Use it wisely.",
    "A sticker for your shift: ⭐ Gold star.",
    "Go ahead and call your best lead next. Momentum is yours.",
    "Free pass: pick any lead and call it first.",
  ];
  let spinning = false;

  const goalHit = () => (api.stats().callsToday || 0) >= api.goal();
  const wheelState = () => {
    const w = api.read(WHEEL_KEY, null);
    return w && w.day === api.today() ? w : null;
  };

  function wheelSection() {
    const w = wheelState();
    let body;
    if (w) body = `<div class="buddy-fun-note">Today's spin: ${escapeHtml(w.prize)}</div>`;
    else if (spinning) body = '<div class="buddy-wheel is-spinning" aria-hidden="true">\u{1F3A1}</div><div class="buddy-fun-note">Spinning…</div>';
    else if (goalHit()) body = '<div class="buddy-fun-note">You hit your goal, so you earned a spin!</div><button type="button" class="btn btn-primary btn-small" data-fun="spin">\u{1F3A1} Spin</button>';
    else body = `<div class="buddy-fun-note">Hit your daily goal (${api.goal()} calls) to unlock a spin.</div>`;
    return section("wheel", `\u{1F3A1} Spin the wheel${w ? " ✓" : ""}`, body);
  }

  function spin() {
    if (spinning || wheelState() || !goalHit()) return;
    spinning = true;
    api.rerender();
    setTimeout(() => {
      spinning = false;
      const prize = api.pick(PRIZES);
      api.write(WHEEL_KEY, { day: api.today(), prize });
      api.say({ key: `spin:${api.today()}`, kind: "event", pose: "party", title: "The wheel says…", text: prize, confetti: true });
      api.rerender();
    }, 1300);
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
    return section("lead", "\u{1F4DE} Lead of the day", `<div class="buddy-fun-q">${escapeHtml(lead.name)}</div><div class="buddy-fun-note">${escapeHtml(where)}${where ? " · " : ""}${escapeHtml(why)}</div><button type="button" class="btn btn-ghost btn-small" data-fun="lead-open">Find it in Claimed</button>`);
  }

  /* ---------- kudos ---------- */

  let team = { people: [], goal: { target: null, calls: 0, weekStart: "" } };
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
    const g = team.goal || {};
    if (g.target && g.calls >= g.target && api.read(GOAL_KEY, {}).week !== g.weekStart) {
      api.write(GOAL_KEY, { week: g.weekStart });
      api.say({ key: `teamgoal:${g.weekStart}`, kind: "event", pose: "party", title: "Team goal reached!", text: `Together you've made ${g.calls.toLocaleString()} calls this week. Amazing team effort.`, confetti: true });
    }
    api.rerender();
  }

  function kudosSection() {
    if (!team.people.length) return "";
    return section("kudos", "\u{1F4E3} Give kudos", `<div class="buddy-fun-note">Thank a teammate. They'll see it pop up once.</div>
      <div class="buddy-fun-row"><select data-fun-kudos-to aria-label="Who to thank">${team.people.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("")}</select></div>
      <div class="buddy-fun-row"><input type="text" data-fun-kudos-body maxlength="140" placeholder="Thanks for covering my callbacks!" aria-label="Your thank-you"><button type="button" class="btn btn-primary btn-small" data-fun="kudos-send">Send</button></div>`);
  }

  async function sendKudos(root) {
    const to = root.querySelector("[data-fun-kudos-to]");
    const input = root.querySelector("[data-fun-kudos-body]");
    const body = input.value.trim();
    if (!body) { showToast("Write a few words first", true); return; }
    try {
      await apiPost("buddy/kudos", { toUserId: to.value, body });
      showToast("Thank-you sent");
      input.value = "";
      api.earn("cheer");
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function onKudos(list) {
    list.forEach((k) => api.say({
      key: `kudos:${k.id}`, kind: "event", pose: "thumbs", title: `${k.from} says thanks`, text: k.body,
      onSeen: () => apiPost("buddy/kudos/seen", { id: k.id }).catch((err) => console.log("[buddy] " + err.message)),
    }));
  }

  /* ---------- the team goal ---------- */

  function teamGoalHtml() {
    const g = team.goal || {};
    if (!g.target) return "";
    const pct = Math.min(100, Math.round((g.calls / g.target) * 100));
    return `<div class="buddy-team-goal"><strong>Team goal this week</strong>
      <div class="buddy-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${g.target}" aria-valuenow="${Math.min(g.calls, g.target)}"><span style="width:${pct}%"></span></div>
      <span class="buddy-progress">${g.calls.toLocaleString()} of ${g.target.toLocaleString()} calls${g.calls >= g.target ? " ✅" : ""}</span></div>`;
  }

  /* ---------- one-tap mood ---------- */

  const MOOD_REPLY = {
    3: { pose: "thumbs", text: "Love to hear it. Let's make it a great shift." },
    2: { pose: "neutral", text: "Steady wins it. Take a breath between calls." },
    1: { pose: "note", text: "Sorry it's a rough one. Be kind to yourself, one call at a time. I'm in your corner." },
  };

  function askMood() {
    const m = api.minutesNow();
    if (m < api.SHIFT.start || m > api.SHIFT.end) return;
    if (api.read(MOOD_KEY, {}).day === api.today()) return;
    api.say({
      key: `mood:${api.today()}`, kind: "small", pose: "wave", title: "How's your day going?",
      text: "One tap, so I know how the team is doing. Only anonymous totals are shared, never names.",
      choices: [{ label: "\u{1F600} Great", value: 3 }, { label: "\u{1F610} Okay", value: 2 }, { label: "\u{1F61F} Rough", value: 1 }],
      onChoice: async (mood) => {
        api.write(MOOD_KEY, { day: api.today() });
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

  /* ---------- the sidekick ---------- */

  const PET_STAGES = [
    { min: 0, emoji: "\u{1F95A}", name: "an egg" },
    { min: 1, emoji: "\u{1F423}", name: "a hatchling" },
    { min: 3, emoji: "\u{1F425}", name: "a chick" },
    { min: 7, emoji: "\u{1F426}", name: "a songbird" },
    { min: 14, emoji: "\u{1F99C}", name: "a parrot" },
    { min: 30, emoji: "\u{1F99A}", name: "a peacock" },
  ];

  function showPet(streak, bounce) {
    const el = document.getElementById("buddyPet");
    if (!el) return;
    const idx = PET_STAGES.reduce((best, st, i) => (streak >= st.min ? i : best), 0);
    const stage = PET_STAGES[idx];
    const next = PET_STAGES[idx + 1];
    el.textContent = stage.emoji;
    el.title = `Your sidekick is ${stage.name}. ${streak ? `${streak}-day call streak.` : "Call today to start a streak."}${next ? ` ${next.min - streak} more day${next.min - streak === 1 ? "" : "s"} to grow.` : " Fully grown!"}`;
    el.hidden = false;
    if (bounce && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      el.classList.remove("is-bouncing");
      void el.offsetWidth;
      el.classList.add("is-bouncing");
    }
  }

  /* ---------- the panel ---------- */

  const open = new Set();

  function section(id, title, body) {
    return `<details class="buddy-sec" data-sec="${id}" ${open.has(id) ? "open" : ""}><summary>${title}</summary><div class="buddy-sec-body">${body}</div></details>`;
  }

  function panelHtml() {
    return `<div class="buddy-secs">${riddleSection()}${wheelSection()}${leadSection()}${kudosSection()}</div>`;
  }

  document.addEventListener("toggle", (e) => {
    const d = e.target;
    if (d && d.matches && d.matches("details.buddy-sec")) {
      if (d.open) open.add(d.dataset.sec); else open.delete(d.dataset.sec);
    }
  }, true);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches && e.target.matches("[data-fun-riddle-input]")) checkRiddle(e.target.value);
    else if (e.key === "Enter" && e.target.matches && e.target.matches("[data-fun-kudos-body]")) sendKudos(e.target.closest(".buddy-sec-body"));
  });

  // Returns true when the click was one of ours, so buddy.js leaves it alone.
  function onClick(e) {
    const el = e.target.closest && e.target.closest("[data-fun]");
    if (!el) return false;
    const act = el.dataset.fun;
    if (act === "riddle-check") checkRiddle(el.closest(".buddy-sec-body").querySelector("[data-fun-riddle-input]").value);
    else if (act === "riddle-reveal") { const s = riddleState(); s.revealed = true; api.write(RIDDLE_KEY, s); api.rerender(); }
    else if (act === "spin") spin();
    else if (act === "kudos-send") sendKudos(el.closest(".buddy-sec-body"));
    else if (act === "lead-open" && lead) {
      state.claimedSearchQuery = lead.name;
      els.claimedSearchInput.value = lead.name;
      state.claimedPage = 1;
      switchView("claimed");
    } else if (act === "script-next") scriptIndex += 1;
    return true;
  }

  /* ---------- lifecycle ---------- */

  let lastCalls = null;
  let lastStreak = null;
  let timer = null;

  function onToday(view) {
    const stats = view.stats || {};
    const calls = stats.callsToday || 0;
    const streak = stats.streak || 0;
    pickLead(view);
    try { localStorage.setItem(STREAK_KEY, String(streak)); } catch { /* storage blocked */ }
    showPet(streak, (lastStreak !== null && streak > lastStreak) || (lastCalls !== null && lastCalls < api.goal() && calls >= api.goal()));
    if (lastCalls === 0 && calls >= 1 && !riddleState().solved && !riddleState().revealed) {
      api.say({ key: `puzzleinvite:${api.today()}`, kind: "small", pose: "thinking", title: "Puzzle time?", text: "Nice first call. Today's puzzle is waiting in my panel when you want a short break." });
    }
    lastCalls = calls;
    lastStreak = streak;
    askMood();
    loadTeam(false);
  }

  function start() {
    let cached = 0;
    try { cached = Number(localStorage.getItem(STREAK_KEY)) || 0; } catch { /* default */ }
    showPet(cached, false);
    loadTeam(true);
    loadScripts();
    clearInterval(timer);
    timer = setInterval(breakTick, 60000);
  }

  function stop() {
    clearInterval(timer);
    timer = null;
    team = { people: [], goal: { target: null, calls: 0, weekStart: "" } };
    scripts = [];
    lead = null;
    lastCalls = null;
    lastStreak = null;
    workedSince = null;
    lastTeamFetch = 0;
  }

  window.dmeBuddyFun = { panelHtml, teamGoalHtml, onClick, onToday, onKudos, callHelperHtml, start, stop };
  // buddy.js may already be signed in and showing; catch up.
  if (typeof getSession === "function" && getSession() && document.getElementById("buddyLaunch")) start();
})();
