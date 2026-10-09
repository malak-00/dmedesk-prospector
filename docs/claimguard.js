/* A heads-up before claiming: "this looks like a lead that is already claimed".
   Before leads are claimed (the Claim button in Prospect, and a result in call mode), their phone numbers and owner's
   name are compared with the leads already claimed. If one looks like the same business as a lead a teammate holds,
   a dialog names it and lets you claim anyway, skip those, or cancel. The server still enforces ownership as before;
   this only warns. If the check can't run, the claim carries on.
   dmeClaimGuard.check(companies) resolves to the companies to claim (maybe fewer), or null when cancelled. */
(function () {
  "use strict";

  function describe(c) {
    return {
      npi: String(c.npi || ""),
      phones: [c.phone, ...(c.decisionMakers || []).map((d) => d.phone), ...(c.locations || []).map((l) => l.phone)].filter(Boolean),
      owner: ((c.decisionMakers || [])[0] || {}).name || "",
      state: (c.address && c.address.state) || c.state || "",
    };
  }

  const whyText = (why) => (why || []).join(" and ");

  function ask(items) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "suggestion-overlay cg-overlay";
      const rows = items.map(({ company, related }) => `
        <div class="cg-item">
          <div class="cg-name">${escapeHtml(company.name || "This lead")}${company.address ? ` <span class="muted-note">${escapeHtml([company.address.city, company.address.state].filter(Boolean).join(", "))}</span>` : ""}</div>
          ${related.map((r) => `<div class="cg-rel">Looks related to <strong>${escapeHtml(r.name || "a claimed lead")}</strong>${r.city || r.state ? ` (${escapeHtml([r.city, r.state].filter(Boolean).join(", "))})` : ""}, claimed by <strong>${escapeHtml(r.mine ? "you" : r.claimedBy)}</strong>${r.status ? `, status ${escapeHtml(r.status)}` : ""} · ${escapeHtml(whyText(r.why))}</div>`).join("")}
        </div>`).join("");
      overlay.innerHTML = `
        <div class="suggestion-card cg-card" role="dialog" aria-modal="true" aria-labelledby="cgTitle">
          <h3 id="cgTitle">${items.length === 1 ? "This lead looks related to one that's already claimed" : `${items.length} leads look related to ones that are already claimed`}</h3>
          <p class="suggestion-hint">Same phone number or same owner. A teammate may already be working this business. You can still claim it if it's a different one.</p>
          <div class="cg-list">${rows}</div>
          <div class="suggestion-actions cg-actions">
            <button type="button" class="btn btn-ghost" data-cg="cancel">Cancel</button>
            <div>
              <button type="button" class="btn btn-ghost" data-cg="skip">${items.length === 1 ? "Skip this one" : "Skip these"}</button>
              <button type="button" class="btn btn-primary" data-cg="all">Claim anyway</button>
            </div>
          </div>
        </div>`;
      document.body.append(overlay);
      const done = (answer) => { document.removeEventListener("keydown", onKey, true); overlay.remove(); resolve(answer); };
      const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); done("cancel"); } };
      document.addEventListener("keydown", onKey, true);
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) { done("cancel"); return; }
        const btn = e.target.closest("[data-cg]");
        if (btn) done(btn.dataset.cg);
      });
      overlay.querySelector('[data-cg="all"]').focus();
    });
  }

  async function check(companies) {
    const list = (companies || []).filter(Boolean);
    if (!list.length) return list;
    let related = {};
    try {
      related = (await apiPost("leads/related-check", { companies: list.map(describe) })).related || {};
    } catch (err) {
      console.log("[claimguard] " + err.message); // can't check: don't get in the way of the claim
      return list;
    }
    // Only a lead held by a teammate is worth stopping for; one you hold yourself is not a clash.
    const flagged = list
      .map((company) => ({ company, related: (related[String(company.npi)] || []).filter((r) => !r.mine) }))
      .filter((x) => x.related.length);
    if (!flagged.length) return list;
    const answer = await ask(flagged);
    if (answer === "cancel") return null;
    if (answer === "skip") {
      const skip = new Set(flagged.map((x) => String(x.company.npi)));
      return list.filter((c) => !skip.has(String(c.npi)));
    }
    return list;
  }

  window.dmeClaimGuard = { check };
})();
