/* Profile pictures. An admin uploads one per person in Controls; the picture then shows next to their name in the
   header, in Team activity and Controls, in kudos pop-ups and in birthday messages. A person without a picture
   gets a round badge with their initials.
   dmeAvatars.html(who, size) returns the markup for a person ({ userId, username, name } or just a name);
   dmeAvatars.load() fetches everyone's pictures; dmeAvatars.upload(userId, file) / remove(userId) are for Controls.
   Loaded after app.js (it needs the sign-in hooks and the API helpers). */
(function () {
  "use strict";

  let list = [];
  let loading = null;
  const byId = new Map();
  const byUsername = new Map();
  const byName = new Map();

  const key = (s) => String(s || "").trim().toLowerCase();

  function index() {
    byId.clear(); byUsername.clear(); byName.clear();
    for (const a of list) {
      byId.set(a.userId, a);
      byUsername.set(key(a.username), a);
      byName.set(key(a.name), a);
    }
  }

  function find(who) {
    if (!who) return null;
    if (typeof who === "string") return byName.get(key(who)) || byUsername.get(key(who)) || null;
    return byId.get(who.userId || who.id) || byUsername.get(key(who.username)) || byName.get(key(who.name || who.displayName)) || null;
  }

  const initialsOf = (name) => {
    const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
    return ((parts[0] || "?")[0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  };

  // A steady colour per name, so the same person always has the same badge.
  const hueOf = (name) => { let h = 0; for (const ch of String(name || "")) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };

  // size is in pixels. Pictures are decorative (the name is always written next to them).
  function html(who, size = 28) {
    const found = find(who);
    const name = (found && found.name) || (typeof who === "string" ? who : who && (who.name || who.displayName)) || "";
    const s = `--s:${size}px`;
    if (found && found.image) return `<span class="av has-pic" style="${s}" data-name="${escapeHtml(name)}"><img src="${found.image}" alt="" width="${size}" height="${size}" title="Click to enlarge"></span>`;
    return `<span class="av av-initials" style="${s};--h:${hueOf(name)}" aria-hidden="true">${escapeHtml(initialsOf(name))}</span>`;
  }

  function paintHeader() {
    const el = document.getElementById("userAvatar");
    const session = getSession();
    if (!el) return;
    el.innerHTML = session ? html({ username: session.username, name: session.displayName }, 26) : "";
  }

  async function load(force) {
    if (loading && !force) return loading;
    loading = (async () => {
      try {
        const data = await apiGet("buddy/avatars");
        list = data.avatars || [];
      } catch (err) {
        console.log("[avatars] " + err.message);
        list = [];
      }
      index();
      paintHeader();
    })();
    return loading;
  }

  /* ---------- uploading (Controls) ---------- */

  // Centre-crop to a square and shrink until it is small enough to store (the server accepts about 45 KB). 320 px keeps
  // it sharp when someone clicks it to enlarge.
  function shrink(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - side) / 2;
        const sy = (img.naturalHeight - side) / 2;
        for (const px of [320, 256, 192, 128]) {
          const canvas = document.createElement("canvas");
          canvas.width = px; canvas.height = px;
          canvas.getContext("2d").drawImage(img, sx, sy, side, side, 0, 0, px, px);
          for (const [type, q] of [["image/webp", 0.85], ["image/webp", 0.7], ["image/jpeg", 0.8], ["image/jpeg", 0.6]]) {
            const data = canvas.toDataURL(type, q);
            if (data.startsWith(`data:${type}`) && data.length <= 55000) { resolve(data); return; }
          }
        }
        reject(new Error("That picture couldn't be made small enough. Try a simpler one"));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file isn't a picture the browser can open")); };
      img.src = url;
    });
  }

  async function upload(userId, file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) throw new Error("Choose an image file (png, jpeg or webp)");
    const image = await shrink(file);
    await apiPost("admin/users/avatar", { userId, image });
    await load(true);
  }

  async function remove(userId) {
    await apiPost("admin/users/avatar", { userId, image: "" });
    await load(true);
  }

  /* ---------- click a picture to see it bigger ---------- */

  let zoom = null;
  function closeZoom() { if (zoom) { zoom.remove(); zoom = null; } }

  document.addEventListener("click", (e) => {
    if (zoom && (e.target === zoom || e.target.closest(".av-zoom-close"))) { closeZoom(); return; }
    const img = e.target.closest && e.target.closest(".av.has-pic img");
    if (!img || e.target.closest(".av-zoom")) return;
    e.preventDefault();
    e.stopPropagation();
    closeZoom();
    const name = img.closest(".av").dataset.name || "";
    zoom = document.createElement("div");
    zoom.className = "av-zoom";
    zoom.setAttribute("role", "dialog");
    zoom.setAttribute("aria-modal", "true");
    zoom.setAttribute("aria-label", name ? `${name}'s picture` : "Profile picture");
    zoom.innerHTML = `<figure><img src="${img.src}" alt="${escapeHtml(name)}">${name ? `<figcaption>${escapeHtml(name)}</figcaption>` : ""}<button type="button" class="av-zoom-close" aria-label="Close">Close</button></figure>`;
    document.body.append(zoom);
    zoom.querySelector("button").focus();
  }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && zoom) closeZoom(); });

  const hooks = window.dmeHooks;
  const previousSignedIn = hooks.onSignedIn;
  hooks.onSignedIn = () => { previousSignedIn?.(); paintHeader(); load(true); };
  const previousSignedOut = hooks.onSignedOut;
  hooks.onSignedOut = () => { previousSignedOut?.(); closeZoom(); list = []; index(); paintHeader(); loading = null; };

  window.dmeAvatars = { html, load, ready: () => loading || load(), upload, remove, has: (who) => Boolean(find(who) && find(who).image), find };
  if (getSession()) { paintHeader(); load(true); }
})();
