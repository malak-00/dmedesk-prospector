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
  // "Search more" bookkeeping -- see the functions near runSearch/searchMore.
  lastSearchParams: null,
  searchMoreVariantSkips: {},
  searchMoreSeenNpis: [],
  view: "search",
  claimedLoaded: false,
  claimedLeads: [],
  // The full, unfiltered set fetched from the server -- state.claimedLeads
  // (what's actually rendered, indexed 1:1 with row DOM elements) is derived
  // from this by applying the status filter, so changing the status filter
  // never needs a re-fetch, just a re-derive + re-render.
  claimedLeadsAll: [],
  statusFilter: "",
  claimedExpandedIndex: null,
  claimedLoadedAt: null,
  claimedSortKey: null,
  claimedSortDir: 1,
  statuses: [],
  reminderTargetIndex: null,
  // Which single call-log entry (if any) is currently showing its inline
  // editor -- only one at a time app-wide. Re-rendering the detail panel
  // (the same "recompute from state" approach used everywhere else in this
  // view) is enough to show/hide it, no manual DOM patching needed.
  editingNoteLine: null, // { claimedIndex, lineIndex } | null
  // npi -> reminderAt string already notified for. Keying on the exact
  // timestamp (not just the npi) means rescheduling a reminder makes it
  // eligible to notify again, instead of being silently skipped forever.
  notifiedReminders: new Map(),
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
  // Leads with no reminder sort last in the default (ascending/soonest-first)
  // direction, since Date.parse("") is NaN and falls back to Infinity.
  reminder: (a, b) => (Date.parse(a.reminderAt) || Infinity) - (Date.parse(b.reminderAt) || Infinity),
};
const CLAIMED_DEFAULT_SORT_DIR = { company: 1, location: 1, claimedBy: 1, updated: -1, status: 1, reminder: 1 };

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
  searchMoreBtn: document.getElementById("searchMoreBtn"),
  searchMoreLabel: document.getElementById("searchMoreLabel"),
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
  enableNotifications: document.getElementById("enableNotifications"),
  updatedWithin: document.getElementById("updatedWithin"),
  updatedYear: document.getElementById("updatedYear"),
  statusFilter: document.getElementById("statusFilter"),
  refreshClaimedBtn: document.getElementById("refreshClaimedBtn"),
  staleNudge: document.getElementById("staleNudge"),
  lastUpdatedYearSelect: document.getElementById("lastUpdatedYearSelect"),
  devNotice: document.getElementById("devNotice"),
  devNoticeClose: document.getElementById("devNoticeClose"),
  suggestBtn: document.getElementById("suggestBtn"),
  suggestionOverlay: document.getElementById("suggestionOverlay"),
  suggestionForm: document.getElementById("suggestionForm"),
  suggestionText: document.getElementById("suggestionText"),
  suggestionSubmitBtn: document.getElementById("suggestionSubmitBtn"),
  suggestionCancelBtn: document.getElementById("suggestionCancelBtn"),
  reminderOverlay: document.getElementById("reminderOverlay"),
  reminderForm: document.getElementById("reminderForm"),
  reminderContext: document.getElementById("reminderContext"),
  reminderAtInput: document.getElementById("reminderAtInput"),
  reminderClearBtn: document.getElementById("reminderClearBtn"),
  reminderCancelBtn: document.getElementById("reminderCancelBtn"),
  reminderSaveBtn: document.getElementById("reminderSaveBtn"),
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
    const data = await apiPost("suggestions/submit", { text });
    closeSuggestionBox();
    showToast("Thanks! Your suggestion was sent to Caroline.", false, data.sheetUrl);
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

// "states" and "taxonomyDescriptions" are multi-valued (several checkboxes
// sharing one `name`) -- FormData.entries() would yield one params[key]
// assignment per checked box, each overwriting the last, so they're pulled
// out via getAll() and sent as a single comma-joined value instead.
const MULTI_VALUE_FIELDS = ["states", "taxonomyDescriptions"];

function buildSearchParams(formData) {
  const params = {};
  for (const [key, value] of formData.entries()) {
    if (MULTI_VALUE_FIELDS.includes(key)) continue;
    if (value !== "" && value !== null) params[key] = value;
  }
  for (const key of MULTI_VALUE_FIELDS) {
    const values = formData.getAll(key).filter(Boolean);
    if (values.length) params[key] = values.join(",");
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
    if (!el.name || MULTI_VALUE_FIELDS.includes(el.name)) continue;
    values[el.name] = el.type === "checkbox" ? el.checked : formData.get(el.name) || "";
  }
  for (const key of MULTI_VALUE_FIELDS) values[key] = formData.getAll(key);
  sessionStorage.setItem(SEARCH_FILTERS_KEY, JSON.stringify(values));
}

