/* App insights: what a super admin sees in place of the Today screen.
   Usage and adoption, how far leads get, where people hit friction, and system health,
   all from GET admin/insights (see worker/src/lib/insights.js). Ordinary reps and admins
   never see it: the Worker refuses anyone who is not a super admin (sql/045).
   Loaded after today.js, which it steps in front of only for a super admin. */
(function () {
  "use strict";

  const panel = document.getElementById("todayPanel");
  const todayTab = document.querySelector('.view-tabs .tab[data-view="today"]');
  const FLAG_KEY = "dmeSuperAdmin"; // remembered per username so the right screen shows at once
  const DAYS_KEY = "dmeInsightsDays";
  const RANGES = [14, 28, 60, 90];

  let isSuper = false;
  let data = null;
  let days = 28;
  let loading = false;
  let error = "";

  try {
    const saved = Number(localStorage.getItem(DAYS_KEY));
    if (RANGES.includes(saved)) days = saved;
  } catch { /* defaults apply */ }

  const num = (n) => Number(n || 0).toLocaleString();
  const esc = (s) => escapeHtml(String(s ?? ""));
  const pct = (x) => `${Math.round((x || 0) * 100)}%`;

  function ago(iso) {
    const t = Date.parse(iso);
    if (!t) return "never";
    const d = Math.floor((Date.now() - t) / 86_400_000);
    if (d <= 0) return "today";
    if (d === 1) return "yesterday";
    return `${d} days ago`;
  }

  function rememberedFlag() {
    try { return localStorage.getItem(FLAG_KEY) === (getSession()?.username || "\0"); } catch { return false; }
  }

  function setFlag(on) {
    isSuper = on;
    window.dmeInsightsActive = on; // today.js stops drawing into the shared panel
    try {
      if (on) localStorage.setItem(FLAG_KEY, getSession()?.username || "");
      else localStorage.removeItem(FLAG_KEY);
    } catch { /* not remembered */ }
    const label = todayTab?.querySelector(".tab-label");
    if (label) label.textContent = on ? "Insights" : "Today";
    if (todayTab) todayTab.title = on ? "App insights" : "Today";
  }

  /* ---------- pieces ---------- */

  const kpi = (label, value, sub) =>
    `<div class="kpi-card"><span class="kpi-label">${esc(label)}</span><span class="kpi-value">${esc(value)}</span><span class="kpi-sub">${esc(sub || " ")}</span></div>`;

  function chart(daily) {
    if (!daily.length) return "";
    const W = 720, H = 150, pad = 18;
    const totals = daily.map((d) => d.claims + d.dials + d.calls);
    const max = Math.max(1, ...totals);
    const bw = (W - pad * 2) / daily.length;
    const bars = daily.map((d, i) => {
      const x = pad + i * bw + 1;
      let y = H - pad;
      return [["calls", "var(--score-high)"], ["dials", "var(--accent)"], ["claims", "var(--score-mid)"]].map(([key, color]) => {
        const h = (d[key] / max) * (H - pad * 2);
        y -= h;
        return h > 0 ? `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h.toFixed(1)}" fill="${color}"><title>${esc(d.date)}: ${d[key]} ${key}</title></rect>` : "";
      }).join("");
    }).join("");
    return `<svg class="ins-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily activity: claims, phone taps and logged calls">
        <line x1="${pad}" x2="${W - pad}" y1="${H - pad}" y2="${H - pad}" stroke="var(--hairline)"/>${bars}
        <text x="${pad}" y="${H - 3}" font-size="10" fill="var(--muted)">${esc(daily[0].date)}</text>
        <text x="${W - pad}" y="${H - 3}" font-size="10" fill="var(--muted)" text-anchor="end">${esc(daily[daily.length - 1].date)}</text>
      </svg>
      <div class="ins-legend"><span><i style="background:var(--score-mid)"></i>Claims</span><span><i style="background:var(--accent)"></i>Phone taps</span><span><i style="background:var(--score-high)"></i>Logged calls</span></div>`;
  }

  function trend(p) {
    if (!p.weekNow && !p.weekPrev) return '<span class="ins-dim">no activity</span>';
    const diff = p.weekNow - p.weekPrev;
    const cls = diff > 0 ? "ins-up" : diff < 0 ? "ins-down" : "";
    return `<span class="${cls}">${diff > 0 ? "\u25B2" : diff < 0 ? "\u25BC" : "\u2013"} ${num(p.weekNow)} <small>(was ${num(p.weekPrev)})</small></span>`;
  }

  function people(list) {
    if (!list.length) return `<p class="ins-empty">No reps yet.</p>`;
    return `<div class="table-wrap"><table class="results-table ins-table"><thead><tr>
        <th>Person</th><th>Last active</th><th>Vs last week</th><th>Claims</th><th>Taps</th><th>Calls</th><th>Searches</th><th>Open leads</th><th>Never called</th><th>Overdue</th></tr></thead><tbody>${list.map((p) => `
        <tr><td>${esc(p.name)}${p.isAdmin ? ' <span class="reminder-badge reminder-upcoming">admin</span>' : ""}</td>
        <td class="${p.lastActive && Date.now() - Date.parse(p.lastActive) < 7 * 86_400_000 ? "" : "ins-dim"}">${esc(ago(p.lastActive))}</td>
        <td>${trend(p)}</td>
        <td>${num(p.claims)}</td><td>${num(p.dials)}</td><td>${num(p.calls)}</td><td>${num(p.searches)}</td><td>${num(p.openLeads)}</td>
        <td>${num(p.neverContacted)}</td><td>${num(p.overdue)}</td></tr>`).join("")}
      </tbody></table></div>`;
  }

  function funnel(f) {
    if (!f.total) return `<p class="ins-empty">No claimed leads to measure yet.</p>`;
    return `<div class="ins-funnel">${f.stages.map((s) => `
      <div class="ins-funnel-row"><span class="ins-funnel-label">${esc(s.label)}</span>
        <span class="ins-funnel-track"><span class="ins-funnel-fill" style="width:${Math.max(2, Math.round(s.ofClaimed * 100))}%"></span></span>
        <span class="ins-funnel-num">${num(s.count)} <small>${pct(s.ofClaimed)}</small></span></div>`).join("")}</div>`;
  }

  function firstCall(fc) {
    if (!fc.claimed) return `<p class="ins-empty">No leads were claimed in this period.</p>`;
    if (!fc.contacted) return `<p class="ins-empty">${num(fc.claimed)} leads claimed, none called yet.</p>`;
    const hours = fc.medianHours;
    const med = hours < 1 ? "under an hour" : hours < 48 ? `${Math.round(hours)} hours` : `${Math.round(hours / 24)} days`;
    return `<div class="ins-big">${esc(med)}</div><p class="ins-note">median time from claiming to the first call</p>
      <ul class="ins-list">
        <li><span class="ins-dot"></span><span>Called within a day<small>${num(fc.within1d)} of ${num(fc.claimed)} claimed (${Math.round((fc.within1d / fc.claimed) * 100)}%)</small></span></li>
        <li><span class="ins-dot"></span><span>Called within 3 days<small>${num(fc.within3d)} of ${num(fc.claimed)} (${Math.round((fc.within3d / fc.claimed) * 100)}%)</small></span></li>
        <li><span class="ins-dot"></span><span>Never called yet<small>${num(fc.claimed - fc.contacted)}</small></span></li></ul>`;
  }

  function segments(title, rows) {
    if (!rows.length) return `<p class="ins-empty">Not enough claimed leads yet.</p>`;
    return `<div class="table-wrap"><table class="results-table ins-table"><thead><tr><th>${esc(title)}</th><th>Claimed</th><th>Called</th><th>Meetings held</th><th>Onboarded</th></tr></thead><tbody>${rows.map((r) => `
      <tr><td>${esc(r.label)}</td><td>${num(r.claimed)}</td><td>${pct(r.contacted / r.claimed)}</td><td>${pct(r.held / r.claimed)}</td><td>${pct(r.won / r.claimed)}</td></tr>`).join("")}</tbody></table></div>`;
  }

  function stuckList(list) {
    if (!list.length) return `<p class="ins-empty">Nothing stuck. Every claimed lead has been called or updated.</p>`;
    return `<div class="table-wrap"><table class="results-table ins-table"><thead><tr><th>Lead</th><th>Claimed by</th><th>Waiting</th></tr></thead><tbody>${list.map((l) => `
      <tr><td>${esc(l.company)}</td><td>${esc(l.rep)}</td><td>${num(l.days)} days</td></tr>`).join("")}</tbody></table></div>`;
  }

  // When the team calls, in this browser's own time: weekday rows, three-hour columns.
  function heatmap(times) {
    if (!times || !times.length) return `<p class="ins-empty">No calls in this period.</p>`;
    const grid = Array.from({ length: 7 }, () => Array(8).fill(0));
    times.forEach((t) => { const d = new Date(t); grid[(d.getDay() + 6) % 7][Math.floor(d.getHours() / 3)] += 1; });
    const max = Math.max(1, ...grid.flat());
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const hours = ["12a", "3a", "6a", "9a", "12p", "3p", "6p", "9p"];
    return `<div class="ins-heat"><span></span>${hours.map((h) => `<span class="ins-heat-h">${h}</span>`).join("")}
      ${grid.map((row, i) => `<span class="ins-heat-h">${days[i]}</span>${row.map((n, j) => `<span class="ins-heat-cell" style="--a:${(n / max).toFixed(2)}" title="${days[i]} ${hours[j]}: ${n} calls"></span>`).join("")}`).join("")}</div>`;
  }

  function nudgeList(list) {
    if (!list.length) return `<p class="ins-empty">Nobody needs a nudge right now.</p>`;
    return `<ul class="ins-nudges">${list.map((n, i) => `
      <li data-nudge="${i}"><div class="ins-nudge-head"><strong>${esc(n.name)}</strong><span class="reminder-badge reminder-upcoming">${esc(n.reason)}</span>
        ${n.lastNoteAt ? `<small class="ins-dim">Note sent ${esc(ago(n.lastNoteAt))}</small>` : ""}</div>
        <textarea rows="2" maxlength="500" aria-label="Note to ${esc(n.name)}">${esc(n.text)}</textarea>
        <div class="ins-nudge-actions"><button type="button" class="btn btn-primary btn-small" data-ins="nudge" data-i="${i}">Send as avatar note</button><span class="ins-nudge-status" aria-live="polite"></span></div></li>`).join("")}</ul>`;
  }

  function system(sys) {
    if (!sys) return `<p class="ins-empty">System details unavailable.</p>`;
    const row = (ok, label, note) => `<li class="${ok ? "ins-ok" : "ins-bad"}"><span class="ins-dot"></span><span>${esc(label)}<small>${esc(note || "")}</small></span></li>`;
    return `<ul class="ins-list">
      ${(sys.integrations || []).map((i) => row(i.configured, i.label, i.configured ? i.note : "Not connected")).join("")}
      ${(sys.installed || []).map((i) => row(i.installed, i.label, i.installed ? "" : `Not installed (${i.note})`)).join("")}
      <li class="ins-ok"><span class="ins-dot"></span><span>Search source<small>${esc(sys.searchSource || "unknown")}</small></span></li></ul>`;
  }

  /* ---------- page ---------- */

  function render() {
    if (!panel) return;
    if (!data) {
      panel.innerHTML = error
        ? `<div class="today-empty"><div class="today-empty-title">Couldn't load the insights</div><p class="ins-empty">${esc(error)}</p>
             <button type="button" class="btn btn-primary" data-ins="reload">Try again</button></div>`
        : `<div class="today-loading"><span class="spinner"></span> Gathering what's happening in the app…</div>`;
      return;
    }
    const d = data;
    const p = d.pipeline;
    const fr = d.friction;
    const taps = d.adoption.daily.reduce((n, x) => n + x.dials, 0);
    const calls = d.adoption.daily.reduce((n, x) => n + x.calls, 0);
    const claims = d.adoption.daily.reduce((n, x) => n + x.claims, 0);
    const held = p.funnel.stages.find((s) => s.key === "held");
    const q = fr.queues;
    const queueText = [["matchReviews", "possible duplicates"], ["providerChanges", "provider changes"]]
      .filter(([k]) => typeof q[k] === "number").map(([k, l]) => `${num(q[k])} ${l}`).join(" · ");

    panel.innerHTML = `
      <div class="ins-head">
        <div><h2 class="ins-title">App insights</h2>
          <p class="ins-sub">What's happening in the app. Team numbers leave out super admin accounts. Updated ${esc(ago(d.generatedAt))} ${esc(new Date(d.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}.</p></div>
        <div class="ins-tools">
          <label class="inline-field">Last <select data-ins="days" aria-label="Time range">${RANGES.map((n) => `<option value="${n}"${n === days ? " selected" : ""}>${n} days</option>`).join("")}</select></label>
          <button type="button" class="btn btn-ghost btn-small" data-ins="reload"${loading ? " disabled" : ""}>${loading ? "Refreshing…" : "Refresh"}</button>
        </div>
      </div>

      <section class="ins-card ins-signals" aria-label="What to look at">
        <h3>Worth a look</h3>
        <ul class="ins-list">${d.signals.map((s) => `<li class="ins-${esc(s.level)}"><span class="ins-dot"></span><span>${esc(s.text)}</span></li>`).join("")}</ul>
      </section>

      <div class="kpi-strip ins-kpis">
        ${kpi("Active this week", `${d.team.active7} of ${d.team.total}`, "people with any activity in 7 days")}
        ${kpi("Claims", num(claims), `last ${d.days} days`)}
        ${kpi("Calls", num(taps + calls), `${num(taps)} taps · ${num(calls)} logged`)}
        ${kpi("Open leads", num(p.openLeads), `${num(p.overdueCallbacks)} overdue callbacks`)}
        ${kpi("Meetings held", num(held ? held.count : 0), held ? `${pct(held.ofClaimed)} of claimed` : "")}
      </div>

      <section class="ins-card"><h3>Activity per day</h3>${chart(d.adoption.daily)}</section>
      <section class="ins-card"><h3>People</h3>${people(d.adoption.people)}</section>

      <section class="ins-card"><h3>Notes you could send <small>they appear through the avatar, within a minute if the person is signed in</small></h3>${nudgeList(d.nudges || [])}</section>

      <div class="ins-grid">
        <section class="ins-card"><h3>How far claimed leads get</h3>${funnel(p.funnel)}
          <p class="ins-note">${num(p.neverContacted)} claimed ${p.neverContacted === 1 ? "lead was" : "leads were"} never contacted ${p.staleDays}+ days after claiming.</p></section>
        <section class="ins-card"><h3>Where leads sit</h3>
          ${p.statuses.length ? `<ul class="ins-list">${p.statuses.map((s) => `<li><span class="ins-dot"></span><span>${esc(s.label)}<small>${num(s.count)}</small></span></li>`).join("")}</ul>` : `<p class="ins-empty">No leads yet.</p>`}</section>
      </div>

      <div class="ins-grid">
        <section class="ins-card"><h3>Speed to first call</h3>${firstCall(p.firstCall)}</section>
        <section class="ins-card"><h3>When the team calls</h3>${heatmap(d.callAt)}</section>
      </div>

      <div class="ins-grid">
        <section class="ins-card"><h3>Which specialties convert</h3>${segments("Specialty", p.funnel.specialties)}</section>
        <section class="ins-card"><h3>Which states convert</h3>${segments("State", p.funnel.states)}</section>
      </div>

      <section class="ins-card"><h3>Claimed but never called <small>oldest first</small></h3>${stuckList(p.stuck || [])}</section>

      <div class="ins-grid">
        <section class="ins-card"><h3>Friction</h3>
          <ul class="ins-list">
            <li><span class="ins-dot"></span><span>Bad numbers flagged<small>${num(fr.badNumbers.open)} open (${num(fr.badNumbers.wrong)} wrong, ${num(fr.badNumbers.disconnected)} disconnected), ${num(fr.badNumbers.last7)} this week</small></span></li>
            <li><span class="ins-dot"></span><span>Leads sent to disconnected<small>${num(fr.disconnected.count)} (${fr.disconnected.share}% of claimed)</small></span></li>
            <li><span class="ins-dot"></span><span>Waiting on an admin<small>${esc(queueText || "unknown")}</small></span></li>
            <li><span class="ins-dot"></span><span>Claimed with no call notes<small>${num(fr.leadsWithoutNotes)}</small></span></li>
          </ul></section>
        <section class="ins-card"><h3>System health</h3>${system(d.system)}</section>
      </div>

      <section class="ins-card"><h3>What the team is asking for <small>${num(fr.suggestions.total)} suggestions, ${num(fr.suggestions.last7)} this week</small></h3>
        ${fr.suggestions.recent.length ? `<ul class="ins-quotes">${fr.suggestions.recent.map((s) => `<li><p>${esc(s.text)}</p><small>${esc(s.by || "Someone")} · ${esc(ago(s.at))}</small></li>`).join("")}</ul>` : `<p class="ins-empty">No suggestions yet.</p>`}
      </section>`;
  }

  async function refresh({ showSpinner = false } = {}) {
    if (!isSuper) return;
    loading = true;
    if (showSpinner || !data) { error = ""; render(); }
    try {
      data = await apiGet("admin/insights", { days });
      error = "";
    } catch (err) {
      console.log("[insights] " + err.message);
      if (!data) error = err.message;
    }
    loading = false;
    render();
  }

  panel?.addEventListener("click", (e) => {
    if (!isSuper) return;
    if (e.target.closest('[data-ins="reload"]')) refresh({ showSpinner: true });
    const send = e.target.closest('[data-ins="nudge"]');
    if (send) sendNudge(send);
  });

  async function sendNudge(btn) {
    const nudge = data?.nudges?.[Number(btn.dataset.i)];
    const row = btn.closest("[data-nudge]");
    const status = row.querySelector(".ins-nudge-status");
    const body = row.querySelector("textarea").value.trim();
    if (!nudge || !body) { status.textContent = "Write the note first."; return; }
    btn.disabled = true;
    status.textContent = "Sending\u2026";
    try {
      await apiPost("admin/insights/nudge", { userId: nudge.userId, body });
      status.textContent = "Sent. The avatar will show it within a minute.";
      nudge.lastNoteAt = new Date().toISOString();
    } catch (err) {
      status.textContent = err.message;
      btn.disabled = false;
    }
  }
  panel?.addEventListener("change", (e) => {
    if (!isSuper || !e.target.matches('[data-ins="days"]')) return;
    days = Number(e.target.value) || 28;
    try { localStorage.setItem(DAYS_KEY, String(days)); } catch { /* not remembered */ }
    refresh({ showSpinner: true });
  });

  /* ---------- stepping in front of Today, for a super admin only ---------- */

  const hooks = window.dmeHooks;
  const previousOnView = hooks.onView;
  hooks.onView = (view) => {
    if (isSuper && view === "today") { refresh(); return; }
    previousOnView?.(view);
  };

  async function checkFlag() {
    if (!getSession() || getSession().mustChangePassword) return;
    const known = rememberedFlag();
    if (known && !isSuper) { setFlag(true); if (state.view === "today") refresh({ showSpinner: true }); }
    try {
      const flags = await apiGet("auth/flags");
      const on = Boolean(flags.isSuperAdmin);
      if (on !== isSuper) {
        setFlag(on);
        if (state.view === "today") { on ? refresh({ showSpinner: true }) : window.dmeToday?.refresh({ showSpinner: true }); }
      } else if (on && state.view === "today") {
        refresh();
      }
    } catch (err) {
      console.log("[insights] " + err.message);
    }
  }

  const previousSignedIn = hooks.onSignedIn;
  hooks.onSignedIn = () => { previousSignedIn?.(); checkFlag(); };
  const previousSignedOut = hooks.onSignedOut;
  hooks.onSignedOut = () => {
    previousSignedOut?.();
    data = null;
    error = "";
    setFlag(false);
  };

  if (getSession()) checkFlag();
})();
