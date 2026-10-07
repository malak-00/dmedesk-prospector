/* Makes every section in the Admin tab collapsible: the blocks in Team activity, and each section (and each
   sub-section) in Controls. Click a heading to fold or unfold it; what you fold is remembered on this computer.
   The Review queues already fold from their own toolbars (team.js). The Admin panels are redrawn often, so this
   watches them and decorates whatever appears. Loaded after team.js and controls.js. */
(function () {
  "use strict";

  const KEY = "dmeProspectorAdminFolds";
  let folded = new Set();
  try { folded = new Set(JSON.parse(localStorage.getItem(KEY)) || []); } catch { /* nothing remembered */ }

  const remember = () => { try { localStorage.setItem(KEY, JSON.stringify([...folded])); } catch { /* not remembered */ } };

  // Folds `nodes` (everything a heading governs) behind `head`, clicking `trigger` to toggle.
  function foldAfter(head, trigger, nodes, name) {
    const body = document.createElement("div");
    body.className = "fold-body";
    head.after(body);
    nodes.forEach((n) => body.append(n));
    trigger.classList.add("fold-head");
    trigger.tabIndex = 0;
    trigger.setAttribute("role", "button");
    const apply = (fold) => {
      body.hidden = fold;
      trigger.setAttribute("aria-expanded", String(!fold));
    };
    apply(folded.has(name));
    const toggle = () => {
      const fold = trigger.getAttribute("aria-expanded") !== "false";
      apply(fold);
      if (fold) folded.add(name); else folded.delete(name);
      remember();
    };
    trigger.addEventListener("click", (e) => { if (!e.target.closest("select, input, button, a, label")) toggle(); });
    trigger.addEventListener("keydown", (e) => {
      if (e.target === trigger && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggle(); }
    });
  }

  // A heading governs its following siblings up to the next heading of the same kind.
  function foldHeading(h, scope) {
    if (h.dataset.fold) return;
    h.dataset.fold = "1";
    const nodes = [];
    for (let n = h.nextSibling; n && !(n.nodeType === 1 && n.tagName === h.tagName); n = n.nextSibling) nodes.push(n);
    if (!nodes.some((n) => n.nodeType === 1)) return;
    foldAfter(h, h, nodes, `${scope}/${h.textContent.trim()}`);
  }

  // The funnel's heading shares a row with its picker, so the whole row is the header.
  function foldFunnel(block, scope) {
    const head = block.querySelector(":scope > .funnel-head");
    if (!head || head.dataset.fold) return;
    head.dataset.fold = "1";
    const nodes = [];
    for (let n = head.nextSibling; n; n = n.nextSibling) nodes.push(n);
    foldAfter(head, head.querySelector("h4") || head, nodes, `${scope}/${(head.querySelector("h4") || head).textContent.trim()}`);
  }

  function enhance(panel, scope) {
    if (!panel || !panel.firstElementChild) return;
    panel.querySelectorAll("h3.ctl-h").forEach((h) => foldHeading(h, scope));
    panel.querySelectorAll(".team-block > h4, .team-userblock > h4").forEach((h) => foldHeading(h, scope));
    panel.querySelectorAll(".team-funnel").forEach((b) => foldFunnel(b, scope));
  }

  [["teamPanel", "Team"], ["controlsPanel", "Controls"]].forEach(([id, scope]) => {
    const panel = document.getElementById(id);
    if (!panel) return;
    let queued = false;
    const run = () => { queued = false; enhance(panel, scope); };
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(run);
    }).observe(panel, { childList: true, subtree: true });
    run();
  });
})();
