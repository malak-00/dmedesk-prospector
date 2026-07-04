// Frontend for the Apps Script backend. Request layer notes:
// - every request carries ?path= (Apps Script has no real router) and
//   ?token= (session token from sign-in; query param rather than a header
//   keeps requests CORS-simple so no preflight is ever sent)
// - POST bodies go as text/plain for the same reason; the backend parses
//   them as JSON regardless of content type
// - every response is HTTP 200; success/failure is the `success` field in
//   the JSON body, and body.status 401 means the session expired

const THEME_STORAGE_KEY = "dmeProspectorTheme";

// The <head> inline script already set data-theme before first paint (to
// avoid a flash of the wrong theme); this just wires up the toggle button
// to flip it and remember the choice for next time.
function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  setTheme(current === "light" ? "dark" : "light");
}

const SESSION_STORAGE_KEY = "dmeProspectorSession";

// One-time cleanup: earlier versions stored the session in localStorage,
// which never expired on its own. Remove any leftover entry so it doesn't
// sit around indefinitely (it's otherwise inert now -- getSession() below
// no longer reads from localStorage).
localStorage.removeItem(SESSION_STORAGE_KEY);

// sessionStorage (not localStorage) is deliberate -- it's cleared when the
// tab/browser closes, so signing in again is required next time rather than
// silently staying signed in for up to the server's 6-hour session TTL.
function getSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY)) || null;
  } catch {
    return null;
  }
}

