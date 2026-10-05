/* Team activity (Admin tab): calls, meetings and claims per rep, plus a weekly chart.
   Data comes from GET admin/team-activity, which the Worker builds from the
   ownership history and the dated lines of each lead's call log.
   Loaded after app.js; the segmented control switches the Admin tab between
   this view and the existing review queues. */
(function () {
  "use strict";

  const panel = document.getElementById("teamPanel");
  const queues = document.getElementById("adminQueuesPanel");
  const SEG_KEY = "dmeProspectorAdminSeg"; // "team" | "queues"
  const RANGE_KEY = "dmeProspectorTeamWeeks";
  const RANGES = [4, 8, 12];

  let seg = "queues";
  let weeks = 8;
  let data = null;
  let loading = false;
  let error = "";

  try {
    if (localStorage.getItem(SEG_KEY) === "team") seg = "team";
    const saved = Number(localStorage.getItem(RANGE_KEY));
    if (RANGES.includes(saved)) weeks = saved;
  } catch { /* storage blocked: defaults apply for this page view */ }

  const sum = (list) => (list || []).reduce((a, b) => a + b, 0);
  const num = (n) => Number(n || 0).toLocaleString();

  function applySeg() {
    document.querySelectorAll("[data-admin-seg]").forEach((btn) => {
      const on = btn.dataset.adminSeg === seg;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", String(on));
    });
    if (panel) panel.hidden = seg !== "team";
    if (queues) queues.hidden = seg !== "queues";
    if (seg === "team" && state.view === "admin") load();
  }

  async function load() {
    if (loading) return;
    loading = true;
    error = "";
    render();
    try {
      data = await apiGet("admin/team-activity", { weeks });
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
      render();
    }
  }

  /* ---------- rendering ---------- */

  function totalsRow(label, value, sub) {
    return `<div class="stat-card"><span class="stat-value">${num(value)}</span><span class="stat-label">${escapeHtml(label)}</span>${sub ? `<span class="team-stat-sub">${escapeHtml(sub)}</span>` : ""}</div>`;
  }

  function chartHtml(d) {
    const series = [
      { key: "calls", label: "Calls", cls: "is-calls", values: d.totals.calls },
      { key: "meetingsHeld", label: "Meetings held", cls: "is-meetings", values: d.totals.meetingsHeld },
      { key: "claims", label: "Claims", cls: "is-claims", values: d.totals.claims },
    ];
    const stacks = d.weeks.map((_, i) => series.reduce((total, s) => total + (s.values[i] || 0), 0));
    const max = Math.max(1, ...stacks);
    const cols = d.weeks.map((w, i) => {
      const parts = series.map((s) => {
        const v = s.values[i] || 0;
        return v ? `<span class="team-seg ${s.cls}" style="height:${(v / max) * 100}%" title="${escapeHtml(`${s.label}: ${v}`)}"></span>` : "";
      }).join("");
      const detail = series.map((s) => `${s.label} ${s.values[i] || 0}`).join(", ");
      return `<div class="team-col" title="${escapeHtml(`Week of ${w.label}: ${detail}`)}">
        <span class="team-col-total">${stacks[i] || ""}</span>
        <div class="team-bar">${parts}</div>
        <span class="team-col-label">${escapeHtml(w.label)}</span>
      </div>`;
    }).join("");
    const legend = series.map((s) => `<span class="team-legend-item"><i class="team-swatch ${s.cls}"></i>${s.label}</span>`).join("");
    return `<div class="team-chart" role="img" aria-label="Weekly activity, stacked by calls, meetings held and claims">
      <div class="team-chart-bars" style="--cols:${d.weeks.length}">${cols}</div>
      <div class="team-legend">${legend}</div>
    </div>`;
  }

  function tableHtml(d) {
    const rows = d.reps.map((r) => {
      const calls = sum(r.calls);
      const held = sum(r.meetingsHeld);
      const booked = sum(r.meetingsBooked);
      const claims = sum(r.claims);
      const noShows = sum(r.noShows);
      return `<tr>
        <td><span class="team-rep">${escapeHtml(r.name)}</span>${r.isAdmin ? ' <span class="reminder-badge reminder-upcoming">admin</span>' : ""}</td>
        <td class="mono">${num(calls)}</td>
        <td class="mono">${num(held)}${noShows ? `<span class="team-muted"> / ${noShows} no-show</span>` : ""}</td>
        <td class="mono">${num(booked)}</td>
        <td class="mono">${num(claims)}</td>
        <td class="mono">${num(r.openLeads)}</td>
        <td class="mono">${r.overdue ? `<span class="team-overdue">${num(r.overdue)}</span>` : "0"}</td>
        <td class="mono">${num(r.upcomingMeetings)}</td>
      </tr>`;
    }).join("");
    return `<div class="table-wrap"><table class="results-table team-table">
      <thead><tr>
        <th>Rep</th><th>Calls</th><th>Meetings held</th><th>Booked</th><th>Claims</th>
        <th title="Claimed and still open right now">Open leads</th><th title="Callbacks past their time right now">Overdue</th><th title="Meetings still ahead right now">Meetings ahead</th>
      </tr></thead>
      <tbody>${rows || '<tr class="empty-row"><td colspan="8">No reps yet.</td></tr>'}</tbody>
    </table></div>`;
  }

  function render() {
    if (!panel) return;
    const rangeOptions = RANGES.map((n) => `<option value="${n}"${n === weeks ? " selected" : ""}>Last ${n} weeks</option>`).join("");
    let body;
    if (error) {
      body = `<div class="team-state">${escapeHtml(error)} <button type="button" class="link-btn" data-team="reload">Try again</button></div>`;
    } else if (!data) {
      body = `<div class="team-state"><span class="spinner"></span> Loading team activity…</div>`;
    } else {
      body = `
        <div class="admin-stats team-stats">
          ${totalsRow("Calls", sum(data.totals.calls), `last ${data.weeks.length} weeks`)}
          ${totalsRow("Meetings held", sum(data.totals.meetingsHeld))}
          ${totalsRow("Meetings booked", sum(data.totals.meetingsBooked))}
          ${totalsRow("Claims", sum(data.totals.claims))}
        </div>
        <div class="team-grid">
          <div class="team-block"><h4>By week</h4>${chartHtml(data)}</div>
          <div class="team-block team-block-table"><h4>By rep</h4>${tableHtml(data)}</div>
        </div>
        <p class="team-foot">Calls are the dated lines in each lead's call log, so they count what was written down. Claims come from the ownership history. Weeks start on Monday (UTC). Open leads, overdue and meetings ahead are as of now.</p>`;
    }
    panel.innerHTML = `
      <div class="results-toolbar team-toolbar">
        <div class="results-meta">
          <div class="results-count">Team activity</div>
          <div class="results-sub">Calls, meetings and claims per rep</div>
        </div>
        <div class="results-actions">
          <label class="inline-field"><span>Show</span><select data-team="range" ${loading ? "disabled" : ""}>${rangeOptions}</select></label>
          <button type="button" class="btn btn-ghost" data-team="reload" ${loading ? "disabled" : ""}>
            <svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 1.5v3h-3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>Refresh</span>
          </button>
        </div>
      </div>
      <div class="team-body${loading && data ? " is-stale" : ""}">${body}</div>`;
  }

  /* ---------- wiring ---------- */

  document.querySelectorAll("[data-admin-seg]").forEach((btn) => btn.addEventListener("click", () => {
    seg = btn.dataset.adminSeg;
    try { localStorage.setItem(SEG_KEY, seg); } catch { /* the choice just won't be remembered */ }
    applySeg();
  }));

  panel?.addEventListener("click", (e) => {
    if (e.target.closest('[data-team="reload"]')) load();
  });
  panel?.addEventListener("change", (e) => {
    if (!e.target.matches('[data-team="range"]')) return;
    weeks = Number(e.target.value);
    try { localStorage.setItem(RANGE_KEY, String(weeks)); } catch { /* ignore */ }
    load();
  });

  const previousOnView = window.dmeHooks.onView;
  window.dmeHooks.onView = (view) => {
    previousOnView?.(view);
    if (view === "admin") applySeg();
  };
  const previousSignedOut = window.dmeHooks.onSignedOut;
  window.dmeHooks.onSignedOut = () => {
    previousSignedOut?.();
    data = null;
    error = "";
    if (panel) panel.innerHTML = "";
  };

  applySeg();

  /* ---------- collapsible sections in Review queues ---------- */
  // Each section is a toolbar plus whatever follows it up to the next toolbar.
  const FOLD_KEY = "dmeProspectorAdminFolded";
  let folded = [];
  try { folded = JSON.parse(localStorage.getItem(FOLD_KEY)) || []; } catch { /* nothing remembered */ }

  function setFolded(toolbar, fold) {
    toolbar.querySelector(".admin-collapse")?.setAttribute("aria-expanded", String(!fold));
    for (let el = toolbar.nextElementSibling; el && !el.classList.contains("results-toolbar"); el = el.nextElementSibling) {
      el.classList.toggle("admin-folded", fold);
    }
  }

  function makeCollapsible() {
    if (!queues) return;
    queues.querySelectorAll(".results-toolbar").forEach((toolbar) => {
      const title = toolbar.querySelector(".results-count");
      const meta = toolbar.querySelector(".results-meta");
      if (!title || !meta) return;
      const name = title.textContent.trim();
      toolbar.classList.add("has-collapse");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "admin-collapse";
      btn.setAttribute("aria-label", `Collapse or expand ${name}`);
      btn.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      meta.prepend(btn);
      const toggle = () => {
        const fold = btn.getAttribute("aria-expanded") !== "false";
        setFolded(toolbar, fold);
        folded = fold ? [...new Set([...folded, name])] : folded.filter((n) => n !== name);
        try { localStorage.setItem(FOLD_KEY, JSON.stringify(folded)); } catch { /* not remembered */ }
      };
      btn.addEventListener("click", toggle);
      title.addEventListener("click", toggle);
      setFolded(toolbar, folded.includes(name));
    });
  }
  makeCollapsible();
})();
