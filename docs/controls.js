/* Admin > Controls: add, edit and remove users, and see what the app is connected to.
   Removing a user is reversible (they can no longer sign in; their leads and history
   stay as they are), because claimed leads and the ownership history point at them.
   Loaded after app.js; team.js shows and hides this panel with the Admin switch. */
(function () {
  "use strict";

  const panel = document.getElementById("controlsPanel");
  if (!panel) return;

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