function restoreSearchFormState() {
  const raw = sessionStorage.getItem(SEARCH_FILTERS_KEY);
  if (!raw) return;
  let values;
  try { values = JSON.parse(raw); } catch { return; }
  for (const el of els.form.elements) {
    if (!el.name || !(el.name in values) || MULTI_VALUE_FIELDS.includes(el.name)) continue;
    if (el.type === "checkbox") el.checked = Boolean(values[el.name]);
    else el.value = values[el.name];
  }
  if (Array.isArray(values.states)) {
    stateOptionsContainer.querySelectorAll('input[name="states"]').forEach((cb) => {
      cb.checked = values.states.includes(cb.value);
    });
    updateStateSummary();
  }
  if (Array.isArray(values.taxonomyDescriptions)) {
    taxonomyMultiselect.querySelectorAll('input[name="taxonomyDescriptions"]').forEach((cb) => {
      cb.checked = values.taxonomyDescriptions.includes(cb.value);
    });
    taxonomyAllCheckbox.checked = values.taxonomyDescriptions.length === 0;
    updateTaxonomySummary();
  }
  refreshCityOptions(); // programmatic checkbox state above doesn't fire the state options' own change listener
  if (values.city) cityInput.value = values.city;
}

/* ---------- Search more (session-scoped pagination memory) ---------- */
// Lets a rep click through the SAME filters again to see leads beyond what
// they've already been shown, instead of getting the same top results every
// time. The server resumes each underlying NPPES query variant (one per
// state x specialty combo, in the multi-select case) from wherever it left
// off last time -- see CompanyService.searchCompanies's variantSkips -- and
// also skips any NPI already returned earlier in this tab's session, so a
// company reachable through more than one variant can't reappear either.
// None of this is persisted beyond the tab (matches the existing
// sessionStorage-scoped search-filter memory) -- a genuinely new search
// (via the Search leads button) always starts over from scratch.
function collectNpisFromCompanies(companies) {
  const npis = [];
  for (const c of companies) {
    if (c.npi) npis.push(String(c.npi));
    for (const loc of c.locations || []) {
      if (loc.npi) npis.push(String(loc.npi));
    }
  }
  return npis;
}

function updateSearchMoreButton(exhausted) {
  els.searchMoreBtn.hidden = false;
  els.searchMoreBtn.disabled = exhausted;
  els.searchMoreLabel.textContent = exhausted ? "No more leads found" : "Search more";
  els.searchMoreBtn.title = exhausted
    ? "This search has no more unclaimed leads left in the registry"
    : "Keeps the same filters and pages deeper into the registry, skipping every lead you've already seen for this search";
}

async function executeSearch(params, { isMore = false } = {}) {
  els.searchBtn.disabled = true;
  els.searchMoreBtn.disabled = true;
  setStatus("busy", isMore ? "Searching more…" : "Searching…");
  if (!isMore) {
    els.resultsBody.innerHTML = `<tr class="empty-row"><td colspan="7"><div class="loading-row"><span class="spinner"></span> <span id="searchStatusMsg">Searching NPPES registry…</span></div></td></tr>`;
  }

  const phaseTimers = [
    setTimeout(() => { const el = searchStatusMsgEl(); if (el) el.textContent = "Enriching with Places, OSM & Medicare data…"; }, 2500),
    setTimeout(() => { const el = searchStatusMsgEl(); if (el) el.textContent = "Still working — larger searches and scraping take longer…"; }, 8000),
  ];

  try {
    const requestParams = { ...params };
    if (isMore) {
      if (Object.keys(state.searchMoreVariantSkips).length) requestParams.variantSkips = JSON.stringify(state.searchMoreVariantSkips);
      if (state.searchMoreSeenNpis.length) requestParams.excludeNpis = state.searchMoreSeenNpis.join(",");
    }

    const data = await apiGet("search/companies", requestParams);

    state.searchMoreVariantSkips = data.variantSkips || {};
    state.searchMoreSeenNpis = state.searchMoreSeenNpis.concat(collectNpisFromCompanies(data.companies));

    if (isMore && data.companies.length === 0) {
      // Nothing new to show -- leave the current table exactly as it was
      // instead of replacing it with an empty state.
      showToast("No more leads found for this search");
    } else {
      state.companies = data.companies;
      state.selected.clear();
      state.expandedIndex = null;
      state.sortKey = null; // fresh results start in the server's own order (score desc)
      state.sortDir = 1;
      updateSortIndicators(els.resultsTable, null, 1);
      renderResults(data.excludedAsClaimed || 0);
    }

    if (!isMore && data.companies.length === 0) {
      els.searchMoreBtn.hidden = true; // nothing was found at all -- no point offering to page deeper
    } else {
      updateSearchMoreButton(data.exhaustedRegistry);
    }

    state.lastSearchParams = params;
    setStatus("ready", "Ready");
  } catch (err) {
    if (!isMore) els.resultsBody.innerHTML = `<tr class="empty-row"><td colspan="7">${escapeHtml(err.message)}</td></tr>`;
    setStatus("error", "Error");
    showToast(err.message, true);
    // A failed click always leaves it re-clickable -- reaching here means it
    // was enabled (not exhausted) when clicked, since an exhausted button is
    // disabled and can't be clicked in the first place.
    els.searchMoreBtn.disabled = false;
  } finally {
    // Deliberately NOT touching els.searchMoreBtn.disabled here -- the
    // success path above already set its final disabled state based on
    // whether the registry is now exhausted, and unconditionally clearing
    // it here would silently re-enable an exhausted button on every search.
    phaseTimers.forEach(clearTimeout);
    els.searchBtn.disabled = false;
  }
}

