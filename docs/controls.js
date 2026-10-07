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
  let taxonomies = null;
  let statusData = null;
  let statusError = "";
  const statusPick = {}; // stored spelling -> the status it should become ("" = leave it)
  let statusResult = null;
  let buddyData = null;
  let buddyError = "";
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
    const [u, s, t, st, bd] = await Promise.allSettled([apiGet("admin/users"), apiGet("admin/system"), apiGet("taxonomies/list"), apiGet("admin/statuses"), apiGet("admin/buddy")]);
    if (u.status === "fulfilled") { users = u.value.users; features = u.value.features; } else { error = u.reason.message; }
    if (s.status === "fulfilled") { system = s.value; systemError = ""; } else { systemError = s.reason.message; }
    if (t.status === "fulfilled") taxonomies = t.value.taxonomies || [];
    if (st.status === "fulfilled") { statusData = st.value; statusError = ""; } else { statusError = st.reason.message; }
    if (bd.status === "fulfilled") { buddyData = bd.value; buddyError = ""; } else { buddyError = bd.reason.message; }
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
        <section><h3 class="ctl-h">Avatar notes</h3><div id="ctlBuddyHost">${buddyHtml()}</div></section>
        <section><h3 class="ctl-h">System</h3>${systemHtml()}</section>
        <section><h3 class="ctl-h">Search defaults</h3>${defaultsHtml()}</section>
        <section><h3 class="ctl-h">Statuses</h3>${statusesHtml()}</section>
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

  /* ---------- search defaults and status cleanup ---------- */

  /* ---------- avatar notes: message of the day, or a note for one person ---------- */

  const NOTE_STATE = { showing: "Showing", scheduled: "Scheduled", expired: "Expired" };
  const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function peopleHtml() {
    const list = (users || []).filter((u) => !u.disabled);
    if (!list.length) return "";
    const byId = new Map((buddyData.people || []).map((p) => [p.userId, p]));
    return `<h4 style="margin-top:18px">Birthdays and work anniversaries</h4>
      <p class="ctl-help">Optional. The avatar wishes them a happy birthday (month and day only, no year is stored) and marks each work anniversary, and tells their teammates.</p>
      <table class="results-table ctl-table ctl-people-table"><thead><tr><th>Person</th><th>Birthday (month and day)</th><th>Started</th><th></th></tr></thead><tbody>
      ${list.map((u) => {
        const p = byId.get(u.id) || {};
        const [mm, dd] = String(p.birthday || "").split("-");
        return `<tr data-person="${escapeHtml(u.id)}"><td>${escapeHtml(u.displayName)}</td>
          <td><select data-person-month aria-label="Birthday month"><option value="">Month</option>${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((m, i) => `<option value="${String(i + 1).padStart(2, "0")}" ${mm === String(i + 1).padStart(2, "0") ? "selected" : ""}>${m}</option>`).join("")}</select>
            <select data-person-day aria-label="Birthday day"><option value="">Day</option>${Array.from({ length: 31 }, (_, i) => `<option value="${String(i + 1).padStart(2, "0")}" ${dd === String(i + 1).padStart(2, "0") ? "selected" : ""}>${i + 1}</option>`).join("")}</select></td>
          <td><input type="date" data-person-start value="${escapeHtml(p.startedOn || "")}" aria-label="Start date"></td>
          <td><button type="button" class="link-btn" data-ctl="buddy-person">Save</button></td></tr>`;
      }).join("")}</tbody></table>`;
  }

  function buddyHtml() {
    if (buddyError) return `<div class="team-block"><div class="team-state">${escapeHtml(buddyError)}</div></div>`;
    if (!buddyData) return '<div class="team-block"><span class="muted-note">Loading…</span></div>';
    const people = (users || []).filter((u) => !u.disabled);
    const notes = buddyData.notes || [];
    return `<div class="team-block">
      <h4>Write a note</h4>
      <p class="ctl-help">Your avatar shows it as a pop-up the next time each person opens the app, once. Choose everyone for a message of the day, or one person for a personal note. It stays under the avatar's face until it expires.${buddyData.unavailable ? ' <strong>Run sql/031_avatar_notes.sql in Supabase first: notes cannot be saved until you do.</strong>' : ""}</p>
      <textarea id="ctlBuddyBody" class="ctl-note-input" rows="3" maxlength="500" placeholder="e.g. Great week, everyone. Georgia is the focus on Monday." aria-label="Note"></textarea>
      <div class="ctl-run ctl-note-row">
        <label class="ctl-inline">For <select id="ctlBuddyTo"><option value="">Everyone</option>${people.map((u) => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.displayName)}</option>`).join("")}</select></label>
        <label class="ctl-inline">Shows for <select id="ctlBuddyDays">${[[1, "1 day"], [3, "3 days"], [7, "1 week"], [14, "2 weeks"], [30, "1 month"]].map(([d, l]) => `<option value="${d}" ${d === 7 ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="ctl-inline">Repeat <select id="ctlBuddyRepeat" title="A repeating note shows each week on that day until it runs out"><option value="">Once</option>${WEEKDAY_NAMES.map((d, i) => `<option value="${i}">Every ${d}</option>`).join("")}</select></label>
        <label class="ctl-inline">Starting <input type="datetime-local" id="ctlBuddyFrom" aria-label="Start time (optional)"></label>
        <button type="button" class="btn btn-primary btn-small" data-ctl="buddy-send">Send</button>
      </div>
      <label class="checkbox ctl-wins"><input type="checkbox" id="ctlBuddyWins" ${buddyData.settings && buddyData.settings.teamWins ? "checked" : ""}><span>Tell the team when someone onboards a lead (a pop-up for everyone else, for a day)</span></label>
      ${notes.length ? `<table class="results-table ctl-table ctl-note-table"><thead><tr><th>Note</th><th>For</th><th>Status</th><th title="People who have been shown it">Seen</th><th></th></tr></thead><tbody>
        ${notes.map((n) => `<tr><td class="ctl-note-cell">${escapeHtml(n.body)}${n.reactions && n.reactions.length ? `<div class="ctl-react-list">${n.reactions.map((r) => `${escapeHtml(r.name)} ${escapeHtml(r.reaction)}${r.reply ? ` \u201c${escapeHtml(r.reply)}\u201d` : ""}`).join(" \u00b7 ")}</div>` : ""}</td><td>${escapeHtml(n.to)}${n.repeatWeekday !== null && n.repeatWeekday !== undefined ? `<div class="ctl-sub">every ${WEEKDAY_NAMES[n.repeatWeekday]}</div>` : ""}</td>
          <td><span class="status-pill ${n.state === "showing" ? "is-active" : "is-removed"}">${NOTE_STATE[n.state] || n.state}</span><div class="ctl-sub">${n.state === "scheduled" ? `from ${escapeHtml(when(n.showFrom))}` : n.expiresAt ? `until ${escapeHtml(when(n.expiresAt))}` : ""}</div></td>
          <td class="mono">${n.seenBy}</td>
          <td><button type="button" class="link-btn" data-ctl="buddy-retire" data-id="${escapeHtml(n.id)}">Retire</button></td></tr>`).join("")}
      </tbody></table>` : '<div class="muted-note" style="margin-top:12px;">No notes yet.</div>'}
      ${peopleHtml()}
      ${teamHtml()}
    </div>`;
  }

  /* ---------- the avatar's team features: team goal, scripts, mood, kudos ---------- */

  function teamHtml() {
    const unavailable = buddyData.teamUnavailable
      ? '<p class="ctl-help"><strong>Run sql/033_avatar_team.sql in Supabase to use scripts, kudos and the mood check-in.</strong></p>'
      : "";
    const scripts = buddyData.scripts || [];
    const mood = buddyData.mood || [];
    const kudos = buddyData.kudos || [];
    const peak = Math.max(1, ...mood.map((d) => d.great + d.okay + d.rough));
    const answered = mood.reduce((n, d) => n + d.great + d.okay + d.rough, 0);
    return `${unavailable}
      <h4 style="margin-top:18px">Team call goal</h4>
      <p class="ctl-help">A shared target for calls this week (Monday to Sunday). The avatar shows the team's progress and cheers when it is reached. Leave blank to switch it off.</p>
      <div class="ctl-run"><input type="number" id="ctlTeamGoal" min="1" max="100000" step="1" placeholder="e.g. 500" value="${buddyData.teamGoal || ""}" aria-label="Weekly team call goal" style="width:120px">
        <button type="button" class="btn btn-ghost btn-small" data-ctl="buddy-goal">Save</button></div>

      <h4 style="margin-top:18px">Call scripts</h4>
      <p class="ctl-help">Openers and voicemail scripts shown beside call mode. Leave the specialty blank for every lead, or type part of a specialty name (for example "orthotic") to show it only for those leads.</p>
      <div class="ctl-run ctl-note-row">
        <label class="ctl-inline">Title <input type="text" id="ctlScriptTitle" maxlength="60" placeholder="Opener" style="width:150px"></label>
        <label class="ctl-inline">Specialty (optional) <input type="text" id="ctlScriptSpecialty" maxlength="80" placeholder="all leads" style="width:150px"></label>
      </div>
      <textarea id="ctlScriptBody" class="ctl-note-input" rows="3" maxlength="800" placeholder="Hi, this is [name] from [company]. I'm calling because..." aria-label="Script"></textarea>
      <div class="ctl-run"><button type="button" class="btn btn-primary btn-small" data-ctl="buddy-script">Add script</button></div>
      ${scripts.length ? `<table class="results-table ctl-table ctl-note-table"><thead><tr><th>Script</th><th>For</th><th></th></tr></thead><tbody>
        ${scripts.map((sc) => `<tr><td class="ctl-note-cell"><strong>${escapeHtml(sc.title)}</strong><div>${escapeHtml(sc.body)}</div></td><td>${escapeHtml(sc.specialty || "All leads")}</td>
          <td><button type="button" class="link-btn" data-ctl="buddy-script-retire" data-id="${escapeHtml(sc.id)}">Retire</button></td></tr>`).join("")}
      </tbody></table>` : '<div class="muted-note" style="margin-top:10px;">No scripts yet.</div>'}

      <h4 style="margin-top:18px">How the team is feeling</h4>
      <p class="ctl-help">A one-tap check-in the avatar asks at the start of a shift. You only see anonymous totals per day, never who chose what. Last 14 days${answered ? ` (${answered} answers)` : ""}.</p>
      ${answered ? `<div class="ctl-mood" aria-label="Mood over the last 14 days">${mood.map((d) => {
        const total = d.great + d.okay + d.rough;
        const h = (n) => `height:${(n / peak) * 100}%`;
        return `<div class="ctl-mood-day" title="${escapeHtml(d.day)}: ${d.great} great, ${d.okay} okay, ${d.rough} rough"><i class="m3" style="${h(d.great)}"></i><i class="m2" style="${h(d.okay)}"></i><i class="m1" style="${h(d.rough)}"></i></div>`;
      }).join("")}</div><div class="muted-note" style="margin-top:6px;">Green great, yellow okay, red rough.</div>` : '<div class="muted-note">No answers yet.</div>'}

      <h4 style="margin-top:18px">Recent kudos</h4>
      ${kudos.length ? `<table class="results-table ctl-table"><thead><tr><th>From</th><th>To</th><th>Message</th><th>When</th></tr></thead><tbody>
        ${kudos.map((k) => `<tr><td>${escapeHtml(k.from)}</td><td>${escapeHtml(k.to)}</td><td class="ctl-note-cell">${escapeHtml(k.body)}</td><td class="mono">${escapeHtml(when(k.at))}</td></tr>`).join("")}
      </tbody></table>` : '<div class="muted-note">No kudos yet.</div>'}`;
  }

  async function saveTeamGoal() {
    const value = document.getElementById("ctlTeamGoal").value.trim();
    try {
      await apiPost("admin/buddy/settings", { teamGoal: value });
      buddyData.teamGoal = value ? Number(value) : null;
      showToast(value ? "Team goal saved" : "Team goal switched off");
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function addScript() {
    const title = document.getElementById("ctlScriptTitle").value.trim();
    const body = document.getElementById("ctlScriptBody").value.trim();
    if (!title || !body) { showToast("Give the script a title and some text", true); return; }
    try {
      await apiPost("admin/buddy/script", { title, body, specialty: document.getElementById("ctlScriptSpecialty").value.trim() });
      buddyData = await apiGet("admin/buddy");
      refreshBuddy();
      showToast("Script added");
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function retireScript(id) {
    if (!confirm("Retire this script? It stops showing in call mode (the record stays).")) return;
    try {
      await apiPost("admin/buddy/script/retire", { id });
      buddyData = await apiGet("admin/buddy");
      refreshBuddy();
      showToast("Script retired");
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function saveTeamWins(on) {
    try {
      await apiPost("admin/buddy/settings", { teamWins: on });
      buddyData.settings = { teamWins: on };
      showToast(on ? "The team will hear about onboarded leads" : "Onboarded leads won't be announced");
    } catch (err) {
      showToast(err.message, true);
      refreshBuddy();
    }
  }

  async function savePerson(row) {
    const mm = row.querySelector("[data-person-month]").value;
    const dd = row.querySelector("[data-person-day]").value;
    if (Boolean(mm) !== Boolean(dd)) { showToast("Choose both a month and a day, or neither", true); return; }
    try {
      await apiPost("admin/buddy/person", { userId: row.dataset.person, birthday: mm && dd ? `${mm}-${dd}` : "", startedOn: row.querySelector("[data-person-start]").value });
      buddyData = await apiGet("admin/buddy");
      showToast("Saved");
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function refreshBuddy() {
    const host = document.getElementById("ctlBuddyHost");
    if (host) host.innerHTML = buddyHtml();
  }

  async function sendBuddy() {
    const body = document.getElementById("ctlBuddyBody")?.value.trim();
    if (!body) { showToast("Write the note first", true); return; }
    const from = document.getElementById("ctlBuddyFrom")?.value;
    try {
      await apiPost("admin/buddy", {
        body,
        toUserId: document.getElementById("ctlBuddyTo").value,
        expiresDays: document.getElementById("ctlBuddyRepeat").value === "" ? Number(document.getElementById("ctlBuddyDays").value) : "",
        repeatWeekday: document.getElementById("ctlBuddyRepeat").value,
        showFrom: from ? new Date(from).toISOString() : "",
      });
      buddyData = await apiGet("admin/buddy");
      refreshBuddy();
      window.dmeBuddy?.reload?.();
      showToast("Note sent");
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function retireBuddy(id) {
    if (!confirm("Retire this note? It stops showing for everyone (the record stays).")) return;
    try {
      await apiPost("admin/buddy/retire", { id });
      buddyData = await apiGet("admin/buddy");
      refreshBuddy();
      window.dmeBuddy?.reload?.();
      showToast("Note retired");
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function defaultsHtml() {
    if (!taxonomies) return '<div class="team-block"><span class="muted-note">Loading\u2026</span></div>';
    const current = taxonomies.find((t) => t.defaultForSearch);
    return `<div class="team-block">
      <h4>Starting specialty</h4>
      <p class="ctl-help">The specialty ticked for people when they open the search form in a new session. They can change it freely; a saved search or an earlier choice in the same tab always wins.</p>
      <div class="ctl-run"><select id="ctlDefaultTaxonomy" aria-label="Starting specialty">
        <option value="">None (all specialties)</option>
        ${taxonomies.map((t) => `<option value="${escapeHtml(t.rowNumber)}" ${current && current.rowNumber === t.rowNumber ? "selected" : ""}>${escapeHtml(t.facilityType || t.description)}</option>`).join("")}
      </select></div>
    </div>`;
  }

  async function saveDefaultTaxonomy(rowNumber) {
    try {
      const data = await apiPost("admin/taxonomies/default", { rowNumber });
      taxonomies = data.taxonomies || taxonomies;
      showToast(rowNumber ? "Starting specialty saved" : "Starting specialty cleared");
    } catch (err) {
      showToast(err.message, true);
      load();
    }
  }

  const wanted = (row) => (row.status in statusPick ? statusPick[row.status] : (row.target && row.target !== row.status ? row.target : ""));
  const pendingChanges = () => (statusData ? statusData.statuses.filter((r) => r.why !== "disconnected" && wanted(r) && wanted(r) !== r.status) : []);

  function statusesHtml() {
    if (statusError) return `<div class="team-block"><div class="team-state">${escapeHtml(statusError)}</div></div>`;
    if (!statusData) return '<div class="team-block"><span class="muted-note">Loading\u2026</span></div>';
    const rows = statusData.statuses;
    const clean = rows.filter((r) => r.why === "ok");
    const todo = rows.filter((r) => r.why !== "ok");
    const rank = (r) => (r.target && r.target !== r.status ? 0 : r.junk ? 1 : 2);
    todo.sort((a, b) => rank(a) - rank(b) || b.count - a.count);
    const pending = pendingChanges();

    const options = (row) => {
      const list = [...statusData.canonical];
      const picked = wanted(row);
      if (picked && !list.includes(picked)) list.push(picked);
      return `<option value="">Leave as it is</option>${list.map((c) => `<option value="${escapeHtml(c)}" ${picked === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}`;
    };
    const note = (r) => ({ "same meaning": "Same as", "tidy spelling": "Tidier as", meaningless: "Says nothing: back to new", disconnected: "Use Send to Disconnected", custom: "Custom" }[r.why] || "");

    return `<div class="team-block">
      <h4>Tidy the statuses</h4>
      <p class="ctl-help">${clean.length} status${clean.length === 1 ? " is" : "es are"} already clean (${clean.map((r) => `${escapeHtml(r.status)} ${r.count}`).join(", ") || "none yet"}).
        ${todo.length ? `Below are the others: spellings that mean the same thing, and ones that say nothing. Pick what each should become and apply. Only the status text changes (not who owns the lead), and an undo file downloads.` : "Nothing to tidy."}</p>
      ${todo.length ? `<table class="results-table ctl-table ctl-status-table"><thead><tr><th>Stored as</th><th>Leads</th><th></th><th>Becomes</th></tr></thead><tbody>${todo.map((r) => `
        <tr class="${r.junk ? "is-junk" : ""}"><td><strong>${escapeHtml(r.status)}</strong></td><td class="mono">${r.count}</td><td class="muted-note">${escapeHtml(note(r))}</td>
          <td>${r.why === "disconnected" ? '<span class="muted-note">Handled by Send to Disconnected</span>' : `<select data-status-from="${escapeHtml(r.status)}">${options(r)}</select>`}</td></tr>`).join("")}</tbody></table>
        <div class="ctl-run"><button type="button" class="btn btn-primary" data-status="apply" ${pending.length ? "" : "disabled"}>Apply ${pending.length} change${pending.length === 1 ? "" : "s"}</button>
          <span class="muted-note">${pending.reduce((n, r) => n + r.count, 0)} lead${pending.reduce((n, r) => n + r.count, 0) === 1 ? "" : "s"} affected</span></div>` : ""}
      ${statusResult ? `<div class="ctl-summary">Changed ${statusResult.leadsChanged} lead${statusResult.leadsChanged === 1 ? "" : "s"}: ${statusResult.summary.filter((x) => x.leads).map((x) => `${escapeHtml(x.from)} \u2192 ${escapeHtml(x.to)} (${x.leads})`).join(", ")}.</div>` : ""}
    </div>`;
  }

  async function applyStatuses() {
    const list = pendingChanges();
    if (!list.length) return;
    const leads = list.reduce((n, r) => n + r.count, 0);
    if (!confirm(`Change the status of ${leads} lead${leads === 1 ? "" : "s"} across ${list.length} spelling${list.length === 1 ? "" : "s"}? Only the status text changes. A file listing every lead's old status will download so this can be undone.`)) return;
    try {
      const result = await apiPost("admin/statuses/merge", { merges: list.map((r) => ({ from: r.status, to: wanted(r) })) });
      if (result.changed.length) {
        download(`status-cleanup-undo-${today()}.csv`, sheetLib.toCsv(["NPI", "Old status", "New status"], result.changed.map((c) => [c.npi, c.from, c.to])));
      }
      statusResult = result;
      Object.keys(statusPick).forEach((k) => delete statusPick[k]);
      state.statuses = []; // the Claimed filter list is rebuilt on its next load
      showToast(`Changed ${result.leadsChanged} lead${result.leadsChanged === 1 ? "" : "s"}`);
      load();
    } catch (err) {
      showToast(err.message, true);
    }
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
    if (e.target.closest('[data-status="apply"]')) { applyStatuses(); return; }
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
    if (e.target.id === "ctlDefaultTaxonomy") { saveDefaultTaxonomy(e.target.value); return; }
    if (e.target.id === "ctlBuddyWins") { saveTeamWins(e.target.checked); return; }
    const pick = e.target.closest("[data-status-from]");
    if (pick) { statusPick[pick.dataset.statusFrom] = pick.value; statusResult = null; panel.querySelector(".ctl-status-table")?.closest(".team-block")?.replaceWith(Object.assign(document.createElement("div"), { innerHTML: statusesHtml() }).firstElementChild); return; }
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
    else if (btn.dataset.ctl === "buddy-send") sendBuddy();
    else if (btn.dataset.ctl === "buddy-retire") retireBuddy(btn.dataset.id);
    else if (btn.dataset.ctl === "buddy-person") savePerson(btn.closest("tr"));
    else if (btn.dataset.ctl === "buddy-goal") saveTeamGoal();
    else if (btn.dataset.ctl === "buddy-script") addScript();
    else if (btn.dataset.ctl === "buddy-script-retire") retireScript(btn.dataset.id);
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
    taxonomies = null;
    statusData = null;
    buddyData = null;
    panel.innerHTML = "";
  };
})();
