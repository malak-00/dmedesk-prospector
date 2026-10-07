/* The avatar's extra fun and team features, plugged into buddy.js:
   - A daily puzzle (riddle, word scramble, quick maths or trivia, rotating), with a solve streak.
   - Spin the wheel after a goal day, a "lead of the day", and kudos between teammates.
   - A shared weekly team call goal, a one-tap daily mood (only anonymous totals are shared), a stretch reminder,
     and call scripts beside call mode.
   Also: a weekly bingo card, seasonal puzzles, a gallery of her poses (pick her resting pose), a nudge when leads are
   in a good time to call, a reminder before a callback or meeting, a note to tomorrow's you, a team calendar card on
   Today, and "on a roll" / lull remarks.
   Loaded after buddy.js. Kudos, mood and scripts need sql/033, the handover note sql/034; the team goal needs sql/032
   and an admin to set it. */
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
  // In the weeks around a holiday the day's puzzle is a themed one.
  const SEASONAL = {
    halloween: {
      label: "Halloween riddle", from: [10, 20], to: [10, 31],
      list: [
        { q: "What do you call a witch who lives at the beach?", a: ["sandwitch", "sand witch", "a sandwitch", "a sand witch"] },
        { q: "What is a skeleton's favourite musical instrument?", a: ["xylophone", "a xylophone", "trombone", "a trombone"] },
        { q: "Why don't skeletons fight each other?", a: ["no guts", "they have no guts", "they dont have the guts", "guts", "they dont have any guts"] },
        { q: "I'm orange and round, and at Halloween I'm carved with a grin. What am I?", a: ["pumpkin", "a pumpkin", "jack o lantern", "jackolantern", "a jackolantern"] },
        { q: "What do you get when you cross a vampire with a snowman?", a: ["frostbite"] },
        { q: "What do ghosts like to eat for dessert?", a: ["ice scream", "i scream", "ice cream"] },
        { q: "What flies at night, hangs upside down, and isn't a vampire?", a: ["bat", "a bat"] },
        { q: "What has eight legs, spins webs, and is a Halloween favourite?", a: ["spider", "a spider"] },
      ],
    },
    thanksgiving: {
      label: "Thanksgiving trivia", from: [11, 15], to: [11, 27],
      list: [
        { q: "Which US president made Thanksgiving a national holiday during the Civil War?", a: ["lincoln", "abraham lincoln"] },
        { q: "Which bird is the traditional centrepiece of a Thanksgiving dinner?", a: ["turkey", "a turkey"] },
        { q: "In which month is US Thanksgiving?", a: ["november"] },
        { q: "Which pie is the classic Thanksgiving dessert?", a: ["pumpkin", "pumpkin pie"] },
        { q: "What colour is cranberry sauce?", a: ["red"] },
        { q: "Which ship carried the Pilgrims to America in 1620?", a: ["mayflower", "the mayflower"] },
        { q: "On which day of the week does US Thanksgiving fall?", a: ["thursday"] },
        { q: "What do people do at the table on Thanksgiving, as the name says?", a: ["give thanks", "giving thanks", "thanks"] },
      ],
    },
    christmas: {
      label: "Holiday riddle", from: [12, 10], to: [12, 26],
      list: [
        { q: "What do snowmen eat for breakfast?", a: ["snowflakes", "frosted flakes", "snow flakes"] },
        { q: "How many reindeer pull Santa's sleigh, not counting Rudolph?", a: ["8", "eight"] },
        { q: "Who goes 'ho ho ho' and has a big white beard?", a: ["santa", "santa claus", "father christmas"] },
        { q: "What do you call a snowman in the summer?", a: ["puddle", "a puddle", "water"] },
        { q: "On which date is Christmas Day?", a: ["25 december", "december 25", "25th december", "december 25th", "dec 25"] },
        { q: "Which reindeer has a famous red nose?", a: ["rudolph"] },
        { q: "Which green character tried to steal Christmas?", a: ["grinch", "the grinch"] },
        { q: "How many days of Christmas are there in the song?", a: ["12", "twelve"] },
      ],
    },
  };
  function seasonalTheme(now = new Date()) {
    const m = now.getMonth() + 1;
    const d = now.getDate();
    return Object.values(SEASONAL).find((t) => (m > t.from[0] || (m === t.from[0] && d >= t.from[1])) && (m < t.to[0] || (m === t.to[0] && d <= t.to[1]))) || null;
  }
  const TYPES = ["riddle", "scramble", "math", "trivia"];
  const TYPE_LABEL = { riddle: "Riddle", scramble: "Word scramble", math: "Quick maths", trivia: "Trivia" };
  const SOLVE_LINES = ["Nailed it!", "Sharp mind.", "Got it in one.", "Brilliant.", "That's the one!"];

  const norm = (text) => String(text || "").toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/^(a|an|the|your) /, "").replace(/\s+/g, " ").trim();

  function todaysPuzzle() {
    const d = api.dayNumber();
    const theme = seasonalTheme();
    if (theme) return { type: "seasonal", label: theme.label, ...theme.list[d % theme.list.length] };
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
      bingoMark("puzzle");
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
    return section("riddle", `${uiIcon("puzzle")} Daily puzzle${s.solved ? ` ${uiIcon("check")}` : ""}`, `<div class="buddy-fun-label">${escapeHtml(p.label || TYPE_LABEL[p.type])}</div><div class="buddy-fun-q">${escapeHtml(p.q)}</div>${body}`);
  }

  /* ---------- spin the wheel ---------- */

  const PRIZES = [
    "You pick the next playlist. Everyone else has to listen.",
    "A well-earned 5-minute stretch break. Go!",
    "Compliment of the day: you make hard calls look easy.",
    "Fun fact: you've outworked the alarm clock today.",
    "Your next callback is guaranteed to go well. (Trust me.)",
    "A virtual high five from me.",
    "Treat yourself to your favourite snack. You earned it.",
    "You're excused from small talk for the next 10 minutes.",
    "Today's superpower: persistence. Use it wisely.",
    "A sticker for your shift: a gold star.",
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
    else if (spinning) body = `<div class="buddy-wheel is-spinning" aria-hidden="true">${uiIcon("wheel", "big")}</div><div class="buddy-fun-note">Spinning…</div>`;
    else if (goalHit()) body = `<div class="buddy-fun-note">You hit your goal, so you earned a spin!</div><button type="button" class="btn btn-primary btn-small" data-fun="spin">${uiIcon("wheel")} Spin</button>`;
    else body = `<div class="buddy-fun-note">Hit your daily goal (${api.goal()} calls) to unlock a spin.</div>`;
    return section("wheel", `${uiIcon("wheel")} Spin the wheel${w ? ` ${uiIcon("check")}` : ""}`, body);
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
    return section("lead", `${uiIcon("phone")} Lead of the day`, `<div class="buddy-fun-q">${escapeHtml(lead.name)}</div><div class="buddy-fun-note">${escapeHtml(where)}${where ? " · " : ""}${escapeHtml(why)}</div><button type="button" class="btn btn-ghost btn-small" data-fun="lead-open">Find it in Claimed</button>`);
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
    return section("kudos", `${uiIcon("megaphone")} Give kudos`, `<div class="buddy-fun-note">Thank a teammate. They'll see it pop up once.</div>
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
      bingoMark("kudos");
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
      <span class="buddy-progress">${g.calls.toLocaleString()} of ${g.target.toLocaleString()} calls${g.calls >= g.target ? ` ${uiIcon("check")}` : ""}</span></div>`;
  }

  /* ---------- one-tap mood ---------- */

  const MOOD_REPLY = {
    3: { pose: "thumbs", text: "Love to hear it. Let's make it a great shift." },
    2: { pose: "neutral", text: "Steady wins it. Take a breath between calls." },
    1: { pose: "encourage", text: "Sorry it's a rough one. Be kind to yourself, one call at a time. I'm in your corner." },
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
    { id: "puzzle", text: "Solve the daily puzzle", icon: "puzzle" },
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
      <div class="buddy-fun-note">She shows each look at the right moment. Pick one to be her resting pose; outfits for holidays and Fridays still take over on their days.</div>`);
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
      return `<div class="team-cal-row"><span>${who} ${what}</span><span>${when(o)}</span></div>`;
    }).join("");
    return `<section class="today-card side-card"><header class="today-card-head"><h3>Team calendar</h3></header><div class="side-body">${rows}</div></section>`;
  }

  /* ---------- the panel ---------- */

  const open = new Set();

  function section(id, title, body) {
    return `<details class="buddy-sec" data-sec="${id}" ${open.has(id) ? "open" : ""}><summary>${title}</summary><div class="buddy-sec-body">${body}</div></details>`;
  }

  function panelHtml() {
    return `<div class="buddy-secs">${riddleSection()}${bingoSection()}${wheelSection()}${leadSection()}${kudosSection()}${handoverSection()}${gallerySection()}</div>`;
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
    if (lastCalls === 0 && calls >= 1 && !riddleState().solved && !riddleState().revealed) {
      api.say({ key: `puzzleinvite:${api.today()}`, kind: "small", pose: "thinking", title: "Puzzle time?", text: "Nice first call. Today's puzzle is waiting in my panel when you want a short break." });
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
    team = { people: [], goal: { target: null, calls: 0, weekStart: "" } };
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

  window.dmeBuddyFun = { panelHtml, teamGoalHtml, onClick, onToday, onKudos, onUpcoming, onEvent, todayCardHtml, callHelperHtml, start, stop };
  // buddy.js may already be signed in and showing; catch up.
  if (typeof getSession === "function" && getSession() && document.getElementById("buddyLaunch")) start();
})();
