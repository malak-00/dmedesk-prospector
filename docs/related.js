/* Related businesses: leads in the same list that are probably the same business (a chain,
   or branches under different NPIs), so they are not worked as separate leads.
   Two leads are related when they share a phone number, or have the same owner's name in
   the same state. Looks only at what is already on screen: no extra searches.
   The clustering is pure (tested in worker/test/related.test.js); the rest wires it into the
   Prospect and Claimed tables through window.dmeHooks. */
(function (root) {
  "use strict";

  const MAX_PHONE_GROUP = 6; // a number shared by more rows than this is a switchboard, not a business
  const MAX_OWNER_GROUP = 8;

  const digits = (v) => String(v || "").replace(/\D/g, "").slice(-10);
  const usablePhone = (d) => d.length === 10 && !/^(\d)\1+$/.test(d);
  const nameKey = (v) => String(v || "").toLowerCase().replace(/[^a-z\s]/g, " ")
    .replace(/\b(dr|mr|mrs|ms|md|jr|sr|ii|iii|owner|ceo)\b/g, " ").replace(/\s+/g, " ").trim();

  // describe(item) -> { phones: [], owner: "", state: "" }
  function clusterRelated(items, describe) {
    const info = items.map((item) => {
      const d = describe(item) || {};
      return { phones: [...new Set((d.phones || []).map(digits).filter(usablePhone))], owner: nameKey(d.owner), state: String(d.state || "").trim().toUpperCase() };
    });
    const parent = items.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const union = (a, b) => { parent[find(a)] = find(b); };

    const byPhone = new Map();
    const byOwner = new Map();
    info.forEach((x, i) => {
      x.phones.forEach((p) => byPhone.set(p, [...(byPhone.get(p) || []), i]));
      if (x.owner.split(" ").length >= 2 && x.state) {
        const key = `${x.owner}|${x.state}`;
        byOwner.set(key, [...(byOwner.get(key) || []), i]);
      }
    });
    byPhone.forEach((list) => { if (list.length >= 2 && list.length <= MAX_PHONE_GROUP) list.slice(1).forEach((i) => union(list[0], i)); });
    byOwner.forEach((list) => { if (list.length >= 2 && list.length <= MAX_OWNER_GROUP) list.slice(1).forEach((i) => union(list[0], i)); });

    const groups = new Map();
    items.forEach((_, i) => { const r = find(i); groups.set(r, [...(groups.get(r) || []), i]); });
    const clusters = [...groups.values()].filter((m) => m.length >= 2);
    const clusterOf = items.map(() => -1);
    clusters.forEach((members, c) => members.forEach((i) => { clusterOf[i] = c; }));

    // Why two members are linked, for the card.
    const relation = (i, j) => {
      const why = [];
      if (info[i].phones.some((p) => info[j].phones.includes(p))) why.push("same phone");
      if (info[i].owner && info[i].owner === info[j].owner && info[i].state === info[j].state) why.push("same owner");
      return why.join(" and ") || "same business group";
    };
    return { clusters, clusterOf, relation };
  }

  // The order that keeps each cluster together, ordered by where its first member already was.
  function groupedOrder(count, clusters, clusterOf) {
    const order = [];
    const placed = new Set();
    for (let i = 0; i < count; i++) {
      if (placed.has(i)) continue;
      const members = clusterOf[i] >= 0 ? clusters[clusterOf[i]] : [i];
      members.forEach((m) => { if (!placed.has(m)) { placed.add(m); order.push(m); } });
    }
    return order;
  }

  const api = { clusterRelated, groupedOrder };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.dmeRelated = api;

  /* ---------------- browser wiring ---------------- */
  if (typeof document === "undefined" || !root.dmeHooks) return;

  const hooks = root.dmeHooks;
  const KEY = "dmeProspectorRelatedTogether";
  const describers = {
    prospect: (c) => ({
      phones: [c.phone, ...(c.decisionMakers || []).map((d) => d.phone), ...(c.locations || []).map((l) => l.phone)],
      owner: ((c.decisionMakers || [])[0] || {}).name,
      state: c.address && c.address.state,
    }),
    claimed: (l) => ({ phones: [l.companyPhone, l.contactPhone], owner: l.contactName, state: l.state }),
  };
  const listOf = (kind) => (kind === "prospect" ? state.companies : state.claimedLeads) || [];

  // Recomputed only when the list on screen changes.
  const cache = {};
  function clusters(kind) {
    const list = listOf(kind);
    const sig = list.length + ":" + (list[0] && (list[0].npi || "")) + ":" + (list[list.length - 1] && (list[list.length - 1].npi || ""));
    if (!cache[kind] || cache[kind].list !== list || cache[kind].sig !== sig) {
      cache[kind] = { list, sig, ...clusterRelated(list, describers[kind]) };
    }
    return cache[kind];
  }

  const nameOf = (kind, item) => item.name;
  const placeOf = (kind, item) => (kind === "prospect" ? [item.address && item.address.city, item.address && item.address.state] : [item.city, item.state]).filter(Boolean).join(", ");

  hooks.relatedChip = (kind, index) => {
    const c = clusters(kind);
    const id = c.clusterOf[index];
    if (id < 0) return "";
    const n = c.clusters[id].length;
    return ` <span class="related-chip" title="${escapeHtml(`${n} leads in this list look like the same business (shared phone or owner). Open the lead to see them.`)}">Related ×${n}</span>`;
  };

  hooks.relatedBlock = (kind, index) => {
    const c = clusters(kind);
    const id = c.clusterOf[index];
    if (id < 0) return "";
    const list = listOf(kind);
    const others = c.clusters[id].filter((i) => i !== index);
    return `<div class="related-block" data-related-kind="${kind}" data-related-index="${index}">
      <div class="related-head"><strong>Probably the same business</strong>
        <span>${others.length} other${others.length === 1 ? "" : "s"} in this list</span></div>
      <ul class="related-list">${others.map((i) => `
        <li><span class="related-name">${escapeHtml(nameOf(kind, list[i]))}</span>
          <span class="related-meta">${escapeHtml(placeOf(kind, list[i]))} · ${escapeHtml(c.relation(index, i))}</span></li>`).join("")}</ul>
      <div class="related-actions">${kind === "prospect"
        ? `<button type="button" class="btn btn-ghost btn-small" data-related-select="${index}">Select all ${others.length + 1} together</button>`
        : `<button type="button" class="link-btn" data-related-find="${index}">Find them in the list</button>`}</div>
    </div>`;
  };

  document.addEventListener("click", (e) => {
    const select = e.target.closest("[data-related-select]");
    if (select) {
      e.stopPropagation();
      const c = clusters("prospect");
      const members = c.clusters[c.clusterOf[Number(select.dataset.relatedSelect)]] || [];
      members.forEach((i) => {
        state.selected.add(i);
        const box = els.resultsBody.querySelector(`.row-check[data-index="${i}"]`);
        if (box) { box.checked = true; box.closest(".lead-row")?.classList.add("is-selected"); }
      });
      els.selectAll.checked = state.companies.length > 0 && state.selected.size === state.companies.length;
      updateSelectionUI();
      showToast(`Selected ${members.length} related leads`);
    }
    const find = e.target.closest("[data-related-find]");
    if (find) {
      e.stopPropagation();
      const c = clusters("claimed");
      const members = c.clusters[c.clusterOf[Number(find.dataset.relatedFind)]] || [];
      const first = state.claimedLeads[members[0]];
      if (first) { els.claimedSearchInput.value = (first.contactName || first.companyPhone || first.name || "").trim(); els.claimedSearchInput.dispatchEvent(new Event("input", { bubbles: true })); }
    }
  });

  // "Keep related together": reorders the page being shown so each business's rows sit side by side.
  const toggle = document.getElementById("relatedTogether");
  const isOn = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
  if (toggle) {
    toggle.checked = isOn();
    toggle.addEventListener("change", () => {
      try { localStorage.setItem(KEY, toggle.checked ? "1" : "0"); } catch { /* not remembered */ }
      const page = state.resultPages[state.currentPage];
      if (!page) return;
      page.grouped = isOn();
      applyOrder(page);
      state.selected.clear();
      state.expandedIndex = null;
      state.companies = page.companies;
      renderResults();
      updateSelectionUI();
    });
  }

  function applyOrder(page) {
    if (!page.original) page.original = page.companies.slice();
    if (!isOn()) { page.companies = page.original.slice(); return; }
    const c = clusterRelated(page.original, describers.prospect);
    page.companies = groupedOrder(page.original.length, c.clusters, c.clusterOf).map((i) => page.original[i]);
  }

  hooks.beforeRender = () => {
    const page = state.resultPages[state.currentPage];
    if (page && Boolean(page.grouped) !== isOn()) { page.grouped = isOn(); applyOrder(page); }
  };
})(typeof window !== "undefined" ? window : globalThis);
