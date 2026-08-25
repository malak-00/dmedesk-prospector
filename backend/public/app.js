const state = { companies: [], selected: new Set(), expandedIndex: null };

const els = {
  form: document.getElementById("searchForm"),
  searchBtn: document.getElementById("searchBtn"),
  resultsBody: document.getElementById("resultsBody"),
  resultsCount: document.getElementById("resultsCount"),
  selectAll: document.getElementById("selectAll"),
  exportCsvBtn: document.getElementById("exportCsvBtn"),
  exportSheetsBtn: document.getElementById("exportSheetsBtn"),
  exportCsvLabel: document.getElementById("exportCsvLabel"),
  exportSheetsLabel: document.getElementById("exportSheetsLabel"),
  selectionChip: document.getElementById("selectionChip"),
  selectionCount: document.getElementById("selectionCount"),
  clearSelectionBtn: document.getElementById("clearSelectionBtn"),
  statusDot: document.querySelector(".status-dot"),
  statusText: document.getElementById("statusText"),
  toast: document.getElementById("toast"),
  lastUpdatedYearSelect: document.getElementById("lastUpdatedYearSelect"),
};

// Populate the "Last updated (year)" filter with the current year and a few back.
(function () {
  const thisYear = new Date().getFullYear();
  for (let y = thisYear; y >= thisYear - 5; y--) {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    els.lastUpdatedYearSelect.appendChild(opt);
  }
})();

function setStatus(mode, text) {
  els.statusDot.className = `status-dot ${mode === "ready" ? "" : mode}`;
  els.statusText.textContent = text;
}

function showToast(message, isError = false, linkUrl = null) {
  els.toast.innerHTML = linkUrl
    ? `${message} — <a href="${linkUrl}" target="_blank" rel="noopener">open sheet</a>`
    : message;
  els.toast.className = `toast visible ${isError ? "error" : ""}`;
  setTimeout(() => { els.toast.className = "toast"; }, 5000);
}

function scoreTier(pct) {
  if (pct >= 65) return "high";
  if (pct >= 35) return "mid";
  return "low";
}

function scoreRing(score) {
  const pct = score?.percentage ?? 0;
  const tier = scoreTier(pct);
  const color = { high: "var(--score-high)", mid: "var(--score-mid)", low: "var(--score-low)" }[tier];
  const r = 16, c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  return `
    <div class="score-ring">
      <svg width="40" height="40" viewBox="0 0 40 40">
        <circle class="track" cx="20" cy="20" r="${r}"></circle>
        <circle class="fill" cx="20" cy="20" r="${r}" stroke="${color}"
          stroke-dasharray="${c}" stroke-dashoffset="${offset}"></circle>
      </svg>
      <span class="label">${pct}</span>
    </div>`;
}

function buildQuery(formData) {
  const params = new URLSearchParams();
  for (const [key, value] of formData.entries()) {
    if (value !== "" && value !== null) params.set(key, value);
  }
  if (!formData.get("enrich")) params.set("enrich", "false");
  if (formData.get("scrape")) params.set("scrape", "true");
  return params.toString();
}

// The whole search (NPPES fetch + Foursquare/OSM/CMS enrichment + optional
// scraping) is one request -- there's no real progress to report. These
// timed messages are an approximation, not a claim of exact server state,
// but they at least stop "Searching NPPES registry…" from sitting there
// unchanged while the much slower enrichment step runs.
function searchStatusMsgEl() {
  return document.getElementById("searchStatusMsg");
}

