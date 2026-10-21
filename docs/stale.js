/* Stale leads (Admin tab): claimed leads nobody has touched for a while, so an admin can hand them back to Prospect.
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
  let repFilter = "";
  let busy = false;
  const picked = new Set();

  const num = (n) => Number(n || 0).toLocaleString();
  const esc = (s) => escapeHtml(String(s ?? ""));
  const visible = () => ((data && data.items) || []).filter((i) => !repFilter || i.repId === repFilter);

  async function load() {
    if (loading) return;
    loading = true;
    error = "";
    render();
    try {
      data = await apiGet("admin/stale-leads", { days });
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
      body = `
        <p class="ins-note" style="margin-top:0"><strong>${num(data.total)}</strong> claimed lead${data.total === 1 ? "" : "s"} quiet for ${num(days)}+ days${data.total > data.items.length ? ` (the ${num(data.items.length)} quietest are shown)` : ""}.
          Tick the ones to hand back. They leave the rep's Claimed list, the lead's notes and history stay with it, and anyone can claim it again.</p>
        <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 16px;margin:10px 0">
          <label class="inline-field">Rep <select data-stale="rep"><option value="">Everyone (${num(data.total)})</option>${data.reps.map((r) => `<option value="${esc(r.repId)}"${r.repId === repFilter ? " selected" : ""}>${esc(r.rep)} (${num(r.count)})</option>`).join("")}</select></label>
          <button type="button" class="btn btn-primary btn-small" data-stale="hand-back"${chosen.length && !busy ? "" : " disabled"}>${busy ? "Handing back…" : `Hand back ${chosen.length ? num(chosen.length) : ""} to Prospect`}</button>
        </div>
        <div class="ins-table-wrap"><table class="ins-table"><thead><tr>
          <th style="width:34px"><input type="checkbox" data-stale="all" aria-label="Tick every lead shown"${allOn ? " checked" : ""}></th>
          <th>Company</th><th>Rep</th><th>Status</th><th>State</th><th class="num">Quiet</th></tr></thead><tbody>${list.map((i) => `
          <tr><td data-label="" style="width:34px"><input type="checkbox" data-stale-npi="${esc(i.npi)}" aria-label="Tick ${esc(i.name)}"${picked.has(i.npi) ? " checked" : ""}></td>
            <td data-label="Company">${esc(i.name)}<div class="muted-note mono">${esc(i.npi)}</div></td>
            <td data-label="Rep">${esc(i.rep)}</td><td data-label="Status">${esc(i.status)}</td><td data-label="State">${esc(i.state)}</td>
            <td data-label="Quiet" class="num">${num(i.quietDays)} days</td></tr>`).join("")}</tbody></table></div>`;
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

  panel.addEventListener("click", (e) => {
    const act = e.target.closest("[data-stale]")?.dataset.stale;
    if (act === "reload") load();
    else if (act === "hand-back") handBack();
  });

  panel.addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches('[data-stale="days"]')) {
      days = Number(t.value) || 30;
      try { localStorage.setItem(DAYS_KEY, String(days)); } catch { /* not remembered */ }
      picked.clear();
      data = null;
      load();
    } else if (t.matches('[data-stale="rep"]')) {
      repFilter = t.value;
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