async function searchMore() {
  if (!state.lastSearchParams) return;
  await executeSearch(state.lastSearchParams, { isMore: true });
}

async function runSearch(evt) {
  evt.preventDefault();
  const formData = new FormData(els.form);
  const params = buildSearchParams(formData);
  saveSearchFormState();

  // A brand-new search always starts over from scratch -- only "Search
  // more" continues from a remembered position.
  state.searchMoreVariantSkips = {};
  state.searchMoreSeenNpis = [];

  await executeSearch(params);
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

function clearSelection() {
  state.selected.clear();
  els.selectAll.checked = false;
  els.resultsBody.querySelectorAll(".row-check").forEach((box) => { box.checked = false; });
  els.resultsBody.querySelectorAll(".lead-row").forEach((row) => row.classList.remove("is-selected"));
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
        <div class="company-name">${escapeHtml(company.name)}${locationsBadge(company.locations)}</div>
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

// Shown next to the company name when NPPES has multiple branches (same
// name, same authorized official) folded into this one row -- see
// CompanyService's mergeDuplicateBranches_.
function locationsBadge(locations) {
  if (!locations || locations.length <= 1) return "";
  return ` <span class="locations-badge" title="Same company and authorized official, ${locations.length} branch locations">${locations.length} locations</span>`;
}

function branchLocationsHtml(locations) {
  if (!locations || locations.length <= 1) return "";
  return `
    <div class="detail-block">
      <h4>Branch locations (${locations.length})</h4>
      ${locations.map((loc) => `
        <div class="contact-item">
          <div class="mono" style="font-size:13px; line-height:1.6;">
            NPI: ${escapeHtml(loc.npi || "—")}<br>
            ${escapeHtml(loc.address?.line1 || "")}<br>
            ${escapeHtml(loc.address?.city || "")}, ${escapeHtml(loc.address?.state || "")} ${escapeHtml(loc.address?.postalCode || "")}<br>
            ${escapeHtml(loc.phone || "—")}
          </div>
        </div>
      `).join("")}
    </div>
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
          ${branchLocationsHtml(company.locations)}
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
    clearSelection(); // these leads are claimed now -- leave them unchecked rather than re-exportable at a click
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

// Matches "cbk", "call back", "call-back", "callback" (any casing) -- used
// to auto-offer a reminder right after someone sets one of these statuses.
function isCallbackStatus(status) {
  return /\bcbk\b|call\s*-?\s*back/i.test(status || "");
}

// Reminders only ever "remind" someone while the app is open (no email/push
// delivery), so the badge's whole job is to be scannable at a glance:
// overdue is urgent, today is coming up, anything later is just FYI.
function reminderUrgency(reminderAt) {
  const t = Date.parse(reminderAt);
  if (isNaN(t)) return null;
  const now = Date.now();
  if (t < now) return "overdue";
  if (t - now < 24 * 60 * 60 * 1000) return "today";
  return "upcoming";
}

function formatReminder(reminderAt) {
  const d = new Date(reminderAt);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function reminderBadgeHtml(reminderAt) {
  const urgency = reminderUrgency(reminderAt);
  if (!urgency) return "";
  return `<span class="reminder-badge reminder-${urgency}">🔔 ${escapeHtml(formatReminder(reminderAt))}</span>`;
}

// <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" in LOCAL time, not
// the ISO/UTC string the sheet stores -- new Date(iso).toISOString() would
// silently shift the displayed time by the browser's UTC offset.
function toDatetimeLocalValue(reminderAt) {
  const d = new Date(reminderAt);
  if (isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Re-renders a row's expanded detail panel in place after its data changes
// (e.g. a new note was added) -- a no-op if that row isn't expanded.
function refreshClaimedDetailIfExpanded(idx) {
  if (state.claimedExpandedIndex !== idx) return;
  collapseClaimedRow(idx);
  state.claimedExpandedIndex = null;
  toggleClaimedRowDetail(idx);
}

/* ---------- Callback reminders ---------- */

function openReminderModal(idx) {
  const lead = state.claimedLeads[idx];
  state.reminderTargetIndex = idx;
  els.reminderContext.textContent = lead.name;
  els.reminderAtInput.value = lead.reminderAt ? toDatetimeLocalValue(lead.reminderAt) : "";
  els.reminderClearBtn.hidden = !lead.reminderAt;
  els.reminderOverlay.hidden = false;
  els.reminderAtInput.focus();
}

function closeReminderModal() {
  els.reminderOverlay.hidden = true;
  els.reminderForm.reset();
  state.reminderTargetIndex = null;
}

// Swaps just the one cell (row badge) and, if applicable, the detail panel --
// same "touch only what changed" approach used elsewhere in this view.
function refreshClaimedRowReminderBadge(idx) {
  const cell = document.querySelector(`#claimedBody .lead-row[data-claimed-index="${idx}"] .reminder-cell`);
  if (cell) cell.innerHTML = reminderBadgeHtml(state.claimedLeads[idx].reminderAt);
  refreshClaimedDetailIfExpanded(idx);
}

async function saveReminder(idx, reminderAt) {
  const lead = state.claimedLeads[idx];
  els.reminderSaveBtn.disabled = true;
  try {
    const data = await apiPost("leads/reminder", { npi: lead.npi, reminderAt });
    lead.reminderAt = data.reminderAt;
    closeReminderModal();
    refreshClaimedRowReminderBadge(idx);
    showToast(data.reminderAt ? "Reminder set" : "Reminder cleared");
  } catch (err) {
    showToast(err.message, true);
  } finally {
    els.reminderSaveBtn.disabled = false;
  }
}

function handleReminderSubmit(evt) {
  evt.preventDefault();
  const idx = state.reminderTargetIndex;
  if (idx == null || !els.reminderAtInput.value) return;
  saveReminder(idx, new Date(els.reminderAtInput.value).toISOString());
}

function handleReminderClear() {
  const idx = state.reminderTargetIndex;
  if (idx == null) return;
  saveReminder(idx, "");
}

// Real OS-level browser notifications, not a true push service: this only
// fires while the app is open in some tab (any tab, not necessarily the
// Claimed Leads one, and it doesn't need focus) -- there's no backend
// capable of delivering a notification while the browser itself is closed
// (that needs a service worker + VAPID-signed push, which Apps Script can't
// sign). Good enough for "don't let a callback slip by during a shift."
const NOTIFY_PREF_KEY = "dmeProspectorNotifyReminders";

function notificationsSupported() {
  return typeof Notification !== "undefined";
}

function initNotificationToggle() {
  if (!notificationsSupported()) { els.enableNotifications.disabled = true; return; }
  const wanted = localStorage.getItem(NOTIFY_PREF_KEY) === "true";
  els.enableNotifications.checked = wanted && Notification.permission === "granted";
}

async function handleNotificationToggle(e) {
  if (!e.target.checked) {
    localStorage.setItem(NOTIFY_PREF_KEY, "false");
    return;
  }
  if (!notificationsSupported()) {
    showToast("Your browser doesn't support notifications", true);
    e.target.checked = false;
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    showToast("Notifications were blocked — allow them in your browser's site settings to use this", true);
    e.target.checked = false;
    localStorage.setItem(NOTIFY_PREF_KEY, "false");
    return;
  }
  localStorage.setItem(NOTIFY_PREF_KEY, "true");
  showToast("You'll get a notification when a callback reminder comes due");
  checkDueReminders();
}

// Scans whatever's currently loaded in memory (no extra network request) for
// reminders that just became due, and fires one notification each -- keyed
// by npi + exact reminderAt, so rescheduling a reminder makes it eligible to
// notify again instead of being silently skipped forever.
//
// Only notifies for leads claimed by the SIGNED-IN user -- state.claimedLeads
// can include every teammate's claimed leads (whenever "Only mine" is
// unchecked), and a reminder is only ever meant for whoever set it, not
// everyone currently viewing the shared list.
function checkDueReminders() {
  if (!notificationsSupported() || Notification.permission !== "granted") return;
  if (localStorage.getItem(NOTIFY_PREF_KEY) !== "true") return;
  const myName = getSession()?.displayName;
  if (!myName) return;
  const now = Date.now();
  state.claimedLeads.forEach((lead) => {
    if (!lead.reminderAt) return;
    if (lead.claimedBy !== myName) return;
    const t = Date.parse(lead.reminderAt);
    if (isNaN(t) || t > now) return;
    if (state.notifiedReminders.get(lead.npi) === lead.reminderAt) return;
    state.notifiedReminders.set(lead.npi, lead.reminderAt);
    const notification = new Notification(`Callback due: ${lead.name}`, {
      body: `Reminder was set for ${formatReminder(lead.reminderAt)}`,
      tag: `dme-reminder-${lead.npi}`,
    });
    notification.onclick = () => window.focus();
  });
}

// Keeps the current selection if it's still a known status; otherwise falls
// back to "All statuses" -- a custom status could in principle disappear if
// no lead uses it anymore between loads.
function populateStatusFilterOptions() {
  const current = els.statusFilter.value;
  els.statusFilter.innerHTML =
    `<option value="">All statuses</option>` +
    state.statuses.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
  els.statusFilter.value = state.statuses.includes(current) ? current : "";
  state.statusFilter = els.statusFilter.value;
}

function applyStatusFilter(leads) {
  return state.statusFilter ? leads.filter((lead) => lead.status === state.statusFilter) : leads;
}

async function loadClaimedLeads() {
  els.claimedBody.innerHTML = skeletonRows(5, 9);
  els.staleNudge.hidden = true;
  try {
    const params = {};
    if (els.onlyMine.checked) params.mine = "true";
    if (els.updatedWithin.value) params.updatedWithinDays = els.updatedWithin.value;
    if (els.updatedYear.value) params.updatedYear = els.updatedYear.value;
    const data = await apiGet("leads/list", params);
    state.statuses = data.statuses || [];
    populateStatusFilterOptions();
    state.claimedLoaded = true;
    state.claimedLoadedAt = Date.now();
    state.claimedSortKey = null; // fresh data starts in the server's own order (last updated desc)
    state.claimedSortDir = 1;
    updateSortIndicators(els.claimedTable, null, 1);
    state.claimedLeadsAll = data.leads || [];
    renderClaimedLeads(applyStatusFilter(state.claimedLeadsAll));
  } catch (err) {
    els.claimedBody.innerHTML = `<tr class="empty-row"><td colspan="9">${escapeHtml(err.message)}</td></tr>`;
    showToast(err.message, true);
  }
}

function renderClaimedLeads(leads) {
  state.claimedLeads = leads;
  state.claimedExpandedIndex = null;
  els.claimedCount.textContent = `${leads.length} claimed lead${leads.length === 1 ? "" : "s"}`;
  checkDueReminders();

  if (leads.length === 0) {
    els.claimedBody.innerHTML = `<tr class="empty-row"><td colspan="9">Nothing claimed yet — export some leads to Sheets first.</td></tr>`;
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
        <select class="status-select status-${escapeHtml(lead.status).replace(/\s+/g, "-")}" data-npi="${escapeHtml(lead.npi)}" data-index="${index}">
          ${state.statuses.map((s) => statusOptionHtml(s, s === lead.status)).join("")}
          <option value="${ADD_STATUS_SENTINEL}">+ Add new status…</option>
        </select>
      </td>
      <td class="reminder-cell">${reminderBadgeHtml(lead.reminderAt)}</td>
      <td onclick="event.stopPropagation()">
        <input type="text" class="notes-input" data-npi="${escapeHtml(lead.npi)}" data-index="${index}" placeholder="Add a note…">
        ${latestNoteLine(lead.notes) ? `<div class="notes-preview" title="${escapeHtml(latestNoteLine(lead.notes))}">${escapeHtml(latestNoteLine(lead.notes))}</div>` : ""}
      </td>
      <td><span class="chevron">▸</span></td>
    </tr>
  `;
}

// Notes are a running call log (newest entry first, one per line -- see
// SheetsStore.addLeadNote/replaceLeadNotes), not a single value.
function notesLines(notes) {
  return (notes || "").split("\n").filter(Boolean);
}

// "What to show while collapsed" without rendering the whole history in the row.
function latestNoteLine(notes) {
  return notesLines(notes)[0] || "";
}

function notesHistoryHtml(notes, claimedIndex) {
  const lines = notesLines(notes);
  if (lines.length === 0) {
    return '<span style="color:var(--muted); font-size:13px;">No notes yet</span>';
  }
  return `<div class="notes-history">${lines.map((line, lineIndex) => {
    const editing = state.editingNoteLine
      && state.editingNoteLine.claimedIndex === claimedIndex
      && state.editingNoteLine.lineIndex === lineIndex;

    if (editing) {
      return `
        <div class="notes-entry notes-entry-editing">
          <input type="text" class="notes-entry-edit-input" value="${escapeHtml(line)}" data-claimed-index="${claimedIndex}" data-line-index="${lineIndex}">
          <span class="notes-entry-actions">
            <button type="button" class="notes-entry-btn" data-note-save data-claimed-index="${claimedIndex}" data-line-index="${lineIndex}">Save</button>
            <button type="button" class="notes-entry-btn" data-note-cancel>Cancel</button>
          </span>
        </div>`;
    }

    return `
      <div class="notes-entry">
        <span class="notes-entry-text">${escapeHtml(line)}</span>
        <span class="notes-entry-actions">
          <button type="button" class="notes-entry-btn" data-note-edit data-claimed-index="${claimedIndex}" data-line-index="${lineIndex}" title="Edit this entry">Edit</button>
          <button type="button" class="notes-entry-btn" data-note-delete data-claimed-index="${claimedIndex}" data-line-index="${lineIndex}" title="Delete this entry">Delete</button>
        </span>
      </div>`;
  }).join("")}</div>`;
}

// Keeps the collapsed row's one-line preview in sync after a note is added,
// edited, or deleted -- removes the preview entirely once the last entry is gone.
function updateNotesPreview(idx, notesText) {
  const input = document.querySelector(`#claimedBody .notes-input[data-index="${idx}"]`);
  if (!input) return;
  const latest = latestNoteLine(notesText);
  let preview = input.parentElement.querySelector(".notes-preview");
  if (latest) {
    if (!preview) {
      preview = document.createElement("div");
      preview.className = "notes-preview";
      input.insertAdjacentElement("afterend", preview);
    }
    preview.textContent = latest;
    preview.title = latest;
  } else {
    preview?.remove();
  }
}

async function saveNoteEntryEdit(idx, lineIndex, newText) {
  const trimmed = newText.trim();
  if (!trimmed) {
    showToast("A note entry can't be blank — use Delete instead", true);
    return;
  }
  const lead = state.claimedLeads[idx];
  const lines = notesLines(lead.notes);
  lines[lineIndex] = trimmed;
  try {
    const data = await apiPost("leads/notes/replace", { npi: lead.npi, notes: lines.join("\n") });
    lead.notes = data.notes;
    state.editingNoteLine = null;
    updateNotesPreview(idx, data.notes);
    refreshClaimedDetailIfExpanded(idx);
    showToast("Note updated");
  } catch (err) {
    showToast(err.message, true);
  }
}

async function deleteNoteEntry(idx, lineIndex) {
  if (!confirm("Delete this call log entry? This can't be undone.")) return;
  const lead = state.claimedLeads[idx];
  const lines = notesLines(lead.notes);
  lines.splice(lineIndex, 1);
  try {
    const data = await apiPost("leads/notes/replace", { npi: lead.npi, notes: lines.join("\n") });
    lead.notes = data.notes;
    state.editingNoteLine = null;
    updateNotesPreview(idx, data.notes);
    refreshClaimedDetailIfExpanded(idx);
    showToast("Note deleted");
  } catch (err) {
    showToast(err.message, true);
  }
}

// Wires the Edit/Delete/Save/Cancel controls for whichever call-log entries
// are currently rendered -- called every time the detail panel is (re)drawn,
// same as the brief/reminder button wiring right below it.
function wireNotesHistoryHandlers(idx) {
  document.querySelectorAll(`[data-note-edit][data-claimed-index="${idx}"]`).forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      state.editingNoteLine = { claimedIndex: idx, lineIndex: Number(btn.dataset.lineIndex) };
      refreshClaimedDetailIfExpanded(idx);
    });
  });
  document.querySelectorAll(`[data-note-delete][data-claimed-index="${idx}"]`).forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteNoteEntry(idx, Number(btn.dataset.lineIndex));
    });
  });
  document.querySelectorAll(`[data-note-save][data-claimed-index="${idx}"]`).forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const input = document.querySelector(`.notes-entry-edit-input[data-claimed-index="${idx}"][data-line-index="${btn.dataset.lineIndex}"]`);
      saveNoteEntryEdit(idx, Number(btn.dataset.lineIndex), input.value);
    });
  });
  document.querySelectorAll(`[data-note-cancel]`).forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      state.editingNoteLine = null;
      refreshClaimedDetailIfExpanded(idx);
    });
  });
  document.querySelectorAll(`.notes-entry-edit-input[data-claimed-index="${idx}"]`).forEach((input) => {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        saveNoteEntryEdit(idx, Number(input.dataset.lineIndex), input.value);
      } else if (e.key === "Escape") {
        state.editingNoteLine = null;
        refreshClaimedDetailIfExpanded(idx);
      }
    });
  });
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
      <td colspan="9">
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
          ${notesHistoryHtml(lead.notes, index)}
        </div>
        <div class="detail-block reminder-block">
          <h4>Callback reminder</h4>
          ${lead.reminderAt
            ? `<div class="reminder-current reminder-${reminderUrgency(lead.reminderAt)}">🔔 ${escapeHtml(formatReminder(lead.reminderAt))}</div>`
            : '<span style="color:var(--muted); font-size:13px;">No reminder set</span>'}
          <button type="button" class="btn btn-ghost btn-small" data-reminder-index="${index}">${lead.reminderAt ? "Edit reminder" : "Set reminder"}</button>
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
    if (state.editingNoteLine?.claimedIndex === idx) state.editingNoteLine = null;
    return;
  }

  if (state.claimedExpandedIndex !== null) {
    collapseClaimedRow(state.claimedExpandedIndex);
    if (state.editingNoteLine?.claimedIndex === state.claimedExpandedIndex) state.editingNoteLine = null;
  }

  state.claimedExpandedIndex = idx;
  row.querySelector(".chevron")?.classList.add("open");
  row.setAttribute("aria-expanded", "true");
  row.insertAdjacentHTML("afterend", claimedDetailRowHtml(state.claimedLeads[idx], idx));
  document.querySelector(`[data-claimed-brief-index="${idx}"]`)?.addEventListener("click", (e) => {
    e.stopPropagation();
    generateClaimedBrief(idx);
  });
  document.querySelector(`[data-reminder-index="${idx}"]`)?.addEventListener("click", (e) => {
    e.stopPropagation();
    openReminderModal(idx);
  });
  wireNotesHistoryHandlers(idx);
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
        // Same object reference as in state.claimedLeadsAll -- keeps the
        // status filter (and anything else reading state.claimedLeads)
        // correct without waiting for a full reload.
        state.claimedLeads[Number(e.target.dataset.index)].status = status;
        previousValue = status;
        showToast(`Status updated to "${status}"`);
        // A callback-ish status is a strong signal this lead needs a
        // follow-up time -- offer to set one right away, without forcing it
        // (Cancel just leaves the status change in place, reminder-less).
        if (isCallbackStatus(status)) openReminderModal(Number(e.target.dataset.index));
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
        updateNotesPreview(idx, data.notes);
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

