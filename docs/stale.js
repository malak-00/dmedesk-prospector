/* Stale leads (Admin tab): claimed leads nobody has touched for a while, so an admin can hand them back to Prospect or give them to another rep.
   Stale means what it means on a rep's Today screen: quiet for N days, no meeting or callback coming up, not won, lost or refused.
   GET admin/stale-leads lists them; POST admin/stale-leads/hand-back returns the ticked ones using the same release
   function a rep's own "Return to Prospect" uses, so the lead's history stays and anyone can claim it again.
   Loaded after team.js, which shows this panel when the "Stale leads" button is chosen. */
(function () {
  "use strict";

  const panel = document.getElementById("stalePanel");
  if (!panel) return;

  const DAYS_KEY = "dmeStaleHandbackDays";
  const RANGES = [14, 30, 60, 90, 180];
  let days = 30;
  try { const d = Number(localStorage.getItem(DAYS_KEY)); if (RANGES.includes(d)) days = d; } catch { /* default */ }
  let data = null;
  let loading = false;
  let error = "";
  const filters = { rep: "", status: "", state: "", specialty: "", q: "" };
  let sortKey = "quiet";
  let sortDir = "desc";
  let busy = false;
  let users = []; // active accounts a lead can be reassigned to
  let targetId = "";
  const picked = new Set();

  const num = (n) => Number(n || 0).toLocaleString();
  const esc = (s) => escapeHtml(String(s ?? ""));
  const norm = (v) => String(v ?? "").trim().toLowerCase();
  const VALUE = { name: (i) => norm(i.name), rep: (i) => norm(i.rep), status: (i) => norm(i.status), state: (i) => norm(i.state), specialty: (i) => norm(i.specialty), quiet: (i) => i.quietDays };
  // Each filter matches the column's exact value; the search box matches the company name or NPI.
  function visible() {
    const q = norm(filters.q);
    const list = ((data && data.items) || []).filter((i) =>
      (!filters.rep || i.repId === filters.rep) && (!filters.status || norm(i.status) === filters.status) &&
      (!filters.state || norm(i.state) === filters.state) && (!filters.specialty || norm(i.specialty) === filters.specialty) &&
      (!q || norm(i.name).includes(q) || i.npi.includes(q)));
    const get = VALUE[sortKey] || VALUE.quiet;
    const sign = sortDir === "asc" ? 1 : -1;
    return list.sort((a, b) => {
      const x = get(a), y = get(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sign || VALUE.name(a).localeCompare(VALUE.name(b));
    });
  }
  // The values a column holds across every stale lead, with how many leads have each, for its filter list.
  function valuesOf(field) {
    const counts = new Map();
    for (const i of (data && data.items) || []) {
      const v = String(i[field] ?? "").trim();
      if (v) counts.set(norm(v), { label: v, count: (counts.get(norm(v))?.count || 0) + 1 });
    }
    return [...counts.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label));
  }
  const filterSelect = (key, label, field) => `<label class="inline-field">${label} <select data-stale-filter="${key}"><option value="">All</option>${valuesOf(field).map(([v, o]) => `<option value="${esc(v)}"${filters[key] === v ? " selected" : ""}>${esc(o.label)} (${num(o.count)})</option>`).join("")}</select></label>`;
  const sortTh = (key, label, cls = "") => `<th${cls ? ` class="${cls}"` : ""} aria-sort="${sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}"><button type="button" class="link-btn" data-stale-sort="${key}" title="Sort by ${label}">${label}${sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}</button></th>`;

  async function load() {
    if (loading) return;
    loading = true;
    error = "";
    render();
    try {
      const [list, people] = await Promise.all([apiGet("admin/stale-leads", { days }), users.length ? null : apiGet("admin/users").catch(() => null)]);
      data = list;
      if (people && people.users) users = people.users.filter((u) => !u.disabled);
      const still = new Set(data.items.map((i) => i.npi));
      [...picked].forEach((n) => { if (!still.has(n)) picked.delete(n); });
    } catch (err) {
      error = err.message;
    }
    loading = false;
    render();
  }

  function render() {
    let body;
    if (error) {
      body = `<div class="team-state">${esc(error)} <button type="button" class="link-btn" data-stale="reload">Try again</button></div>`;
    } else if (!data) {
      body = `<div class="team-state"><span class="spinner"></span> Looking for quiet leads…</div>`;
    } else if (!data.total) {
      body = `<div class="team-state">No claimed leads have been quiet for ${num(days)}+ days. Nothing to hand back.</div>`;
    } else {
      const list = visible();
      const chosen = list.filter((i) => picked.has(i.npi));
      const allOn = list.length > 0 && chosen.length === list.length;
      const filtered = Object.values(filters).some(Boolean);
      body = `
        <p class="ins-note" style="margin-top:0"><strong>${num(data.total)}</strong> claimed lead${data.total === 1 ? "" : "s"} quiet for ${num(days)}+ days${data.total > data.items.length ? ` (the ${num(data.items.length)} quietest are shown)` : ""}.
          Tick the ones to act on. Notes and history always stay with the lead.</p>
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin:10px 0">
          <input type="search" class="input-small" data-stale-filter="q" placeholder="Company or NPI" value="${esc(filters.q)}" aria-label="Search company or NPI">
          <label class="inline-field">Rep <select data-stale-filter="rep"><option value="">All</option>${data.reps.map((r) => `<option value="${esc(r.repId)}"${r.repId === filters.rep ? " selected" : ""}>${esc(r.rep)} (${num(r.count)})</option>`).join("")}</select></label>
          ${filterSelect("status", "Status", "status")}${filterSelect("state", "State", "state")}${filterSelect("specialty", "Specialty", "specialty")}
          ${filtered ? `<button type="button" class="link-btn" data-stale="clear-filters">Clear filters</button>` : ""}
          <span class="muted-note">${num(list.length)} shown</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:10px 0">
          <label class="inline-field">Give to <select data-stale="target"><option value="">Choose a rep…</option>${users.map((u) => `<option value="${esc(u.id)}"${u.id === targetId ? " selected" : ""}>${esc(u.displayName || u.username)}</option>`).join("")}</select></label>
          <button type="button" class="btn btn-ghost btn-small" data-stale="reassign"${chosen.length && targetId && !busy ? "" : " disabled"} title="Moves the business to that rep. Notes and history stay, and a note records who moved it.">Reassign${chosen.length ? " " + num(chosen.length) : ""}</button>
          <button type="button" class="btn btn-ghost btn-small" data-stale="disconnect"${chosen.length && !busy ? "" : " disabled"} title="For leads that can't be reached or aren't worth calling. They leave the rep's Claimed list and go to Disconnected.">${busy ? "Working…" : `Send ${chosen.length ? num(chosen.length) + " " : ""}to Disconnected`}</button>
          <button type="button" class="btn btn-primary btn-small" data-stale="hand-back"${chosen.length && !busy ? "" : " disabled"}>${busy ? "Working…" : `Hand back ${chosen.length ? num(chosen.length) : ""} to Prospect`}</button>
        </div>
        <div class="ins-table-wrap"><table class="ins-table"><thead><tr>
          <th style="width:34px"><input type="checkbox" data-stale="all" aria-label="Tick every lead shown"${allOn ? " checked" : ""}></th>
          ${sortTh("name", "Company")}${sortTh("rep", "Rep")}${sortTh("status", "Status")}${sortTh("state", "State")}${sortTh("specialty", "Specialty")}${sortTh("quiet", "Quiet", "num")}</tr></thead><tbody>${list.length ? list.map((i) => `
          <tr><td data-label="" style="width:34px"><input type="checkbox" data-stale-npi="${esc(i.npi)}" aria-label="Tick ${esc(i.name)}"${picked.has(i.npi) ? " checked" : ""}></td>
            <td data-label="Company">${esc(i.name)}<div class="muted-note mono">${esc(i.npi)}</div></td>
            <td data-label="Rep">${esc(i.rep)}</td><td data-label="Status">${esc(i.status)}</td><td data-label="State">${esc(i.state)}</td><td data-label="Specialty">${esc(i.specialty)}</td>
            <td data-label="Quiet" class="num">${num(i.quietDays)} days</td></tr>`).join("") : `<tr class="empty-row"><td colspan="7">No leads match these filters.</td></tr>`}</tbody></table></div>`;
    }
    panel.innerHTML = `
      <div class="results-toolbar team-toolbar">
        <div class="results-meta"><div class="results-count">Stale leads</div><div class="results-sub">Claimed leads nobody is working</div></div>
        <div class="results-actions">
          <label class="inline-field">Quiet for at least <select data-stale="days">${RANGES.map((n) => `<option value="${n}"${n === days ? " selected" : ""}>${n} days</option>`).join("")}</select></label>
          <button type="button" class="btn btn-ghost btn-small" data-stale="reload"${loading ? " disabled" : ""}>${loading ? "Refreshing…" : "Refresh"}</button>
        </div>
      </div>
      <div class="team-body">${body}</div>`;
  }

  async function handBack() {
    const chosen = visible().filter((i) => picked.has(i.npi));
    if (!chosen.length || busy) return;
    const reps = new Set(chosen.map((i) => i.rep)).size;
    if (!confirm(`Hand ${chosen.length} lead${chosen.length === 1 ? "" : "s"} from ${reps} rep${reps === 1 ? "" : "s"} back to Prospect?\n\nThey leave the rep's Claimed list. Notes and history stay with the lead, and anyone can claim it again.`)) return;
    busy = true;
    render();
    try {
      const out = await apiPost("admin/stale-leads/hand-back", { npis: chosen.map((i) => i.npi), days });
      showToast(`Handed back ${num(out.returned)} lead${out.returned === 1 ? "" : "s"}${out.leftAlone ? `. ${num(out.leftAlone)} had been worked since, so they stayed` : ""}`);
      picked.clear();
      state.claimedLoaded = false; // the Claimed views are stale now
    } catch (err) {
      showToast(err.message, true);
    }
    busy = false;
    data = null;
    load();
  }

  async function disconnect() {
    const chosen = visible().filter((i) => picked.has(i.npi));
    if (!chosen.length || busy) return;
    if (!confirm(`Send ${chosen.length} lead${chosen.length === 1 ? "" : "s"} to Disconnected?\n\nThey leave the rep's Claimed list and are marked disconnected, so nobody is asked to call them. Notes and history stay with the lead.`)) return;
    busy = true;
    render();
    try {
      const out = await apiPost("admin/stale-leads/disconnect", { npis: chosen.map((i) => i.npi), days });
      showToast(`Sent ${num(out.disconnected)} lead${out.disconnected === 1 ? "" : "s"} to Disconnected${out.leftAlone ? `. ${num(out.leftAlone)} had been worked since, so they stayed` : ""}`);
      picked.clear();
      state.claimedLoaded = false;
    } catch (err) {
      showToast(err.message, true);
    }
    busy = false;
    data = null;
    load();
  }

  async function reassign() {
    const chosen = visible().filter((i) => picked.has(i.npi));
    const who = users.find((u) => u.id === targetId);
    if (!chosen.length || !who || busy) return;
    const name = who.displayName || who.username;
    if (!confirm(`Give ${chosen.length} lead${chosen.length === 1 ? "" : "s"} to ${name}?

The whole business moves with each lead, so a business is never split between two reps. Notes and history stay, and a note records who moved it. It will not count as ${name}'s own calls.`)) return;
    busy = true;
    render();
    try {
      const out = await apiPost("admin/stale-leads/reassign", { npis: chosen.map((i) => i.npi), toUserId: targetId, days });
      const left = out.leftAlone + out.noGroup + out.skipped;
      showToast(`Gave ${num(out.reassigned)} lead${out.reassigned === 1 ? "" : "s"} to ${out.to}${left ? `. ${num(left)} stayed where they were (worked since, already theirs, or not part of a business group)` : ""}`);
      picked.clear();
      state.claimedLoaded = false;
    } catch (err) {
      showToast(err.message, true);
    }
    busy = false;
    data = null;
    load();
  }

  panel.addEventListener("click", (e) => {
    const act = e.target.closest("[data-stale]")?.dataset.stale;
    if (act === "reload") load();
    else if (act === "hand-back") handBack();
    else if (act === "reassign") reassign();
    else if (act === "disconnect") disconnect();
    else if (act === "clear-filters") { Object.keys(filters).forEach((k) => { filters[k] = ""; }); render(); }
    const sort = e.target.closest("[data-stale-sort]")?.dataset.staleSort;
    if (sort) {
      sortDir = sort === sortKey ? (sortDir === "asc" ? "desc" : "asc") : (sort === "quiet" ? "desc" : "asc");
      sortKey = sort;
      render();
    }
  });

  panel.addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches('[data-stale="days"]')) {
      days = Number(t.value) || 30;
      try { localStorage.setItem(DAYS_KEY, String(days)); } catch { /* not remembered */ }
      picked.clear();
      data = null;
      load();
    } else if (t.matches('[data-stale="target"]')) {
      targetId = t.value;
      render();
    } else if (t.matches("[data-stale-filter]")) {
      filters[t.dataset.staleFilter] = t.value;
      render();
    } else if (t.matches('[data-stale="all"]')) {
      visible().forEach((i) => (t.checked ? picked.add(i.npi) : picked.delete(i.npi)));
      render();
    } else if (t.matches("[data-stale-npi]")) {
      if (t.checked) picked.add(t.dataset.staleNpi); else picked.delete(t.dataset.staleNpi);
      render();
    }
  });

  // Shown (or reloaded) when the admin chooses "Stale leads".
  window.dmeHooks.onStaleShown = () => load();
  const previousSignedOut = window.dmeHooks.onSignedOut;
  window.dmeHooks.onSignedOut = () => {
    previousSignedOut?.();
    data = null;
    picked.clear();
    panel.innerHTML = "";
  };
})();
