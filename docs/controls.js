/* Admin > Controls: add, edit and remove users, and see what the app is connected to.
   Removing a user is reversible (they can no longer sign in; their leads and history
   stay as they are), because claimed leads and the ownership history point at them.
   Loaded after app.js; team.js shows and hides this panel with the Admin switch. */
(function () {
  "use strict";

  const panel = document.getElementById("controlsPanel");
  if (!panel || !window.dmeSheet) return;

  let users = null;
  let features = { remove: true, claimForOthers: true };
  let system = null;
  let systemError = "";
  let loading = false;
  let error = "";
  let dialog = null; // the open dialog's overlay element

  const me = () => getSession();
  // The sign-in session carries the username, not the id.
  const isMe = (u) => String(u.username).toLowerCase() === String(me()?.username || "").toLowerCase();
  const when = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");

  async function load() {
    if (loading) return;
    loading = true;
    error = "";
    render();
    const [u, s] = await Promise.allSettled([apiGet("admin/users"), apiGet("admin/system")]);
    if (u.status === "fulfilled") { users = u.value.users; features = u.value.features; } else { error = u.reason.message; }
    if (s.status === "fulfilled") { system = s.value; systemError = ""; } else { systemError = s.reason.message; }
    loading = false;
    render();
  }

  /* ---------- the page ---------- */

  function roleBadges(u) {
    return [
      u.isAdmin ? '<span class="role-badge is-admin">Admin</span>' : '<span class="role-badge">Rep</span>',
      u.canClaimForOthers ? '<span class="role-badge" title="Can claim leads on behalf of a teammate">Claims for others</span>' : "",
    ].join(" ");
  }

  function userRows() {
    return users.map((u) => `
      <tr class="${u.disabled ? "is-removed" : ""}">
        <td><div class="ctl-name">${escapeHtml(u.displayName)}${isMe(u) ? ' <span class="muted-note">(you)</span>' : ""}</div>
          <div class="ctl-sub mono">${escapeHtml(u.username)}</div></td>
        <td>${roleBadges(u)}</td>
        <td>${u.disabled ? `<span class="status-pill is-removed" title="Removed ${escapeHtml(when(u.disabledAt))}">Removed</span>` : '<span class="status-pill is-active">Active</span>'}${u.lockedUntil ? ' <span class="status-pill is-removed" title="Too many wrong passwords. Open Edit to unlock.">Locked</span>' : ""}${u.mustChangePassword ? ' <span class="role-badge" title="Still on the temporary password you gave them">Temp password</span>' : ""}</td>
        <td class="mono">${u.claimedCount}</td>
        <td class="mono">${escapeHtml(when(u.createdAt))}</td>
        <td class="ctl-actions"><button type="button" class="btn btn-ghost btn-small" data-ctl="edit" data-id="${escapeHtml(u.id)}">Edit</button></td>
      </tr>`).join("");
  }

  function systemHtml() {
    if (systemError) return `<div class="team-state">${escapeHtml(systemError)}</div>`;
    if (!system) return '<div class="team-state"><span class="spinner"></span> Checking…</div>';
    const dot = (on) => `<span class="sys-dot ${on ? "is-on" : "is-off"}" aria-hidden="true"></span><span class="sr-only">${on ? "On" : "Off"}</span>`;
    const row = (label, on, note) => `<li class="sys-row">${dot(on)}<span class="sys-label">${escapeHtml(label)}</span><span class="sys-note">${escapeHtml(note || "")}</span></li>`;
    const source = system.searchSource === "dmedesk" ? "DME Desk's own provider table" : `The mirror project (${system.searchSource})`;
    return `
      <div class="ctl-grid">
        <div class="team-block"><h4>Connected services</h4>
          <ul class="sys-list">${system.integrations.map((i) => row(i.label, i.configured, i.configured ? i.note : "Not set up")).join("")}</ul>
        </div>
        <div class="team-block"><h4>Installed in the database</h4>
          <ul class="sys-list">${system.installed.map((i) => row(i.label, i.installed, i.installed ? "Installed" : `Not installed (${i.note})`)).join("")}</ul>
        </div>
      </div>
      <p class="team-foot">Leads are searched from: <strong>${escapeHtml(source)}</strong>. Sessions last ${system.sessionHours} hours. Keys and secrets are never shown here; they are set in the Worker's settings.</p>`;
  }

  function render() {
    let usersBody;
    if (error) usersBody = `<div class="team-state">${escapeHtml(error)} <button type="button" class="link-btn" data-ctl="reload">Try again</button></div>`;
    else if (!users) usersBody = '<div class="team-state"><span class="spinner"></span> Loading users…</div>';
    else {
      const active = users.filter((u) => !u.disabled).length;
      usersBody = `
        <div class="ctl-summary">${active} active ${active === 1 ? "user" : "users"}${users.length > active ? `, ${users.length - active} removed` : ""}</div>
        <div class="table-wrap"><table class="results-table ctl-table">
          <thead><tr><th>Person</th><th>Role</th><th>Status</th><th title="Leads they hold right now">Claimed</th><th>Added</th><th></th></tr></thead>
          <tbody>${userRows()}</tbody>
        </table></div>`;
    }
    panel.innerHTML = `
      <div class="results-toolbar team-toolbar">
        <div class="results-meta"><div class="results-count">Controls</div><div class="results-sub">Users and what the app is connected to</div></div>
        <div class="results-actions">
          <button type="button" class="btn btn-primary" data-ctl="add">+ Add user</button>
          <button type="button" class="btn btn-ghost" data-ctl="reload" ${loading ? "disabled" : ""}>Refresh</button>
        </div>
      </div>
      <div class="team-body${loading && users ? " is-stale" : ""}">
        <section><h3 class="ctl-h">Users</h3>${usersBody}</section>
        <section><h3 class="ctl-h">System</h3>${systemHtml()}</section>
        <section><h3 class="ctl-h">Sheet import &amp; export</h3><div id="ctlSheetHost">${users ? sheetHtml() : ""}</div></section>
      </div>`;
  }

  /* ---------- dialogs ---------- */

  function closeDialog() {
    if (dialog) { dialog.remove(); dialog = null; }
  }

  function openDialog(html) {
    closeDialog();
    dialog = document.createElement("div");
    dialog.className = "suggestion-overlay";
    dialog.innerHTML = `<div class="suggestion-card ctl-card" role="dialog" aria-modal="true">${html}</div>`;
    document.body.append(dialog);
    dialog.addEventListener("click", (e) => { if (e.target === dialog) closeDialog(); });
    return dialog.querySelector(".ctl-card");
  }

  function generatePassword() {
    const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  }

  const passwordField = (id, label) => `
    <label class="field"><span>${label}</span>
      <div class="ctl-pw"><input type="text" id="${id}" autocomplete="new-password" spellcheck="false" placeholder="At least 8 characters">
      <button type="button" class="btn btn-ghost btn-small" data-ctl-gen="${id}">Generate</button></div></label>`;

  function openAdd() {
    const card = openDialog(`
      <h3>Add a user</h3>
      <p class="suggestion-hint">They sign in with the username and password below. Give them the password yourself; it is not emailed.</p>
      <label class="field"><span>Name</span><input type="text" id="ctlName" maxlength="60" autocomplete="off" placeholder="Ana Lopez"></label>
      <label class="field"><span>Username</span><input type="text" id="ctlUsername" maxlength="40" autocomplete="off" placeholder="ana.lopez"></label>
      ${passwordField("ctlPassword", "Temporary password")}
      <label class="checkbox"><input type="checkbox" id="ctlMustChange" checked><span>Make them choose their own password at first sign-in</span></label>
      <label class="checkbox"><input type="checkbox" id="ctlAdmin"><span>Admin (can open this Admin tab)</span></label>
      ${features.claimForOthers ? '<label class="checkbox"><input type="checkbox" id="ctlClaimOthers"><span>Can claim leads for a teammate</span></label>' : ""}
      <div class="login-error" id="ctlError" hidden></div>
      <div class="suggestion-actions"><button type="button" class="btn btn-ghost" data-ctl="close">Cancel</button>
        <button type="button" class="btn btn-primary" data-ctl="create">Add user</button></div>`);
    card.querySelector("#ctlName").focus();
    card.querySelector("#ctlPassword").value = generatePassword();
  }

  function showCreated(result, password) {
    const card = dialog.querySelector(".ctl-card");
    card.innerHTML = `
      <h3>${escapeHtml(result.displayName)} is in</h3>
      <p class="suggestion-hint">Share these now. The password is not shown again.</p>
      <div class="ctl-creds"><div><span>Username</span><strong class="mono">${escapeHtml(result.username)}</strong></div>
        <div><span>Password</span><strong class="mono">${escapeHtml(password)}</strong></div></div>
      <div class="suggestion-actions"><button type="button" class="btn btn-ghost" data-ctl="copycreds" data-text="${escapeHtml(`Username: ${result.username}  Password: ${password}`)}">Copy both</button>
        <button type="button" class="btn btn-primary" data-ctl="close">Done</button></div>`;
  }

  async function create() {
    const card = dialog.querySelector(".ctl-card");
    const err = card.querySelector("#ctlError");
    const password = card.querySelector("#ctlPassword").value;
    const btn = card.querySelector('[data-ctl="create"]');
    err.hidden = true;
    btn.disabled = true;
    try {
      const result = await apiPost("admin/users", {
        displayName: card.querySelector("#ctlName").value,
        username: card.querySelector("#ctlUsername").value,
        password,
        isAdmin: card.querySelector("#ctlAdmin").checked,
        canClaimForOthers: Boolean(card.querySelector("#ctlClaimOthers")?.checked),
        mustChangePassword: card.querySelector("#ctlMustChange").checked,
      });
      showCreated(result, password);
      load();
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
      btn.disabled = false;
    }
  }

  function openEdit(id) {
    const u = users.find((x) => x.id === id);
    if (!u) return;
    const mine = isMe(u);
    const card = openDialog(`
      <h3>${escapeHtml(u.displayName)}</h3>
      <p class="suggestion-hint mono">${escapeHtml(u.username)}${u.disabled ? " · removed" : ""}</p>
      <label class="checkbox"><input type="checkbox" id="ctlAdmin" ${u.isAdmin ? "checked" : ""} ${mine ? "disabled" : ""}><span>Admin${mine ? " (you can't change your own)" : ""}</span></label>
      ${features.claimForOthers ? `<label class="checkbox"><input type="checkbox" id="ctlClaimOthers" ${u.canClaimForOthers ? "checked" : ""}><span>Can claim leads for a teammate</span></label>` : ""}
      ${u.lockedUntil ? `<div class="ctl-locked">Locked after too many wrong passwords until ${escapeHtml(new Date(u.lockedUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}. <button type="button" class="link-btn" data-ctl="unlock">Unlock now</button></div>` : ""}
      ${passwordField("ctlPassword", "Reset password <em class=\"field-optional\">leave blank to keep</em>")}
      <label class="checkbox"><input type="checkbox" id="ctlMustChange" checked><span>Make them choose their own after this</span></label>
      <div class="login-error" id="ctlError" hidden></div>
      <div class="suggestion-actions ctl-edit-actions">
        ${mine ? "<span></span>" : (u.disabled
          ? '<button type="button" class="btn btn-ghost" data-ctl="restore">Restore access</button>'
          : '<button type="button" class="btn btn-ghost btn-danger" data-ctl="remove">Remove user</button>')}
        <div><button type="button" class="btn btn-ghost" data-ctl="close">Cancel</button>
          <button type="button" class="btn btn-primary" data-ctl="save">Save</button></div>
      </div>`);
    card.dataset.id = id;
    card.querySelector("#ctlPassword").value = "";
  }

  async function update(patch, doneMessage) {
    const card = dialog.querySelector(".ctl-card");
    const err = card.querySelector("#ctlError");
    err.hidden = true;
    card.querySelectorAll("button").forEach((b) => { b.disabled = true; });
    try {
      await apiPost("admin/users/update", { id: card.dataset.id, ...patch });
      closeDialog();
      showToast(doneMessage);
      load();
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
      card.querySelectorAll("button").forEach((b) => { b.disabled = false; });
    }
  }

  function save() {
    const card = dialog.querySelector(".ctl-card");
    const u = users.find((x) => x.id === card.dataset.id);
    const patch = {};
    const admin = card.querySelector("#ctlAdmin");
    if (admin && !admin.disabled && admin.checked !== u.isAdmin) patch.isAdmin = admin.checked;
    const claim = card.querySelector("#ctlClaimOthers");
    if (claim && claim.checked !== u.canClaimForOthers) patch.canClaimForOthers = claim.checked;
    const password = card.querySelector("#ctlPassword").value;
    if (password) { patch.password = password; patch.mustChangePassword = card.querySelector("#ctlMustChange").checked; }
    if (!Object.keys(patch).length) { closeDialog(); return; }
    update(patch, password ? "Saved. Give them the new password." : "Saved");
  }

  function remove() {
    const card = dialog.querySelector(".ctl-card");
    const u = users.find((x) => x.id === card.dataset.id);
    const leads = u.claimedCount ? ` Their ${u.claimedCount} claimed lead${u.claimedCount === 1 ? "" : "s"} stay assigned to them until you move them.` : "";
    if (!features.remove) { showToast("Removing users needs sql/026_user_controls.sql run in Supabase first", true); return; }
    if (!confirm(`Remove ${u.displayName}? They won't be able to sign in, and any open session ends within about 30 seconds.${leads} You can restore them later.`)) return;
    update({ disabled: true }, `${u.displayName} was removed`);
  }

  /* ---------- sheet import and CSV export ---------- */

  const sheetLib = window.dmeSheet;
  const imp = {
    fileName: "", rows: null, q: null,
    options: { excludeSubs: "solar", excludeWords: "george", skipSynced: true, useSheetStatus: true, fixedStatus: "Onboarded" },
    openerUser: {}, phase: "idle", progress: { done: 0, total: 0 }, results: new Map(),
  };

  const activeUsers = () => (users || []).filter((u) => !u.disabled);

  // Pre-pick the rep whose first name (or username) is the opener's name.
  function guessUser(opener) {
    const o = String(opener || "").trim().toLowerCase();
    if (!o) return "";
    const hit = activeUsers().find((u) => u.displayName.toLowerCase().split(" ")[0] === o || u.username.toLowerCase().split(/[.@]/)[0] === o);
    return hit ? hit.username : "";
  }

  function requalify() {
    imp.q = imp.rows ? sheetLib.qualify(imp.rows, imp.options) : null;
    if (imp.q) imp.q.openers.forEach((o) => { if (!(o.name in imp.openerUser)) imp.openerUser[o.name] = guessUser(o.name); });
    imp.results = new Map();
    imp.phase = imp.q && imp.q.candidates.length ? "ready" : "idle";
  }

  const stamp = () => new Date().toISOString().slice(0, 16).replace("T", " ");

  function sheetHtml() {
    const q = imp.q;
    const opt = imp.options;
    let body = `
      <div class="team-block">
        <h4>Import leads from a sheet</h4>
        <p class="ctl-help">Export a tab of BD MEETINGS as CSV (File, Download, CSV) and choose it here. Each row is claimed for the rep named in its Opener column, in the same way the BD MEETINGS sync does, and the sheet's status and notes come with it.</p>
        <label class="btn btn-ghost ctl-file"><input type="file" accept=".csv,text/csv" data-sheet-file><span>${imp.fileName ? escapeHtml(imp.fileName) : "Choose CSV file…"}</span></label>`;

    if (q && q.missingNpi) {
      body += '<div class="login-error">That file has no "NPI" column. Export the tab that has one.</div>';
    } else if (q) {
      const s = q.skipped;
      body += `
        <div class="ctl-summary"><strong>${q.candidates.length}</strong> ready to import
          <span class="muted-note"> · ${s.invalid} without a valid NPI · ${s.excluded} excluded · ${s.synced} already synced · ${s.duplicate} repeated</span></div>
        <div class="ctl-opts">
          <label class="field"><span>Skip rows whose SUB is</span><input type="text" data-sheet-opt="excludeSubs" value="${escapeHtml(opt.excludeSubs)}" placeholder="solar, ..."></label>
          <label class="field"><span>Skip rows that mention</span><input type="text" data-sheet-opt="excludeWords" value="${escapeHtml(opt.excludeWords)}" placeholder="george, ..."></label>
          <label class="checkbox"><input type="checkbox" data-sheet-opt="skipSynced" ${opt.skipSynced ? "checked" : ""}><span>Skip rows already marked SYNC</span></label>
          <label class="checkbox"><input type="checkbox" data-sheet-opt="useSheetStatus" ${opt.useSheetStatus ? "checked" : ""}><span>Use the sheet's Status column</span></label>
          <label class="field"><span>${opt.useSheetStatus ? "Status when the sheet's is blank" : "Status for every lead"}</span><input type="text" data-sheet-opt="fixedStatus" value="${escapeHtml(opt.fixedStatus)}" maxlength="60"></label>
        </div>
        ${q.openers.length ? `<div class="cm-label">Who gets each opener's leads</div>
        <table class="results-table ctl-table ctl-openers"><tbody>${q.openers.map((o) => `
          <tr><td>${o.name ? escapeHtml(o.name) : '<span class="muted-note">(blank opener)</span>'}</td><td class="mono">${o.count}</td>
            <td><select data-sheet-opener="${escapeHtml(o.name)}"><option value="">Don't import these</option>${activeUsers().map((u) =>
              `<option value="${escapeHtml(u.username)}" ${imp.openerUser[o.name] === u.username ? "selected" : ""}>${escapeHtml(u.displayName)}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table>` : ""}
        <div class="ctl-run">
          <button type="button" class="btn btn-ghost" data-sheet="preview" ${imp.phase === "previewing" || imp.phase === "importing" || !q.candidates.length ? "disabled" : ""}>Check what would happen</button>
          <button type="button" class="btn btn-primary" data-sheet="import" ${imp.phase === "previewing" || imp.phase === "importing" || !q.candidates.length ? "disabled" : ""}>Import ${importable().length} lead${importable().length === 1 ? "" : "s"}</button>
          <span class="muted-note" id="ctlProgress">${progressText()}</span>
        </div>
        ${resultsHtml()}`;
    }
    body += "</div>";

    body += `
      <div class="team-block">
        <h4>Export leads to CSV</h4>
        <p class="ctl-help">Every active claimed lead with its status, contact, callback, meeting and call log, to open in Excel or Google Sheets.</p>
        <div class="ctl-run">
          <label class="inline-field"><span>Whose</span><select id="ctlExportUser"><option value="">All reps</option>${activeUsers().map((u) => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.displayName)}</option>`).join("")}</select></label>
          <button type="button" class="btn btn-ghost" data-sheet="export">Download CSV</button>
        </div>
      </div>`;
    return `<div class="ctl-grid ctl-grid-sheet">${body}</div>`;
  }

  function importable() {
    if (!imp.q) return [];
    return imp.q.candidates.filter((c) => imp.openerUser[c.opener]);
  }

  function progressText() {
    if (imp.phase === "previewing" || imp.phase === "importing") return `${imp.phase === "previewing" ? "Checking" : "Importing"} ${imp.progress.done} of ${imp.progress.total}…`;
    return "";
  }

  function resultsHtml() {
    if (!imp.results.size) return "";
    const rows = imp.q.candidates.filter((c) => imp.results.has(c.npi)).map((c) => ({ c, r: imp.results.get(c.npi) }));
    const tally = {};
    rows.forEach(({ r }) => { tally[r.result] = (tally[r.result] || 0) + 1; });
    const chips = Object.entries(tally).map(([k, n]) => `<span class="role-badge ${k === "imported" || k === "would-import" ? "is-admin" : ""}">${n} ${escapeHtml(sheetLib.RESULT_LABELS[k] || k).toLowerCase()}</span>`).join(" ");
    const problems = rows.filter(({ r }) => !["imported", "would-import", "already-theirs"].includes(r.result));
    return `<div class="ctl-results">
      <div class="ctl-summary">${imp.phase === "done" ? "Finished." : "Preview (nothing was written)."} ${chips}</div>
      ${problems.length ? `<table class="results-table ctl-table"><thead><tr><th>Row</th><th>Company</th><th>Result</th></tr></thead><tbody>${problems.slice(0, 40).map(({ c, r }) => `
        <tr><td class="mono">${c.rowNumber}</td><td>${escapeHtml(c.company || c.npi)}</td><td>${escapeHtml(sheetLib.RESULT_LABELS[r.result] || r.result)}: ${escapeHtml(r.detail)}</td></tr>`).join("")}</tbody></table>
        ${problems.length > 40 ? `<div class="muted-note">+ ${problems.length - 40} more in the download.</div>` : ""}` : ""}
      <button type="button" class="btn btn-ghost btn-small" data-sheet="results">Download result CSV</button>
      <span class="muted-note">Paste its SYNC column back into the sheet.</span>
    </div>`;
  }

  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const today = () => new Date().toISOString().slice(0, 10);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // A few leads at a time: claiming many at once makes the database work out every possible
  // business grouping in one statement, which can run out of time.
  async function run(dry) {
    const list = importable();
    if (!list.length) { showToast("Choose who gets each opener's leads first", true); return; }
    imp.phase = dry ? "previewing" : "importing";
    imp.results = new Map();
    imp.progress = { done: 0, total: list.length };
    refreshSheet();

    const statusMode = imp.options.useSheetStatus
      ? { useSheet: true, fallback: imp.options.fixedStatus.trim() }
      : { useSheet: false, fixed: imp.options.fixedStatus.trim() };
    const actor = getSession()?.displayName || "";
    const byUser = new Map();
    list.forEach((c) => { const u = imp.openerUser[c.opener]; byUser.set(u, [...(byUser.get(u) || []), c]); });

    for (const [username, items] of byUser) {
      for (let i = 0; i < items.length; i += 5) {
        const chunk = items.slice(i, i + 5);
        try {
          const response = await apiPost("admin/claim-for-user", {
            username,
            dryRun: dry,
            companies: chunk.map((c) => sheetLib.toPayload(c, { stamp: stamp(), actor, statusMode })),
          });
          const verdicts = sheetLib.verdictFor(chunk.map((c) => c.npi), response);
          chunk.forEach((c) => imp.results.set(c.npi, { ...verdicts[c.npi], rep: username }));
        } catch (err) {
          chunk.forEach((c) => imp.results.set(c.npi, { result: "error", detail: err.message, rep: username }));
        }
        imp.progress.done += chunk.length;
        const label = document.getElementById("ctlProgress");
        if (label) label.textContent = progressText();
        await sleep(50);
      }
    }
    imp.phase = dry ? "previewed" : "done";
    refreshSheet();
    if (!dry) {
      const n = [...imp.results.values()].filter((r) => r.result === "imported").length;
      showToast(`Imported ${n} lead${n === 1 ? "" : "s"}`);
      state.claimedLoaded = false; // the Claimed view is stale now
    }
  }

  function refreshSheet() {
    const host = panel.querySelector("#ctlSheetHost");
    if (host) host.innerHTML = sheetHtml();
  }

  async function onSheetFile(file) {
    if (!file) return;
    imp.fileName = file.name;
    imp.rows = sheetLib.parseCsv(await file.text());
    imp.openerUser = {};
    requalify();
    refreshSheet();
  }

  async function exportLeads() {
    const userId = panel.querySelector("#ctlExportUser").value;
    try {
      const data = await apiGet("admin/export/leads", { userId });
      if (!data.leads.length) { showToast("No claimed leads to export", true); return; }
      download(`bd-leads-${today()}.csv`, sheetLib.leadsToCsv(data.leads));
      showToast(`Exported ${data.leads.length} lead${data.leads.length === 1 ? "" : "s"}`);
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function downloadResults() {
    const rows = imp.q.candidates.filter((c) => imp.results.has(c.npi)).map((c) => ({ rowNumber: c.rowNumber, npi: c.npi, company: c.company, ...imp.results.get(c.npi) }));
    download(`import-results-${today()}.csv`, sheetLib.resultsToCsv(rows));
  }

  panel.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-sheet]");
    if (!btn) return;
    const act = btn.dataset.sheet;
    if (act === "preview") run(true);
    else if (act === "import") {
      const n = importable().length;
      if (confirm(`Claim ${n} lead${n === 1 ? "" : "s"} for the reps you chose? Leads someone else already owns are skipped, never taken over. Tip: run "Check what would happen" first.`)) run(false);
    } else if (act === "export") exportLeads();
    else if (act === "results") downloadResults();
  });
  panel.addEventListener("change", (e) => {
    if (e.target.matches("[data-sheet-file]")) { onSheetFile(e.target.files[0]); return; }
    const opener = e.target.closest("[data-sheet-opener]");
    if (opener) { imp.openerUser[opener.dataset.sheetOpener] = opener.value; imp.results = new Map(); refreshSheet(); return; }
    const opt = e.target.closest("[data-sheet-opt]");
    if (!opt) return;
    const key = opt.dataset.sheetOpt;
    imp.options[key] = opt.type === "checkbox" ? opt.checked : opt.value;
    requalify();
    refreshSheet();
  });

  // Your own claimed leads, from the Claimed view (no server call: they are already loaded).
  document.getElementById("claimedExportCsvBtn")?.addEventListener("click", async () => {
    try {
      const { leads } = await apiGet("leads/list");
      if (!leads.length) { showToast("You have no claimed leads to export", true); return; }
      download(`my-leads-${today()}.csv`, sheetLib.leadsToCsv(leads));
      showToast(`Exported ${leads.length} lead${leads.length === 1 ? "" : "s"}`);
    } catch (err) {
      showToast(err.message, true);
    }
  });

  /* ---------- wiring ---------- */

  panel.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-ctl]");
    if (!btn) return;
    if (btn.dataset.ctl === "reload") load();
    else if (btn.dataset.ctl === "add") openAdd();
    else if (btn.dataset.ctl === "edit") openEdit(btn.dataset.id);
  });

  document.addEventListener("click", (e) => {
    if (!dialog || !dialog.contains(e.target)) return;
    const gen = e.target.closest("[data-ctl-gen]");
    if (gen) { dialog.querySelector(`#${gen.dataset.ctlGen}`).value = generatePassword(); return; }
    const btn = e.target.closest("[data-ctl]");
    if (!btn) return;
    const act = btn.dataset.ctl;
    if (act === "close") closeDialog();
    else if (act === "create") create();
    else if (act === "save") save();
    else if (act === "remove") remove();
    else if (act === "restore") update({ disabled: false }, "Access restored");
    else if (act === "unlock") update({ unlock: true }, "Account unlocked");
    else if (act === "copycreds") {
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(btn.dataset.text).then(() => showToast("Copied"), () => showToast("Couldn't copy: select it by hand", true));
      else showToast("Couldn't copy: select it by hand", true);
    }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && dialog) closeDialog(); });

  window.dmeHooks.onControlsShown = load;
  const previousSignedOut = window.dmeHooks.onSignedOut;
  window.dmeHooks.onSignedOut = () => {
    previousSignedOut?.();
    closeDialog();
    users = null;
    system = null;
    panel.innerHTML = "";
  };
})();