const cityInput = document.getElementById("cityInput");
const cityOptions = document.getElementById("cityOptions");

// Generic open/close behavior for a checkbox-dropdown multi-select: click the
// toggle button to open, click anywhere outside (or Escape) to close. Reused
// by both the State and Specialty fields below.
function setupMultiselectToggle(containerEl) {
  const toggle = containerEl.querySelector(".multiselect-toggle");
  const panel = containerEl.querySelector(".multiselect-panel");

  function open() {
    panel.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    containerEl.classList.add("open");
  }
  function close() {
    panel.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    containerEl.classList.remove("open");
  }
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    if (panel.hidden) open(); else close();
  });
  document.addEventListener("click", (e) => {
    if (!containerEl.contains(e.target)) close();
  });
  containerEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { close(); toggle.focus(); }
  });
}

function updateMultiselectSummary(containerEl, checkboxSelector, emptyLabel, checkedNoun) {
  const toggle = containerEl.querySelector(".multiselect-toggle");
  const checked = [...containerEl.querySelectorAll(checkboxSelector + ":checked")];
  if (checked.length === 0) toggle.textContent = emptyLabel;
  else if (checked.length === 1) toggle.textContent = checked[0].nextElementSibling.textContent;
  else toggle.textContent = `${checked.length} ${checkedNoun} selected`;
}

