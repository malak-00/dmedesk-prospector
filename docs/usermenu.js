/* The header's user chip: your picture and name open a small menu with "Change password" and "Sign out", instead of two underlined links
   sitting next to the name. The two buttons keep their ids (#changePasswordBtn, #signOutBtn), so everything that listens to them
   (app.js, account.js, buddy.js) works unchanged; they are only moved into the menu. */
(function () {
  "use strict";

  const chip = document.getElementById("userChip");
  const avatar = document.getElementById("userAvatar");
  const name = document.getElementById("userName");
  const password = document.getElementById("changePasswordBtn");
  const signOut = document.getElementById("signOutBtn");
  if (!chip || !avatar || !name || !password || !signOut) return;

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "user-trigger";
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  trigger.title = "Your account";

  const menu = document.createElement("div");
  menu.className = "user-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;

  chip.insertBefore(trigger, avatar);
  trigger.append(avatar, name);
  trigger.insertAdjacentHTML("beforeend", '<svg class="user-caret" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>');
  password.textContent = "Change password";
  [password, signOut].forEach((b) => { b.classList.remove("link-btn"); b.classList.add("user-menu-item"); b.setAttribute("role", "menuitem"); menu.append(b); });
  chip.append(menu);

  function setOpen(open) {
    menu.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
    if (open) password.focus();
  }
  trigger.addEventListener("click", () => setOpen(menu.hidden));
  document.addEventListener("click", (e) => { if (!menu.hidden && !chip.contains(e.target)) setOpen(false); });
  // Choosing an item closes the menu; the item's own handler still runs.
  menu.addEventListener("click", () => setOpen(false));
  chip.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) { setOpen(false); trigger.focus(); }
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !menu.hidden) {
      e.preventDefault();
      const items = [password, signOut];
      const i = items.indexOf(document.activeElement);
      items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length].focus();
    }
  });
})();
