/* Call mode: step through a list of leads one at a time.
   Claimed leads: Call, pick a result, optional note and callback, Save & next.
   Prospect results: Call, then Claim & next or Skip.
   Also: Back, an "up next" list you can jump around in, every phone number on
   file, Book meeting (claimed), keyboard shortcuts, and a summary at the end
   that lets you go back through the ones you skipped.
   Uses the same endpoints as the call log and claim buttons; nothing new on the server.
   Loaded after app.js and shares its globals (state, els, apiPost, showToast, ...). */
(function () {
  "use strict";

  const CALLBACK_CHOICES = [
    { days: 1, label: "Tomorrow" },
    { days: 3, label: "3 days" },
    { days: 7, label: "1 week" },
    { days: 14, label: "2 weeks" },
  ];
  const UP_NEXT_SHOWN = 4;

  const run = {
    mode: "claimed", // "claimed" | "prospect"
    queue: [],
    outcome: [], // per lead: null | { kind: "saved" | "skipped", label }
    pos: 0,
    busy: false,
    status: "",
    remind: "",
    note: "",
    startedAt: 0,
    shuffle: false,
    order: null, // each lead's place in the list as it was handed over, to undo a shuffle
    undo: null,  // { npi, name, pos }: the claim that can still be taken back
  };
  const SHUFFLE_KEY = "dmeProspectorCallShuffle";
  const UNDO_MS = 10000;
  // What a rep can tap on a prospect: each claims the lead with that result and moves on.
  const PROSPECT_RESULTS = [
    ["voicemail", "Voicemail"], ["no answer", "No answer"], ["gatekeeper", "Gatekeeper"],
    ["interested", "Interested"], ["not interested", "Not interested"], ["disconnected", "Disconnected"],
  ];
  let undoTimer = null;

  let backdrop = null;
  let drawer = null;

  const isOpen = () => Boolean(drawer) && !drawer.hidden;

  function build() {
    if (drawer) return;
    backdrop = document.createElement("div");
    backdrop.className = "call-backdrop";
    backdrop.hidden = true;
    drawer = document.createElement("aside");
    drawer.className = "call-drawer";
    drawer.id = "callDrawer";
    drawer.hidden = true;
    drawer.tabIndex = -1;
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-label", "Call mode");
    document.body.append(backdrop, drawer);

    backdrop.addEventListener("click", close);
    drawer.addEventListener("click", onClick);
    drawer.addEventListener("input", (e) => {
      if (e.target.classList.contains("cm-note")) run.note = e.target.value;
    });
    document.addEventListener("keydown", onKey);
  }

  /* ---------- what to show for each kind of lead ---------- */

  const digits = (value) => String(value || "").replace(/\D/g, "").slice(-10);

  // Every number on file, best first, one entry per distinct number.
  function phoneOptions(item) {
    const list = [];
    const add = (label, number) => {
      const clean = String(number || "").trim();
      if (!clean || list.some((p) => digits(p.number) === digits(clean))) return;
      list.push({ label, number: clean });
    };
    if (run.mode === "prospect") {
      (item.decisionMakers || []).forEach((dm) => add([dm.name, dm.title].filter(Boolean).join(", ") || "Contact", dm.phone));
      add("Main line", item.phone);
    } else {
      add(item.contactName ? `${item.contactName} (direct)` : "Contact", item.contactPhone);
      add("Main line", item.companyPhone);
    }
    return list;
  }

  function describe(item) {
    if (run.mode === "prospect") {
      const dm = (item.decisionMakers || []).find((d) => (d.phone || "").trim()) || (item.decisionMakers || [])[0];
      const addr = item.address || {};
      const claims = item.medicare && typeof item.medicare.totalClaims === "number" ? item.medicare.totalClaims : null;
      return {
        name: item.name,
        contact: dm ? [dm.name, dm.title].filter(Boolean).join(" — ") : "",
        place: [addr.city, addr.state].filter(Boolean).join(", "),
        stateCode: addr.state || "",
        specialty: item.taxonomy && item.taxonomy.description,
        website: item.website || "",
        claims,
        prior: item.priorContact || null,
        opener: "",
        lastNote: "",
        meeting: "",
      };
    }
    const lines = String(item.notes || "").split("\n").map((x) => x.trim()).filter(Boolean);
    const claims = item.medicareClaims !== "" && item.medicareClaims != null && !Number.isNaN(Number(item.medicareClaims)) ? Number(item.medicareClaims) : null;
    return {
      name: item.name,
      contact: [item.contactName, item.contactTitle].filter(Boolean).join(" — "),
      place: [item.city, item.state].filter(Boolean).join(", "),
      stateCode: item.state || "",
      specialty: item.taxonomy,
      website: item.website || "",
      claims,
      prior: null,
      opener: item.meetingAt && !meetingIsPast(item) ? (item.meetingOpenerNotes || "") : "",
      lastNote: lines[0] || "",
      meeting: item.meetingAt ? formatMeeting(item.meetingAt) : "",
    };
  }

  /* ---------- rendering ---------- */

  function counts() {
    const saved = run.outcome.filter((o) => o && o.kind === "saved").length;
    const skipped = run.outcome.filter((o) => o && o.kind === "skipped").length;
    return { saved, skipped, left: run.queue.length - saved - skipped };
  }

  function chipsHtml(list, cls, current) {
    return list.map((value) =>
      `<button type="button" class="choice-chip ${cls}${value === current ? " active" : ""}" data-value="${escapeHtml(value)}">${escapeHtml(value)}</button>`
    ).join("");
  }

  function callBlockHtml(phones) {
    if (!phones.length) return '<div class="cm-hint cm-nophone">No phone number on file for this lead.</div>';
    const [first, ...others] = phones;
    const href = (n) => `tel:${escapeHtml(n.replace(/[^\d+*#]/g, ""))}`;
    return `<div class="cm-call">
        <a class="btn btn-primary cm-call-btn" href="${href(first.number)}" data-cm="called">${SIGNAL_ICONS.phone}<span>Call ${escapeHtml(first.number)}</span></a>
        <button type="button" class="btn btn-ghost" data-copy-phone="${escapeHtml(first.number)}">${SIGNAL_ICONS.copy}<span>Copy</span></button>
      </div>
      <div class="cm-hint">${escapeHtml(first.label)}</div>
      ${others.length ? `<div class="cm-others">${others.map((p) => `
        <div class="cm-other">
          <span class="cm-other-label">${escapeHtml(p.label)}</span>
          <a class="btn btn-ghost btn-small" href="${href(p.number)}" data-cm="called">${SIGNAL_ICONS.phone}${escapeHtml(p.number)}</a>
          <button type="button" class="link-btn" data-copy-phone="${escapeHtml(p.number)}">Copy</button>
        </div>`).join("")}</div>` : ""}`;
  }

  function upNextHtml() {
    const rest = [];
    for (let i = run.pos + 1; i < run.queue.length && rest.length < UP_NEXT_SHOWN; i++) {
      if (!run.outcome[i]) rest.push(i);
    }
    if (!rest.length) return "";
    const more = run.queue.length - run.pos - 1 - rest.length;
    return `<div class="cm-label">Up next</div>
      <div class="cm-next">${rest.map((i) => {
        const info = describe(run.queue[i]);
        return `<button type="button" class="cm-next-row" data-cm-jump="${i}" title="Jump to this lead">
          <span class="cm-next-name">${escapeHtml(info.name)}</span>
          <span class="cm-next-sub">${escapeHtml(info.place)}</span></button>`;
      }).join("")}${more > 0 ? `<div class="cm-hint">+ ${more} more</div>` : ""}</div>`;
  }

  function undoHtml() {
    if (!run.undo) return "";
    return `<div class="cm-undo" role="status"><span>Claimed <strong>${escapeHtml(run.undo.name)}</strong>${run.undo.status ? ` as ${escapeHtml(run.undo.status)}` : ""}.</span>
      <button type="button" class="link-btn" data-cm="undo">Undo</button></div>`;
  }

  function offerUndo(item, status) {
    clearTimeout(undoTimer);
    run.undo = { npi: String(item.npi), name: item.name, status, pos: run.pos };
    undoTimer = setTimeout(() => { run.undo = null; drawer?.querySelector(".cm-undo")?.remove(); }, UNDO_MS);
  }

  // Takes the last claim back (returns the lead to Prospect) and goes back to that lead.
  async function undoClaim() {
    const u = run.undo;
    if (!u || run.busy) return;
    run.busy = true;
    try {
      await apiPost("leads/return-to-prospect", { npis: [u.npi] });
      clearTimeout(undoTimer);
      run.undo = null;
      state.claimedLoaded = false;
      run.outcome[u.pos] = null;
      showToast(`${u.name} is back in Prospect`);
      goTo(u.pos);
    } catch (err) {
      showToast(err.message, true);
    } finally {
      run.busy = false;
    }
  }

  // Random order for the leads still to call; turning it off puts them back as they were given.
  function reorderRest() {
    const slots = [];
    for (let i = run.pos + 1; i < run.queue.length; i++) if (!run.outcome[i]) slots.push(i);
    const items = slots.map((i) => run.queue[i]);
    if (run.shuffle) {
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
    } else {
      items.sort((a, b) => run.order.get(a) - run.order.get(b));
    }
    slots.forEach((slot, k) => { run.queue[slot] = items[k]; });
  }

  function toggleShuffle() {
    run.shuffle = !run.shuffle;
    try { localStorage.setItem(SHUFFLE_KEY, run.shuffle ? "1" : "0"); } catch { /* not remembered */ }
    reorderRest();
    render();
  }

  function render() {
    if (!drawer) return;
    if (run.pos >= run.queue.length) { renderDone(); return; }
    const item = run.queue[run.pos];
    const info = describe(item);
    const total = run.queue.length;
    const c = counts();
    const pct = Math.round(((c.saved + c.skipped) / total) * 100);

    let facts = "";
    if (info.claims != null) facts += `<span class="cm-fact">${info.claims.toLocaleString()} Medicare claims</span>`;
    if (info.website) facts += `<a class="cm-fact cm-fact-link" href="${escapeHtml(info.website)}" target="_blank" rel="noopener">Website</a>`;
    if (info.meeting) facts += `<span class="cm-fact is-meeting">📅 ${escapeHtml(info.meeting)}</span>`;

    let context = "";
    if (info.prior) context += priorContactBannerHtml(info.prior);
    if (info.opener) context += `<div class="opener-notes"><div class="opener-label">Your opener</div><div class="opener-text">${escapeHtml(info.opener)}</div></div>`;
    if (info.lastNote) context += `<div class="cm-lastnote"><span>Last note</span>${escapeHtml(info.lastNote)}</div>`;

    let work;
    let primaryLabel;
    if (run.mode === "claimed") {
      primaryLabel = "Save & next";
      work = `
        <div class="cm-label">How did it go?</div>
        <div class="cm-chips">${chipsHtml(callResultStatuses(), "cm-status", run.status)}</div>
        <textarea class="cm-note" rows="3" maxlength="500" placeholder="Add a note (optional)">${escapeHtml(run.note)}</textarea>
        <div class="cm-label">Call back</div>
        <div class="cm-chips">
          ${CALLBACK_CHOICES.map((o) => `<button type="button" class="choice-chip cm-remind${String(o.days) === run.remind ? " active" : ""}" data-value="${o.days}">${o.label}</button>`).join("")}
        </div>
        <div class="cm-more"><button type="button" class="text-action" data-cm="meeting">📅 ${item.meetingAt && !meetingIsPast(item) ? "Edit meeting" : "Book a meeting"}</button></div>`;
    } else {
      primaryLabel = "";
      work = `
        <div class="cm-label">How did it go? <span class="cm-hint-inline">Tap a result to claim this lead and move on</span></div>
        <div class="cm-chips">${PROSPECT_RESULTS.map(([value, label]) => `<button type="button" class="choice-chip cm-status${value === "disconnected" ? " is-danger" : ""}" data-value="${value}">${label}</button>`).join("")}</div>
        <textarea class="cm-note" rows="3" maxlength="500" placeholder="Add a note first (optional)">${escapeHtml(run.note)}</textarea>
        <div class="cm-more"><button type="button" class="text-action" data-cm="primary">Claim without a result</button></div>`;
    }

    drawer.innerHTML = `
      <div class="cm-head">
        <div>
          <div class="cm-kicker">${run.mode === "claimed" ? "Calling your leads" : "Calling prospects"}</div>
          <div class="cm-count">${run.pos + 1} of ${total}</div>
        </div>
        <div class="cm-head-meta"><span>${c.saved} ${run.mode === "claimed" ? "logged" : "claimed"}</span><span>${c.skipped} skipped</span><span>${c.left} left</span></div>
        ${total > 1 ? `<button type="button" class="btn btn-ghost btn-small cm-shuffle${run.shuffle ? " is-on" : ""}" data-cm="shuffle" aria-pressed="${run.shuffle}" title="Take the leads still to call in a random order">Shuffle</button>` : ""}
        <button type="button" class="btn btn-ghost btn-small" data-cm="close">Close</button>
      </div>
      <div class="cm-progress" aria-hidden="true"><span style="width:${pct}%"></span></div>
      <div class="cm-body">
        ${undoHtml()}
        <div class="cm-name">${escapeHtml(info.name)}</div>
        ${info.contact ? `<div class="cm-sub">${escapeHtml(info.contact)}</div>` : ""}
        <div class="cm-sub cm-muted">${escapeHtml([info.place, info.specialty].filter(Boolean).join(" · "))} ${window.dmeHooks.localTime?.(info.stateCode) || ""}</div>
        ${facts ? `<div class="cm-facts">${facts}</div>` : ""}
        ${callBlockHtml(phoneOptions(item))}
        ${context}
        ${work}
        ${upNextHtml()}
      </div>
      <div class="cm-foot">
        <button type="button" class="btn btn-ghost" data-cm="back" ${run.pos === 0 ? "disabled" : ""} title="Previous lead (←)">Back</button>
        <button type="button" class="btn btn-ghost" data-cm="skip" title="Skip this lead (→)">Skip</button>
        ${primaryLabel ? `<button type="button" class="btn btn-primary" data-cm="primary" title="Ctrl+Enter">${primaryLabel}</button>` : ""}
      </div>
      <div class="cm-keys">← back · → skip · ${run.mode === "claimed" ? "Ctrl+Enter save · " : "Ctrl+Enter claim without a result · "}Esc close</div>`;
  }

  function renderDone() {
    const c = counts();
    let breakdown = "";
    if (run.mode === "claimed") {
      const tally = new Map();
      run.outcome.forEach((o) => { if (o && o.kind === "saved") tally.set(o.label, (tally.get(o.label) || 0) + 1); });
      breakdown = [...tally.entries()].sort((a, b) => b[1] - a[1])
        .map(([label, n]) => `<span class="cm-fact">${n} × ${escapeHtml(label)}</span>`).join("");
    }
    const skippedAny = c.skipped > 0;
    drawer.innerHTML = `
      <div class="cm-head">
        <div><div class="cm-kicker">Call list finished</div><div class="cm-count">All done</div></div>
        <button type="button" class="btn btn-ghost btn-small" data-cm="close">Close</button>
      </div>
      <div class="cm-progress" aria-hidden="true"><span style="width:100%"></span></div>
      <div class="cm-body cm-done">
        ${undoHtml()}
        <div class="cm-done-num">${c.saved}</div>
        <div class="cm-sub">${c.saved === 1 ? "lead" : "leads"} ${run.mode === "claimed" ? "logged" : "claimed"}${skippedAny ? `, ${c.skipped} skipped` : ""}.</div>
        ${breakdown ? `<div class="cm-facts cm-facts-center">${breakdown}</div>` : ""}
      </div>
      <div class="cm-foot">
        ${skippedAny ? '<button type="button" class="btn btn-ghost" data-cm="redo">Go through skipped</button>' : ""}
        <button type="button" class="btn btn-primary" data-cm="close">Done</button>
      </div>`;
  }

  /* ---------- actions ---------- */

  function goTo(pos) {
    run.pos = pos;
    run.status = "";
    run.remind = "";
    run.note = "";
    render();
  }

  function nextOpen(from) {
    for (let i = from; i < run.queue.length; i++) if (!run.outcome[i]) return i;
    return run.queue.length;
  }

  async function saveClaimed(item) {
    const note = run.note.trim();
    const status = run.status;
    const remind = run.remind;
    if (!status && !note && !remind) {
      showToast("Pick a result, add a note or a callback, or press Skip", true);
      return null;
    }
    // Same three calls as the call log on a claimed lead's card.
    if (status && status !== item.status) {
      item.status = (await apiPost("leads/status", { npi: item.npi, status })).status;
    }
    if (status || note) {
      const data = await apiPost("leads/notes", { npi: item.npi, note: [status, note].filter(Boolean).join(" — ") });
      item.notes = data.notes;
    }
    if (remind) {
      const data = await apiPost("leads/reminder", { npi: item.npi, reminderAt: remindDateIso(remind) });
      item.reminderAt = data.reminderAt;
    }
    return status || (remind ? "callback set" : "note added");
  }

  async function claimProspect(company) {
    const data = await apiPost("export/sheets", { companies: [company] });
    state.claimedLoaded = false;
    const npi = String(company.npi);
    const claimed = data.claimedNpis ? data.claimedNpis.map(String).includes(npi) : true;
    const already = (data.alreadyClaimedNpis || []).map(String).includes(npi);
    const blocked = (data.blocked || []).some((b) => String(b.npi) === npi);
    if (claimed || already || blocked) removeCompaniesFromProspect([company]);
    if (blocked) { showToast("Couldn't claim this one: a teammate owns it or it is held for review", true); return null; }
    showToast(already ? "You already had this lead" : "Claimed");
    return already ? "already yours" : "claimed";
  }

  // The result and note go on the lead once it is claimed (they need a claimed lead to be written to).
  async function recordOnClaimed(npi, status, note) {
    try {
      if (status) await apiPost("leads/status", { npi, status });
      if (status || note) await apiPost("leads/notes", { npi, note: [status, note].filter(Boolean).join(" \u2014 ") });
    } catch (err) {
      showToast(`Claimed, but the result didn't save: ${err.message}`, true);
    }
  }

  // A tap on a result chip in prospect mode: claim, record the result, move on.
  async function prospectResult(status) {
    if (run.busy) return;
    const item = run.queue[run.pos];
    const note = run.note.trim();
    run.busy = true;
    drawer.querySelectorAll(".cm-status").forEach((b) => { b.disabled = true; });
    try {
      if (status === "disconnected") {
        // Not a claim: the lead goes to the shared Disconnected list, which can't be undone.
        if (!confirm(`Send ${item.name} to Disconnected? It leaves Prospect for everyone and can't be undone.`)) return;
        await apiPost("export/disconnected", { companies: [item] });
        removeCompaniesFromProspect([item]);
        run.outcome[run.pos] = { kind: "saved", label: "disconnected" };
        run.undo = null;
        goTo(nextOpen(run.pos + 1));
        return;
      }
      const label = await claimProspect(item);
      if (!label) return;
      await recordOnClaimed(String(item.npi), status, note);
      run.outcome[run.pos] = { kind: "saved", label: status };
      if (label === "claimed") offerUndo(item, status); else run.undo = null; // a lead that was already yours isn't undone
      goTo(nextOpen(run.pos + 1));
    } catch (err) {
      showToast(err.message, true);
    } finally {
      run.busy = false;
      drawer.querySelectorAll(".cm-status").forEach((b) => { b.disabled = false; });
    }
  }

  async function primary() {
    if (run.busy) return;
    const item = run.queue[run.pos];
    run.busy = true;
    drawer.querySelectorAll('[data-cm="primary"]').forEach((b) => { b.disabled = true; });
    try {
      let label;
      if (run.mode === "claimed") {
        label = await saveClaimed(item);
      } else {
        label = await claimProspect(item); // a claim with no result
        if (label && run.note.trim()) await recordOnClaimed(String(item.npi), "", run.note.trim());
        if (label === "claimed") offerUndo(item, ""); else run.undo = null;
      }
      if (label) {
        run.outcome[run.pos] = { kind: "saved", label };
        goTo(nextOpen(run.pos + 1));
      }
    } catch (err) {
      showToast(err.message, true);
    } finally {
      run.busy = false;
      drawer.querySelectorAll('[data-cm="primary"]').forEach((b) => { b.disabled = false; });
    }
  }

  function skip() {
    if (run.busy) return;
    run.outcome[run.pos] = { kind: "skipped", label: "skipped" };
    goTo(nextOpen(run.pos + 1));
  }

  function back() {
    if (run.pos === 0) return;
    // Previous lead; a skipped one becomes open again, a saved one is only viewed.
    let target = run.pos - 1;
    if (run.outcome[target] && run.outcome[target].kind === "skipped") run.outcome[target] = null;
    goTo(target);
  }

  function redoSkipped() {
    const keep = [];
    run.queue.forEach((item, i) => { if (run.outcome[i] && run.outcome[i].kind === "skipped") keep.push(item); });
    run.queue = keep;
    run.outcome = keep.map(() => null);
    goTo(0);
  }

  function bookMeeting() {
    const item = run.queue[run.pos];
    // The dialog edits a lead by its row on the Claimed page; one that isn't on this page is kept alongside it.
    openMeetingModal(claimedIndexFor(item));
  }

  function onClick(e) {
    const jump = e.target.closest("[data-cm-jump]");
    if (jump) { goTo(Number(jump.dataset.cmJump)); return; }
    const cm = e.target.closest("[data-cm]");
    if (cm) {
      const act = cm.dataset.cm;
      if (act === "close") close();
      else if (act === "skip") skip();
      else if (act === "back") back();
      else if (act === "primary") primary();
      else if (act === "undo") undoClaim();
      else if (act === "shuffle") toggleShuffle();
      else if (act === "meeting") bookMeeting();
      else if (act === "redo") redoSkipped();
      // "called" is a plain tel: link; nothing to do beyond letting it dial.
      return;
    }
    const chip = e.target.closest(".cm-status, .cm-remind");
    if (!chip) return;
    if (run.mode === "prospect" && chip.classList.contains("cm-status")) { prospectResult(chip.dataset.value); return; }
    const isStatus = chip.classList.contains("cm-status");
    const was = chip.classList.contains("active");
    drawer.querySelectorAll(isStatus ? ".cm-status" : ".cm-remind").forEach((c) => c.classList.remove("active"));
    if (!was) chip.classList.add("active");
    const value = was ? "" : chip.dataset.value;
    if (isStatus) {
      run.status = value;
      // "Call back" style results get a callback suggested, as the call log does.
      if (value && isCallbackStatus(value) && !run.remind) {
        run.remind = "1";
        drawer.querySelectorAll(".cm-remind").forEach((c) => c.classList.toggle("active", c.dataset.value === "1"));
      }
    } else {
      run.remind = value;
    }
  }

  function onKey(e) {
    if (!isOpen()) return;
    // The meeting dialog (and the palette) sit above the drawer: leave them alone.
    if (e.key === "Escape") {
      if (!els.meetingOverlay.hidden || !palette.overlay.hidden) return;
      close();
      return;
    }
    if (run.pos >= run.queue.length) return;
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); primary(); return; }
    const typing = e.target.closest && e.target.closest("textarea, input, select");
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "ArrowRight") { e.preventDefault(); skip(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
  }

  /* ---------- open / close ---------- */

  function start(items, mode) {
    const list = (items || []).filter(Boolean);
    if (!list.length) { showToast("Nothing to call yet", true); return; }
    build();
    let shuffle = false;
    try { shuffle = localStorage.getItem(SHUFFLE_KEY) === "1"; } catch { /* not remembered */ }
    clearTimeout(undoTimer);
    Object.assign(run, {
      mode, queue: list, outcome: list.map(() => null), pos: -1, busy: false, status: "", remind: "", note: "", startedAt: Date.now(),
      shuffle, order: new Map(list.map((item, i) => [item, i])), undo: null,
    });
    if (shuffle) reorderRest(); // pos -1: every lead is still to call
    run.pos = 0;
    backdrop.hidden = false;
    drawer.hidden = false;
    document.documentElement.classList.add("call-open");
    render();
    drawer.focus();
  }

  function close() {
    if (!isOpen()) return;
    drawer.hidden = true;
    backdrop.hidden = true;
    clearTimeout(undoTimer);
    run.undo = null;
    document.documentElement.classList.remove("call-open");
    const saved = counts().saved;
    if (run.mode === "claimed" && saved > 0) {
      // Fresh from the server, not the queue's copies, which may be stale by now.
      loadClaimedLeads(true).then(() => window.dmeHooks.onClaimedChanged?.());
    } else if (saved > 0) {
      window.dmeHooks.onClaimedChanged?.();
    }
  }

  /* ---------- buttons in the two tables ---------- */

  function syncStartButtons() {
    const p = document.getElementById("startCallingProspectBtn");
    const c = document.getElementById("startCallingClaimedBtn");
    if (p) {
      const n = state.selected.size;
      p.disabled = n === 0;
      document.getElementById("startCallingProspectLabel").textContent = n ? `Call ${n} selected` : "Start calling";
    }
    if (c) {
      const n = state.claimedSelected.size;
      c.disabled = n === 0;
      document.getElementById("startCallingClaimedLabel").textContent = n ? `Call ${n} selected` : "Start calling";
    }
  }

  document.getElementById("startCallingProspectBtn")?.addEventListener("click", () => start(getSelectedProspectCompanies(), "prospect"));
  document.getElementById("startCallingClaimedBtn")?.addEventListener("click", () => start(getCheckedClaimedLeads(), "claimed"));

  const previousSelectionHook = window.dmeHooks.onSelectionChanged;
  window.dmeHooks.onSelectionChanged = () => { previousSelectionHook?.(); syncStartButtons(); };
  const previousSignedOut = window.dmeHooks.onSignedOut;
  window.dmeHooks.onSignedOut = () => { previousSignedOut?.(); close(); };
  // A meeting booked from inside call mode changes the lead: show it, keeping the note being typed.
  const previousChanged = window.dmeHooks.onClaimedChanged;
  window.dmeHooks.onClaimedChanged = () => {
    previousChanged?.();
    if (isOpen() && run.pos < run.queue.length) render();
  };
  syncStartButtons();

  // The lead on screen (claimed or prospect), so a tap on its phone number can be recorded against it.
  const current = () => (isOpen() && run.pos < run.queue.length ? run.queue[run.pos] : null);

  window.dmeCall = { start, close, current };
})();