/* State multi-select */

const stateMultiselect = document.getElementById("stateMultiselect");
const stateOptionsContainer = document.getElementById("stateOptions");
setupMultiselectToggle(stateMultiselect);

for (const [code, name] of Object.entries(US_STATE_NAMES)) {
  const label = document.createElement("label");
  label.className = "multiselect-option";
  label.innerHTML = `<input type="checkbox" name="states" value="${code}"><span>${code} — ${name}</span>`;
  stateOptionsContainer.appendChild(label);
}

function updateStateSummary() {
  updateMultiselectSummary(stateMultiselect, 'input[name="states"]', "All states", "states");
}

function refreshCityOptions() {
  const checkedStates = [...stateOptionsContainer.querySelectorAll('input[name="states"]:checked')].map((cb) => cb.value);
  const cities = checkedStates.length
    ? [...new Set(checkedStates.flatMap((code) => US_CITIES_BY_STATE[code] || []))].sort()
    : [];
  cityOptions.innerHTML = cities.map((c) => `<option value="${c}"></option>`).join("");
}

stateOptionsContainer.addEventListener("change", () => {
  cityInput.value = ""; // stale city from a state that's no longer checked would silently mis-filter
  updateStateSummary();
  refreshCityOptions();
});
document.getElementById("stateClearBtn").addEventListener("click", () => {
  stateOptionsContainer.querySelectorAll('input[name="states"]:checked').forEach((cb) => { cb.checked = false; });
  cityInput.value = "";
  updateStateSummary();
  refreshCityOptions();
});
updateStateSummary();
refreshCityOptions();

