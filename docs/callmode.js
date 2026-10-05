/* Call mode: step through a list of leads one at a time.
   Claimed leads: Call, pick a result, optional note and callback, Save & next.
   Prospect results: Call, then Claim & next or Skip.
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

  const run = {
    mode: "claimed", // "claimed" | "prospect"
    queue: [],
    pos: 0,
    saved: 0,
    skipped: 0,
    busy: false,
    status: "",
    remind: "",
  };

  let backdrop = null;
  let drawer = null;

  function build() {
    if (drawer) return;
    backdrop = document.createElement("div");
    backdrop.className = "call-backdrop";
    backdrop.hidden = true;
    drawer = document.createElement("aside");
    drawer.className = "call-drawer";
    drawer.id = "callDrawer";
    drawer.hidden = true;
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-label", "Call mode");
    document.body.append(backdrop, drawer);

    backdrop.addEventListener("click", close);
    drawer.addEventListener("click", onClick);
    drawer.addEventListener("input", (e) => {
      if (e.target.classList.contains("cm-note")) e.target.dataset.touched = "1";
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && drawer && !drawer.hidden) close();
    });
  }

  /* ---------- what to show for each kind of lead ---------- */

  function describe(item) {
    if (run.mode === "prospect") {
      const c = item;
      const dm = (c.decisionMakers || []).find((d) => (d.phone || "").trim()) || (c.decisionMakers || [])[0];
      const addr = c.address || {};
      return {
        name: c.name,
        contact: dm ? [dm.name, dm.title].filter(Boolean).join(" — ") : "",
        phone: ((dm && dm.phone) || c.phone || "").trim(),
        isMain: !(dm && (dm.phone || "").trim()),
        place: [addr.city, addr.state].filter(Boolean).join(", "),
        specialty: c.taxonomy && c.taxonomy.description,
        prior: c.priorContact || null,
        opener: "",
        lastNote: "",
      };
    }
    const l = item;
    const lines = String(l.notes || "").split("\n").map((x) => x.trim()).filter(Boolean);
    const directPhone = (l.contactPhone || "").trim();
    return {
      name: l.name,
      contact: [l.contactName, l.contactTitle].filter(Boolean).join(" — "),
      phone: directPhone || (l.companyPhone || "").trim(),
      isMain: !directPhone,
      place: [l.city, l.state].filter(Boolean).join(", "),
      specialty: l.taxonomy,
      prior: null,
      opener: l.meetingAt && !meetingIsPast(l) ? (l.meetingOpenerNotes || "") : "",
      lastNote: lines[0] || "",
    };
  }

  /* ---------- rendering ---------- */

  function chipsHtml(list, cls, current) {
    return list.map((value) =>
      `<button type="button" class="choice-chip ${cls}${value === current ? " active" : ""}" data-value="${escapeHtml(value)}">${escapeHtml(value)}</button>`
    ).join("");
  }

  function render() {
    if (!drawer) return;
    if (run.pos >= run.queue.length) { renderDone(); return; }
    const item = run.queue[run.pos];
    const info = describe(item);
    const total = run.queue.length;
    const pct = Math.round((run.pos / total) * 100);
    const phoneHref = info.phone.replace(/[^\d+*#]/g, "");

    const callBlock = info.phone
      ? `<div class="cm-call">
           <a class="btn btn-primary cm-call-btn" href="tel:${escapeHtml(phoneHref)}">${SIGNAL_ICONS.phone}<span>Call ${escapeHtml(info.phone)}</span></a>
           <button type="button" class="btn btn-ghost" data-copy-phone="${escapeHtml(info.phone)}">${SIGNAL_ICONS.copy}<span>Copy</span></button>
         </div>
         ${info.isMain ? '<div class="cm-hint">Main line, no direct number on file.</div>' : ""}`
      : '<div class="cm-hint cm-nophone">No phone number on file for this lead.</div>';

    let context = "";
    if (info.prior) context += priorContactBannerHtml(info.prior);
    if (info.opener) context += `<div class="opener-notes"><div class="opener-label">Your opener</div><div class="opener-text">${escapeHtml(info.opener)}</div></div>`;
    if (info.lastNote) context += `<div class="cm-lastnote"><span>Last note</span>${escapeHtml(info.lastNote)}</div>`;

    let work = "";
    let primaryLabel = "";
    if (run.mode === "claimed") {
      primaryLabel = "Save & next";
      work = `
        <div class="cm-label">How did it go?</div>
        <div class="cm-chips" data-group="status">${chipsHtml(callResultStatuses(), "cm-status", run.status)}</div>
        <textarea class="cm-note" rows="3" maxlength="500" placeholder="Add a note (optional)"></textarea>
        <div class="cm-label">Call back</div>
        <div class="cm-chips" data-group="remind">
          ${CALLBACK_CHOICES.map((c) => `<button type="button" class="choice-chip cm-remind${String(c.days) === run.remind ? " active" : ""}" data-value="${c.days}">${c.label}</button>`).join("")}
        </div>`;
    } else {
      primaryLabel = "Claim & next";
      work = '<div class="cm-hint">Claiming puts this lead under your name so you can log the call in Claimed leads.</div>';
    }

    drawer.innerHTML = `
      <div class="cm-head">
        <div>
          <div class="cm-kicker">${run.mode === "claimed" ? "Calling your leads" : "Calling prospects"}</div>
          <div class="cm-count">${run.pos + 1} of ${total}</div>
        </div>
        <button type="button" class="btn btn-ghost btn-small" data-cm="close">Close</button>
      </div>
      <div class="cm-progress" aria-hidden="true"><span style="width:${pct}%"></span></div>
      <div class="cm-body">
        <div class="cm-name">${escapeHtml(info.name)}</div>
        ${info.contact ? `<div class="cm-sub">${escapeHtml(info.contact)}</div>` : ""}
        <div class="cm-sub cm-muted">${escapeHtml([info.place, info.specialty].filter(Boolean).join(" · "))}</div>
        ${callBlock}
        ${context}
        ${work}
      </div>
      <div class="cm-foot">
        <button type="button" class="btn btn-ghost" data-cm="skip">Skip</button>
        <button type="button" class="btn btn-primary" data-cm="primary">${primaryLabel}</button>
      </div>`;
  }

  function renderDone() {
    const what = run.mode === "claimed" ? "logged" : "claimed";
    drawer.innerHTML = `
      <div class="cm-head">
        <div><div class="cm-kicker">Call list finished</div><div class="cm-count">All done</div></div>
        <button type="button" class="btn btn-ghost btn-small" data-cm="close">Close</button>
      </div>
      <div class="cm-progress" aria-hidden="true"><span style="width:100%"></span></div>
      <div class="cm-body cm-done">
        <div class="cm-done-num">${run.saved}</div>
        <div class="cm-sub">${run.saved === 1 ? "lead" : "leads"} ${what}${run.skipped ? `, ${run.skipped} skipped` : ""}.</div>
      </div>
      <div class="cm-foot"><button type="button" class="btn btn-primary" data-cm="close">Done</button></div>`;
  }

  /* ---------- actions ---------- */

  function advance() {
    run.pos += 1;
    run.status = "";
    run.remind = "";
    render();
  }

  async function saveClaimed(item) {
    const note = drawer.querySelector(".cm-note").value.trim();
    const status = run.status;
    const remind = run.remind;
    if (!status && !note && !remind) {
      showToast("Pick a result, add a note or a callback, or press Skip", true);
      return false;
    }
    // Same three calls as the call log on a claimed lead's card.
    if (status && status !== item.status) {
      await apiPost("leads/status", { npi: item.npi, status });
      item.status = status;
    }
    if (status || note) {
      const data = await apiPost("leads/notes", { npi: item.npi, note: [status, note].filter(Boolean).join(" — ") });
      item.notes = data.notes;
    }
    if (remind) {
      const data = await apiPost("leads/reminder", { npi: item.npi, reminderAt: remindDateIso(remind) });
      item.reminderAt = data.reminderAt;
    }
    return true;
  }

  async function claimProspect(company) {
    const data = await apiPost("export/sheets", { companies: [company] });
    state.claimedLoaded = false;
    const npi = String(company.npi);
    const claimed = data.claimedNpis ? data.claimedNpis.map(String).includes(npi) : true;
    const already = (data.alreadyClaimedNpis || []).map(String).includes(npi);
    const blocked = (data.blocked || []).some((b) => String(b.npi) === npi);
    if (claimed || already || blocked) removeCompaniesFromProspect([company]);
    if (blocked) { showToast("Couldn't claim this one: a teammate owns it or it is held for review", true); return false; }
    showToast(already ? "You already had this lead" : "Claimed");
    return true;
  }

  async function primary() {
    if (run.busy) return;
    const item = run.queue[run.pos];
    const btn = drawer.querySelector('[data-cm="primary"]');
    run.busy = true;
    btn.disabled = true;
    try {
      const ok = run.mode === "claimed" ? await saveClaimed(item) : await claimProspect(item);
      if (ok) { run.saved += 1; advance(); }
    } catch (err) {
      showToast(err.message, true);
    } finally {
      run.busy = false;
      const again = drawer.querySelector('[data-cm="primary"]');
      if (again) again.disabled = false;
    }
  }

  function onClick(e) {
    const cm = e.target.closest("[data-cm]");
    if (cm) {
      if (cm.dataset.cm === "close") close();
      else if (cm.dataset.cm === "skip") { run.skipped += 1; advance(); }
      else if (cm.dataset.cm === "primary") primary();
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
      if (value && isCallbackStatus(value) && !run.remind) {
        run.remind = "1";
        drawer.querySelectorAll(".cm-remind").forEach((c) => c.classList.toggle("active", c.dataset.value === "1"));
      }
    } else {
      run.remind = value;
    }
  }

  /* ---------- open / close ---------- */

  function start(items, mode) {
    const list = (items || []).filter(Boolean);
    if (!list.length) { showToast("Nothing to call yet", true); return; }
    build();
    Object.assign(run, { mode, queue: list, pos: 0, saved: 0, skipped: 0, busy: false, status: "", remind: "" });
    backdrop.hidden = false;
    drawer.hidden = false;
    document.documentElement.classList.add("call-open");
    render();
    drawer.focus?.();
  }

  function close() {
    if (!drawer || drawer.hidden) return;
    drawer.hidden = true;
    backdrop.hidden = true;
    document.documentElement.classList.remove("call-open");
    if (run.mode === "claimed" && run.saved > 0 && state.claimedLoaded) {
      renderClaimedLeads(applyClaimedFilters(state.claimedLeadsAll));
    }
    if (run.saved > 0) window.dmeHooks.onClaimedChanged?.();
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
  syncStartButtons();

  window.dmeCall = { start, close };
})();
