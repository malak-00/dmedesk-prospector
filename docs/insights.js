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

  const TABS = [["overview", "Overview"], ["people", "People"], ["pipeline", "Pipeline"], ["quality", "Search & errors"], ["system", "System"]];
  const TAB_KEY = "dmeInsightsTab";
  let tab = "overview";
  try { const t = localStorage.getItem(TAB_KEY); if (TABS.some(([k]) => k === t)) tab = t; } catch { /* default */ }
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

  // One table for every list on this page. With room it is a plain compact table; in a narrow card each row
  // becomes a small stacked block (see .ins-table in style.css), so nothing runs off the card.
  // cols: [{ label, num? }]; rows: arrays of ready-made (already escaped) cell html.
  function table(cols, rows) {
    return `<div class="ins-table-wrap"><table class="ins-table"><thead><tr>${cols.map((c) => `<th${c.num ? ' class="num"' : ""}>${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${rows.map((cells) => `<tr>${cells.map((html, i) => `<td data-label="${esc(cols[i].label)}"${cols[i].num ? ' class="num"' : ""}>${html}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }

  function people(list) {
    if (!list.length) return `<p class="ins-empty">No reps yet.</p>`;
    const recent = (p) => p.lastActive && Date.now() - Date.parse(p.lastActive) < 7 * 86_400_000;
    return table(
      [{ label: "Person" }, { label: "Last active" }, { label: "Vs last week" }, { label: "Claims", num: 1 }, { label: "Taps", num: 1 }, { label: "Calls", num: 1 }, { label: "Searches", num: 1 }, { label: "Open leads", num: 1 }, { label: "Never called", num: 1 }, { label: "Overdue", num: 1 }],
      list.map((p) => [
        `${esc(p.name)}${p.isAdmin ? ' <span class="reminder-badge reminder-upcoming">admin</span>' : ""}`,
        recent(p) ? esc(ago(p.lastActive)) : `<span class="ins-dim">${esc(ago(p.lastActive))}</span>`,
        trend(p),
        num(p.claims), num(p.dials), num(p.calls), num(p.searches), num(p.openLeads), num(p.neverContacted), num(p.overdue),
      ]),
    );
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
    return table(
      [{ label: title }, { label: "Claimed", num: 1 }, { label: "Called", num: 1 }, { label: "Meetings held", num: 1 }, { label: "Onboarded", num: 1 }],
      rows.map((r) => [esc(r.label), num(r.claimed), pct(r.contacted / r.claimed), pct(r.held / r.claimed), pct(r.won / r.claimed)]),
    );
  }

  function stuckList(list) {
    if (!list.length) return `<p class="ins-empty">Nothing stuck. Every claimed lead has been called or updated.</p>`;
    return table(
      [{ label: "Lead" }, { label: "Claimed by" }, { label: "Waiting", num: 1 }],
      list.map((l) => [esc(l.company), esc(l.rep), `${num(l.days)} days`]),
    );
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

  // Territory map: one tile per state in a rough map layout, shaded by the chosen measure.
  const TILES = {
    AK: [0, 0], ME: [0, 10], VT: [1, 9], NH: [1, 10],
    WA: [2, 0], ID: [2, 1], MT: [2, 2], ND: [2, 3], MN: [2, 4], IL: [2, 5], WI: [2, 6], MI: [2, 7], NY: [2, 8], RI: [2, 9], MA: [2, 10],
    OR: [3, 0], NV: [3, 1], WY: [3, 2], SD: [3, 3], IA: [3, 4], IN: [3, 5], OH: [3, 6], PA: [3, 7], NJ: [3, 8], CT: [3, 9],
    CA: [4, 0], UT: [4, 1], CO: [4, 2], NE: [4, 3], MO: [4, 4], KY: [4, 5], WV: [4, 6], VA: [4, 7], MD: [4, 8], DE: [4, 9],
    AZ: [5, 1], NM: [5, 2], KS: [5, 3], AR: [5, 4], TN: [5, 5], NC: [5, 6], SC: [5, 7], DC: [5, 8],
    OK: [6, 3], LA: [6, 4], MS: [6, 5], AL: [6, 6], GA: [6, 7],
    HI: [7, 0], TX: [7, 3], FL: [7, 7],
  };
  const TERRITORY_MEASURES = [
    { key: "claimed", label: "Leads claimed", value: (r) => r.claimed, show: (v) => num(v) },
    { key: "pickup", label: "Pickup rate", value: (r) => r.pickup, show: (v) => pct(v) },
    { key: "meeting", label: "Meetings booked", value: (r) => r.meeting, show: (v) => pct(v) },
    { key: "win", label: "Onboarded", value: (r) => r.win, show: (v) => pct(v) },
  ];
  let territoryMeasure = "claimed";

  function territoryMap(t) {
    if (!t || !t.states || !t.states.length) return `<p class="ins-empty">No claimed leads with a state yet.</p>`;
    const measure = TERRITORY_MEASURES.find((m) => m.key === territoryMeasure) || TERRITORY_MEASURES[0];
    const byState = new Map(t.states.map((r) => [r.state, r]));
    const values = t.states.map(measure.value).filter((v) => v != null);
    const max = Math.max(...values, 0.0001);
    const tiles = Object.entries(TILES).map(([st, [row, col]]) => {
      const r = byState.get(st);
      const v = r ? measure.value(r) : null;
      const tip = r
        ? `${st}: ${num(r.claimed)} claimed, ${r.calls} logged calls (${r.pickup == null ? "pickup rate needs " + 5 + "+ calls" : pct(r.pickup) + " picked up"}), ${num(r.booked)} meetings booked, ${num(r.won)} onboarded`
        : `${st}: nothing claimed`;
      const a = v == null ? 0 : Math.max(0.12, v / max);
      return `<span class="ins-tile${r ? "" : " is-empty"}${r && v == null ? " is-na" : ""}${a > 0.55 ? " is-hot" : ""}" style="grid-row:${row + 1};grid-column:${col + 1};--a:${a.toFixed(2)}" title="${esc(tip)}"><b>${st}</b><small>${v == null ? "" : measure.show(v)}</small></span>`;
    }).join("");
    const known = new Set(Object.keys(TILES));
    const other = t.states.filter((r) => !known.has(r.state));
    return `<div class="ins-terr-toggle" role="group" aria-label="Measure">${TERRITORY_MEASURES.map((m) =>
      `<button type="button" class="choice-chip${m.key === territoryMeasure ? " active" : ""}" data-ins="territory" data-measure="${m.key}">${esc(m.label)}</button>`).join("")}</div>
      <div class="ins-tiles" role="img" aria-label="Map of states shaded by ${esc(measure.label)}">${tiles}</div>
      <p class="ins-note">Last ${num(t.days)} days. Darker means more. A state shows a pickup rate only after 5 logged calls there.${other.length ? ` Also: ${esc(other.map((r) => `${r.state} (${num(r.claimed)})`).join(", "))}.` : ""}</p>
      ${table(
        [{ label: "State" }, { label: "Claimed", num: 1 }, { label: "Calls", num: 1 }, { label: "Pickup", num: 1 }, { label: "Meetings booked", num: 1 }, { label: "Onboarded", num: 1 }],
        t.states.slice(0, 15).map((r) => [esc(r.state), num(r.claimed), num(r.calls), r.pickup == null ? "\u2014" : pct(r.pickup), pct(r.meeting), pct(r.win)]),
      )}`;
  }

  function nudgeList(list) {
    if (!list.length) return `<p class="ins-empty">Nobody needs a nudge right now.</p>`;
    return `<ul class="ins-nudges">${list.map((n, i) => `
      <li data-nudge="${i}"><div class="ins-nudge-head"><strong>${esc(n.name)}</strong><span class="reminder-badge reminder-upcoming">${esc(n.reason)}</span>
        ${n.lastNoteAt ? `<small class="ins-dim">Note sent ${esc(ago(n.lastNoteAt))}</small>` : ""}</div>
        <textarea rows="2" maxlength="500" aria-label="Note to ${esc(n.name)}">${esc(n.text)}</textarea>
        <div class="ins-nudge-actions"><button type="button" class="btn btn-primary btn-small" data-ins="nudge" data-i="${i}">Send as avatar note</button><span class="ins-nudge-status" aria-live="polite"></span></div></li>`).join("")}</ul>`;
  }

  const NOT_COLLECTING = `<p class="ins-empty">Not collecting yet. Run sql/046_app_events.sql in Supabase, then this fills in as people use the app.</p>`;

  function searchQuality(u) {
    if (!u) return NOT_COLLECTING;
    const s = u.searches;
    if (!s.total) return `<p class="ins-empty">No searches recorded in this period yet.</p>`;
    const sec = (ms) => (ms === null ? "n/a" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
    return `<ul class="ins-list">
        <li class="${s.zeroShare >= 25 ? "ins-warn" : ""}"><span class="ins-dot"></span><span>Searches that found nothing<small>${num(s.zero)} of ${num(s.total)} (${s.zeroShare}%)</small></span></li>
        <li><span class="ins-dot"></span><span>Typical speed<small>median ${sec(s.medianMs)}, slowest 1 in 20 over ${sec(s.p95Ms)}; ${num(s.slow)} took 5 s or more</small></span></li></ul>
      ${s.zeroTop.length ? table(
        [{ label: "Empty searches by" }, { label: "Where" }, { label: "Filters on" }, { label: "Times", num: 1 }],
        s.zeroTop.map((r) => [esc(r.specialty), esc(r.states), esc(r.filters || "none"), num(r.count)]),
      ) : ""}`;
  }

  function featureUsage(u) {
    if (!u) return NOT_COLLECTING;
    const used = u.features.filter((f) => f.uses);
    const unused = u.features.filter((f) => !f.uses);
    const max = Math.max(1, ...used.map((f) => f.uses));
    return `${used.length ? `<div class="ins-funnel">${used.map((f) => `
      <div class="ins-funnel-row ins-feature-row"><span class="ins-funnel-label" title="${esc(f.label)}">${esc(f.label)}</span>
        <span class="ins-funnel-track"><span class="ins-funnel-fill" style="width:${Math.max(2, Math.round((f.uses / max) * 100))}%"></span></span>
        <span class="ins-funnel-num">${num(f.uses)} <small>${num(f.people)} ${f.people === 1 ? "person" : "people"}</small></span></div>`).join("")}</div>` : `<p class="ins-empty">No feature use recorded yet.</p>`}
      ${unused.length ? `<p class="ins-note"><strong>Not used in ${u.span} days:</strong> ${esc(unused.map((f) => f.label.toLowerCase()).join(", "))}.</p>` : ""}`;
  }

  function errorList(u) {
    if (!u) return NOT_COLLECTING;
    if (!u.errors.total) return `<p class="ins-note ins-allgood">No failed requests in this period.</p>`;
    return `<p class="ins-note">${num(u.errors.total)} failed, ${num(u.errors.last7)} in the last 7 days.</p>
      ${table(
        [{ label: "Request" }, { label: "Status" }, { label: "Times", num: 1 }, { label: "People", num: 1 }, { label: "Last seen" }, { label: "Message" }],
        u.errors.top.map((e) => [esc(e.name), esc(e.status), num(e.count), num(e.people), esc(ago(e.last)), esc(e.message)]),
      )}`;
  }

  function system(sys) {
    if (!sys) return `<p class="ins-empty">System details unavailable.</p>`;
    const checks = [
      ...(sys.integrations || []).map((i) => ({ ok: i.configured, label: i.label, note: i.configured ? i.note : "Not connected" })),
      ...(sys.installed || []).map((i) => ({ ok: i.installed, label: i.label, note: i.installed ? "" : `Not installed (${i.note})` })),
    ];
    const row = (c) => `<li class="${c.ok ? "ins-ok" : "ins-bad"}"><span class="ins-dot"></span><span>${esc(c.label)}<small>${esc(c.note)}</small></span></li>`;
    const bad = checks.filter((c) => !c.ok);
    const good = checks.filter((c) => c.ok);
    return `${bad.length ? `<ul class="ins-list">${bad.map(row).join("")}</ul>` : `<p class="ins-note ins-allgood">All ${checks.length} checks are fine.</p>`}
      <details class="ins-details"><summary>${good.length} working</summary><ul class="ins-list">${good.map(row).join("")}
        <li class="ins-ok"><span class="ins-dot"></span><span>Search source<small>${esc(sys.searchSource || "unknown")}</small></span></li></ul></details>`;
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

    const sec = (title, body, extra = "") => `<section class="ins-card"><h3>${title}</h3>${body}${extra}</section>`;
    const pane = (key, html) => `<div class="ins-pane" data-ins-pane="${key}"${key === tab ? "" : " hidden"}>${html}</div>`;
    const dataIssues = p.funnel.specialties.find((r) => r.label === "Unknown specialty");

    panel.innerHTML = `
      <div class="ins-wrap">
      <div class="ins-head">
        <div><h2 class="ins-title">App insights</h2>
          <p class="ins-sub">What's happening in the app. Team numbers leave out super admin and integration accounts. Updated ${esc(new Date(d.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}.</p></div>
        <div class="ins-tools">
          <label class="inline-field">Last <select data-ins="days" aria-label="Time range">${RANGES.map((n) => `<option value="${n}"${n === days ? " selected" : ""}>${n} days</option>`).join("")}</select></label>
          <button type="button" class="btn btn-ghost btn-small" data-ins="reload"${loading ? " disabled" : ""}>${loading ? "Refreshing…" : "Refresh"}</button>
        </div>
      </div>

      <div class="admin-seg ins-tabs" role="tablist" aria-label="Insight sections">${TABS.map(([k, label]) => `<button type="button" class="admin-seg-btn${k === tab ? " is-active" : ""}" role="tab" data-ins-tab="${k}" aria-selected="${k === tab}">${label}${k === "quality" && d.usage && d.usage.errors.last7 ? ` <span class="ins-pill">${d.usage.errors.last7}</span>` : ""}${k === "people" && (d.nudges || []).length ? ` <span class="ins-pill">${d.nudges.length}</span>` : ""}</button>`).join("")}</div>

      ${pane("overview", `
        <section class="ins-card ins-signals" aria-label="What to look at"><h3>Worth a look</h3>
          <ul class="ins-list">${d.signals.map((s) => `<li class="ins-${esc(s.level)}"><span class="ins-dot"></span><span>${esc(s.text)}</span></li>`).join("")}</ul></section>
        <div class="kpi-strip ins-kpis">
          ${kpi("Active this week", `${d.team.active7} of ${d.team.total}`, "people with any activity in 7 days")}
          ${kpi("Claims", num(claims), `last ${d.days} days`)}
          ${kpi("Calls", num(taps + calls), `${num(taps)} taps \u00b7 ${num(calls)} logged`)}
          ${kpi("Open leads", num(p.openLeads), `${num(p.overdueCallbacks)} overdue callbacks`)}
          ${kpi("Meetings held", num(held ? held.count : 0), held ? `${pct(held.ofClaimed)} of claimed` : "")}
        </div>
        ${sec("Activity per day", chart(d.adoption.daily))}
        ${sec(`What the team is asking for <small>${num(fr.suggestions.total)} suggestions, ${num(fr.suggestions.last7)} this week</small>`,
          fr.suggestions.recent.length ? `<ul class="ins-quotes">${fr.suggestions.recent.map((s) => `<li><p>${esc(s.text)}</p><small>${esc(s.by || "Someone")} \u00b7 ${esc(ago(s.at))}</small></li>`).join("")}</ul>` : `<p class="ins-empty">No suggestions yet.</p>`)}`)}

      ${pane("people", `
        ${sec("People", people(d.adoption.people))}
        ${sec('Notes you could send <small>they appear through the avatar within a minute if the person is signed in</small>', nudgeList(d.nudges || []))}
        <div class="ins-grid">
          ${sec("Speed to first call", firstCall(p.firstCall))}
          ${sec("When the team calls", heatmap(d.callAt))}
        </div>`)}

      ${pane("pipeline", `
        <div class="ins-grid">
          ${sec("How far claimed leads get", funnel(p.funnel), `<p class="ins-note">${num(p.neverContacted)} claimed ${p.neverContacted === 1 ? "lead was" : "leads were"} never contacted ${p.staleDays}+ days after claiming.</p>`)}
          ${sec("Where leads sit", p.statuses.length ? `<ul class="ins-list">${p.statuses.map((s) => `<li><span class="ins-dot"></span><span>${esc(s.label)}<small>${num(s.count)}</small></span></li>`).join("")}</ul>` : `<p class="ins-empty">No leads yet.</p>`)}
        </div>
        <div class="ins-grid">
          ${sec("Which specialties convert", segments("Specialty", p.funnel.specialties), dataIssues ? `<p class="ins-note">${num(dataIssues.claimed)} claimed leads have no specialty recorded, so they can't be broken down.</p>` : "")}
          ${sec("Which states convert", segments("State", p.funnel.states))}
        </div>
        ${sec("Territory map", territoryMap(d.territory))}
        ${sec('Claimed but never called <small>oldest first</small>', stuckList(p.stuck || []))}`)}

      ${pane("quality", `
        <div class="ins-grid">
          ${sec("Search quality", searchQuality(d.usage))}
          ${sec("Which features get used", featureUsage(d.usage))}
        </div>
        ${sec("Errors", errorList(d.usage))}
        ${sec("Friction", `<ul class="ins-list">
            <li><span class="ins-dot"></span><span>Bad numbers flagged<small>${num(fr.badNumbers.open)} open (${num(fr.badNumbers.wrong)} wrong, ${num(fr.badNumbers.disconnected)} disconnected), ${num(fr.badNumbers.last7)} this week</small></span></li>
            <li><span class="ins-dot"></span><span>Leads sent to disconnected<small>${num(fr.disconnected.count)} (${fr.disconnected.share}% of claimed)</small></span></li>
            <li><span class="ins-dot"></span><span>Waiting on an admin<small>${esc(queueText || "unknown")}</small></span></li>
            <li><span class="ins-dot"></span><span>Claimed with no call notes<small>${num(fr.leadsWithoutNotes)}</small></span></li></ul>`)}`)}

      ${pane("system", sec("System health", system(d.system)))}
      </div>`;
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
    const tabBtn = e.target.closest("[data-ins-tab]");
    if (tabBtn) {
      tab = tabBtn.dataset.insTab;
      try { localStorage.setItem(TAB_KEY, tab); } catch { /* not remembered */ }
      panel.querySelectorAll("[data-ins-tab]").forEach((b) => { const on = b.dataset.insTab === tab; b.classList.toggle("is-active", on); b.setAttribute("aria-selected", String(on)); });
      panel.querySelectorAll("[data-ins-pane]").forEach((x) => { x.hidden = x.dataset.insPane !== tab; });
    }
    const send = e.target.closest('[data-ins="nudge"]');
    if (send) sendNudge(send);
    const measure = e.target.closest('[data-ins="territory"]');
    if (measure) { territoryMeasure = measure.dataset.measure; render(); }
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
