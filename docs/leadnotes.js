/* Team notes on a lead, without claiming it: short comments and tags that the whole team sees.
   Shown on an opened Prospect card and in the call panel (both for prospects and claimed leads).
   Uses GET /leads/annotations and POST /leads/annotations/{comment,tag,tag/remove} (sql/049).
   Comments are never edited or deleted; a tag can be removed by whoever added it or an admin.
   Wired through window.dmeHooks; loaded after app.js and before callmode.js. */
(function (root) {
  "use strict";

  const hooks = root.dmeHooks;
  if (typeof document === "undefined" || !hooks) return;

  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const SUGGESTED = ["wrong specialty", "do not call", "closed", "not interested", "competitor", "patient", "good fit", "wheelchair only", "owner reachable", "call after 2pm", "chain"];
  let popularTags = [...SUGGESTED];
  const MAX_SHOWN_COMMENTS = 5;

  async function loadPopularTags() {
    try {
      const res = await apiGet("leads/annotations/popular-tags");
      if (res && res.tags && res.tags.length) popularTags = res.tags;
    } catch { /* use default SUGGESTED */ }
  }
  loadPopularTags();

  const data = new Map();   // npi -> { installed, comments, tags, suggested }
  const drafts = new Map(); // npi -> { comment, tag } so a redraw does not lose what was typed
  const busy = new Set();

  function ago(iso) {
    const t = Date.parse(iso);
    if (!t) return "";
    const mins = Math.round((Date.now() - t) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} h ago`;
    const days = Math.round(hrs / 24);
    return days < 30 ? `${days} d ago` : new Date(t).toLocaleDateString();
  }

  function me() {
    const s = typeof getSession === "function" ? getSession() : null;
    return { name: s && s.displayName, isAdmin: Boolean(s && s.isAdmin) };
  }

  const draftOf = (npi) => drafts.get(npi) || { comment: "", tag: "" };
  function setDraft(npi, patch) { drafts.set(npi, { ...draftOf(npi), ...patch }); }

  function bodyHtml(npi, noForm) {
    const d = data.get(npi);
    if (!d) return '<span class="muted-note">Loading…</span>';
    if (!d.installed) return '<span class="muted-note">Comments and tags are not set up yet. An admin needs to run sql/049_lead_comments_tags.sql in Supabase.</span>';
    const who = me();
    const have = new Set(d.tags.map((t) => t.tag));
    const canRemove = (t) => who.isAdmin || (who.name && t.by === who.name);
    const tags = d.tags.map((t) => `<span class="ann-tag" title="Added by ${esc(t.by)}">${esc(t.tag)}${canRemove(t) ? `<button type="button" class="ann-x" data-ann-tag-remove="${esc(t.tag)}" aria-label="Remove tag ${esc(t.tag)}">×</button>` : ""}</span>`).join("");
    const suggestions = (d.suggested && d.suggested.length ? d.suggested : SUGGESTED).filter((t) => !have.has(t)).slice(0, 4)
      .map((t) => `<button type="button" class="ann-suggest" data-ann-tag-add="${esc(t)}">+ ${esc(t)}</button>`).join("");
    const shown = d.comments.slice(0, MAX_SHOWN_COMMENTS);
    const comments = shown.length
      ? `<ul class="ann-comments">${shown.map((c) => `<li><span class="ann-meta"><strong>${esc(c.by)}</strong> · ${esc(ago(c.at))}</span><span class="ann-text">${esc(c.text)}</span></li>`).join("")}</ul>${d.comments.length > shown.length ? `<div class="muted-note">+${d.comments.length - shown.length} older</div>` : ""}`
      : '<div class="muted-note ann-none">No comments yet.</div>';
    const draft = draftOf(npi);
    return `<div class="ann-tags">${tags}<input type="text" class="ann-tag-input" maxlength="24" placeholder="Add a tag" aria-label="Add a tag" value="${esc(draft.tag)}"></div>
      ${suggestions ? `<div class="ann-suggestions">${suggestions}</div>` : ""}
      ${comments}
      ${noForm ? "" : `<div class="ann-form"><input type="text" class="ann-comment-input" maxlength="500" placeholder="Leave a comment for the team (no need to claim)" aria-label="Comment" value="${esc(draft.comment)}">
        <button type="button" class="btn btn-ghost btn-small" data-ann-comment-send>Add</button></div>`}`;
  }

  // The read-only tag chips and the fold's label in the call panel.
  function paintSummary(npi) {
    const d = data.get(npi);
    if (!d || !d.installed) return;
    document.querySelectorAll(`[data-ann-chips-npi="${npi}"]`).forEach((el) => {
      el.innerHTML = d.tags.map((t) => `<span class="ann-tag ann-tag-ro" title="Added by ${esc(t.by)}">${esc(t.tag)}</span>`).join("");
    });
    const bits = [];
    if (d.tags.length) bits.push(`${d.tags.length} tag${d.tags.length === 1 ? "" : "s"}`);
    if (d.comments.length) bits.push(`${d.comments.length} comment${d.comments.length === 1 ? "" : "s"}`);
    document.querySelectorAll(`[data-ann-count-npi="${npi}"]`).forEach((el) => {
      el.textContent = bits.length ? `Team notes \u00b7 ${bits.join(", ")}` : "Team notes \u00b7 add a tag or comment";
    });
  }

  function paint(npi, force) {
    paintSummary(npi);
    document.querySelectorAll(`.ann[data-ann-npi="${npi}"] .ann-body`).forEach((box) => {
      const active = document.activeElement;
      const typing = box.contains(active) && active.tagName === "INPUT";
      // Do not rebuild a box the person is typing in, unless something they did just changed it.
      if (typing && !force) return;
      const refocus = typing ? (active.matches(".ann-tag-input") ? ".ann-tag-input" : ".ann-comment-input") : "";
      box.innerHTML = bodyHtml(npi, Boolean(box.closest(".ann") && box.closest(".ann").dataset.annNoform));
      if (refocus) { const el = box.querySelector(refocus); if (el) el.focus(); }
    });
  }

  async function load(npi, fresh) {
    if (!fresh && data.has(npi)) { paint(npi); return; }
    paint(npi);
    try {
      data.set(npi, await apiGet("leads/annotations", { npi }));
    } catch (err) {
      console.log("[leadnotes] " + err.message);
      if (!data.has(npi)) data.set(npi, { installed: true, comments: [], tags: [], suggested: SUGGESTED });
    }
    paint(npi);
  }

  hooks.annotationsBlock = (npi, opts) => {
    if (!npi) return "";
    const compact = Boolean(opts && opts.compact);
    const noForm = Boolean(opts && opts.noForm);
    return `<div class="ann${compact ? " ann-compact" : ""}" data-ann-npi="${esc(npi)}"${noForm ? ' data-ann-noform="1"' : ""}>${compact ? "" : '<h4>Team notes <small>seen by everyone, no claim needed</small></h4>'}<div class="ann-body">${bodyHtml(String(npi), noForm)}</div></div>`;
  };

  // Saves a comment from somewhere else (the call panel's note box) and refreshes every box showing this lead.
  hooks.annotationsPost = async (npi, text) => {
    await apiPost("leads/annotations/comment", { npi, text });
    data.set(npi, await apiGet("leads/annotations", { npi }));
    paint(npi, true);
  };

  // For the call panel's collapsed row: read-only tag chips, and the label of the "Team notes" fold.
  hooks.annotationsChips = (npi) => `<span class="ann-chips" data-ann-chips-npi="${esc(npi)}"></span>`;
  hooks.annotationsLabel = (npi) => `<span data-ann-count-npi="${esc(npi)}">Team notes</span>`;

  // fresh: ask the server again (a card or the call panel just opened); otherwise a redraw reuses what is held.
  hooks.annotationsOpened = (npi, fresh = true) => { if (npi) load(String(npi), fresh); };
  hooks.getPopularTags = () => popularTags;
  hooks.annotationsTag = async (npi, tag) => addTag(npi, tag);

  // Small chips for a table row: up to three tags and a comment count.
  hooks.rowTags = (company) => {
    const tags = (company && company.tags) || [];
    const n = (company && company.commentCount) || 0;
    if (!tags.length && !n) return "";
    return ` <span class="row-tags">${tags.slice(0, 3).map((t) => `<span class="row-tag">${esc(t)}</span>`).join("")}${tags.length > 3 ? `<span class="row-tag">+${tags.length - 3}</span>` : ""}${n ? `<span class="row-tag row-comments" title="${n} team comment${n === 1 ? "" : "s"}">${n} note${n === 1 ? "" : "s"}</span>` : ""}</span>`;
  };

  async function run(npi, fn) {
    if (busy.has(npi)) return;
    busy.add(npi);
    try { await fn(); } catch (err) { showToast(err.message, true); } finally { busy.delete(npi); }
  }

  async function addTag(npi, raw) {
    const tag = String(raw || "").trim();
    if (!tag) return;
    await run(npi, async () => {
      await apiPost("leads/annotations/tag", { npi, tag });
      setDraft(npi, { tag: "" });
      data.set(npi, await apiGet("leads/annotations", { npi }));
      paint(npi, true);
    });
  }

  async function addComment(npi) {
    const text = draftOf(npi).comment.trim();
    if (!text) return;
    await run(npi, async () => {
      await apiPost("leads/annotations/comment", { npi, text });
      setDraft(npi, { comment: "" });
      data.set(npi, await apiGet("leads/annotations", { npi }));
      paint(npi, true);
      showToast("Comment added");
    });
  }

  const npiOf = (el) => { const box = el.closest(".ann"); return box ? box.dataset.annNpi : ""; };

  document.addEventListener("click", (e) => {
    const add = e.target.closest("[data-ann-tag-add]");
    const del = e.target.closest("[data-ann-tag-remove]");
    const send = e.target.closest("[data-ann-comment-send]");
    if (!add && !del && !send) return;
    e.stopPropagation();
    const npi = npiOf(e.target);
    if (!npi) return;
    if (add) addTag(npi, add.dataset.annTagAdd);
    else if (del) {
      run(npi, async () => {
        await apiPost("leads/annotations/tag/remove", { npi, tag: del.dataset.annTagRemove });
        data.set(npi, await apiGet("leads/annotations", { npi }));
        paint(npi, true);
      });
    } else addComment(npi);
  }, true);

  document.addEventListener("input", (e) => {
    const npi = e.target.closest && npiOf(e.target);
    if (!npi) return;
    if (e.target.matches(".ann-comment-input")) setDraft(npi, { comment: e.target.value });
    else if (e.target.matches(".ann-tag-input")) setDraft(npi, { tag: e.target.value });
  });

  // Enter adds the tag or the comment. Stopped here so the call panel's own shortcuts never see it.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !e.target.matches || !e.target.matches(".ann-comment-input, .ann-tag-input")) return;
    e.preventDefault();
    e.stopPropagation();
    const npi = npiOf(e.target);
    if (!npi) return;
    if (e.target.matches(".ann-tag-input")) addTag(npi, e.target.value);
    else addComment(npi);
  }, true);
})(typeof window !== "undefined" ? window : globalThis);
