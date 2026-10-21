/* Home for a super admin: what the Today tab shows instead of the rep's callbacks and meetings.
   A short "what needs you today" page: today against yesterday, the things worth a look, what is waiting in the
   admin queues, who has been active, and whether the system is healthy. Each card points to where the work is done
   (Insights for analysis, Admin for queues and settings). Built from the same GET admin/insights answer as the
   Insights page, kept for a minute so switching tabs is instant.
   Everyone else keeps the normal Today screen (today.js). Loaded after insights.js. */
(function () {
  "use strict";

  const panel = document.getElementById("todayPanel");
  const todayTab = document.querySelector('.view-tabs .tab[data-view="today"]');
  const FLAG_KEY = "dmeSuperAdmin"; // remembered per username so the right screen shows at once
  const CACHE_MS = 60 * 1000;

  let on = false;
  let goals = null; // { installed, callsWeek, meetingsWeek } (sql/051)
  let week = null; // this week's team totals from admin/team-activity
  let editingGoals = false;
  let data = null;
  let fetchedAt = 0;
  let loading = false;
  let error = "";

  const num = (n) => Number(n || 0).toLocaleString();
  const esc = (s) => escapeHtml(String(s ?? ""));

  function rememberedFlag() {
    try { return localStorage.getItem(FLAG_KEY) === (getSession()?.username || "\0"); } catch { return false; }
  }

  function setOn(value) {
    on = value;
    window.dmeHomeOverride = value; // today.js stops drawing into the shared panel
    try {
      if (value) localStorage.setItem(FLAG_KEY, getSession()?.username || "");
      else localStorage.removeItem(FLAG_KEY);
    } catch { /* not remembered */ }
    const label = todayTab?.querySelector(".tab-label");
    if (label) label.textContent = value ? "Home" : "Today";
    if (todayTab) todayTab.title = value ? "Home" : "Today";
  }

  const sameDay = (iso, ref) => Boolean(iso) && String(iso).slice(0, 10) === ref;

  function ago(iso) {
    const t = Date.parse(iso);
    if (!t) return "never";
    const mins = Math.round((Date.now() - t) / 60000);
    if (mins < 2) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} h ago`;
    const days = Math.floor(hrs / 24);
    return days === 1 ? "yesterday" : `${days} days ago`;
  }

  function greeting() {
    const h = new Date().getHours();
    const part = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
    const first = String(getSession()?.displayName || "").trim().split(/\s+/)[0];
    return `Good ${part}${first ? `, ${esc(first)}` : ""}`;
  }

  // Today against yesterday: the last two days of the activity series (UTC days, as on the Insights page).
  function vs(today, yesterday) {
    const diff = today - yesterday;
    const cls = diff > 0 ? "ins-up" : diff < 0 ? "ins-down" : "";
    const sym = diff > 0 ? "▲" : diff < 0 ? "▼" : "–";
    return `<span class="${cls}">${sym} ${num(Math.abs(diff))}</span> <small>vs yesterday (${num(yesterday)})</small>`;
  }

  const kpi = (label, value, sub) => `<div class="kpi-card"><span class="kpi-label">${esc(label)}</span><span class="kpi-value">${value}</span><span class="kpi-sub">${sub}</span></div>`;

  function systemLine(sys) {
    if (!sys) return `<p class="ins-empty">System details unavailable.</p>`;
    const checks = [...(sys.integrations || []).map((i) => i.configured), ...(sys.installed || []).map((i) => i.installed)];
    const bad = checks.filter((ok) => !ok).length;
    return bad
      ? `<p class="ins-note"><strong>${num(bad)} of ${num(checks.length)}</strong> checks need attention. <button type="button" class="link-btn" data-goto="insights" data-section="system">See which</button></p>`
      : `<p class="ins-note ins-allgood">All ${num(checks.length)} checks are fine.</p>`;
  }

  const sumOf = (list) => (list || []).reduce((a, b) => a + b, 0);

  // This week against the goals an admin set (sql/051). Hidden until that file is installed.
  function goalsCard() {
    if (!goals || !goals.installed) return "";
    const calls = week && week.totals ? sumOf(week.totals.calls) : 0;
    const held = week && week.totals ? sumOf(week.totals.meetingsHeld) : 0;
    const bar = (label, value, goal) => `<div class="home-goal">
      <div class="home-goal-head"><span>${esc(label)}</span><span><b>${num(value)}</b> of ${num(goal)}</span></div>
      <div class="home-goal-bar" role="img" aria-label="${esc(label)}: ${num(value)} of ${num(goal)}"><i style="width:${Math.min(100, goal ? Math.round((value / goal) * 100) : 0)}%"></i></div></div>`;
    const set = [goals.callsWeek != null ? bar("Calls this week", calls, goals.callsWeek) : "", goals.meetingsWeek != null ? bar("Meetings held this week", held, goals.meetingsWeek) : ""].join("");
    const form = editingGoals ? `<div class="home-goal-form">
        <label>Calls per week<input type="number" min="0" max="100000" data-goal="callsWeek" value="${goals.callsWeek ?? ""}"></label>
        <label>Meetings held per week<input type="number" min="0" max="100000" data-goal="meetingsWeek" value="${goals.meetingsWeek ?? ""}"></label>
        <button type="button" class="btn btn-primary btn-small" data-home="goals-save">Save</button>
        <button type="button" class="link-btn" data-home="goals-cancel">Cancel</button></div>` : "";
    return `<section class="ins-card"><h3>Weekly goals <small>since Monday, UTC</small></h3>
      ${set || `<p class="ins-note">No goals set yet.</p>`}
      ${form || `<p class="ins-note"><button type="button" class="link-btn" data-home="goals-edit">${set ? "Change goals" : "Set goals"}</button></p>`}</section>`;
  }

  function render() {
    if (!panel || !on) return;
    if (!data) {
      panel.innerHTML = error
        ? `<div class="today-empty"><div class="today-empty-title">Couldn't load Home</div><p class="ins-empty">${esc(error)}</p>
             <button type="button" class="btn btn-primary" data-home="reload">Try again</button></div>`
        : `<div class="today-loading"><span class="spinner"></span> Getting today's picture…</div>`;
      return;
    }
    const d = data;
    const daily = d.adoption.daily;
    const t = daily[daily.length - 1] || { date: "", claims: 0, dials: 0, calls: 0 };
    const y = daily[daily.length - 2] || { claims: 0, dials: 0, calls: 0 };
    const people = [...d.adoption.people].sort((a, b) => (Date.parse(b.lastActive) || 0) - (Date.parse(a.lastActive) || 0));
    const activeToday = people.filter((p) => sameDay(p.lastActive, t.date)).length;
    const fr = d.friction;
    const q = fr.queues || {};
    const attention = d.signals.filter((s) => s.level === "bad" || s.level === "warn").slice(0, 5);
    const calls = t.dials + t.calls;
    const callsY = y.dials + y.calls;
    const waiting = [
      ["Possible duplicates", q.matchReviews, "admin", "queues"],
      ["Provider changes", q.providerChanges, "admin", "queues"],
      ["Suggestions this week", fr.suggestions.last7, "admin", "queues"],
      ["Overdue callbacks (team)", d.pipeline.overdueCallbacks, "insights", "people"],
    ];

    panel.innerHTML = `
      <div class="home-wrap">
        <header class="home-head">
          <div><h2 class="ins-title">${greeting()}</h2>
            <p class="ins-sub">${esc(new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }))}. What needs you today. Team numbers leave out super admin and integration accounts.</p></div>
          <div class="home-actions">
            <button type="button" class="btn btn-ghost btn-small" data-goto="insights">Open insights</button>
            <button type="button" class="btn btn-ghost btn-small" data-goto="admin" data-section="queues">Open admin</button>
            <button type="button" class="btn btn-ghost btn-small" data-home="digest" title="Sends you this week's digest as an avatar note, the same one the Monday cron sends">Send me the digest</button>
            <button type="button" class="btn btn-ghost btn-small" data-home="reload"${loading ? " disabled" : ""}>${loading ? "Refreshing…" : "Refresh"}</button>
          </div>
        </header>

        <div class="kpi-strip ins-kpis">
          ${kpi("Claims today", num(t.claims), vs(t.claims, y.claims))}
          ${kpi("Calls today", num(calls), vs(calls, callsY))}
          ${kpi("Active today", `${num(activeToday)} of ${num(d.team.total)}`, "people who did anything today")}
          ${kpi("Open leads", num(d.pipeline.openLeads), `${num(d.pipeline.neverContacted)} never contacted`)}
        </div>

        <div class="ins-grid">
          <section class="ins-card"><h3>Worth a look</h3>
            ${attention.length
              ? `<ul class="ins-list">${attention.map((s) => `<li class="ins-${esc(s.level)}"><span class="ins-dot"></span><span>${esc(s.text)}</span></li>`).join("")}</ul>`
              : `<p class="ins-note ins-allgood">Nothing stands out right now.</p>`}
            <p class="ins-note"><button type="button" class="link-btn" data-goto="insights" data-section="overview">All signals and trends in Insights</button></p>
          </section>

          <section class="ins-card"><h3>Waiting on you</h3>
            <ul class="home-queue">${waiting.map(([label, n, view, section]) => `
              <li><span>${esc(label)}</span><b class="${n > 0 ? "has" : ""}">${n == null ? "n/a" : num(n)}</b>
                <button type="button" class="link-btn" data-goto="${view}" data-section="${section}">Open</button></li>`).join("")}</ul>
          </section>

          <section class="ins-card"><h3>Team right now</h3>
            ${people.length ? `<ul class="home-people">${people.slice(0, 6).map((p) => {
              const diff = p.weekNow - p.weekPrev;
              const cls = diff > 0 ? "ins-up" : diff < 0 ? "ins-down" : "";
              return `<li><span class="home-person">${esc(p.name)}</span><small>${esc(ago(p.lastActive))}</small><span class="${cls}">${diff > 0 ? "▲" : diff < 0 ? "▼" : "–"} ${num(p.weekNow)}</span></li>`;
            }).join("")}</ul>
            <p class="ins-note">Last column: actions this week. <button type="button" class="link-btn" data-goto="insights" data-section="people">Everyone in Insights</button></p>` : `<p class="ins-empty">No reps yet.</p>`}
          </section>

          ${goalsCard()}
          <section class="ins-card"><h3>System</h3>${systemLine(d.system)}</section>
        </div>
      </div>`;
  }

  async function refresh({ force = false } = {}) {
    if (!on) return;
    if (!force && data && Date.now() - fetchedAt < CACHE_MS) { render(); return; }
    loading = true;
    if (!data) { error = ""; render(); }
    try {
      const [d, g, w] = await Promise.all([
        apiGet("admin/insights", { days: 7 }),
        apiGet("admin/goals").catch(() => null),
        apiGet("admin/team-activity", { weeks: 1 }).catch(() => null),
      ]);
      data = d;
      goals = g;
      week = w;
      fetchedAt = Date.now();
      error = "";
    } catch (err) {
      console.log("[home] " + err.message);
      if (!data) error = err.message;
    }
    loading = false;
    render();
  }

  panel?.addEventListener("click", async (e) => {
    if (!on) return;
    const btn = e.target.closest("[data-home]");
    if (!btn) return;
    const act = btn.dataset.home;
    if (act === "reload") refresh({ force: true });
    else if (act === "digest") {
      btn.disabled = true;
      try {
        const out = await apiPost("admin/digest/test", {});
        showToast("Digest sent. Your avatar will show it within a minute.");
        console.log("[home] digest: " + out.body);
      } catch (err) {
        showToast(err.message, true);
      }
      btn.disabled = false;
    }
    else if (act === "goals-edit") { editingGoals = true; render(); }
    else if (act === "goals-cancel") { editingGoals = false; render(); }
    else if (act === "goals-save") {
      const field = (k) => panel.querySelector(`[data-goal="${k}"]`)?.value ?? "";
      try {
        goals = await apiPost("admin/goals", { callsWeek: field("callsWeek"), meetingsWeek: field("meetingsWeek") });
        editingGoals = false;
        showToast("Goals saved");
      } catch (err) {
        showToast(err.message, true);
      }
      render();
    }
  });

  const hooks = window.dmeHooks;
  const previousOnView = hooks.onView;
  hooks.onView = (view) => {
    if (on && view === "today") { refresh(); return; }
    previousOnView?.(view);
  };

  async function checkFlag() {
    if (!getSession() || getSession().mustChangePassword) return;
    if (rememberedFlag() && !on) { setOn(true); if (state.view === "today") refresh(); }
    try {
      const flags = await apiGet("auth/flags");
      const value = Boolean(flags.isSuperAdmin);
      if (value !== on) {
        setOn(value);
        if (state.view === "today") { value ? refresh({ force: true }) : window.dmeToday?.refresh({ showSpinner: true }); }
      }
    } catch (err) {
      console.log("[home] " + err.message);
    }
  }

  const previousSignedIn = hooks.onSignedIn;
  hooks.onSignedIn = () => { previousSignedIn?.(); checkFlag(); };
  const previousSignedOut = hooks.onSignedOut;
  hooks.onSignedOut = () => {
    previousSignedOut?.();
    data = null;
    error = "";
    setOn(false);
  };

  if (getSession()) checkFlag();
})();