async function runSearch(evt) {
  evt.preventDefault();
  const formData = new FormData(els.form);
  const query = buildQuery(formData);

  els.searchBtn.disabled = true;
  setStatus("busy", "Searching…");
  els.resultsBody.innerHTML = `<tr class="empty-row"><td colspan="7"><div class="loading-row"><span class="spinner"></span> <span id="searchStatusMsg">Searching NPPES registry…</span></div></td></tr>`;

  const phaseTimers = [
    setTimeout(() => { const el = searchStatusMsgEl(); if (el) el.textContent = "Enriching with Places, OSM & Medicare data…"; }, 2500),
    setTimeout(() => { const el = searchStatusMsgEl(); if (el) el.textContent = "Still working — larger searches and scraping take longer…"; }, 8000),
  ];

  try {
    const res = await fetch(`/api/search/companies?${query}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.message || "Search failed");

    state.companies = data.companies;
    state.selected.clear();
    state.expandedIndex = null;
    renderResults(data.excludedAsClaimed || 0);
    setStatus("ready", "Ready");
  } catch (err) {
    els.resultsBody.innerHTML = `<tr class="empty-row"><td colspan="7">${err.message}</td></tr>`;
    setStatus("error", "Error");
    showToast(err.message, true);
  } finally {
    phaseTimers.forEach(clearTimeout);
    els.searchBtn.disabled = false;
  }
}

function renderResults(excludedAsClaimed = 0) {
  const { companies } = state;
  const excludedNote = excludedAsClaimed > 0 ? ` (${excludedAsClaimed} already claimed, filtered out)` : "";
  els.resultsCount.textContent = `${companies.length} lead${companies.length === 1 ? "" : "s"} found${excludedNote}`;
  els.exportCsvBtn.disabled = companies.length === 0;
  els.exportSheetsBtn.disabled = companies.length === 0;
  els.selectAll.checked = companies.length > 0 && state.selected.size === companies.length;

  if (companies.length === 0) {
    els.resultsBody.innerHTML = `<tr class="empty-row"><td colspan="7">No leads matched that search.</td></tr>`;
    updateSelectionUI();
    return;
  }

  els.resultsBody.innerHTML = companies.map((c, i) => leadRowHtml(c, i)).join("");
  attachRowHandlers();
  updateSelectionUI();
}

function updateSelectionUI() {
  const count = state.selected.size;
  els.selectionChip.hidden = count === 0;
  els.selectionCount.textContent = `${count} selected`;
  els.exportCsvLabel.textContent = count > 0 ? `Export ${count} selected` : "Export CSV";
  els.exportSheetsLabel.textContent = count > 0 ? `Send ${count} selected` : "Export to Sheets";
}

// Small badges showing which free enrichment sources actually contributed
// data for this lead (Foursquare, OpenStreetMap, CMS Medicare, scraped
// website) -- otherwise invisible, even though it affects how much to
// trust a given website/rating.
function sourceBadges(sources) {
  if (!sources) return "";
  const labels = [];
  if (sources.places) labels.push("FSQ");
  if (sources.osm) labels.push("OSM");
  if (sources.cms) labels.push("CMS");
  if (sources.website) labels.push("SITE");
  if (labels.length === 0) return "";
  return `<div class="source-badges">${labels.map((l) => `<span class="source-badge">${l}</span>`).join("")}</div>`;
}

function leadRowHtml(company, index) {
  const primaryContact = company.decisionMakers?.[0];
  const isSelected = state.selected.has(index);
  return `
    <tr class="lead-row ${isSelected ? "is-selected" : ""}" data-index="${index}">
      <td onclick="event.stopPropagation()"><input type="checkbox" class="row-check" data-index="${index}" ${isSelected ? "checked" : ""}></td>
      <td>${scoreRing(company.score)}</td>
      <td>
        <div class="company-name">${escapeHtml(company.name)}</div>
        <div class="company-taxonomy">${escapeHtml(company.taxonomy?.description || "")}</div>
        ${sourceBadges(company.sources)}
      </td>
      <td class="mono">${escapeHtml(company.address?.city || "")}, ${escapeHtml(company.address?.state || "")}</td>
      <td>${primaryContact ? escapeHtml(primaryContact.name) : '<span class="text-muted">—</span>'}</td>
      <td class="mono">${phoneCell(primaryContact?.phone, company.phone)}</td>
      <td><span class="chevron">▸</span></td>
    </tr>
  `;
}

function detailRowHtml(company, index) {
  const sourcesList = company.sources
    ? Object.keys(company.sources).filter((k) => company.sources[k]).map((k) => k.toUpperCase()).join(", ")
    : "";
  return `
    <tr class="detail-row">
      <td colspan="7">
        <div class="detail-grid">
          <div class="detail-block">
            <h4>Details</h4>
            <div class="mono detail-info">
              NPI: ${escapeHtml(company.npi || "—")}<br>
              ${escapeHtml(company.address?.line1 || "")}<br>
              ${escapeHtml(company.address?.city || "")}, ${escapeHtml(company.address?.state || "")} ${escapeHtml(company.address?.postalCode || "")}<br>
              Company phone: ${escapeHtml(company.phone || "—")}<br>
              Website: ${company.website ? `<a href="${escapeHtml(company.website)}" target="_blank">${escapeHtml(company.website)}</a>` : "—"}<br>
              Fax: ${escapeHtml(company.fax || "—")}<br>
              NPPES last updated: ${escapeHtml(company.lastUpdated || "—")}<br>
              Medicare (CMS): ${escapeHtml(medicareSummary(company.medicare))}<br>
              Data sources: ${escapeHtml(sourcesList || "NPPES only")}
            </div>
          </div>
          <div class="detail-block">
            <h4>Decision makers (${company.decisionMakers?.length || 0})</h4>
            ${(company.decisionMakers || []).map((dm) => `
              <div class="contact-item">
                <div>
                  ${escapeHtml(dm.name)}${dm.title ? ` — ${escapeHtml(dm.title)}` : ""}
                  <span class="contact-role">${escapeHtml(dm.roleCategory)}</span>
                </div>
                ${dm.phone ? `<div class="mono contact-phone">${escapeHtml(dm.phone)}</div>` : ""}
              </div>
            `).join("") || '<span class="text-muted text-sm">None identified</span>'}
          </div>
        </div>
        <div class="brief-box">
          <button class="btn btn-ghost btn-small" data-brief-index="${index}">Generate call brief</button>
          <div class="brief-output" id="brief-${index}"></div>
        </div>
      </td>
    </tr>
  `;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Prefer the contact's direct line; fall back to the company's main number
// (NPPES rarely publishes an official's direct phone).
function phoneCell(contactPhone, companyPhone) {
  const direct = (contactPhone || "").trim();
  if (direct) return `<a href="tel:${escapeHtml(direct)}">${escapeHtml(direct)}</a>`;
  const main = (companyPhone || "").trim();
  if (main) return `<a href="tel:${escapeHtml(main)}">${escapeHtml(main)}</a> <span class="muted-tag">main</span>`;
  return '<span class="text-muted">—</span>';
}

function medicareSummary(medicare) {
  if (!medicare || medicare.totalClaims == null) return "No CMS claims data found";
  const parts = [`${Number(medicare.totalClaims).toLocaleString()} claims`];
  if (medicare.totalBeneficiaries != null) parts.push(`${Number(medicare.totalBeneficiaries).toLocaleString()} beneficiaries`);
  if (medicare.medicarePayment != null) parts.push(`$${Math.round(medicare.medicarePayment).toLocaleString()} paid`);
  return parts.join(" · ");
}

function attachRowHandlers() {
  document.querySelectorAll(".lead-row").forEach((row) => {
    row.addEventListener("click", () => toggleRowDetail(Number(row.dataset.index)));
  });

  document.querySelectorAll(".row-check").forEach((box) => {
    box.addEventListener("change", (e) => {
      const idx = Number(e.target.dataset.index);
      const row = e.target.closest(".lead-row");
      if (e.target.checked) { state.selected.add(idx); row?.classList.add("is-selected"); }
      else { state.selected.delete(idx); row?.classList.remove("is-selected"); }
      els.selectAll.checked = state.companies.length > 0 && state.selected.size === state.companies.length;
      updateSelectionUI();
    });
  });
}

// Expands/collapses exactly one row's detail panel by inserting/removing
// just that row's DOM node, instead of rebuilding and re-binding the whole
// table (the old renderResults() call) for what's otherwise a single-row
// change -- the table can get large enough for that to be noticeably janky.
function collapseRow(idx) {
  const row = document.querySelector(`.lead-row[data-index="${idx}"]`);
  row?.querySelector(".chevron")?.classList.remove("open");
  const detail = row?.nextElementSibling;
  if (detail && detail.classList.contains("detail-row")) detail.remove();
}

function toggleRowDetail(idx) {
  const row = document.querySelector(`.lead-row[data-index="${idx}"]`);
  if (!row) return;

  if (state.expandedIndex === idx) {
    collapseRow(idx);
    state.expandedIndex = null;
    return;
  }

  if (state.expandedIndex !== null) collapseRow(state.expandedIndex);

  state.expandedIndex = idx;
  row.querySelector(".chevron")?.classList.add("open");
  row.insertAdjacentHTML("afterend", detailRowHtml(state.companies[idx], idx));
  document.querySelector(`[data-brief-index="${idx}"]`)?.addEventListener("click", (e) => {
    e.stopPropagation();
    generateBrief(idx);
  });
}

async function generateBrief(index) {
  const company = state.companies[index];
  const output = document.getElementById(`brief-${index}`);
  output.className = "brief-output visible";
  output.textContent = "Generating brief…";

  try {
    const res = await fetch("/api/brief/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || "Brief generation failed");
    output.textContent = data.brief;
  } catch (err) {
    output.textContent = `Could not generate brief: ${err.message}`;
  }
}

function getExportCompanies() {
  if (state.selected.size > 0) {
    return [...state.selected].map((i) => state.companies[i]);
  }
  return state.companies;
}

async function exportCsv() {
  const companies = getExportCompanies();
  els.exportCsvBtn.disabled = true; // prevents a double-click from double-exporting
  setStatus("busy", "Exporting…");
  try {
    const res = await fetch("/api/export/csv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companies }),
    });
    if (!res.ok) throw new Error("Export failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dme-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${companies.length} lead(s) to CSV`);
    setStatus("ready", "Ready");
  } catch (err) {
    showToast(err.message, true);
    setStatus("error", "Error");
  } finally {
    els.exportCsvBtn.disabled = state.companies.length === 0;
  }
}