function saveSession(session) {
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

function clearSession() {
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
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
  excludedAsClaimed: 0,
  sortKey: null,
  sortDir: 1,
  view: "search",
  claimedLoaded: false,
  claimedLeads: [],
  claimedExpandedIndex: null,
  claimedLoadedAt: null,
  claimedSortKey: null,
  claimedSortDir: 1,
  statuses: [],
};

function skeletonRows(count, colCount) {
  const widths = [85, 55, 70, 90, 60]; // varied widths so it doesn't look like a rigid grid
  const row = `<tr class="skeleton-row">${Array.from({ length: colCount }, (_, i) =>
    `<td><div class="skeleton-bar" style="width:${widths[i % widths.length]}%"></div></td>`
  ).join("")}</tr>`;
  return Array.from({ length: count }, () => row).join("");
}

/* ---------- Sortable columns (both tables) ---------- */

// Clears any previous sort-asc/sort-desc classes in a table's header and
// marks the currently active one, so the arrow indicator stays in sync.
function updateSortIndicators(table, sortKey, sortDir) {
  table.querySelectorAll("th[data-sort-key]").forEach((th) => {
    th.classList.remove("sort-asc", "sort-desc");
    if (th.dataset.sortKey === sortKey) th.classList.add(sortDir > 0 ? "sort-asc" : "sort-desc");
  });
}

function wireSortableHeaders(table, defaultDirs, onSort) {
  table.querySelectorAll("th[data-sort-key]").forEach((th) => {
    th.addEventListener("click", () => onSort(th.dataset.sortKey, defaultDirs[th.dataset.sortKey] ?? 1));
  });
}

const PROSPECT_SORT_COMPARATORS = {
  score: (a, b) => (a.score?.value ?? -1) - (b.score?.value ?? -1),
  company: (a, b) => (a.name || "").localeCompare(b.name || ""),
  location: (a, b) =>
    `${a.address?.state || ""}|${a.address?.city || ""}`.localeCompare(`${b.address?.state || ""}|${b.address?.city || ""}`),
};
const PROSPECT_DEFAULT_SORT_DIR = { score: -1, company: 1, location: 1 };

function sortProspectResults(key, defaultDir) {
  state.sortDir = state.sortKey === key ? state.sortDir * -1 : defaultDir;
  state.sortKey = key;
  state.companies.sort((a, b) => PROSPECT_SORT_COMPARATORS[key](a, b) * state.sortDir);
  state.expandedIndex = null; // row indices shift after a sort
  updateSortIndicators(els.resultsTable, state.sortKey, state.sortDir);
  renderResults();
}

const CLAIMED_SORT_COMPARATORS = {
  company: (a, b) => (a.name || "").localeCompare(b.name || ""),
  location: (a, b) => `${a.state || ""}|${a.city || ""}`.localeCompare(`${b.state || ""}|${b.city || ""}`),
  claimedBy: (a, b) => (a.claimedBy || "").localeCompare(b.claimedBy || ""),
  updated: (a, b) => (Date.parse(a.lastUpdated) || 0) - (Date.parse(b.lastUpdated) || 0),
  status: (a, b) => (a.status || "").localeCompare(b.status || ""),
};
const CLAIMED_DEFAULT_SORT_DIR = { company: 1, location: 1, claimedBy: 1, updated: -1, status: 1 };

function sortClaimedLeads(key, defaultDir) {
  state.claimedSortDir = state.claimedSortKey === key ? state.claimedSortDir * -1 : defaultDir;
  state.claimedSortKey = key;
  state.claimedLeads.sort((a, b) => CLAIMED_SORT_COMPARATORS[key](a, b) * state.claimedSortDir);
  updateSortIndicators(els.claimedTable, state.claimedSortKey, state.claimedSortDir);
  renderClaimedLeads(state.claimedLeads);
}

const els = {
  form: document.getElementById("searchForm"),
  searchBtn: document.getElementById("searchBtn"),
  resultsTable: document.getElementById("resultsTable"),
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
  claimedTable: document.getElementById("claimedTable"),
  claimedBody: document.getElementById("claimedBody"),
  claimedCount: document.getElementById("claimedCount"),
  onlyMine: document.getElementById("onlyMine"),
  updatedWithin: document.getElementById("updatedWithin"),
  updatedYear: document.getElementById("updatedYear"),
  refreshClaimedBtn: document.getElementById("refreshClaimedBtn"),
  staleNudge: document.getElementById("staleNudge"),
  lastUpdatedYearSelect: document.getElementById("lastUpdatedYearSelect"),
  devNotice: document.getElementById("devNotice"),
  suggestBtn: document.getElementById("suggestBtn"),
  suggestionOverlay: document.getElementById("suggestionOverlay"),
  suggestionForm: document.getElementById("suggestionForm"),
  suggestionText: document.getElementById("suggestionText"),
  suggestionSubmitBtn: document.getElementById("suggestionSubmitBtn"),
  suggestionCancelBtn: document.getElementById("suggestionCancelBtn"),
};

// Populate the "Year" filters with the current year and a few back.
(function () {
  const thisYear = new Date().getFullYear();
  [els.updatedYear, els.lastUpdatedYearSelect].forEach((select) => {
    for (let y = thisYear; y >= thisYear - 5; y--) {
      const opt = document.createElement("option");
      opt.value = String(y);
      opt.textContent = String(y);
      select.appendChild(opt);
    }
  });
})();

/* ---------- Sign in ---------- */

function showLogin() {
  els.loginOverlay.hidden = false;
  els.userChip.hidden = true;
  els.suggestBtn.hidden = true;
  els.devNotice.hidden = true;
  els.loginForm.querySelector("input[name=username]")?.focus();
}

function hideLogin() {
  els.loginOverlay.hidden = true;
  const session = getSession();
  if (session) {
    els.userName.textContent = session.displayName;
    els.userChip.hidden = false;
    els.suggestBtn.hidden = false;
    els.devNotice.hidden = false; // shown fresh on every sign-in/page open, not persisted
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

/* ---------- Suggestion box ---------- */

function openSuggestionBox() {
  els.suggestionOverlay.hidden = false;
  els.suggestionText.focus();
}

function closeSuggestionBox() {
  els.suggestionOverlay.hidden = true;
  els.suggestionForm.reset();
}

async function handleSuggestionSubmit(evt) {
  evt.preventDefault();
  const text = els.suggestionText.value.trim();
  if (!text) return;

  els.suggestionSubmitBtn.disabled = true;
  try {
    await apiPost("suggestions/submit", { text });
    closeSuggestionBox();
    showToast("Thanks! Your suggestion was sent to Caroline.");
  } catch (err) {
    showToast(err.message, true);
  } finally {
    els.suggestionSubmitBtn.disabled = false;
  }
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

// Human-readable labels for ScoringService's breakdown keys -- the
// breakdown was already computed server-side and sent down with every
// company, just never rendered anywhere until now.
const SCORE_FACTOR_LABELS = {
  hasPhone: "Has phone number",
  hasFax: "Has fax number",
  hasWebsite: "Has a website",
  activeStatus: "Confirmed open (Places)",
  completeAddress: "Complete address on file",
  placesVerified: "Verified on Foursquare",
  goodRating: "Good rating (8+/10)",
  establishedPresence: "Established (10+ reviews)",
  hasDecisionMaker: "Contact identified",
  medicareActive: "Active Medicare biller",
};

function scoreTooltipHtml(score) {
  if (!score?.breakdown) return "";
  const rows = Object.entries(score.breakdown).map(([key, points]) => {
    const earned = points > 0;
    const label = SCORE_FACTOR_LABELS[key] || key;
    return `<div class="score-tooltip-row ${earned ? "earned" : ""}">
      <span class="score-tooltip-mark">${earned ? "✓" : "✗"}</span>
      <span class="score-tooltip-label">${escapeHtml(label)}</span>
    </div>`;
  }).join("");
  return `
    <div class="score-tooltip">
      <div class="score-tooltip-title">${score.value ?? 0}/${score.maxPossible ?? "?"} points</div>
      ${rows}
    </div>`;
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

// The whole search (NPPES fetch + Foursquare/OSM/CMS enrichment + optional
// scraping) is one opaque request to Apps Script -- there's no real progress
// to report. These timed messages are an approximation, not a claim of
// exact server state, but they at least stop "Searching NPPES registry…"
// from sitting there unchanged while the much slower enrichment step runs.
function searchStatusMsgEl() {
  return document.getElementById("searchStatusMsg");
}

// Remembers the last search filters for this tab session only (sessionStorage,
// not localStorage) -- flipping to Claimed leads and back shouldn't lose what
// was typed, but a brand-new session should still start from a blank form.
const SEARCH_FILTERS_KEY = "dmeProspectorLastSearch";

function saveSearchFormState() {
  const formData = new FormData(els.form);
  const values = {};
  for (const el of els.form.elements) {
    if (!el.name) continue;
    values[el.name] = el.type === "checkbox" ? el.checked : formData.get(el.name) || "";
  }
  sessionStorage.setItem(SEARCH_FILTERS_KEY, JSON.stringify(values));
}

function restoreSearchFormState() {
  const raw = sessionStorage.getItem(SEARCH_FILTERS_KEY);
  if (!raw) return;
  let values;
  try { values = JSON.parse(raw); } catch { return; }
  for (const el of els.form.elements) {
    if (!el.name || !(el.name in values)) continue;
    if (el.type === "checkbox") el.checked = Boolean(values[el.name]);
    else el.value = values[el.name];
  }
  refreshCityOptions(); // programmatic .value assignment above doesn't fire the state select's own change listener
  if (values.city) cityInput.value = values.city;
}

async function runSearch(evt) {
  evt.preventDefault();
  const formData = new FormData(els.form);
  const params = buildSearchParams(formData);
  saveSearchFormState();

  els.searchBtn.disabled = true;
  setStatus("busy", "Searching…");
  els.resultsBody.innerHTML = `<tr class="empty-row"><td colspan="7"><div class="loading-row"><span class="spinner"></span> <span id="searchStatusMsg">Searching NPPES registry…</span></div></td></tr>`;

  const phaseTimers = [
    setTimeout(() => { const el = searchStatusMsgEl(); if (el) el.textContent = "Enriching with Places, OSM & Medicare data…"; }, 2500),
    setTimeout(() => { const el = searchStatusMsgEl(); if (el) el.textContent = "Still working — larger searches and scraping take longer…"; }, 8000),
  ];

  try {
    const data = await apiGet("search/companies", params);

    state.companies = data.companies;
    state.selected.clear();
    state.expandedIndex = null;
    state.sortKey = null; // fresh results start in the server's own order (score desc)
    state.sortDir = 1;
    updateSortIndicators(els.resultsTable, null, 1);
    renderResults(data.excludedAsClaimed || 0);
    setStatus("ready", "Ready");
  } catch (err) {
    els.resultsBody.innerHTML = `<tr class="empty-row"><td colspan="7">${escapeHtml(err.message)}</td></tr>`;
    setStatus("error", "Error");
    showToast(err.message, true);
  } finally {
    phaseTimers.forEach(clearTimeout);
    els.searchBtn.disabled = false;
  }
}

function renderResults(excludedAsClaimed) {
  if (excludedAsClaimed !== undefined) state.excludedAsClaimed = excludedAsClaimed; // remembered across re-renders (e.g. a sort click)
  const { companies } = state;
  const excludedNote = state.excludedAsClaimed > 0 ? ` (${state.excludedAsClaimed} already claimed, filtered out)` : "";
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
    <tr class="lead-row ${isSelected ? "is-selected" : ""}" data-index="${index}" tabindex="0" aria-expanded="false">
      <td onclick="event.stopPropagation()"><input type="checkbox" class="row-check" data-index="${index}" ${isSelected ? "checked" : ""}></td>
      <td>
        <div class="score-ring-wrap" tabindex="0">
          ${scoreRing(company.score)}
          ${scoreTooltipHtml(company.score)}
        </div>
      </td>
      <td>
        <div class="company-name">${escapeHtml(company.name)}</div>
        <div class="company-taxonomy">${escapeHtml(company.taxonomy?.description || "")}</div>
        ${sourceBadges(company.sources)}
      </td>
      <td class="mono">${escapeHtml(company.address?.city || "")}, ${escapeHtml(company.address?.state || "")}</td>
      <td>${primaryContact ? escapeHtml(primaryContact.name) : '<span style="color:var(--muted)">—</span>'}</td>
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
            <div class="mono" style="font-size:13px; line-height:1.8;">
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
            `).join("") || '<span style="color:var(--muted); font-size:13px;">None identified</span>'}
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

function attachRowHandlers() {
  // Scoped to #resultsBody -- the Claimed Leads table also uses ".lead-row"
  // (for shared hover/selection styling) and stays in the DOM under
  // [hidden] when that tab isn't active, so an unscoped query here would
  // double-bind onto its rows too.
  els.resultsBody.querySelectorAll(".lead-row").forEach((row) => {
    row.addEventListener("click", () => toggleRowDetail(Number(row.dataset.index)));
    row.addEventListener("keydown", (e) => {
      if (e.target !== row) return; // let checkboxes/inputs inside the row handle their own keys
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      toggleRowDetail(Number(row.dataset.index));
    });
  });

  els.resultsBody.querySelectorAll(".row-check").forEach((box) => {
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
  row?.setAttribute("aria-expanded", "false");
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
  row.setAttribute("aria-expanded", "true");
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
  els.exportCsvBtn.disabled = true; // prevents a double-click from double-exporting
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
  } finally {
    els.exportCsvBtn.disabled = state.companies.length === 0;
  }
}

async function exportSheets() {
  const companies = getExportCompanies();
  const who = getSession()?.displayName || "you";
  // Claiming leads is a shared, team-visible action with no undo -- confirm
  // before writing, especially since "select none" silently means "all".
  if (!confirm(`Export ${companies.length} lead(s) to the shared Sheet, claimed by ${who}?`)) return;

  els.exportSheetsBtn.disabled = true; // prevents a double-click from double-claiming
  setStatus("busy", "Sending to Sheets…");
  try {
    const data = await apiPost("export/sheets", { companies });
    showToast(`Added ${data.rowsAdded} row(s) claimed by ${data.claimedBy || "you"}`, false, data.sheetUrl);
    state.claimedLoaded = false; // claimed view is now stale
    setStatus("ready", "Ready");
  } catch (err) {
    showToast(err.message, true);
    setStatus("error", "Error");
  } finally {
    els.exportSheetsBtn.disabled = state.companies.length === 0;
  }
}

/* ---------- Claimed leads view ---------- */

// A sentinel option value, never a real status, that means "prompt for a
// new custom status" when selected -- lets teammates introduce their own
// statuses from the app instead of being stuck with the built-in list.
const ADD_STATUS_SENTINEL = "__add_new_status__";

function statusOptionHtml(status, selected) {
  return `<option value="${escapeHtml(status)}" ${selected ? "selected" : ""}>${escapeHtml(status)}</option>`;
}

// Re-renders a row's expanded detail panel in place after its data changes
// (e.g. a new note was added) -- a no-op if that row isn't expanded.
function refreshClaimedDetailIfExpanded(idx) {
  if (state.claimedExpandedIndex !== idx) return;
  collapseClaimedRow(idx);
  state.claimedExpandedIndex = null;
  toggleClaimedRowDetail(idx);
}

async function loadClaimedLeads() {
  els.claimedBody.innerHTML = skeletonRows(5, 8);
  els.staleNudge.hidden = true;
  try {
    const params = {};
    if (els.onlyMine.checked) params.mine = "true";
    if (els.updatedWithin.value) params.updatedWithinDays = els.updatedWithin.value;
    if (els.updatedYear.value) params.updatedYear = els.updatedYear.value;
    const data = await apiGet("leads/list", params);
    state.statuses = data.statuses || [];
    state.claimedLoaded = true;
    state.claimedLoadedAt = Date.now();
    state.claimedSortKey = null; // fresh data starts in the server's own order (last updated desc)
    state.claimedSortDir = 1;
    updateSortIndicators(els.claimedTable, null, 1);
    renderClaimedLeads(data.leads || []);
  } catch (err) {
    els.claimedBody.innerHTML = `<tr class="empty-row"><td colspan="8">${escapeHtml(err.message)}</td></tr>`;
    showToast(err.message, true);
  }
}

function renderClaimedLeads(leads) {
  state.claimedLeads = leads;
  state.claimedExpandedIndex = null;
  els.claimedCount.textContent = `${leads.length} claimed lead${leads.length === 1 ? "" : "s"}`;

  if (leads.length === 0) {
    els.claimedBody.innerHTML = `<tr class="empty-row"><td colspan="8">Nothing claimed yet — export some leads to Sheets first.</td></tr>`;
    return;
  }

  els.claimedBody.innerHTML = leads.map((lead, i) => claimedLeadRowHtml(lead, i)).join("");
  attachClaimedRowHandlers();
}

function claimedLeadRowHtml(lead, index) {
  const contactLine = lead.contactName
    ? `${escapeHtml(lead.contactName)}${lead.contactTitle ? ` — ${escapeHtml(lead.contactTitle)}` : ""}`
    : "";
  return `
    <tr class="lead-row" data-claimed-index="${index}" tabindex="0" aria-expanded="false">
      <td>
        <div class="company-name">${escapeHtml(lead.name)}</div>
        ${contactLine ? `<div class="company-taxonomy">${contactLine}</div>` : ""}
      </td>
      <td class="mono">${escapeHtml(lead.city)}, ${escapeHtml(lead.state)}</td>
      <td class="mono">${phoneCell(lead.contactPhone, lead.companyPhone)}</td>
      <td>${escapeHtml(lead.claimedBy || "—")}</td>
      <td class="mono">${escapeHtml((lead.lastUpdated || "").slice(0, 10))}</td>
      <td onclick="event.stopPropagation()">
        <select class="status-select status-${escapeHtml(lead.status).replace(/\s+/g, "-")}" data-npi="${escapeHtml(lead.npi)}">
          ${state.statuses.map((s) => statusOptionHtml(s, s === lead.status)).join("")}
          <option value="${ADD_STATUS_SENTINEL}">+ Add new status…</option>
        </select>
      </td>
      <td onclick="event.stopPropagation()">
        <input type="text" class="notes-input" data-npi="${escapeHtml(lead.npi)}" data-index="${index}" placeholder="Add a note…">
        ${latestNoteLine(lead.notes) ? `<div class="notes-preview" title="${escapeHtml(latestNoteLine(lead.notes))}">${escapeHtml(latestNoteLine(lead.notes))}</div>` : ""}
      </td>
      <td><span class="chevron">▸</span></td>
    </tr>
  `;
}

// Notes are a running call log (newest entry first, one per line -- see
// SheetsStore.addLeadNote), not a single value -- this is just "what to
// show while collapsed" without rendering the whole history in the row.
function latestNoteLine(notes) {
  return notes ? notes.split("\n")[0] : "";
}

function notesHistoryHtml(notes) {
  const lines = (notes || "").split("\n").filter(Boolean);
  if (lines.length === 0) {
    return '<span style="color:var(--muted); font-size:13px;">No notes yet</span>';
  }
  return `<div class="notes-history">${lines.map((line) => `<div class="notes-entry">${escapeHtml(line)}</div>`).join("")}</div>`;
}

// Reconstructs a CompanyModel-shaped object from the flat fields stored in
// the sheet, so the same brief/generate endpoint used in the Prospect view
// works here too -- useful for the exact case this view is meant for
// (dialing straight from claimed leads without the Sheet open).
function companyLikeFromClaimedLead(lead) {
  const activeSources = (lead.sources || "").split(";").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const hasMedicare = lead.medicareClaims !== "" && lead.medicareClaims != null;
  return {
    name: lead.name,
    npi: lead.npi,
    address: { line1: lead.addressLine1, city: lead.city, state: lead.state, postalCode: lead.postalCode },
    taxonomy: { description: lead.taxonomy },
    website: lead.website || null,
    phone: lead.companyPhone || null,
    fax: lead.fax || null,
    decisionMakers: lead.contactName
      ? [{ name: lead.contactName, title: lead.contactTitle, roleCategory: lead.contactRole || "staff", phone: lead.contactPhone || null }]
      : [],
    places: { rating: lead.rating !== "" ? Number(lead.rating) : null },
    medicare: hasMedicare
      ? {
          totalClaims: Number(lead.medicareClaims),
          totalBeneficiaries: lead.medicareBeneficiaries !== "" ? Number(lead.medicareBeneficiaries) : null,
          medicarePayment: lead.medicarePayment !== "" ? Number(lead.medicarePayment) : null,
        }
      : null,
    score: {
      value: lead.scoreValue !== "" ? Number(lead.scoreValue) : null,
      percentage: lead.scorePercentage !== "" ? Number(lead.scorePercentage) : null,
    },
    sources: {
      nppes: true,
      places: activeSources.includes("places"),
      osm: activeSources.includes("osm"),
      cms: activeSources.includes("cms"),
      website: activeSources.includes("website"),
    },
  };
}

function claimedDetailRowHtml(lead, index) {
  const sourcesList = lead.sources
    ? lead.sources.split(";").map((s) => s.trim().toUpperCase()).filter(Boolean).join(", ")
    : "";
  const scoreLine = lead.scorePercentage !== "" ? `${lead.scorePercentage}% (${lead.scoreValue || "?"} pts)` : "Not scored";
  const medicareLine = lead.medicareClaims !== ""
    ? `${Number(lead.medicareClaims).toLocaleString()} claims` +
      (lead.medicareBeneficiaries !== "" ? `, ${Number(lead.medicareBeneficiaries).toLocaleString()} beneficiaries` : "") +
      (lead.medicarePayment !== "" ? `, $${Math.round(Number(lead.medicarePayment)).toLocaleString()} paid` : "")
    : "No CMS claims data found";

  return `
    <tr class="detail-row">
      <td colspan="8">
        <div class="detail-grid">
          <div class="detail-block">
            <h4>Details</h4>
            <div class="mono" style="font-size:13px; line-height:1.8;">
              NPI: ${escapeHtml(lead.npi || "—")}<br>
              ${escapeHtml(lead.addressLine1 || "")}<br>
              ${escapeHtml(lead.city || "")}, ${escapeHtml(lead.state || "")} ${escapeHtml(lead.postalCode || "")}<br>
              Company phone: ${escapeHtml(lead.companyPhone || "—")}<br>
              Website: ${lead.website ? `<a href="${escapeHtml(lead.website)}" target="_blank">${escapeHtml(lead.website)}</a>` : "—"}<br>
              Fax: ${escapeHtml(lead.fax || "—")}<br>
              Specialty: ${escapeHtml(lead.taxonomy || "—")}<br>
              Score: ${escapeHtml(scoreLine)}<br>
              Medicare (CMS): ${escapeHtml(medicareLine)}<br>
              NPPES last updated: ${escapeHtml(lead.nppesLastUpdated || "—")}<br>
              Data sources: ${escapeHtml(sourcesList || "NPPES only")}
            </div>
          </div>
          <div class="detail-block">
            <h4>Contact</h4>
            ${lead.contactName ? `
              <div class="contact-item">
                <div>
                  ${escapeHtml(lead.contactName)}${lead.contactTitle ? ` — ${escapeHtml(lead.contactTitle)}` : ""}
                  ${lead.contactRole ? `<span class="contact-role">${escapeHtml(lead.contactRole)}</span>` : ""}
                </div>
                ${lead.contactPhone ? `<div class="mono contact-phone">${escapeHtml(lead.contactPhone)}</div>` : ""}
              </div>
            ` : '<span style="color:var(--muted); font-size:13px;">None identified</span>'}
            ${Number(lead.additionalContacts) > 0 ? `<div style="font-size:12px; color:var(--muted); margin-top:8px;">+${escapeHtml(lead.additionalContacts)} other contact(s) found (see Sheet)</div>` : ""}
          </div>
        </div>
        <div class="detail-block notes-history-block">
          <h4>Call log</h4>
          ${notesHistoryHtml(lead.notes)}
        </div>
        <div class="brief-box">
          <button class="btn btn-ghost btn-small" data-claimed-brief-index="${index}">Generate call brief</button>
          <div class="brief-output" id="claimed-brief-${index}"></div>
        </div>
      </td>
    </tr>
  `;
}

async function generateClaimedBrief(index) {
  const lead = state.claimedLeads[index];
  const company = companyLikeFromClaimedLead(lead);
  const output = document.getElementById(`claimed-brief-${index}`);
  output.className = "brief-output visible";
  output.textContent = "Generating brief…";

  try {
    const data = await apiPost("brief/generate", { company });
    output.textContent = data.brief;
  } catch (err) {
    output.textContent = `Could not generate brief: ${err.message}`;
  }
}

// Same "touch only the one row that changed" approach as the Prospect
// table -- see toggleRowDetail/collapseRow above.
function collapseClaimedRow(idx) {
  const row = document.querySelector(`#claimedBody .lead-row[data-claimed-index="${idx}"]`);
  row?.querySelector(".chevron")?.classList.remove("open");
  row?.setAttribute("aria-expanded", "false");
  const detail = row?.nextElementSibling;
  if (detail && detail.classList.contains("detail-row")) detail.remove();
}

function toggleClaimedRowDetail(idx) {
  const row = document.querySelector(`#claimedBody .lead-row[data-claimed-index="${idx}"]`);
  if (!row) return;

  if (state.claimedExpandedIndex === idx) {
    collapseClaimedRow(idx);
    state.claimedExpandedIndex = null;
    return;
  }

  if (state.claimedExpandedIndex !== null) collapseClaimedRow(state.claimedExpandedIndex);

  state.claimedExpandedIndex = idx;
  row.querySelector(".chevron")?.classList.add("open");
  row.setAttribute("aria-expanded", "true");
  row.insertAdjacentHTML("afterend", claimedDetailRowHtml(state.claimedLeads[idx], idx));
  document.querySelector(`[data-claimed-brief-index="${idx}"]`)?.addEventListener("click", (e) => {
    e.stopPropagation();
    generateClaimedBrief(idx);
  });
}

function attachClaimedRowHandlers() {
  document.querySelectorAll("#claimedBody .lead-row").forEach((row) => {
    row.addEventListener("click", () => toggleClaimedRowDetail(Number(row.dataset.claimedIndex)));
    row.addEventListener("keydown", (e) => {
      if (e.target !== row) return; // let the status select / notes input handle their own keys
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      toggleClaimedRowDetail(Number(row.dataset.claimedIndex));
    });
  });

  els.claimedBody.querySelectorAll(".status-select").forEach((select) => {
    var previousValue = select.value;
    select.addEventListener("change", async (e) => {
      const npi = e.target.dataset.npi;
      let status = e.target.value;

      if (status === ADD_STATUS_SENTINEL) {
        const custom = (prompt("New status name (e.g. \"follow-up 2wk\"):") || "").trim();
        if (!custom) { e.target.value = previousValue; return; } // cancelled
        status = custom;
        if (!state.statuses.includes(status)) {
          state.statuses.push(status);
          // Every other status dropdown on screen should offer the new
          // status too, without waiting for a full reload.
          document.querySelectorAll(".status-select").forEach((otherSelect) => {
            if (otherSelect === e.target) return;
            otherSelect.insertAdjacentHTML("beforeend", statusOptionHtml(status, false));
          });
        }
        // Replace the sentinel option with a real one for this status.
        e.target.querySelector(`option[value="${CSS.escape(ADD_STATUS_SENTINEL)}"]`)?.remove();
        e.target.insertAdjacentHTML("beforeend", statusOptionHtml(status, true));
        e.target.value = status;
      }

      e.target.disabled = true;
      try {
        await apiPost("leads/status", { npi, status });
        e.target.className = `status-select status-${status.replace(/\s+/g, "-")}`;
        previousValue = status;
        showToast(`Status updated to "${status}"`);
      } catch (err) {
        e.target.value = previousValue;
        showToast(err.message, true);
      } finally {
        e.target.disabled = false;
      }
    });
  });

  // Each Enter adds one new timestamped, attributed entry to the lead's
  // call log (see SheetsStore.addLeadNote) -- the field is always "type the
  // next note", not an editable copy of the last one.
  els.claimedBody.querySelectorAll(".notes-input").forEach((input) => {
    input.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const note = e.target.value.trim();
      if (!note) return;

      const npi = e.target.dataset.npi;
      const idx = Number(e.target.dataset.index);
      e.target.disabled = true;
      try {
        const data = await apiPost("leads/notes", { npi, note });
        state.claimedLeads[idx].notes = data.notes;
        e.target.value = "";

        const latest = latestNoteLine(data.notes);
        let preview = e.target.parentElement.querySelector(".notes-preview");
        if (!preview) {
          preview = document.createElement("div");
          preview.className = "notes-preview";
          e.target.insertAdjacentElement("afterend", preview);
        }
        preview.textContent = latest;
        preview.title = latest;

        refreshClaimedDetailIfExpanded(idx);
        showToast("Note added");
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
restoreSearchFormState();

/* ---------- Wiring ---------- */

els.form.addEventListener("submit", runSearch);
els.selectAll.addEventListener("change", (e) => {
  els.resultsBody.querySelectorAll(".row-check").forEach((box) => {
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
  els.resultsBody.querySelectorAll(".row-check").forEach((box) => { box.checked = false; });
  els.resultsBody.querySelectorAll(".lead-row").forEach((row) => row.classList.remove("is-selected"));
  updateSelectionUI();
});
els.exportCsvBtn.addEventListener("click", exportCsv);
els.exportSheetsBtn.addEventListener("click", exportSheets);

els.loginForm.addEventListener("submit", handleLogin);
els.signOutBtn.addEventListener("click", handleSignOut);
els.suggestBtn.addEventListener("click", openSuggestionBox);
els.suggestionForm.addEventListener("submit", handleSuggestionSubmit);
els.suggestionCancelBtn.addEventListener("click", closeSuggestionBox);
els.suggestionOverlay.addEventListener("click", (e) => { if (e.target === els.suggestionOverlay) closeSuggestionBox(); });
// Two toggle buttons exist (header + login card, so theme can be changed
// even before signing in) -- both share the .theme-toggle class.
document.querySelectorAll(".theme-toggle").forEach((btn) => btn.addEventListener("click", toggleTheme));
document.querySelectorAll(".view-tabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => switchView(tab.dataset.view));
});
els.onlyMine.addEventListener("change", loadClaimedLeads);
els.updatedWithin.addEventListener("change", loadClaimedLeads);
els.updatedYear.addEventListener("change", loadClaimedLeads);
els.refreshClaimedBtn.addEventListener("click", loadClaimedLeads);
els.staleNudge.addEventListener("click", loadClaimedLeads);

wireSortableHeaders(els.resultsTable, PROSPECT_DEFAULT_SORT_DIR, sortProspectResults);
wireSortableHeaders(els.claimedTable, CLAIMED_DEFAULT_SORT_DIR, sortClaimedLeads);

// Nudges the user to refresh the Claimed tab after it's been sitting open
// for a while -- teammates share one sheet, so a colleague's status/claim
// change wouldn't otherwise show up until a manual refresh.
const STALE_AFTER_MS = 2 * 60 * 1000;
setInterval(() => {
  if (state.view !== "claimed" || !state.claimedLoadedAt) return;
  els.staleNudge.hidden = Date.now() - state.claimedLoadedAt < STALE_AFTER_MS;
}, 15000);

if (getSession()) hideLogin(); else showLogin();