/* Specialty/taxonomy multi-select -- "All specialties" is mutually exclusive
   with the specific checkboxes below it (picking one clears "All", and
   checking "All" clears every specific pick), since "no filter" and "OR of
   these specific filters" are two different underlying queries, not a
   spectrum -- there's no meaningful "All + Prosthetic" combination. */

const taxonomyMultiselect = document.getElementById("taxonomyMultiselect");
const taxonomyAllCheckbox = document.getElementById("taxonomyAllCheckbox");
setupMultiselectToggle(taxonomyMultiselect);

function updateTaxonomySummary() {
  const toggle = taxonomyMultiselect.querySelector(".multiselect-toggle");
  const checked = [...taxonomyMultiselect.querySelectorAll('input[name="taxonomyDescriptions"]:checked')];
  if (taxonomyAllCheckbox.checked || checked.length === 0) toggle.textContent = "All specialties";
  else if (checked.length === 1) toggle.textContent = checked[0].nextElementSibling.textContent;
  else toggle.textContent = `${checked.length} specialties selected`;
}

taxonomyAllCheckbox.addEventListener("change", () => {
  if (taxonomyAllCheckbox.checked) {
    taxonomyMultiselect.querySelectorAll('input[name="taxonomyDescriptions"]').forEach((cb) => { cb.checked = false; });
  }
  updateTaxonomySummary();
});
taxonomyMultiselect.querySelectorAll('input[name="taxonomyDescriptions"]').forEach((cb) => {
  cb.addEventListener("change", () => {
    if (cb.checked) taxonomyAllCheckbox.checked = false; // picking a specific one cancels "All"
    updateTaxonomySummary();
  });
});
document.getElementById("taxonomySelectAllBtn").addEventListener("click", () => {
  taxonomyAllCheckbox.checked = false;
  taxonomyMultiselect.querySelectorAll('input[name="taxonomyDescriptions"]').forEach((cb) => { cb.checked = true; });
  updateTaxonomySummary();
});
document.getElementById("taxonomyClearBtn").addEventListener("click", () => {
  taxonomyAllCheckbox.checked = true;
  taxonomyMultiselect.querySelectorAll('input[name="taxonomyDescriptions"]').forEach((cb) => { cb.checked = false; });
  updateTaxonomySummary();
});
updateTaxonomySummary();

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
els.clearSelectionBtn.addEventListener("click", clearSelection);
els.searchMoreBtn.addEventListener("click", searchMore);
els.exportCsvBtn.addEventListener("click", exportCsv);
els.exportSheetsBtn.addEventListener("click", exportSheets);

