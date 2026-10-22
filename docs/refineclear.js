/* The "Only show" filters under the Prospect results are pills you switch on (see .refine-check in style.css), and a "Clear" button appears
   while any of them is on. Clearing sends the same change events a click would, so the list refreshes exactly as if you had unticked each. */
(function () {
  "use strict";

  const bar = document.getElementById("resultsRefine");
  const grouping = document.getElementById("relatedTogether");
  if (!bar) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "refine-clear";
  btn.hidden = true;
  btn.textContent = "Clear";
  btn.title = "Switch all of these off";
  const right = bar.querySelector(".refine-right");
  bar.insertBefore(btn, right || null);

  const boxes = () => [...bar.querySelectorAll('input[type="checkbox"]')].filter((b) => b !== grouping);
  const tag = () => bar.querySelector('input[name="tag"]');
  const objection = () => bar.querySelector('select[name="objection"]');

  function active() {
    return boxes().filter((b) => b.checked).length + (tag() && tag().value.trim() ? 1 : 0) + (objection() && objection().value ? 1 : 0);
  }
  function paint() {
    const n = active();
    btn.hidden = n === 0;
    btn.textContent = n <= 1 ? "Clear" : `Clear (${n})`;
  }

  btn.addEventListener("click", () => {
    boxes().forEach((b) => { if (b.checked) { b.checked = false; b.dispatchEvent(new Event("change", { bubbles: true })); } });
    if (tag() && tag().value) { tag().value = ""; tag().dispatchEvent(new Event("input", { bubbles: true })); tag().dispatchEvent(new Event("change", { bubbles: true })); }
    if (objection() && objection().value) { objection().value = ""; objection().dispatchEvent(new Event("change", { bubbles: true })); }
    paint();
  });
  bar.addEventListener("change", paint);
  bar.addEventListener("input", paint);
  // The bar is shown again (and its ticks restored from the saved search) elsewhere; look again when that happens.
  new MutationObserver(paint).observe(bar, { attributes: true, attributeFilter: ["hidden", "class"] });
  paint();
})();
