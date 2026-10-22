/* Folds the "Exclude keywords" chips in the search form: with a long list (25 keywords is normal) the form shows one line of them and a
   "Show all" button, so the filters above and below stay in view. Open or closed is remembered on this device. The chips are still
   there and still count when folded; typing a new keyword opens the list so you can see what you added. */
(function () {
  "use strict";

  const KEY = "dmeKeywordsFold"; // "open" when the person opened it last
  const list = document.getElementById("excludeKeywordsChipList");
  const row = list && list.closest(".field") && list.closest(".field").querySelector(".field-label-row");
  const field = list && list.closest(".field");
  if (!list || !row || !field) return;

  const read = () => { try { return localStorage.getItem(KEY) === "open"; } catch { return false; } };
  const write = (open) => { try { if (open) localStorage.setItem(KEY, "open"); else localStorage.removeItem(KEY); } catch { /* not remembered */ } };

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "link-btn chip-clear kw-fold-btn";
  btn.hidden = true;
  const clear = document.getElementById("clearExcludeKeywordsBtn");
  row.insertBefore(btn, clear || null);

  let open = read();
  function paint() {
    const n = list.children.length;
    // Few keywords always fit on one line, so there is nothing to fold.
    const foldable = n > 6;
    field.classList.toggle("kw-folded", foldable && !open);
    btn.hidden = !foldable;
    btn.textContent = open ? "Show fewer" : "Show all";
    btn.setAttribute("aria-expanded", String(open));
  }
  btn.addEventListener("click", () => { open = !open; write(open); paint(); });
  const entry = document.getElementById("excludeKeywordsEntry");
  if (entry) entry.addEventListener("keydown", (e) => { if (e.key === "Enter" && !open) { open = true; paint(); } });

  const box = document.getElementById("excludeKeywordsChipInput");
  if (box) box.addEventListener("focusin", () => { if (field.classList.contains("kw-folded")) { open = true; paint(); } });

  new MutationObserver(paint).observe(list, { childList: true });
  paint();
})();