els.loginForm.addEventListener("submit", handleLogin);
els.signOutBtn.addEventListener("click", handleSignOut);
els.suggestBtn.addEventListener("click", openSuggestionBox);
els.suggestionForm.addEventListener("submit", handleSuggestionSubmit);
els.suggestionCancelBtn.addEventListener("click", closeSuggestionBox);
els.suggestionOverlay.addEventListener("click", (e) => { if (e.target === els.suggestionOverlay) closeSuggestionBox(); });
els.reminderForm.addEventListener("submit", handleReminderSubmit);
els.reminderCancelBtn.addEventListener("click", closeReminderModal);
els.reminderClearBtn.addEventListener("click", handleReminderClear);
els.reminderOverlay.addEventListener("click", (e) => { if (e.target === els.reminderOverlay) closeReminderModal(); });
els.devNoticeClose.addEventListener("click", () => { els.devNotice.hidden = true; });
// Two toggle buttons exist (header + login card, so theme can be changed
// even before signing in) -- both share the .theme-toggle class.
document.querySelectorAll(".theme-toggle").forEach((btn) => btn.addEventListener("click", toggleTheme));
document.querySelectorAll(".view-tabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => switchView(tab.dataset.view));
});
els.onlyMine.addEventListener("change", loadClaimedLeads);
els.updatedWithin.addEventListener("change", loadClaimedLeads);
els.updatedYear.addEventListener("change", loadClaimedLeads);
// Status is filtered client-side over the already-fetched list (no new
// server round-trip needed, unlike the other filters above which change
// what the server itself returns).
els.statusFilter.addEventListener("change", () => {
  state.statusFilter = els.statusFilter.value;
  state.claimedSortKey = null; // matches the other filters' "fresh view resets sort" behavior
  state.claimedSortDir = 1;
  updateSortIndicators(els.claimedTable, null, 1);
  renderClaimedLeads(applyStatusFilter(state.claimedLeadsAll));
});
els.refreshClaimedBtn.addEventListener("click", loadClaimedLeads);
els.staleNudge.addEventListener("click", loadClaimedLeads);

