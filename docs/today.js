/* Today: the screen reps land on after signing in.
   Built entirely from the claimed leads the app already loads:
     - meetings that have passed ("How did it go?")
     - meetings today, with the rep's opener notes
     - callbacks due (overdue or due today)
     - claimed leads still waiting for a first call
   Also owns the "How did it go?" dialog. Loaded after app.js and callmode.js. */
(function () {
  "use strict";

  const panel = document.getElementById("todayPanel");
  const badge = document.getElementById("todayTabBadge");
  const FIRST_CALLS_SHOWN = 6;
  const OUTCOME_CALLBACKS = [
    { days: 1, label: "Tomorrow" },
    { days: 3, label: "3 days" },
    { days: 7, label: "1 week" },
    { days: 14, label: "2 weeks" },
    { days: 0, label: "No callback" },
  ];

  let refreshTimer = null;
  let loadFailed = false;
  let outcomeOverlay = null;
  const outcome = { npi: "", kind: "", status: "", days: null, busy: false };

  /* ---------- the server's view of today ---------- */
  // The lists, numbers and nudges are built by GET /leads/today from all of the rep's leads, so
  // the browser holds only what this screen shows, however many leads they have.

  let view = null;
  const STALE_KEY = "dmeStaleDays";
  const time = (iso) => Date.parse(iso) || 0;
  const phoneOf = (l) => (l.contactPhone || l.companyPhone || "").trim();

  function staleDays() {
    try {
      const n = Number(localStorage.getItem(STALE_KEY));
      if (n >= 3 && n <= 90) return Math.round(n);
    } catch { /* the default applies */ }
    return 14;
  }

  // The rep's own day and week, as the server needs them (call-log stamps are UTC).
  function todayQuery() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    return { start: start.toISOString(), end: end.toISOString(), week: monday.toISOString(), tz: now.getTimezoneOffset(), staleDays: staleDays() };
  }

  const allLeads = () => (view ? [...view.review, ...view.meetingsToday, ...view.callbacks, ...view.firstCalls.items, ...view.stale.items] : []);
  const byNpi = (npi) => allLeads().find((l) => l.npi === npi);

  function buckets() {
    if (!view) return { review: [], meetingsToday: [], callbacks: [], callbacksTotal: 0, firstCalls: [], firstTotal: 0, stale: [], staleTotal: 0, staleDays: staleDays(), nextMeeting: null, total: 0 };
    return {
      review: view.review,
      meetingsToday: view.meetingsToday,
      callbacks: view.callbacks,
      callbacksTotal: view.callbacksTotal,
      firstCalls: view.firstCalls.items,
      firstTotal: view.firstCalls.total,
      stale: view.stale.items,
      staleTotal: view.stale.total,
      staleDays: view.stale.days,
      nextMeeting: view.nextMeeting,
      total: view.totals.claimed,
    };
  }

  // Leads whose local time is a good time to call come first, strongest part of the day first; the rest keep their order.
  function openFirst(list) {
    const good = (l) => (window.dmeTime && window.dmeTime.localInfo(l.state)?.good ? 0 : 1);
    // Among the leads open now, the ones in the part of the day that gets the most pick-ups come first (see besttimes.js).
    const hot = (l) => -((window.dmeBest && window.dmeBest.score && window.dmeBest.score(l.state)) || 0);
    return list.map((l, i) => ({ l, i })).sort((a, b) => good(a.l) - good(b.l) || hot(a.l) - hot(b.l) || a.i - b.i).map((x) => x.l);
  }
  const unique = (list) => list.filter((l, i, all) => all.findIndex((x) => x.npi === l.npi) === i);

  /* ---------- rendering ---------- */

  function greeting() {
    const h = new Date().getHours();
    const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    const first = String(getSession()?.displayName || "").trim().split(/\s+/)[0];
    return first ? `${part}, ${first}` : part;
  }

  function clock(iso) {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  function until(l) {
    const mins = Math.round((time(l.meetingAt) - Date.now()) / 60000);
    if (mins <= 0) return "now";
    if (mins < 60) return `in ${mins} min`;
    return `in ${Math.round(mins / 6) / 10} h`.replace(".0", "");
  }

  function actionsHtml(l, { log = true } = {}) {
    const phone = phoneOf(l);
    return `<div class="today-actions">
      ${phone ? `<a class="btn btn-primary btn-small" href="tel:${escapeHtml(phone.replace(/[^\d+*#]/g, ""))}">${SIGNAL_ICONS.phone}Call</a>` : ""}
      ${log ? `<button type="button" class="btn btn-ghost btn-small" data-today="log" data-npi="${escapeHtml(l.npi)}">Log result</button>` : ""}
      <button type="button" class="link-btn" data-today="open" data-npi="${escapeHtml(l.npi)}">Open</button>
    </div>`;
  }

  function whoHtml(l) {
    const sub = [l.contactName, [l.city, l.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
    const tz = window.dmeHooks.localTime?.(l.state) || "";
    return `<div class="today-who"><div class="today-name">${escapeHtml(l.name)}</div>${sub || tz ? `<div class="today-sub">${escapeHtml(sub)} ${tz}</div>` : ""}</div>`;
  }

  function section(title, count, bodyHtml, { hint = "", action = "", tone = "" } = {}) {
    return `<section class="today-card ${tone}">
      <header class="today-card-head">
        <h3>${escapeHtml(title)}<span class="today-count">${count}</span></h3>
        ${hint ? `<span class="today-hint">${escapeHtml(hint)}</span>` : ""}
        ${action}
      </header>
      <div class="today-rows">${bodyHtml}</div>
    </section>`;
  }

  function render() {
    if (!panel) return;
    if (!view) {
      panel.innerHTML = loadFailed
        ? `<div class="today-empty"><div class="today-empty-title">Couldn't load your leads</div>
             <button type="button" class="btn btn-primary" data-today="reload">Try again</button></div>`
        : `<div class="today-loading"><span class="spinner"></span> Getting your day ready…</div>`;
      return;
    }
    const b = buckets();
    const calling = openFirst(unique([...b.callbacks, ...b.firstCalls]));
    const dateLine = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

    const ins = insights(b);
    const bits = [
      b.review.length ? `${b.review.length} meeting${b.review.length === 1 ? "" : "s"} to wrap up` : "",
      b.meetingsToday.length ? `${b.meetingsToday.length} meeting${b.meetingsToday.length === 1 ? "" : "s"} today` : "",
      b.callbacksTotal ? `${b.callbacksTotal} callback${b.callbacksTotal === 1 ? "" : "s"} due` : "",
      b.staleTotal ? `${b.staleTotal} going cold` : "",
      b.firstTotal ? `${b.firstTotal} waiting for a first call` : "",
    ].filter(Boolean);
    const hero = `<div class="today-hero">
      <div class="today-hero-text">
        <div class="today-date">${escapeHtml(dateLine)}</div>
        <h2>${escapeHtml(greeting())}</h2>
        <p>${bits.length ? escapeHtml(bits.join(" · ")) : "Nothing is due right now."}</p>
      </div>
      <div class="today-hero-actions">
        ${calling.length ? `<button type="button" class="btn btn-primary" data-today="start-all">${SIGNAL_ICONS.phone}<span>Start calling ${calling.length}</span></button>` : ""}
        <button type="button" class="btn btn-ghost" data-today="prospect">Find leads</button>
        <button type="button" class="btn btn-ghost" data-today="claimed">My leads</button>
      </div>
    </div>
    <div class="today-kpis">
      ${kpi("Calls today", ins.callsToday, "logged in call logs")}
      ${kpi("Calls this week", ins.callsWeek, "since Monday")}
      ${kpi("Meetings held", ins.heldWeek, "this week")}
      ${kpi("Claimed leads", b.total, `${ins.touched} worked so far`)}
    </div>`;
    let html = "";

    if (b.review.length) {
      html += section("How did it go?", b.review.length, b.review.map((l) => `
        <div class="today-row">
          ${whoHtml(l)}
          <span class="today-when is-past">${escapeHtml(formatMeeting(l.meetingAt))}</span>
          <div class="today-actions"><button type="button" class="btn btn-primary btn-small" data-today="review" data-npi="${escapeHtml(l.npi)}">How did it go?</button>
            <button type="button" class="link-btn" data-today="open" data-npi="${escapeHtml(l.npi)}">Open</button></div>
        </div>`).join(""), { hint: "Meetings that have passed. A quick answer keeps your list clean.", tone: "is-attention" });
    }

    if (b.meetingsToday.length) {
      html += section("Meetings today", b.meetingsToday.length, b.meetingsToday.map((l) => `
        <div class="today-row">
          ${whoHtml(l)}
          <span class="today-when">${escapeHtml(clock(l.meetingAt))}<small>${escapeHtml(until(l))}</small></span>
          ${actionsHtml(l, { log: false })}
          ${l.meetingOpenerNotes ? `<div class="opener-notes today-opener"><div class="opener-label">Your opener</div><div class="opener-text">${escapeHtml(l.meetingOpenerNotes)}</div></div>` : ""}
        </div>`).join(""));
    }

    if (b.callbacks.length) {
      html += section("Callbacks due", b.callbacksTotal, b.callbacks.map((l) => `
        <div class="today-row">
          ${whoHtml(l)}
          <span class="today-when">${reminderBadgeHtml(l.reminderAt)}</span>
          ${actionsHtml(l)}
        </div>`).join(""), { hint: "Overdue first." });
    }

    if (b.stale.length) {
      const shown = b.stale.slice(0, FIRST_CALLS_SHOWN);
      const more = b.staleTotal - shown.length;
      html += section("Going cold", b.staleTotal, shown.map((l) => `
        <div class="today-row">
          ${whoHtml(l)}
          <span class="today-when"><span class="stale-days" title="No call, note or status change since">${l.quietDays} days quiet</span></span>
          ${actionsHtml(l)}
        </div>`).join("") + (more > 0 ? `<div class="today-more">+ ${more} more. <button type="button" class="link-btn" data-today="start-stale">Call the coldest ${b.stale.length}</button></div>` : ""),
      { hint: `Nothing for ${b.staleDays}+ days and nothing scheduled.`, tone: "is-cold", action: `<button type="button" class="link-btn today-card-link" data-today="stale-days" title="How many quiet days count as cold">Change</button>` });
    }

    if (b.firstCalls.length) {
      const shown = b.firstCalls.slice(0, FIRST_CALLS_SHOWN);
      const more = b.firstTotal - shown.length;
      html += section("Ready for a first call", b.firstTotal, shown.map((l) => `
        <div class="today-row">
          ${whoHtml(l)}
          <span class="today-when"><span class="muted-note">Claimed ${escapeHtml((l.claimedAt || l.lastUpdated || "").slice(0, 10))}</span></span>
          ${actionsHtml(l)}
        </div>`).join("") + (more > 0 ? `<div class="today-more">+ ${more} more. <button type="button" class="link-btn" data-today="start-first">Call ${b.firstTotal > b.firstCalls.length ? "the first" : "all"} ${b.firstCalls.length}</button></div>` : ""));
    }

    if (!b.review.length && !b.meetingsToday.length && !b.callbacks.length && !b.stale.length && !b.firstCalls.length) {
      html += `<div class="today-empty">
        <div class="today-empty-title">${b.total ? "You're all caught up" : "No claimed leads yet"}</div>
        <p>${b.total
          ? (b.nextMeeting ? `Next meeting: ${escapeHtml(b.nextMeeting.name)}, ${escapeHtml(formatMeeting(b.nextMeeting.meetingAt))}.` : "Nothing is due today. A good time to find more leads.")
          : "Search in Prospect, claim the leads you want, and they will show up here."}</p>
        <button type="button" class="btn btn-primary" data-today="prospect">Go to Prospect</button>
      </div>`;
    }
    panel.innerHTML = `${hero}<div class="today-grid"><div class="today-main">${html}</div><aside class="today-side">${sideHtml(b, ins)}</aside></div>`;
    celebrate();
  }

  /* ---------- weekly numbers, pipeline, coming up, recent activity ---------- */

  function insights() {
    const stats = view ? view.stats : { callsToday: 0, callsWeek: 0, heldWeek: 0, streak: 0 };
    return { ...stats, touched: view ? view.totals.touched : 0 };
  }

  /* ---------- daily goal (the fun part) ---------- */

  const GOAL_KEY = "dmeDailyCallGoal";
  const CELEBRATED_KEY = "dmeGoalCelebrated";

  function dailyGoal() {
    try {
      const n = Number(localStorage.getItem(GOAL_KEY));
      if (n >= 1 && n <= 200) return Math.round(n);
    } catch { /* storage blocked: the default applies */ }
    return 15;
  }

  // YYYY-MM-DD on the rep's own clock (call-log stamps are UTC).
  function localDay(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function goalMessage(done, goal) {
    if (done >= goal) return "Goal hit. Nice work!";
    const left = goal - done;
    if (done === 0) return `${goal} calls today. Let's get the first one out of the way.`;
    if (left <= 3) return `Only ${left} to go!`;
    if (done >= goal / 2) return "Over halfway. Keep it rolling.";
    return `${left} to go. You've got this.`;
  }

  function goalCardHtml(ins) {
    const goal = dailyGoal();
    const done = ins.callsToday;
    const pct = Math.min(1, done / goal);
    const C = 2 * Math.PI * 34;
    const hit = done >= goal;
    return `<section class="today-card goal-card${hit ? " is-hit" : ""}" id="goalCard">
      <div class="goal-ring">
        <svg viewBox="0 0 80 80" aria-hidden="true">
          <circle class="goal-bg" cx="40" cy="40" r="34"/>
          <circle class="goal-fg" cx="40" cy="40" r="34" stroke-dasharray="${(C * pct).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 40 40)"/>
        </svg>
        <div class="goal-num"><strong>${done}</strong><span>of ${goal}</span></div>
      </div>
      <div class="goal-text">
        <div class="goal-title">Daily call goal</div>
        <div class="goal-msg">${escapeHtml(goalMessage(done, goal))}</div>
        <div class="goal-foot">
          ${ins.streak ? `<span class="goal-streak" title="Days in a row with a logged call">${uiIcon("flame")} ${ins.streak}-day streak</span>` : '<span class="goal-streak muted-note">Log a call to start a streak</span>'}
          <button type="button" class="link-btn" data-today="goal">Change goal</button>
        </div>
      </div>
    </section>`;
  }

  function celebrate() {
    const card = document.getElementById("goalCard");
    if (!card || !card.classList.contains("is-hit")) return;
    const today = localDay(new Date());
    try {
      if (localStorage.getItem(CELEBRATED_KEY) === today) return;
      localStorage.setItem(CELEBRATED_KEY, today);
    } catch { /* storage blocked: it just celebrates again next render */ }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const colors = ["var(--accent)", "var(--score-mid)", "var(--score-high)", "var(--score-low)"];
    for (let i = 0; i < 28; i += 1) {
      const bit = document.createElement("i");
      bit.className = "confetti-bit";
      bit.style.cssText = `left:${10 + Math.random() * 80}%;background:${colors[i % colors.length]};--dx:${(Math.random() - 0.5) * 140}px;--rot:${Math.round(Math.random() * 720)}deg;animation-delay:${(Math.random() * 0.25).toFixed(2)}s`;
      card.append(bit);
      setTimeout(() => bit.remove(), 1800);
    }
  }

  function kpi(label, value, sub) {
    return `<div class="kpi-card"><span class="kpi-label">${escapeHtml(label)}</span><span class="kpi-value">${Number(value || 0).toLocaleString()}</span><span class="kpi-sub">${escapeHtml(sub)}</span></div>`;
  }

  function pipelineHtml() {
    const rows = view ? view.pipeline : [];
    if (!rows.length) return '<span class="muted-note">Claim some leads to see your pipeline.</span>';
    const max = rows[0].count;
    return rows.map(({ status, count }) => `
      <button type="button" class="pipe-row" data-today="status" data-status="${escapeHtml(status)}" title="Show these in Claimed leads">
        <span class="pipe-label">${escapeHtml(status)}</span>
        <span class="pipe-track"><span class="pipe-fill" style="width:${Math.max(6, Math.round((count / max) * 100))}%"></span></span>
        <span class="pipe-n">${count}</span>
      </button>`).join("");
  }

  function comingUpHtml() {
    const items = view ? view.comingUp : [];
    if (!items.length) return '<span class="muted-note">Nothing scheduled in the next 7 days.</span>';
    return items.map((it) => `
      <button type="button" class="up-row" data-today="open" data-npi="${escapeHtml(it.npi)}">
        <span class="up-day">${escapeHtml(new Date(it.at).toLocaleDateString(undefined, { weekday: "short", day: "numeric" }))}</span>
        <span class="up-main"><span class="up-name">${escapeHtml(it.name)}</span><span class="up-kind">${it.kind} · ${escapeHtml(clock(it.at))}</span></span>
      </button>`).join("");
  }

  function activityHtml() {
    const rows = view ? view.recent : [];
    if (!rows.length) return '<span class="muted-note">Calls you log will show up here.</span>';
    return rows.map((r) => `
      <button type="button" class="act-row" data-today="open" data-npi="${escapeHtml(r.npi)}">
        <span class="act-text">${escapeHtml(r.text.length > 90 ? r.text.slice(0, 89) + "…" : r.text)}</span>
        <span class="act-meta">${escapeHtml(r.name)} · ${escapeHtml(new Date(r.at).toLocaleDateString(undefined, { month: "short", day: "numeric" }))}</span>
      </button>`).join("");
  }

  function sideHtml(b, ins) {
    const card = (title, body) => `<section class="today-card side-card"><header class="today-card-head"><h3>${title}</h3></header><div class="side-body">${body}</div></section>`;
    return goalCardHtml(ins) + card("Your pipeline", pipelineHtml()) + card("Coming up", comingUpHtml()) + (window.dmeBest?.cardHtml?.() || "") + (window.dmeBuddyFun?.todayCardHtml?.() || "") + card("Recent activity", activityHtml());
  }

  function updateBadge() {
    if (!badge) return;
    if (!view) { badge.hidden = true; return; }
    const n = view.review.length + view.meetingsToday.length + view.callbacksTotal;
    badge.textContent = n > 99 ? "99+" : String(n);
    badge.hidden = n === 0;
    setClaimedBadge(view.totals.claimed); // the Claimed tab's count, known as soon as Today has loaded
  }

  async function refresh({ showSpinner = false } = {}) {
    if (showSpinner || !view) { loadFailed = false; render(); }
    try {
      view = await apiGet("leads/today", todayQuery());
      loadFailed = false;
      window.dmeBuddy?.onToday(view, dailyGoal());
    } catch (err) {
      console.log("[today] " + err.message);
      if (!view) loadFailed = true;
    }
    updateBadge();
    if (state.view === "today") render();
  }

  /* ---------- actions ---------- */

  function openInClaimed(lead) {
    state.claimedSearchQuery = lead.name;
    els.claimedSearchInput.value = lead.name;
    state.claimedPage = 1;
    switchView("claimed"); // loads the Claimed table with that search
  }

  // The meeting dialog addresses a lead by its row in the Claimed table; a lead from Today may
  // not be on the page showing, so it is kept alongside it (see claimedIndexFor).
  function claimedRowIndex(npi) {
    const lead = byNpi(npi);
    return lead ? claimedIndexFor(lead) : -1;
  }

  function onPanelClick(e) {
    const btn = e.target.closest("[data-today]");
    if (!btn) return;
    const act = btn.dataset.today;
    const lead = btn.dataset.npi ? byNpi(btn.dataset.npi) : null;
    if (act === "reload") refresh({ showSpinner: true });
    else if (act === "prospect") switchView("search");
    else if (act === "claimed") switchView("claimed");
    else if (act === "goal") {
      const answer = prompt("Calls you want to make each day:", String(dailyGoal()));
      const n = Math.round(Number(answer));
      if (answer !== null && n >= 1 && n <= 200) {
        try { localStorage.setItem(GOAL_KEY, String(n)); } catch { /* not remembered */ }
        render();
      }
    }
    else if (act === "status") {
      state.statusFilter = btn.dataset.status;
      state.claimedSearchQuery = "";
      els.claimedSearchInput.value = "";
      state.claimedPage = 1;
      switchView("claimed");
    }
    else if (act === "stale-days") {
      const answer = prompt("Call a lead cold after how many quiet days?", String(staleDays()));
      const n = Math.round(Number(answer));
      if (answer !== null && n >= 3 && n <= 90) {
        try { localStorage.setItem(STALE_KEY, String(n)); } catch { /* not remembered */ }
        refresh();
      }
    }
    else if (act === "open" && lead) openInClaimed(lead);
    else if (act === "log" && lead) window.dmeCall.start([lead], "claimed");
    else if (act === "review" && lead) openOutcome(lead);
    else if (act === "start-all" || act === "start-first" || act === "start-stale") {
      const b = buckets();
      const list = act === "start-first" ? b.firstCalls : act === "start-stale" ? b.stale : [...b.callbacks, ...b.firstCalls];
      window.dmeCall.start(openFirst(unique(list)), "claimed");
    }
  }

  /* ---------- "How did it go?" ---------- */

  function buildOutcome() {
    if (outcomeOverlay) return;
    outcomeOverlay = document.createElement("div");
    outcomeOverlay.className = "suggestion-overlay";
    outcomeOverlay.hidden = true;
    outcomeOverlay.innerHTML = `<div class="suggestion-card outcome-card" role="dialog" aria-modal="true" aria-labelledby="outcomeTitle"></div>`;
    document.body.append(outcomeOverlay);
    outcomeOverlay.addEventListener("click", onOutcomeClick);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !outcomeOverlay.hidden) closeOutcome(); });
  }

  function closeOutcome() {
    if (outcomeOverlay) outcomeOverlay.hidden = true;
  }

  function openOutcome(lead) {
    buildOutcome();
    Object.assign(outcome, { npi: lead.npi, kind: "", status: "", days: null, busy: false });
    renderOutcome();
    outcomeOverlay.hidden = false;
  }

  function defaultsFor(kind, lead) {
    if (kind === "held") {
      const statuses = callResultStatuses();
      return { status: statuses.find((s) => s.toLowerCase() === "interested") || "", days: 3 };
    }
    const keep = String(lead.status || "").toLowerCase() === "meeting booked";
    return { status: keep ? (callResultStatuses().find((s) => s.toLowerCase() === "called") || "") : "", days: 1 };
  }

  function renderOutcome() {
    const lead = byNpi(outcome.npi);
    const card = outcomeOverlay.querySelector(".outcome-card");
    if (!lead) { closeOutcome(); return; }
    const choice = (kind, title, sub) =>
      `<button type="button" class="outcome-btn${outcome.kind === kind ? " active" : ""}" data-outcome="${kind}"><strong>${title}</strong><small>${sub}</small></button>`;
    const more = outcome.kind ? `
      <div class="cm-label">Set status</div>
      <div class="cm-chips">${callResultStatuses().map((s) =>
        `<button type="button" class="choice-chip${s === outcome.status ? " active" : ""}" data-oc-status="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join("")}</div>
      <div class="cm-label">Call back</div>
      <div class="cm-chips">${OUTCOME_CALLBACKS.map((c) =>
        `<button type="button" class="choice-chip${outcome.days === c.days ? " active" : ""}" data-oc-days="${c.days}">${c.label}</button>`).join("")}</div>
      <label class="field"><span>Note <em class="field-optional">optional</em></span>
        <textarea id="outcomeNote" rows="2" maxlength="500" placeholder="${outcome.kind === "held" ? "What happened, what they need next" : "Anything worth remembering"}"></textarea></label>
      <div class="suggestion-actions reminder-actions">
        <button type="button" class="btn btn-ghost" data-outcome-cancel>Close</button>
        <button type="button" class="btn btn-primary" data-outcome-save ${outcome.busy ? "disabled" : ""}>Save</button>
      </div>` : `
      <div class="suggestion-actions reminder-actions"><button type="button" class="btn btn-ghost" data-outcome-cancel>Close</button></div>`;
    card.innerHTML = `
      <h3 id="outcomeTitle">How did the meeting go?</h3>
      <p class="suggestion-hint">With <strong>${escapeHtml(lead.name)}</strong>, ${escapeHtml(formatMeeting(lead.meetingAt))}.</p>
      <div class="outcome-choices">
        ${choice("held", "Went well", "It happened")}
        ${choice("no-show", "No-show", "They didn't join")}
        ${choice("reschedule", "Reschedule", "Pick a new time")}
      </div>
      ${more}`;
  }

  async function saveOutcome() {
    const lead = byNpi(outcome.npi);
    if (!lead || outcome.busy) return;
    outcome.busy = true;
    const note = (document.getElementById("outcomeNote")?.value || "").trim();
    const saveBtn = outcomeOverlay.querySelector("[data-outcome-save]");
    if (saveBtn) saveBtn.disabled = true;
    let step = "meeting";
    try {
      // Clearing the meeting with an outcome is what writes "Meeting held" / "Meeting no-show" to the call log.
      const data = await apiPost("leads/meeting", { npi: lead.npi, meetingAt: "", noteLabel: "", outcome: outcome.kind });
      applyMeetingToLead(lead, data);
      step = "status";
      if (outcome.status && outcome.status !== lead.status) {
        lead.status = (await apiPost("leads/status", { npi: lead.npi, status: outcome.status })).status;
      }
      step = "note";
      if (note) {
        const res = await apiPost("leads/notes", { npi: lead.npi, note });
        lead.notes = res.notes;
      }
      step = "callback";
      if (outcome.days) {
        const res = await apiPost("leads/reminder", { npi: lead.npi, reminderAt: remindDateIso(outcome.days) });
        lead.reminderAt = res.reminderAt;
      } else if (outcome.days === 0 && lead.reminderAt) {
        const res = await apiPost("leads/reminder", { npi: lead.npi, reminderAt: "" });
        lead.reminderAt = res.reminderAt;
      }
      closeOutcome();
      showToast(outcome.kind === "held" ? "Logged: meeting held" : "Logged: no-show");
      if (state.claimedLoaded) loadClaimedLeads(true);
    } catch (err) {
      showToast(`${err.message}${step === "meeting" ? "" : " (the meeting result was saved; finish the rest from Claimed leads)"}`, true);
      if (step !== "meeting") closeOutcome();
    } finally {
      outcome.busy = false;
      refresh();
    }
  }

  function onOutcomeClick(e) {
    if (e.target === outcomeOverlay || e.target.closest("[data-outcome-cancel]")) { closeOutcome(); return; }
    if (e.target.closest("[data-outcome-save]")) { saveOutcome(); return; }
    const kindBtn = e.target.closest("[data-outcome]");
    const statusBtn = e.target.closest("[data-oc-status]");
    const daysBtn = e.target.closest("[data-oc-days]");
    const lead = byNpi(outcome.npi);
    if (!lead) return;
    if (kindBtn) {
      const kind = kindBtn.dataset.outcome;
      if (kind === "reschedule") {
        closeOutcome();
        const idx = claimedRowIndex(lead.npi);
        if (idx >= 0) openMeetingModal(idx);
        else showToast("Open this lead in Claimed leads to reschedule it", true);
        return;
      }
      const note = document.getElementById("outcomeNote")?.value || "";
      Object.assign(outcome, { kind }, defaultsFor(kind, lead));
      renderOutcome();
      const field = document.getElementById("outcomeNote");
      if (field) field.value = note;
    } else if (statusBtn || daysBtn) {
      const note = document.getElementById("outcomeNote")?.value || "";
      if (statusBtn) outcome.status = outcome.status === statusBtn.dataset.ocStatus ? "" : statusBtn.dataset.ocStatus;
      if (daysBtn) outcome.days = Number(daysBtn.dataset.ocDays);
      renderOutcome();
      document.getElementById("outcomeNote").value = note;
    }
  }

  /* ---------- wiring ---------- */

  function stopTimer() {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  }

  function startTimer() {
    stopTimer();
    refreshTimer = setInterval(() => {
      const drawerOpen = document.documentElement.classList.contains("call-open");
      if (state.view !== "today" || drawerOpen || (outcomeOverlay && !outcomeOverlay.hidden)) return;
      refresh();
    }, AUTO_REFRESH_INTERVAL_MS);
  }

  panel?.addEventListener("click", onPanelClick);

  const hooks = window.dmeHooks;
  hooks.onView = (view) => {
    if (view === "today") { refresh(); startTimer(); }
    else stopTimer();
  };
  const previousChanged = hooks.onClaimedChanged;
  hooks.onClaimedChanged = () => { previousChanged?.(); refresh(); };
  hooks.onSignedIn = () => {
    // Nothing loads for a temporary password until it has been changed.
    if (getSession()?.mustChangePassword) return;
    // Land on Today after signing in, whatever the tab was before.
    switchView("today");
  };
  const previousSignedOut = hooks.onSignedOut;
  hooks.onSignedOut = () => {
    previousSignedOut?.();
    stopTimer();
    closeOutcome();
    view = null;
    if (badge) badge.hidden = true;
    if (panel) panel.innerHTML = "";
  };

  // The page may have been reloaded while already signed in; app.js ran its
  // sign-in step before this file existed.
  window.dmeToday = { refresh, rerender: () => { if (state.view === "today") render(); } };
  if (getSession()) hooks.onSignedIn();
})();