async function exportSheets() {
  const companies = getExportCompanies();
  // Claiming leads is a shared, team-visible action with no undo -- confirm
  // before writing, especially since "select none" silently means "all".
  if (!confirm(`Export ${companies.length} lead(s) to the shared Sheet?`)) return;

  els.exportSheetsBtn.disabled = true; // prevents a double-click from double-exporting
  setStatus("busy", "Sending to Sheets…");
  try {
    const res = await fetch("/api/export/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companies }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || "Sheets export failed");
    showToast(`Added ${data.rowsAdded} row(s) to "${data.tab}"`, false, data.sheetUrl);
    setStatus("ready", "Ready");
  } catch (err) {
    showToast(err.message, true);
    setStatus("error", "Error");
  } finally {
    els.exportSheetsBtn.disabled = state.companies.length === 0;
  }
}

// ---- State dropdown + dependent city suggestions ----
// Leaving State on "All states" (or City blank) simply omits that filter from
// the NPPES query, i.e. searches across all states / all cities.
const US_STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

const stateSelect = document.getElementById("stateSelect");
const cityInput = document.getElementById("cityInput");
const cityOptions = document.getElementById("cityOptions");

for (const [code, name] of Object.entries(US_STATE_NAMES)) {
  const opt = document.createElement("option");
  opt.value = code;
  opt.textContent = `${code} — ${name}`;
  stateSelect.appendChild(opt);
}

function refreshCityOptions() {
  const cities = US_CITIES_BY_STATE[stateSelect.value] || [];
  cityOptions.innerHTML = cities.map((c) => `<option value="${c}"></option>`).join("");
}

stateSelect.addEventListener("change", () => {
  cityInput.value = ""; // stale city from the previous state would silently mis-filter
  refreshCityOptions();
});
refreshCityOptions();

els.form.addEventListener("submit", runSearch);
els.selectAll.addEventListener("change", (e) => {
  document.querySelectorAll(".row-check").forEach((box) => {
    box.checked = e.target.checked;
    const idx = Number(box.dataset.index);
    const row = box.closest(".lead-row");
    if (e.target.checked) { state.selected.add(idx); row?.classList.add("is-selected"); }
    else { state.selected.delete(idx); row?.classList.remove("is-selected"); }
  });
  updateSelectionUI();
});
els.clearSelectionBtn.addEventListener("click", () => {
  state.selected.clear();
  els.selectAll.checked = false;
  document.querySelectorAll(".row-check").forEach((box) => { box.checked = false; });
  document.querySelectorAll(".lead-row").forEach((row) => row.classList.remove("is-selected"));
  updateSelectionUI();
});
els.exportCsvBtn.addEventListener("click", exportCsv);
els.exportSheetsBtn.addEventListener("click", exportSheets);