wireSortableHeaders(els.resultsTable, PROSPECT_DEFAULT_SORT_DIR, sortProspectResults);
wireSortableHeaders(els.claimedTable, CLAIMED_DEFAULT_SORT_DIR, sortClaimedLeads);

// Nudges the user to refresh the Claimed tab after it's been sitting open
// for a while -- teammates share one sheet, so a colleague's status/claim
// change wouldn't otherwise show up until a manual refresh.
const STALE_AFTER_MS = 2 * 60 * 1000;
setInterval(() => {
  if (state.view === "claimed" && state.claimedLoadedAt) {
    els.staleNudge.hidden = Date.now() - state.claimedLoadedAt < STALE_AFTER_MS;
  }
  // Runs regardless of which tab is active/focused -- claimed leads stay in
  // memory once loaded once, so a reminder can still notify while you're
  // working the Prospect tab in the same browser session.
  checkDueReminders();
}, 15000);

els.enableNotifications.addEventListener("change", handleNotificationToggle);
initNotificationToggle();

// One-off diagnostic, not part of the UI -- callable from the browser
// console (F12) when a search comes back with no Foursquare/Places data, to
// see exactly what's happening (missing key vs. an auth/quota error from
// Foursquare itself) without needing access to the Apps Script project's
// own Executions log. Usage: open the console and run `debugFoursquare()`.
window.debugFoursquare = async function () {
  try {
    const data = await apiGet("debug/foursquare");
    console.log("Foursquare diagnostic:", data);
    return data;
  } catch (err) {
    console.error("Foursquare diagnostic failed:", err.message);
    return { error: err.message };
  }
};

if (getSession()) hideLogin(); else showLogin();
