// Frontend for the Apps Script backend. Request layer notes:
// - every request carries ?path= (Apps Script has no real router) and
//   ?token= (session token from sign-in; query param rather than a header
//   keeps requests CORS-simple so no preflight is ever sent)
// - POST bodies go as text/plain for the same reason; the backend parses
//   them as JSON regardless of content type
// - every response is HTTP 200; success/failure is the `success` field in
//   the JSON body, and body.status 401 means the session expired

const SESSION_STORAGE_KEY = "dmeProspectorSession";

function getSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY)) || null;
  } catch {
    return null;
  }
}

function saveSession(session) {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

async function apiGet(path, params = {}) {
  const query = new URLSearchParams(params);
  query.set("path", path);
  query.set("token", getSession()?.token || "");
  const res = await fetch(`${APPS_SCRIPT_URL}?${query.toString()}`);
  return unwrap(await res.json());
}

async function apiPost(path, body) {
  const query = new URLSearchParams({ path, token: getSession()?.token || "" });
  const res = await fetch(`${APPS_SCRIPT_URL}?${query.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
  });
  return unwrap(await res.json());
}

function unwrap(payload) {
  if (!payload.success) {
    if (payload.status === 401) {
      clearSession();
      showLogin();
    }
    throw new Error(payload.error || "Request failed");
  }
  return payload.data;
}

const state = {
  companies: [],
  selected: new Set(),
  expandedIndex: null,
  view: "search",
  claimedLoaded: false,
  statuses: [],
};

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
  loginOverlay: document.getElementById("loginOverlay"),
  loginForm: document.getElementById("loginForm"),
  loginBtn: document.getElementById("loginBtn"),
  loginError: document.getElementById("loginError"),
  userChip: document.getElementById("userChip"),
  userName: document.getElementById("userName"),
  signOutBtn: document.getElementById("signOutBtn"),
  viewSearch: document.getElementById("viewSearch"),
  viewClaimed: document.getElementById("viewClaimed"),
  claimedBody: document.getElementById("claimedBody"),
  claimedCount: document.getElementById("claimedCount"),
  onlyMine: document.getElementById("onlyMine"),
  updatedWithin: document.getElementById("updatedWithin"),
  updatedYear: document.getElementById("updatedYear"),
  refreshClaimedBtn: document.getElementById("refreshClaimedBtn"),
};

// Populate the "Year" filter with the current year and a few back.
(function () {
  const thisYear = new Date().getFullYear();
  for (let y = thisYear; y >= thisYear - 5; y--) {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    els.updatedYear.appendChild(opt);
  }
})();

/* ---------- Sign in ---------- */

function showLogin() {
  els.loginOverlay.hidden = false;
  els.userChip.hidden = true;
  els.loginForm.querySelector("input[name=username]")?.focus();
}

function hideLogin() {
  els.loginOverlay.hidden = true;
  const session = getSession();
  if (session) {
    els.userName.textContent = session.displayName;
    els.userChip.hidden = false;
  }
}

async function handleLogin(evt) {
  evt.preventDefault();
  const formData = new FormData(els.loginForm);
  els.loginBtn.disabled = true;
  els.loginError.hidden = true;

  try {
    const data = await apiPost("auth/login", {
      username: formData.get("username"),
      password: formData.get("password"),
    });
    saveSession({ token: data.token, username: data.username, displayName: data.displayName });
    els.loginForm.reset();
    hideLogin();
    showToast(`Welcome, ${data.displayName}`);
  } catch (err) {
    els.loginError.textContent = err.message;
    els.loginError.hidden = false;
  } finally {
    els.loginBtn.disabled = false;
  }
}

async function handleSignOut() {
  try { await apiPost("auth/logout", {}); } catch { /* best effort */ }
  clearSession();
  showLogin();
}

/* ---------- View tabs ---------- */

function switchView(view) {
  state.view = view;
  document.querySelectorAll(".view-tabs .tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.view === view);
  });
  els.viewSearch.hidden = view !== "search";
  els.viewClaimed.hidden = view !== "claimed";
  if (view === "claimed" && !state.claimedLoaded) loadClaimedLeads();
}

/* ---------- UI helpers ---------- */

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

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// Prefer the contact's direct line; fall back to the company's main number
// (NPPES rarely publishes an official's direct phone). Marks the fallback so
// reps know it's the switchboard, not a personal line.
function phoneCell(contactPhone, companyPhone) {
  const direct = (contactPhone || "").trim();
  if (direct) return `<a href="tel:${escapeHtml(direct)}">${escapeHtml(direct)}</a>`;
  const main = (companyPhone || "").trim();
  if (main) return `<a href="tel:${escapeHtml(main)}">${escapeHtml(main)}</a> <span class="muted-tag">main</span>`;
  return "—";
}

function medicareSummary(medicare) {
  if (!medicare || medicare.totalClaims == null) return "No CMS claims data found";
  const parts = [`${Number(medicare.totalClaims).toLocaleString()} claims`];
  if (medicare.totalBeneficiaries != null) parts.push(`${Number(medicare.totalBeneficiaries).toLocaleString()} beneficiaries`);
  if (medicare.medicarePayment != null) parts.push(`$${Math.round(medicare.medicarePayment).toLocaleString()} paid`);
  return parts.join(" · ");
}

/* ---------- Search ---------- */

function buildSearchParams(formData) {
  const params = {};
  for (const [key, value] of formData.entries()) {
    if (value !== "" && value !== null) params[key] = value;
  }
  if (!formData.get("enrich")) params.enrich = "false";
  if (formData.get("scrape")) params.scrape = "true";
  return params;
}

async function runSearch(evt) {
  evt.preventDefault();
  const formData = new FormData(els.form);
  const params = buildSearchParams(formData);

  els.searchBtn.disabled = true;
  setStatus("busy", "Searching…");
  els.resultsBody.innerHTML = `<tr class="empty-row"><td colspan="7"><div class="loading-row"><span class="spinner"></span> Searching NPPES registry…</div></td></tr>`;

  try {
    const data = await apiGet("search/companies", params);

    state.companies = data.companies;
    state.selected.clear();
    state.expandedIndex = null;
    renderResults(data.excludedAsClaimed || 0);
    setStatus("ready", "Ready");
  } catch (err) {
    els.resultsBody.innerHTML = `<tr class="empty-row"><td colspan="7">${escapeHtml(err.message)}</td></tr>`;
    setStatus("error", "Error");
    showToast(err.message, true);
  } finally {
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

  els.resultsBody.innerHTML = companies.map((c, i) => rowHtml(c, i)).join("");
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

function rowHtml(company, index) {
  const primaryContact = company.decisionMakers?.[0];
  const isExpanded = state.expandedIndex === index;
  const isSelected = state.selected.has(index);
  const rows = [`
    <tr class="lead-row ${isSelected ? "is-selected" : ""}" data-index="${index}">
      <td onclick="event.stopPropagation()"><input type="checkbox" class="row-check" data-index="${index}" ${isSelected ? "checked" : ""}></td>
      <td>${scoreRing(company.score)}</td>
      <td>
        <div class="company-name">${escapeHtml(company.name)}</div>
        <div class="company-taxonomy">${escapeHtml(company.taxonomy?.description || "")}</div>
      </td>
      <td class="mono">${escapeHtml(company.address?.city || "")}, ${escapeHtml(company.address?.state || "")}</td>
      <td>${primaryContact ? escapeHtml(primaryContact.name) : '<span style="color:var(--muted)">—</span>'}</td>
      <td class="mono">${phoneCell(primaryContact?.phone, company.phone)}</td>
      <td><span class="chevron ${isExpanded ? "open" : ""}">▸</span></td>
    </tr>
  `];

  if (isExpanded) {
    rows.push(`
      <tr class="detail-row">
        <td colspan="7">
          <div class="detail-grid">
            <div class="detail-block">
              <h4>Details</h4>
              <div class="mono" style="font-size:13px; line-height:1.8;">
                NPI: ${escapeHtml(company.npi || "—")}<br>
                ${escapeHtml(company.address?.line1 || "")}<br>
                ${escapeHtml(company.address?.city || "")}, ${escapeHtml(company.address?.state || "")} ${escapeHtml(company.address?.postalCode || "")}<br>
                Company phone: ${escapeHtml(company.phone || "—")}<br>
                Website: ${company.website ? `<a href="${escapeHtml(company.website)}" target="_blank">${escapeHtml(company.website)}</a>` : "—"}<br>
                Fax: ${escapeHtml(company.fax || "—")}<br>
                Medicare (CMS): ${escapeHtml(medicareSummary(company.medicare))}
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
              `).join("") || '<span style="color:var(--muted); font-size:13px;">None identified</span>'}
            </div>
          </div>
          <div class="brief-box">
            <button class="btn btn-ghost btn-small" data-brief-index="${index}">Generate call brief</button>
            <div class="brief-output" id="brief-${index}"></div>
          </div>
        </td>
      </tr>
    `);
  }

  return rows.join("");
}

