/* Your account: change your own password.
   Anyone can open it from the "Password" link next to Sign out. A person whose password
   was set by an admin (a temporary one) is taken here on sign-in and can't do anything
   else until they have chosen their own; the Worker enforces that too.
   Loaded after app.js and shares its globals (apiPost, getSession, saveSession, ...). */
(function () {
  "use strict";

  let overlay = null;
  let forced = false;
  let busy = false;

  function close() {
    if (forced) return; // can't be dismissed until the password is changed
    if (overlay) { overlay.remove(); overlay = null; }
  }

  function open({ force = false } = {}) {
    if (overlay) { forced = forced || force; return; }
    forced = force;
    overlay = document.createElement("div");
    overlay.className = "suggestion-overlay account-overlay";
    overlay.innerHTML = `
      <form class="suggestion-card account-card" role="dialog" aria-modal="true" aria-labelledby="pwTitle" autocomplete="off">
        <h3 id="pwTitle">${force ? "Choose your own password" : "Change your password"}</h3>
        <p class="suggestion-hint">${force
          ? "You signed in with a temporary password. Pick one only you know to continue."
          : "Pick something at least 8 characters long that you don't use anywhere else."}</p>
        <label class="field"><span>${force ? "Temporary password" : "Current password"}</span><input type="password" id="pwCurrent" autocomplete="current-password" required></label>
        <label class="field"><span>New password</span><input type="password" id="pwNew" autocomplete="new-password" minlength="8" required></label>
        <label class="field"><span>New password again</span><input type="password" id="pwAgain" autocomplete="new-password" minlength="8" required></label>
        <div class="login-error" id="pwError" hidden></div>
        <div class="suggestion-actions">
          ${force ? '<button type="button" class="btn btn-ghost" data-pw="signout">Sign out</button>' : '<button type="button" class="btn btn-ghost" data-pw="cancel">Cancel</button>'}
          <button type="submit" class="btn btn-primary" id="pwSave">Save password</button>
        </div>
      </form>`;
    document.body.append(overlay);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
      const act = e.target.closest("[data-pw]")?.dataset.pw;
      if (act === "cancel") close();
      else if (act === "signout") { forced = false; close(); handleSignOut(); }
    });
    overlay.querySelector("form").addEventListener("submit", submit);
    overlay.querySelector("#pwCurrent").focus();
  }

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const current = overlay.querySelector("#pwCurrent").value;
    const next = overlay.querySelector("#pwNew").value;
    const again = overlay.querySelector("#pwAgain").value;
    const error = overlay.querySelector("#pwError");
    const fail = (message) => { error.textContent = message; error.hidden = false; };
    error.hidden = true;
    if (next.length < 8) return fail("The new password must be at least 8 characters.");
    if (next !== again) return fail("The two new passwords don't match.");

    busy = true;
    const btn = overlay.querySelector("#pwSave");
    btn.disabled = true;
    try {
      await apiPost("auth/change-password", { currentPassword: current, newPassword: next });
      const session = getSession();
      if (session) { delete session.mustChangePassword; saveSession(session); }
      const wasForced = forced;
      forced = false;
      close();
      showToast("Password changed");
      // Everything that was refused while the password was temporary can load now.
      if (wasForced) location.reload();
    } catch (err) {
      fail(err.message);
      btn.disabled = false;
    } finally {
      busy = false;
    }
  }

  document.getElementById("changePasswordBtn")?.addEventListener("click", () => open());
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && overlay && !forced) close(); });

  const hooks = window.dmeHooks;
  hooks.onPasswordRequired = () => open({ force: true });
  hooks.onLoginResult = (data) => { if (data && data.mustChangePassword) open({ force: true }); };
  const previousSignedOut = hooks.onSignedOut;
  hooks.onSignedOut = () => {
    previousSignedOut?.();
    forced = false;
    if (overlay) { overlay.remove(); overlay = null; }
  };

  // A reload while still on a temporary password.
  if (getSession()?.mustChangePassword) open({ force: true });

  window.dmeAccount = { open };
})();
