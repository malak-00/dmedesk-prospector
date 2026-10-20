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
    open: { more: false, notes: false }, // which folds are open; kept across redraws
    briefOpen: false, // the call brief panel beside the call panel
  };
  const SHUFFLE_KEY = "dmeProspectorCallShuffle";
  const UNDO_MS = 10000;
  // What a rep can pick as the result of a call on a prospect: the same list as a claimed lead's call log
  // (including any statuses the team added), plus Disconnected, which moves the lead out instead of noting it.
  const prospectResults = () => [...callResultStatuses().filter((v) => v !== "disconnected"), "disconnected"];
  const capital = (value) => String(value || "").charAt(0).toUpperCase() + String(value || "").slice(1);
  let undoTimer = null;

  let backdrop = null;
  let drawer = null;
  let briefPanel = null; // the call brief, a second panel to the left of the call panel
  let briefShownFor = ""; // NPI of the lead the brief panel currently shows
  let briefToken = 0; // guards against an older answer arriving after a newer one

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
    briefPanel = document.createElement("aside");
    briefPanel.className = "call-brief-panel";
    briefPanel.id = "callBriefPanel";
    briefPanel.hidden = true;
    briefPanel.setAttribute("role", "complementary");
    briefPanel.setAttribute("aria-label", "Call brief");
    briefPanel.innerHTML = `<div class="cbp-head"><div><div class="cm-kicker">Call brief</div><div class="cbp-name"></div></div>
        <button type="button" class="btn btn-ghost btn-small" data-cbp="close">Close</button></div>
      <div class="cbp-body"></div>`;
    briefPanel.addEventListener("click", (e) => { if (e.target.closest('[data-cbp="close"]')) setBrief(false); });
    document.body.append(backdrop, drawer, briefPanel);

    backdrop.addEventListener("click", close);
    drawer.addEventListener("click", onClick);
    drawer.addEventListener("toggle", (e) => {
      const fold = e.target.closest && e.target.closest("[data-fold]");
      if (fold && run.open) run.open[fold.dataset.fold] = fold.open;
    }, true);
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
    // A number the team flagged as wrong or not in service goes to the end, marked, so the next one is offered.
    const flagged = run.bad && run.bad.get(String(item.npi));
    list.forEach((p) => { const f = flagged && flagged.get(digits(p.number)); if (f) p.bad = f; });
    return list.filter((p) => !p.bad).concat(list.filter((p) => p.bad));
  }

  /* ---------- wrong numbers (sql/038) ---------- */

  function setBad(npi, number, info) {
    const key = String(npi);
    if (!run.bad.has(key)) run.bad.set(key, new Map());
    run.bad.get(key).set(digits(number), info);
  }

  async function loadBad(list) {
    const npis = [...new Set(list.map((i) => String(i.npi)).filter((n) => /^\d{10}$/.test(n)))];
    for (let i = 0; i < npis.length; i += 100) {
      try {
        const res = await apiGet("leads/bad-numbers", { npis: npis.slice(i, i + 100).join(",") });
        (res.flags || []).forEach((f) => setBad(f.npi, f.number, f));
      } catch (err) { console.log("[callmode] " + err.message); }
    }
    if (isOpen() && run.bad.size) render();
  }

  async function flagBad(number, reason) {
    const item = run.queue[run.pos];
    if (!item || run.busy) return;
    run.busy = true;
    try {
      await apiPost("leads/bad-number", { npi: item.npi, number, reason });
      setBad(item.npi, number, { reason, by: getSession()?.displayName || "" });
      if (reason === "disconnected" && allNotInService(item)) {
        await autoDisconnect(item);
        return;
      }
      run.badUndo = { npi: String(item.npi), number: digits(number), reason };
      render();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      run.busy = false;
    }
  }

  // Two or more numbers on file and every one flagged "not in service": the line is dead, so the lead goes to
  // Disconnected without asking. A "wrong number" flag does not count (the number may be right for someone else).
  function allNotInService(item) {
    const phones = phoneOptions(item);
    return phones.length >= 2 && phones.every((p) => p.bad && p.bad.reason === "disconnected");
  }

  async function autoDisconnect(item) {
    if (run.mode === "prospect") {
      await apiPost("export/disconnected", { companies: [item] });
      removeCompaniesFromProspect([item]);
    } else {
      await apiPost("leads/disconnect", { npis: [item.npi] });
      state.claimedLoaded = false;
    }
    run.outcome[run.pos] = { kind: "saved", label: "disconnected" };
    run.undo = null;
    run.badUndo = null;
    showToast(`${item.name}: every number is not in service, so it was moved to Disconnected`);
    goTo(nextOpen(run.pos + 1));
  }

  async function unflagBad(number) {
    const item = run.queue[run.pos];
    if (!item || run.busy) return;
    run.busy = true;
    try {
      await apiPost("leads/bad-number/clear", { npi: item.npi, number });
      const m = run.bad.get(String(item.npi));
      if (m) m.delete(digits(number));
      run.badUndo = null;
      render();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      run.busy = false;
    }
  }

  const REASON_LABEL = { wrong: "Wrong number", disconnected: "Not in service" };

  function badUndoHtml() {
    const u = run.badUndo;
    if (!u || u.npi !== String((run.queue[run.pos] || {}).npi)) return "";
    return `<div class="cm-undo" role="status"><span>Flagged <strong>${escapeHtml(u.number.replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3"))}</strong> as ${escapeHtml((REASON_LABEL[u.reason] || "bad").toLowerCase())}. It won't be offered again.</span>
      <button type="button" class="link-btn" data-cm="unbad" data-number="${escapeHtml(u.number)}">Undo</button></div>`;
  }

  function describe(item) {
    if (run.mode === "prospect") {
      const dm = (item.decisionMakers || []).find((d) => (d.phone || "").trim()) || (item.decisionMakers || [])[0];
      const addr = item.address || {};
      const claims = item.medicare && typeof item.medicare.totalClaims === "number" ? item.medicare.totalClaims : null;
      return {
        name: item.name,
        contact: dm ? [dm.name, dm.title].filter(Boolean).join(" — ") : "",
        contactName: dm ? dm.name || "" : "",
        contactTitle: dm ? dm.title || "" : "",
        contactRole: dm ? dm.roleCategory || "" : "",
        address: [addr.line1, [addr.city, addr.state].filter(Boolean).join(", "), addr.postalCode].filter(Boolean).join(", "),
        place: [addr.city, addr.state].filter(Boolean).join(", "),
        stateCode: addr.state || "",
        specialty: item.taxonomy && item.taxonomy.description,
        website: item.website || "",
        claims,
        prior: item.priorContact || null,
        company: item,
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
      contactName: item.contactName || "",
      contactTitle: item.contactTitle || "",
      contactRole: item.contactRole || "",
      address: [item.addressLine1, [item.city, item.state].filter(Boolean).join(", "), item.postalCode].filter(Boolean).join(", "),
      place: [item.city, item.state].filter(Boolean).join(", "),
      stateCode: item.state || "",
      specialty: item.taxonomy,
      website: item.website || "",
      claims,
      prior: null,
      // A claimed lead in the same shape as a prospect, so the same info blocks can read it.
      company: {
        npi: item.npi,
        medicare: claims != null ? {
          totalClaims: claims,
          totalBeneficiaries: item.medicareBeneficiaries !== "" && item.medicareBeneficiaries != null ? Number(item.medicareBeneficiaries) : null,
          medicarePayment: item.medicarePayment !== "" && item.medicarePayment != null ? Number(item.medicarePayment) : null,
        } : null,
        lastUpdated: item.nppesLastUpdated || null,
        isOrganization: null,
        locations: [],
      },
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

  function callBlockHtml(phones, contactName) {
    if (!phones.length) return '<div class="cm-hint cm-nophone">No phone number on file for this lead.</div>';
    const href = (n) => `tel:${escapeHtml(n.replace(/[^\d+*#]/g, ""))}`;
    const flag = (p, reason, label) => `<button type="button" class="link-btn" data-cm="badnum" data-reason="${reason}" data-number="${escapeHtml(digits(p.number))}">${label}</button>`;
    const badRows = phones.filter((p) => p.bad).map((p) => `
        <div class="cm-other is-bad">
          <span class="cm-other-label">${escapeHtml(p.label)}</span>
          <span class="cm-bad-number">${escapeHtml(p.number)}</span>
          <span class="cm-bad-tag">${escapeHtml(REASON_LABEL[p.bad.reason] || "Bad number")}${p.bad.by ? ` \u00b7 ${escapeHtml(p.bad.by)}` : ""}</span>
          <button type="button" class="link-btn" data-cm="unbad" data-number="${escapeHtml(digits(p.number))}">Undo</button>
        </div>`).join("");
    const good = phones.filter((p) => !p.bad);
    if (!good.length) {
      return `<div class="cm-hint cm-nophone">Every number on file for this lead was flagged as wrong. Skip it, or send it to Disconnected.</div><div class="cm-others">${badRows}</div>`;
    }
    const [first, ...others] = good;
    return `<div class="cm-call">
        <a class="btn btn-primary cm-call-btn" href="${href(first.number)}" data-cm="called">${SIGNAL_ICONS.phone}<span>Call ${escapeHtml(first.number)}</span></a>
        <button type="button" class="btn btn-ghost" data-copy-phone="${escapeHtml(first.number)}">${SIGNAL_ICONS.copy}<span>Copy</span></button>
      </div>
      ${contactName && String(first.label).includes(contactName) ? "" : `<div class="cm-hint">${escapeHtml(first.label)}</div>`}
      <div class="cm-flag">${flag(first, "wrong", "Wrong number")}${flag(first, "disconnected", "Not in service")}</div>
      ${others.length || badRows ? `<div class="cm-others">${others.map((p) => `
        <div class="cm-other">
          <span class="cm-other-label">${escapeHtml(p.label)}</span>
          <a class="btn btn-ghost btn-small" href="${href(p.number)}" data-cm="called">${SIGNAL_ICONS.phone}${escapeHtml(p.number)}</a>
          <button type="button" class="link-btn" data-copy-phone="${escapeHtml(p.number)}">Copy</button>
          ${flag(p, "wrong", "Wrong")}
        </div>`).join("")}${badRows}</div>` : ""}`;
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

    const hooks = window.dmeHooks;
    const richInfo = Boolean(hooks.whyCallBlock);
    const npi = info.company.npi;

    let context = "";
    if (info.prior && !richInfo) context += priorContactBannerHtml(info.prior);
    if (info.opener) context += `<div class="opener-notes"><div class="opener-label">Your opener</div><div class="opener-text">${escapeHtml(info.opener)}</div></div>`;
    if (info.lastNote) context += `<div class="cm-lastnote"><span>Last note</span>${escapeHtml(info.lastNote)}</div>`;

    // The lead's own card: who it is, who to call (big Call button), and where it is.
    const factRows = [];
    if (info.address) factRows.push(["Address", `${escapeHtml(info.address)}<br><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(info.address)}" target="_blank" rel="noopener">Open in Maps</a>`]);
    if (info.website) factRows.push(["Website", `<a href="${escapeHtml(info.website)}" target="_blank" rel="noopener">${escapeHtml(info.website)}</a>`]);
    if (info.meeting) factRows.push(["Meeting", `${uiIcon("calendar")} ${escapeHtml(info.meeting)}`]);
    const contactRow = info.contactName ? `<div class="who-row cm-who">
        <div class="lead-avatar lead-avatar-sm" aria-hidden="true">${escapeHtml(leadInitials(info.contactName))}</div>
        <div class="who-main"><div class="who-name">${escapeHtml(info.contactName)}${info.contactRole ? `<span class="contact-role">${escapeHtml(info.contactRole)}</span>` : ""}</div>${info.contactTitle ? `<div class="who-sub">${escapeHtml(info.contactTitle)}</div>` : ""}</div>
      </div>` : "";
    const hero = `<div class="detail-block cm-hero">
        <div class="cm-hero-head">
          <div class="lead-avatar" aria-hidden="true">${escapeHtml(leadInitials(info.name))}</div>
          <div class="cm-hero-title">
            <div class="cm-name">${escapeHtml(info.name)}</div>
            <div class="cm-sub cm-muted">${escapeHtml([info.specialty, info.place].filter(Boolean).join(" \u00b7 "))}</div>
          </div>
          ${window.dmeHooks.briefHtml ? `<button type="button" class="btn btn-ghost btn-small cm-brief-btn${run.briefOpen ? " is-on" : ""}" data-cm="brief" aria-pressed="${run.briefOpen}" title="Open the call brief next to this panel">${BRIEF_ICON}<span>Call brief</span></button>` : ""}
        </div>
        <div class="cm-hero-meta">${npi ? `<span class="cm-npi">NPI <span class="mono">${escapeHtml(npi)}</span><button type="button" class="copy-inline" data-copy-text="${escapeHtml(npi)}" data-copy-label="NPI" title="Copy NPI" aria-label="Copy NPI">${SIGNAL_ICONS.copy}</button></span>` : ""}${window.dmeHooks.localTime?.(info.stateCode) || ""}</div>
        ${contactRow}
        ${callBlockHtml(phoneOptions(item), info.contactName)}
        ${factRows.length ? factsHtml(factRows) : ""}
      </div>`;

    const why = richInfo ? `<div class="detail-block cm-card">
        <h4>Why call</h4>
        ${hooks.whyCallSnapshot(info.company, { extraHtml: hooks.annotationsChips?.(npi) || "" })}
        <details class="cm-fold" data-fold="more"${run.open.more ? " open" : ""}>
          <summary>More about this lead</summary>
          ${hooks.whyCallBlock(info.company, { compact: true, noTitle: true, skip: ["medicare", "pickup"], ...(info.prior ? { priorLine: priorContactSummary(info.prior), priorNote: info.prior.note } : {}) })}
        </details>
      </div>` : "";

    let work;
    let foot;
    if (run.mode === "claimed") {
      work = `<div class="detail-block cm-card">
        <h4>Log this call</h4>
        <div class="cm-chips">${chipsHtml(callResultStatuses(), "cm-status", run.status)}</div>
        <textarea class="cm-note" rows="3" maxlength="500" placeholder="Add a note (optional)">${escapeHtml(run.note)}</textarea>
        <div class="cm-label">Call back</div>
        <div class="cm-chips">
          ${CALLBACK_CHOICES.map((o) => `<button type="button" class="choice-chip cm-remind${String(o.days) === run.remind ? " active" : ""}" data-value="${o.days}">${o.label}</button>`).join("")}
        </div>
        <div class="cm-more"><button type="button" class="text-action" data-cm="meeting">${uiIcon("calendar")} ${item.meetingAt && !meetingIsPast(item) ? "Edit meeting" : "Book a meeting"}</button></div>
      </div>
      ${hooks.annotationsBlock ? `<div class="detail-block cm-card"><details class="cm-fold cm-fold-bare" data-fold="notes"${run.open.notes ? " open" : ""}>
          <summary>${hooks.annotationsLabel?.(npi) || "Team notes"}</summary>
          ${hooks.annotationsBlock(npi, { compact: true })}
        </details></div>` : ""}`;
      foot = `<button type="button" class="btn btn-ghost" data-cm="back" ${run.pos === 0 ? "disabled" : ""} title="Previous lead (\u2190)">Back</button>
        <button type="button" class="btn btn-ghost" data-cm="skip" title="Skip this lead (\u2192)">Skip</button>
        <button type="button" class="btn btn-primary cm-save" data-cm="primary" title="Ctrl+Enter">Save &amp; next</button>`;
    } else {
      // A result and note on a lead that is not claimed are kept as a team note: no claim, the whole team sees it.
      work = `<div class="detail-block cm-card">
        <h4>Team notes <small>seen by everyone \u00b7 doesn't claim</small></h4>
        <div class="cm-label">How did it go?</div>
        <div class="cm-chips">${prospectResults().map((value) => `<button type="button" class="choice-chip cm-status${value === "disconnected" ? " is-danger" : ""}${value === run.status ? " active" : ""}" data-value="${escapeHtml(value)}">${escapeHtml(capital(value))}</button>`).join("")}</div>
        <textarea class="cm-note" rows="3" maxlength="480" placeholder="Add a note for the team (optional)">${escapeHtml(run.note)}</textarea>
        ${hooks.annotationsBlock ? hooks.annotationsBlock(npi, { compact: true, noForm: true }) : ""}
      </div>`;
      foot = `<button type="button" class="btn btn-ghost" data-cm="back" ${run.pos === 0 ? "disabled" : ""} title="Previous lead (\u2190)">Back</button>
        <button type="button" class="btn btn-ghost" data-cm="skip" title="Skip this lead (\u2192)">Skip</button>
        <button type="button" class="btn btn-ghost cm-save" data-cm="primary" title="Save the result and note for the team, keep the lead in Prospect, and go to the next lead (Ctrl+Enter)">Save note &amp; next</button>
        <button type="button" class="btn btn-ghost cm-claim" data-cm="claim" title="Make this lead yours: it moves to your Claimed list">Claim lead</button>`;
    }

    drawer.innerHTML = `
      <div class="cm-head">
        <div>
          <div class="cm-kicker">${run.mode === "claimed" ? "Calling your leads" : "Calling prospects"}</div>
          <div class="cm-count">${run.pos + 1} of ${total}</div>
        </div>
        <div class="cm-head-meta"><span>${c.saved} logged</span><span>${c.skipped} skipped</span><span>${c.left} left</span></div>
        ${total > 1 ? `<button type="button" class="btn btn-ghost btn-small cm-shuffle${run.shuffle ? " is-on" : ""}" data-cm="shuffle" aria-pressed="${run.shuffle}" title="Take the leads still to call in a random order">Shuffle</button>` : ""}
        <button type="button" class="btn btn-ghost btn-small" data-cm="close">Close</button>
      </div>
      <div class="cm-progress" aria-hidden="true"><span style="width:${pct}%"></span></div>
      <div class="cm-body">
        ${undoHtml()}${badUndoHtml()}
        ${hero}
        ${why}
        ${context}
        ${work}
        ${upNextHtml()}
      </div>
      <div class="cm-foot">${foot}</div>
      <div class="cm-keys">\u2190 back \u00b7 \u2192 skip \u00b7 Ctrl+Enter save &amp; next \u00b7 Esc close</div>`;
    loadLeadInfo(info.company);
    renderBriefPanel();
    // Warm the next lead while this one is being called, so its details are ready when it is shown.
    const next = run.queue[run.pos + 1];
    if (next && richInfo) {
      const nextCompany = describe(next).company;
      hooks.whyCallOpened?.(nextCompany);
      hooks.annotationsOpened?.(nextCompany.npi, false);
    }
  }

  // Opens or closes the call brief panel. While it is open it follows the lead on screen.
  function setBrief(open) {
    run.briefOpen = open;
    renderBriefPanel();
    drawer?.querySelectorAll(".cm-brief-btn").forEach((b) => { b.classList.toggle("is-on", open); b.setAttribute("aria-pressed", String(open)); });
  }

  async function renderBriefPanel() {
    if (!briefPanel) return;
    const lead = isOpen() && run.pos < run.queue.length ? run.queue[run.pos] : null;
    if (!run.briefOpen || !lead || !window.dmeHooks.briefHtml) {
      briefPanel.hidden = true;
      briefShownFor = "";
      document.documentElement.classList.remove("brief-open");
      return;
    }
    const claimed = run.mode === "claimed";
    const company = claimed ? companyLikeFromClaimedLead(lead) : lead;
    const key = `${run.mode}:${String(lead.npi || lead.name)}`;
    briefPanel.hidden = false;
    document.documentElement.classList.add("brief-open");
    briefPanel.querySelector(".cbp-name").textContent = lead.name || "";
    if (briefShownFor === key) return; // a redraw of the same lead: keep what is shown
    const body = briefPanel.querySelector(".cbp-body");
    const token = ++briefToken;
    body.textContent = "Putting the brief together\u2026";
    try {
      const html = await window.dmeHooks.briefHtml(company, claimed ? { status: lead.status, notes: lead.notes } : null);
      if (token !== briefToken) return;
      body.innerHTML = html;
      body.scrollTop = 0;
      briefShownFor = key;
    } catch (err) {
      if (token === briefToken) body.textContent = `Could not build the brief: ${err.message}`;
    }
  }

  // Fills the Why call and Team notes blocks for the lead on screen. The server is asked again for the notes
  // only when the lead changes; a redraw of the same lead reuses what is held.
  let lastInfoNpi = "";
  function loadLeadInfo(company) {
    if (!company || !company.npi) return;
    const npi = String(company.npi);
    const changed = npi !== lastInfoNpi;
    lastInfoNpi = npi;
    window.dmeHooks.whyCallOpened?.(company);
    window.dmeHooks.annotationsOpened?.(npi, changed);
  }

  function renderDone() {
    run.briefOpen = false;
    renderBriefPanel();
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
        <div class="cm-sub">${c.saved === 1 ? "lead" : "leads"} logged${skippedAny ? `, ${c.skipped} skipped` : ""}.</div>
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
    if (window.dmeClaimGuard) {
      const allowed = await window.dmeClaimGuard.check([company]);
      if (!allowed || !allowed.length) { showToast("Not claimed. You held off because it looks related to a claimed lead."); return null; }
    }
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

  const resultLabel = (value) => capital(value);

  // Not a claim: the lead goes to the shared Disconnected list, which can't be undone.
  async function sendProspectToDisconnected(item) {
    if (!confirm(`Send ${item.name} to Disconnected? It leaves Prospect for everyone and can't be undone.`)) return null;
    await apiPost("export/disconnected", { companies: [item] });
    removeCompaniesFromProspect([item]);
    return "disconnected";
  }

  // A result and note on a lead nobody has claimed are kept as a team note ("Voicemail \u2014 left a message"):
  // everyone sees them, and the lead stays in Prospect.
  async function logProspect(item) {
    const note = run.note.trim();
    const status = run.status;
    if (!status && !note) { showToast("Pick a result or add a note, or press Skip", true); return null; }
    if (status === "disconnected") return sendProspectToDisconnected(item);
    if (!window.dmeHooks.annotationsPost) { showToast("Team notes aren't available right now", true); return null; }
    const text = [resultLabel(status), note].filter(Boolean).join(" \u2014 ").slice(0, 500);
    await window.dmeHooks.annotationsPost(String(item.npi), text);
    showToast("Saved for the team");
    return status || "note added";
  }

  // The separate, deliberate step: make this lead yours. Any result or note already typed goes on the claimed lead.
  async function claimLead() {
    if (run.busy || run.mode !== "prospect") return;
    const item = run.queue[run.pos];
    const status = run.status;
    const note = run.note.trim();
    if (status === "disconnected") { showToast("Pick another result to claim this lead, or Save & next to send it to Disconnected", true); return; }
    run.busy = true;
    drawer.querySelectorAll('[data-cm="claim"], [data-cm="primary"]').forEach((b) => { b.disabled = true; });
    try {
      const label = await claimProspect(item);
      if (!label) return;
      if (status || note) await recordOnClaimed(String(item.npi), status, note);
      run.outcome[run.pos] = { kind: "saved", label: status || "claimed" };
      if (label === "claimed") offerUndo(item, status); else run.undo = null; // a lead that was already yours isn't undone
      goTo(nextOpen(run.pos + 1));
    } catch (err) {
      showToast(err.message, true);
    } finally {
      run.busy = false;
      drawer.querySelectorAll('[data-cm="claim"], [data-cm="primary"]').forEach((b) => { b.disabled = false; });
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
        label = await logProspect(item);
        run.undo = null;
      }
      if (label) {
        run.outcome[run.pos] = { kind: "saved", label };
        // Remove from the prospect pool so a new call session in the same browser tab
        // does not offer this lead again. Disconnected is already removed inside logProspect.
        if (run.mode === "prospect" && label !== "disconnected") removeCompaniesFromProspect([item]);
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
      else if (act === "claim") claimLead();
      else if (act === "brief") setBrief(!run.briefOpen);
      else if (act === "undo") undoClaim();
      else if (act === "shuffle") toggleShuffle();
      else if (act === "meeting") bookMeeting();
      else if (act === "redo") redoSkipped();
      else if (act === "badnum") flagBad(cm.dataset.number, cm.dataset.reason);
      else if (act === "unbad") unflagBad(cm.dataset.number);
      // "called" is a plain tel: link; nothing to do beyond letting it dial.
      return;
    }
    const chip = e.target.closest(".cm-status, .cm-remind");
    if (!chip) return;
    const isStatus = chip.classList.contains("cm-status");
    const was = chip.classList.contains("active");
    drawer.querySelectorAll(isStatus ? ".cm-status" : ".cm-remind").forEach((c) => c.classList.remove("active"));
    if (!was) chip.classList.add("active");
    const value = was ? "" : chip.dataset.value;
    if (isStatus) {
      run.status = value;
      // "Call back" style results get a callback suggested, as the call log does.
      if (run.mode === "claimed" && value && isCallbackStatus(value) && !run.remind) {
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
    lastInfoNpi = "";
    briefShownFor = "";
    Object.assign(run, {
      mode, queue: list, outcome: list.map(() => null), pos: -1, busy: false, status: "", remind: "", note: "", startedAt: Date.now(),
      shuffle, order: new Map(list.map((item, i) => [item, i])), undo: null, bad: new Map(), badUndo: null, briefOpen: false,
    });
    if (shuffle) reorderRest(); // pos -1: every lead is still to call
    run.pos = 0;
    backdrop.hidden = false;
    drawer.hidden = false;
    document.documentElement.classList.add("call-open");
    render();
    drawer.focus();
    loadBad(list);
  }

  function close() {
    if (!isOpen()) return;
    drawer.hidden = true;
    backdrop.hidden = true;
    run.briefOpen = false;
    renderBriefPanel();
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