function attachRowHandlers() {
  document.querySelectorAll(".lead-row").forEach((row) => {
    row.addEventListener("click", () => {
      const idx = Number(row.dataset.index);
      state.expandedIndex = state.expandedIndex === idx ? null : idx;
      renderResults();
    });
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

  document.querySelectorAll("[data-brief-index]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      generateBrief(Number(btn.dataset.briefIndex));
    });
  });
}

async function generateBrief(index) {
  const company = state.companies[index];
  const output = document.getElementById(`brief-${index}`);
  output.className = "brief-output visible";
  output.textContent = "Generating brief…";

  try {
    const data = await apiPost("brief/generate", { company });
    output.textContent = data.brief;
  } catch (err) {
    output.textContent = `Could not generate brief: ${err.message}`;
  }
}

/* ---------- Export ---------- */

function getExportCompanies() {
  if (state.selected.size > 0) {
    return [...state.selected].map((i) => state.companies[i]);
  }
  return state.companies;
}

async function exportCsv() {
  const companies = getExportCompanies();
  setStatus("busy", "Exporting…");
  try {
    const data = await apiPost("export/csv", { companies });
    const blob = new Blob([data.csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = data.filename || `dme-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${companies.length} lead(s) to CSV`);
    setStatus("ready", "Ready");
  } catch (err) {
    showToast(err.message, true);
    setStatus("error", "Error");
  }
}

async function exportSheets() {
  const companies = getExportCompanies();
  setStatus("busy", "Sending to Sheets…");
  try {
    const data = await apiPost("export/sheets", { companies });
    showToast(`Added ${data.rowsAdded} row(s) claimed by ${data.claimedBy || "you"}`, false, data.sheetUrl);
    state.claimedLoaded = false; // claimed view is now stale
    setStatus("ready", "Ready");
  } catch (err) {
    showToast(err.message, true);
    setStatus("error", "Error");
  }
}

/* ---------- Claimed leads view ---------- */

async function loadClaimedLeads() {
  els.claimedBody.innerHTML = `<tr class="empty-row"><td colspan="6"><div class="loading-row"><span class="spinner"></span> Loading claimed leads…</div></td></tr>`;
  try {
    const params = {};
    if (els.onlyMine.checked) params.mine = "true";
    if (els.updatedWithin.value) params.updatedWithinDays = els.updatedWithin.value;
    if (els.updatedYear.value) params.updatedYear = els.updatedYear.value;
    const data = await apiGet("leads/list", params);
    state.statuses = data.statuses || [];
    state.claimedLoaded = true;
    renderClaimedLeads(data.leads || []);
  } catch (err) {
    els.claimedBody.innerHTML = `<tr class="empty-row"><td colspan="6">${escapeHtml(err.message)}</td></tr>`;
    showToast(err.message, true);
  }
}

function renderClaimedLeads(leads) {
  els.claimedCount.textContent = `${leads.length} claimed lead${leads.length === 1 ? "" : "s"}`;

  if (leads.length === 0) {
    els.claimedBody.innerHTML = `<tr class="empty-row"><td colspan="6">Nothing claimed yet — export some leads to Sheets first.</td></tr>`;
    return;
  }

  els.claimedBody.innerHTML = leads.map((lead) => {
    const contactLine = lead.contactName
      ? `${escapeHtml(lead.contactName)}${lead.contactTitle ? ` — ${escapeHtml(lead.contactTitle)}` : ""}`
      : "";
    return `
    <tr>
      <td>
        <div class="company-name">${escapeHtml(lead.name)}</div>
        ${contactLine ? `<div class="company-taxonomy">${contactLine}</div>` : ""}
      </td>
      <td class="mono">${escapeHtml(lead.city)}, ${escapeHtml(lead.state)}</td>
      <td class="mono">${phoneCell(lead.contactPhone, lead.companyPhone)}</td>
      <td>${escapeHtml(lead.claimedBy || "—")}</td>
      <td class="mono">${escapeHtml((lead.lastUpdated || "").slice(0, 10))}</td>
      <td>
        <select class="status-select status-${escapeHtml(lead.status).replace(/\s+/g, "-")}" data-npi="${escapeHtml(lead.npi)}">
          ${state.statuses.map((s) => `<option value="${escapeHtml(s)}" ${s === lead.status ? "selected" : ""}>${escapeHtml(s)}</option>`).join("")}
        </select>
      </td>
    </tr>
  `;
  }).join("");

  els.claimedBody.querySelectorAll(".status-select").forEach((select) => {
    select.addEventListener("change", async (e) => {
      const npi = e.target.dataset.npi;
      const status = e.target.value;
      e.target.disabled = true;
      try {
        await apiPost("leads/status", { npi, status });
        e.target.className = `status-select status-${status.replace(/\s+/g, "-")}`;
        showToast(`Status updated to "${status}"`);
      } catch (err) {
        showToast(err.message, true);
      } finally {
        e.target.disabled = false;
      }
    });
  });
}

/* ---------- State / city dropdowns ---------- */

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

/* ---------- Wiring ---------- */

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

els.loginForm.addEventListener("submit", handleLogin);
els.signOutBtn.addEventListener("click", handleSignOut);
document.querySelectorAll(".view-tabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => switchView(tab.dataset.view));
});
els.onlyMine.addEventListener("change", loadClaimedLeads);
els.updatedWithin.addEventListener("change", loadClaimedLeads);
els.updatedYear.addEventListener("change", loadClaimedLeads);
els.refreshClaimedBtn.addEventListener("click", loadClaimedLeads);

if (getSession()) hideLogin(); else showLogin();
