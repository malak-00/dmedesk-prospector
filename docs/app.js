// Frontend for the Cloudflare Worker backend (see worker/). Request layer notes:
// - every request is a real path (e.g. POST /leads/status) against
//   API_BASE_URL, with the session token sent as a real `Authorization:
//   Bearer` header -- no more Apps Script's ?path=/?token= query-param
//   workaround, since a real host handles CORS preflight properly
// - the response body shape is unchanged from the Apps Script version
//   ({success, data} / {success, status, error}) on purpose, so unwrap()
//   below needed no changes; body.status 401 still means the session expired

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

function authHeaders() {
  const token = getSession()?.token;
  if (!token) return {};
  const headers = { Authorization: `Bearer ${token}` };
  // Admins trying DME Desk's own provider table say so on every request; the
  // server honours it for admins only and ignores it for anyone else.
  if (sourceTrialActive()) headers["X-Search-Source"] = "dmedesk";
  return headers;
}

// Admin-only trial of searching DME Desk's own provider table. On by default
// for admins, remembered per browser, and switched off with one click.
const SOURCE_TRIAL_KEY = "dmeProspectorSourceTrial"; // "off" | unset (on)

function sourceTrialActive() {
  if (!getSession()?.isAdmin) return false;
  try { return localStorage.getItem(SOURCE_TRIAL_KEY) !== "off"; } catch { return true; }
}

async function apiGet(path, params = {}) {
  // Drop undefined/null/empty entries so e.g. `state: undefined` doesn't
  // end up as the literal query string "state=undefined".
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  const query = new URLSearchParams(clean);
  const qs = query.toString();
  const res = await fetch(`${API_BASE_URL}/${path}${qs ? `?${qs}` : ""}`, { headers: authHeaders() });
  return unwrap(await res.json());
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE_URL}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
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
    // A temporary password has to be replaced before anything else works.
    if (payload.status === 403 && /^Change your password first/.test(payload.error || "")) window.dmeHooks.onPasswordRequired?.();
    throw new Error(payload.error || "Request failed");
  }
  return payload.data;
}

// Later scripts (today.js, callmode.js, team.js) register callbacks here; app.js
// calls them with optional chaining because it finishes running before they load.
window.dmeHooks = window.dmeHooks || {};

const state = {
  companies: [],
  selected: new Set(),
  expandedIndex: null,
  excludedAsClaimed: 0,
  sortKey: null,
  sortDir: 1,
  // Every fetched batch of Prospect results, kept around instead of thrown
  // away -- a fresh "Search" starts a new list (index 0 = the newest
  // results), and each "Search more" click APPENDS one more page rather
  // than replacing the table, so earlier pages stay one click away via the
  // page-nav UI instead of disappearing. state.companies is always just a
  // reference to resultPages[currentPage].companies (see applyCurrentPage
  // below) -- existing sort/select code keeps working unchanged since it's
  // still the same array, just swapped out on page-nav clicks.
  resultPages: [],
  currentPage: 0,
  // "Search more" bookkeeping -- see the functions near runSearch/searchMore.
  lastSearchParams: null,
  searchMoreVariantSkips: {},
  searchMoreSeenNpis: [],
  view: "search",
  adminLoaded: false,
  conflicts: [],
  conflictResolveGroupId: null,
  matchReviews: null,
  matchReviewsTier: "all",
  matchReviewsLimit: 25,
  // "leads" loads the whole queue; "registry" (sql/030) is paged by the Worker.
  matchReviewsScope: "leads",
  matchReviewsHasMore: false,
  matchReviewsLoading: false,
  matchReviewSelected: new Set(),
  providerChanges: null,
  providerChangesLimit: 25,
  matchReviewPending: null,
  claimedRefreshInterval: null,
  adminRefreshInterval: null,
  adminLeadsAll: [],
  adminLeadsSearchQuery: "",
  adminLeadsSortKey: null,
  adminLeadsSortDir: 1,
  claimedLoaded: false,
  claimedLeads: [],
  // The full, unfiltered set fetched from the server -- state.claimedLeads
  // (what's actually rendered, indexed 1:1 with row DOM elements) is derived
  // from this by applying the status + search filters, so changing either
  // never needs a re-fetch, just a re-derive + re-render.
  claimedLeadsAll: [],
  statusFilter: "",
  claimedSearchQuery: "",
  claimedSelected: new Set(),
  claimedExpandedIndex: null,
  claimedLoadedAt: null,
  claimedDueOnly: false,
  claimedSortKey: null,
  claimedSortDir: 1,
  // The Claimed table is one server page at a time (sorted and filtered there).
  claimedPage: 1,
  claimedPageSize: 50,
  claimedTotal: 0,      // leads matching the current filters
  claimedPages: 1,
  claimedCounts: { total: 0, due: 0, withReminder: 0, overdue: 0 }, // whole-list figures, whatever the filters
  claimedOpenNow: false,
  claimedSeq: 0,
  dueLeads: [],         // callbacks due and meetings soon, for notifications
  statuses: [],
  reminderTargetIndex: null,
  meetingTargetIndex: null,
  // What this deployment can do for search: { advanced: bool, reason? }; null until asked.
  searchCaps: null,
  quickPickCache: null,
  insightsTimer: null,
  insightsSeq: 0,
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
  company: (a, b) => (a.name || "").localeCompare(b.name || ""),
  specialty: (a, b) => (a.taxonomy?.description || "").localeCompare(b.taxonomy?.description || ""),
  location: (a, b) =>
    `${a.address?.state || ""}|${a.address?.city || ""}`.localeCompare(`${b.address?.state || ""}|${b.address?.city || ""}`),
};
const PROSPECT_DEFAULT_SORT_DIR = { company: 1, specialty: 1, location: 1 };

function sortProspectResults(key, defaultDir) {
  state.sortDir = state.sortKey === key ? state.sortDir * -1 : defaultDir;
  state.sortKey = key;
  state.companies.sort((a, b) => PROSPECT_SORT_COMPARATORS[key](a, b) * state.sortDir);
  state.expandedIndex = null; // row indices shift after a sort
  updateSortIndicators(els.resultsTable, state.sortKey, state.sortDir);
  renderResults();
}

const CLAIMED_DEFAULT_SORT_DIR = { company: 1, location: 1, claimedBy: 1, updated: -1, status: 1, reminder: 1 };

function sortClaimedLeads(key, defaultDir) {
  state.claimedSortDir = state.claimedSortKey === key ? state.claimedSortDir * -1 : defaultDir;
  state.claimedSortKey = key;
  state.claimedPage = 1;
  updateSortIndicators(els.claimedTable, state.claimedSortKey, state.claimedSortDir);
  loadClaimedLeads();
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
  pageNav: document.getElementById("pageNav"),
  pageInfo: document.getElementById("pageInfo"),
  pagePrevBtn: document.getElementById("pagePrevBtn"),
  pageNextBtn: document.getElementById("pageNextBtn"),
  taxonomyAddBtn: document.getElementById("taxonomyAddBtn"),
  taxonomyAddPanel: document.getElementById("taxonomyAddPanel"),
  taxonomyAddInput: document.getElementById("taxonomyAddInput"),
  taxonomyAddResults: document.getElementById("taxonomyAddResults"),
  exportSheetsBtn: document.getElementById("exportSheetsBtn"),
  exportSheetsLabel: document.getElementById("exportSheetsLabel"),
  exportGoogleSheetBtn: document.getElementById("exportGoogleSheetBtn"),
  exportGoogleSheetLabel: document.getElementById("exportGoogleSheetLabel"),
  sendDisconnectedBtn: document.getElementById("sendDisconnectedBtn"),
  sendDisconnectedLabel: document.getElementById("sendDisconnectedLabel"),
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
  viewAdmin: document.getElementById("viewAdmin"),
  adminTab: document.getElementById("adminTab"),
  statTotalUsers: document.getElementById("statTotalUsers"),
  statClaimedLeads: document.getElementById("statClaimedLeads"),
  statDisconnectedLeads: document.getElementById("statDisconnectedLeads"),
  statSuggestions: document.getElementById("statSuggestions"),
  adminSuggestionsBody: document.getElementById("adminSuggestionsBody"),
  refreshAdminBtn: document.getElementById("refreshAdminBtn"),
  adminUserLeadsOverlay: document.getElementById("adminUserLeadsOverlay"),
  adminUserLeadsTitle: document.getElementById("adminUserLeadsTitle"),
  adminUserLeadsSubtitle: document.getElementById("adminUserLeadsSubtitle"),
  adminUserLeadsTable: document.getElementById("adminUserLeadsTable"),
  adminUserLeadsBody: document.getElementById("adminUserLeadsBody"),
  adminUserLeadsCloseBtn: document.getElementById("adminUserLeadsCloseBtn"),
  adminUserLeadsCloseX: document.getElementById("adminUserLeadsCloseX"),
  adminUserLeadsSearchInput: document.getElementById("adminUserLeadsSearchInput"),
  conflictsSummary: document.getElementById("conflictsSummary"),
  conflictsEmpty: document.getElementById("conflictsEmpty"),
  conflictsList: document.getElementById("conflictsList"),
  conflictResolveOverlay: document.getElementById("conflictResolveOverlay"),
  conflictResolveForm: document.getElementById("conflictResolveForm"),
  conflictResolveGroup: document.getElementById("conflictResolveGroup"),
  conflictOwnerOptions: document.getElementById("conflictOwnerOptions"),
  conflictReason: document.getElementById("conflictReason"),
  conflictResolveCancelBtn: document.getElementById("conflictResolveCancelBtn"),
  conflictResolveSubmitBtn: document.getElementById("conflictResolveSubmitBtn"),
  claimResultOverlay: document.getElementById("claimResultOverlay"),
  claimResultSummary: document.getElementById("claimResultSummary"),
  claimResultTitle: document.getElementById("claimResultTitle"),
  claimResultBlockedHint: document.getElementById("claimResultBlockedHint"),
  claimResultHeldHint: document.getElementById("claimResultHeldHint"),
  claimResultBlocked: document.getElementById("claimResultBlocked"),
  claimResultBlockedList: document.getElementById("claimResultBlockedList"),
  claimResultHeld: document.getElementById("claimResultHeld"),
  claimResultHeldList: document.getElementById("claimResultHeldList"),
  claimResultCloseBtn: document.getElementById("claimResultCloseBtn"),
  searchSourceSummary: document.getElementById("searchSourceSummary"),
  compareState: document.getElementById("compareState"),
  compareSpecialty: document.getElementById("compareSpecialty"),
  compareSourcesBtn: document.getElementById("compareSourcesBtn"),
  searchCompareEmpty: document.getElementById("searchCompareEmpty"),
  searchCompareResult: document.getElementById("searchCompareResult"),
  providerChangesSummary: document.getElementById("providerChangesSummary"),
  providerChangesEmpty: document.getElementById("providerChangesEmpty"),
  providerChangesList: document.getElementById("providerChangesList"),
  providerChangesMoreBtn: document.getElementById("providerChangesMoreBtn"),
  matchReviewsSummary: document.getElementById("matchReviewsSummary"),
  matchReviewsTierFilter: document.getElementById("matchReviewsTierFilter"),
  matchReviewsScope: document.getElementById("matchReviewsScope"),
  matchReviewsEmpty: document.getElementById("matchReviewsEmpty"),
  matchReviewsList: document.getElementById("matchReviewsList"),
  matchReviewsMoreBtn: document.getElementById("matchReviewsMoreBtn"),
  matchReviewsSelectAll: document.getElementById("matchReviewsSelectAll"),
  matchReviewsBulkSummary: document.getElementById("matchReviewsBulkSummary"),
  matchReviewsBulkMergeBtn: document.getElementById("matchReviewsBulkMergeBtn"),
  matchReviewsMergeAllBtn: document.getElementById("matchReviewsMergeAllBtn"),
  matchReviewOverlay: document.getElementById("matchReviewOverlay"),
  matchReviewForm: document.getElementById("matchReviewForm"),
  matchReviewTitle: document.getElementById("matchReviewTitle"),
  matchReviewPair: document.getElementById("matchReviewPair"),
  matchReviewEffect: document.getElementById("matchReviewEffect"),
  matchReviewReason: document.getElementById("matchReviewReason"),
  matchReviewCancelBtn: document.getElementById("matchReviewCancelBtn"),
  matchReviewSubmitBtn: document.getElementById("matchReviewSubmitBtn"),
  claimedTable: document.getElementById("claimedTable"),
  claimedBody: document.getElementById("claimedBody"),
  claimedCount: document.getElementById("claimedCount"),
  claimedSelectAll: document.getElementById("claimedSelectAll"),
  claimedSelectionChip: document.getElementById("claimedSelectionChip"),
  claimedSelectionCount: document.getElementById("claimedSelectionCount"),
  claimedClearSelectionBtn: document.getElementById("claimedClearSelectionBtn"),
  claimedReturnToProspectBtn: document.getElementById("claimedReturnToProspectBtn"),
  claimedSendDisconnectedBtn: document.getElementById("claimedSendDisconnectedBtn"),
  claimedExportGoogleSheetBtn: document.getElementById("claimedExportGoogleSheetBtn"),
  enableNotifications: document.getElementById("enableNotifications"),
  claimedSearchInput: document.getElementById("claimedSearchInput"),
  statusFilter: document.getElementById("statusFilter"),
  refreshClaimedBtn: document.getElementById("refreshClaimedBtn"),
  staleNudge: document.getElementById("staleNudge"),
  excludeKeywordsInput: document.getElementById("excludeKeywordsInput"),
  excludeKeywordsChipList: document.getElementById("excludeKeywordsChipList"),
  excludeKeywordsEntry: document.getElementById("excludeKeywordsEntry"),
  saveExcludeKeywordsBtn: document.getElementById("saveExcludeKeywordsBtn"),
  nameContainsInput: document.getElementById("nameContainsInput"),
  nameContainsChipList: document.getElementById("nameContainsChipList"),
  nameContainsEntry: document.getElementById("nameContainsEntry"),
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
  meetingOverlay: document.getElementById("meetingOverlay"),
};

/* ---------- Sign in ---------- */

function showLogin() {
  els.loginOverlay.hidden = false;
  els.userChip.hidden = true;
  els.suggestBtn.hidden = true;
  els.adminTab.hidden = true;
  state.searchCaps = null;
  applySearchCaps();
  applySourceTrialUi();
  window.dmeHooks.onSignedOut?.();
  // Covers both an explicit sign-out and an auto-triggered one (a 401 from
  // any API call routes here too, via unwrap()) -- either way, background
  // polling against a session that's no longer valid should stop.
  stopClaimedAutoRefresh();
  stopAdminAutoRefresh();
  els.loginForm.querySelector("input[name=username]")?.focus();
}

function hideLogin() {
  els.loginOverlay.hidden = true;
  const session = getSession();
  if (session) {
    els.userName.textContent = session.displayName;
    els.userChip.hidden = false;
    els.suggestBtn.hidden = false;
    els.adminTab.hidden = !session.isAdmin;
    applyExcludeKeywordsDefaultIfBlank();
    applySourceTrialUi();
    loadSearchCapabilities();
    window.dmeHooks.onSignedIn?.();
    loadDueLeads();
  }
}

// Pre-fills the Exclude keywords chips with the signed-in user's saved
// default (see AuthService.setExcludeKeywords) -- but ONLY if there are no
// chips yet, so it never clobbers something already restored from this
// tab's own session-scoped search-filter memory (restoreSearchFormState) or
// typed by hand moments ago.
function applyExcludeKeywordsDefaultIfBlank() {
  if (excludeKeywordsChipInput.length > 0) return;
  const saved = getSession()?.excludeKeywords;
  if (saved) excludeKeywordsChipInput.setAll(saved.split(","));
}

/* ---------- Chip/tag input (generic) ---------- */
// Each entry is its own removable chip (not one comma-separated blob), so
// it's clear at a glance what's currently in the list and easy to drop just
// one -- the entry field itself never gets consumed/hidden by adding a chip,
// so typing the next one right after is always available. A hidden <input>
// is kept in sync as a comma-joined string purely so the existing generic
// search-form save/restore/submit code (which reads plain form-element
// values) doesn't need its own special case for whichever field this backs.
// Two independent instances use this: "Exclude keywords" (persisted
// server-side per user, via onChange below) and "Company name (contains)"
// (session-scoped only, like the rest of the search form -- no onChange).
function createChipInput({ chipListEl, entryEl, hiddenInputEl, onChange }) {
  let chips = [];

  function asString() {
    return chips.join(", ");
  }

  function render() {
    chipListEl.innerHTML = chips.map((kw) => `
      <span class="keyword-chip">${escapeHtml(kw)}<button type="button" class="keyword-chip-remove" data-value="${escapeHtml(kw)}" aria-label="Remove ${escapeHtml(kw)}">&times;</button></span>
    `).join("");
    chipListEl.querySelectorAll(".keyword-chip-remove").forEach((btn) => {
      btn.addEventListener("click", () => remove(btn.dataset.value));
    });
    hiddenInputEl.value = asString();
  }

  // Case-insensitive dedupe, so "Wheelchair" and "wheelchair" are treated as
  // the same entry instead of two chips that mean the same thing.
  function add(raw) {
    const kw = raw.trim();
    if (!kw) return;
    const alreadyHave = chips.some((existing) => existing.toLowerCase() === kw.toLowerCase());
    if (alreadyHave) return;
    chips.push(kw);
    render();
    if (onChange) onChange();
  }

  function remove(value) {
    chips = chips.filter((kw) => kw !== value);
    render();
    if (onChange) onChange();
  }

  // Replaces the whole chip set at once (restoring from sessionStorage or
  // from the signed-in user's saved default) -- still de-duped case-
  // insensitively. Deliberately does NOT fire onChange -- this is loading a
  // previously-known value, not a user edit, so it must never re-trigger a
  // server save.
  function setAll(list) {
    const seen = new Set();
    chips = [];
    (list || []).forEach((raw) => {
      const kw = String(raw).trim();
      if (!kw) return;
      const lower = kw.toLowerCase();
      if (seen.has(lower)) return;
      seen.add(lower);
      chips.push(kw);
    });
    render();
  }

  // Commits whatever's still sitting in the entry field (typed but not yet
  // turned into a chip) -- used before an explicit action (like "Save as
  // default") so it never silently drops text the user just typed.
  function flushPendingEntry() {
    if (entryEl.value.trim()) {
      add(entryEl.value);
      entryEl.value = "";
    }
  }

  entryEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault(); // Enter would otherwise submit the search form
      add(entryEl.value);
      entryEl.value = "";
    } else if (e.key === "Backspace" && !entryEl.value && chips.length) {
      // Backspace on an empty entry removes the last chip -- standard
      // tag-input convenience so you don't have to aim for each chip's x.
      remove(chips[chips.length - 1]);
    }
  });
  entryEl.addEventListener("blur", () => {
    // Commits a typed-but-not-Entered keyword on blur, so clicking straight
    // into another field or the Search button right after typing doesn't
    // silently drop it.
    flushPendingEntry();
  });

  return {
    add,
    remove,
    setAll,
    asString,
    flushPendingEntry,
    get length() { return chips.length; },
  };
}

const excludeKeywordsChipInput = createChipInput({
  chipListEl: els.excludeKeywordsChipList,
  entryEl: els.excludeKeywordsEntry,
  hiddenInputEl: els.excludeKeywordsInput,
  onChange: () => persistExcludeKeywords(),
});

// Session-scoped only (no onChange/server persistence) -- matches every
// other Prospect search field, remembered via sessionStorage's generic
// search-filter memory (see save/restoreSearchFormState), not tied to the
// signed-in user's account the way Exclude keywords is.
const nameContainsChipInput = createChipInput({
  chipListEl: els.nameContainsChipList,
  entryEl: els.nameContainsEntry,
  hiddenInputEl: els.nameContainsInput,
});

// Persists the current Exclude keywords chip list to the signed-in user's
// saved default (server-side, a column in the Users sheet) -- called
// automatically after every add/remove so a removed chip actually stays
// gone after a reload instead of silently reappearing (it was previously
// only cleared from view until the next explicit "Save as default" click,
// which read as "clicking x doesn't really remove it"). Silent by default
// since it fires on every single edit; the explicit Save button still shows
// a toast (see saveExcludeKeywordsDefault).
async function persistExcludeKeywords({ silent = true } = {}) {
  const excludeKeywords = excludeKeywordsChipInput.asString();
  try {
    const data = await apiPost("auth/exclude-keywords", { excludeKeywords });
    saveSession({ ...getSession(), excludeKeywords: data.excludeKeywords });
    if (!silent) showToast(excludeKeywords ? "Saved as your default exclude keywords" : "Default exclude keywords cleared");
  } catch (err) {
    showToast(err.message, true);
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
    saveSession({ token: data.token, username: data.username, displayName: data.displayName, excludeKeywords: data.excludeKeywords, isAdmin: data.isAdmin, mustChangePassword: Boolean(data.mustChangePassword) });
    // Unconditionally resets to THIS user's own saved value (never "only if
    // blank" -- a fresh login is a hard boundary) -- otherwise, signing out
    // and signing back in as someone else in the same tab would leave the
    // previous person's chips sitting in memory and wrongly carry over,
    // since applyExcludeKeywordsDefaultIfBlank() below only fills in a
    // default when there are no chips yet.
    excludeKeywordsChipInput.setAll(data.excludeKeywords ? data.excludeKeywords.split(",") : []);
    els.loginForm.reset();
    hideLogin();
    loadTaxonomyOptions();
    window.dmeHooks.onLoginResult?.(data);
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
  excludeKeywordsChipInput.setAll([]); // don't leave this account's chips sitting in memory for whoever signs in next
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

/* ---------- Admin dashboard ---------- */
// Only reachable via the Admin tab, which stays hidden (see hideLogin())
// unless the signed-in session's isAdmin flag is set -- the actual
// enforcement is server-side (index.js's requireAdmin), this is just UI.

function renderAdminStats(stats) {
  els.statTotalUsers.textContent = stats.totalUsers;
  els.statClaimedLeads.textContent = stats.totalClaimedLeads;
  els.statDisconnectedLeads.textContent = stats.totalDisconnectedLeads;
  els.statSuggestions.textContent = stats.totalSuggestions;
}

function renderAdminSuggestions(suggestions) {
  if (suggestions.length === 0) {
    els.adminSuggestionsBody.innerHTML = `<tr class="empty-row"><td colspan="3">No suggestions yet.</td></tr>`;
    return;
  }
  els.adminSuggestionsBody.innerHTML = suggestions
    .map(
      (s) => `
    <tr>
      <td>${escapeHtml(s.submittedBy || "")}</td>
      <td>${escapeHtml(s.text || "")}</td>
      <td class="mono">${escapeHtml((s.submittedAt || "").slice(0, 10))}</td>
    </tr>`
    )
    .join("");
}

// ---- ownership conflicts (admin) ----------------------------------------
// An identity group whose active claims are split across more than one
// person. These are surfaced rather than auto-resolved on purpose: the
// system has no way to know who should own an account, so every one of
// them waits for an explicit approved decision.

function renderConflicts(payload) {
  const available = payload && payload.available !== false;
  const conflicts = (payload && payload.conflicts) || [];
  state.conflicts = conflicts;

  if (!available) {
    els.conflictsSummary.textContent = "Not available";
    els.conflictsEmpty.hidden = false;
    els.conflictsEmpty.textContent = payload.reason || "Identity grouping isn't installed yet.";
    els.conflictsList.innerHTML = "";
    return;
  }

  if (conflicts.length === 0) {
    els.conflictsSummary.textContent = "No conflicts";
    els.conflictsEmpty.hidden = false;
    els.conflictsEmpty.textContent = "Every identity group has a single active owner.";
    els.conflictsList.innerHTML = "";
    return;
  }

  els.conflictsSummary.textContent = `${conflicts.length} group${conflicts.length === 1 ? "" : "s"} need${conflicts.length === 1 ? "s" : ""} an owner decision`;
  els.conflictsEmpty.hidden = true;
  els.conflictsList.innerHTML = conflicts
    .map((conflict) => {
      const owners = conflict.owners
        .map((owner) => `<span class="conflict-owner-chip">${escapeHtml(owner.displayName)} · ${owner.leadCount}</span>`)
        .join("");
      const rows = conflict.leads
        .map((lead) => {
          const location = [lead.city, lead.state].filter(Boolean).join(", ");
          return `
          <tr>
            <td>
              <div class="company-name">${escapeHtml(lead.companyName || "")}</div>
              <div class="company-taxonomy mono">${escapeHtml(lead.npi || "")}</div>
            </td>
            <td>${escapeHtml(location || "—")}</td>
            <td>${escapeHtml(lead.claimedByName || "")}</td>
            <td class="mono">${escapeHtml((lead.claimedAt || "").slice(0, 10))}</td>
          </tr>`;
        })
        .join("");
      const subtitle = [conflict.groupState, `${conflict.leads.length} active claims`].filter(Boolean).join(" · ");
      const matchLine = [conflict.matchTier ? `Tier ${conflict.matchTier}` : "", conflict.matchReason || ""]
        .filter(Boolean)
        .join(" — ");
      return `
      <div class="conflict-card">
        <div class="conflict-card-header">
          <div>
            <div class="conflict-title">${escapeHtml(conflict.groupName)}</div>
            <div class="conflict-subtitle">${escapeHtml(subtitle)}</div>
            ${matchLine ? `<div class="conflict-match">Grouped by: ${escapeHtml(matchLine)}</div>` : ""}
            <div class="conflict-owners">${owners}</div>
          </div>
          <button type="button" class="btn btn-primary" data-resolve-conflict data-group-id="${escapeHtml(conflict.groupId)}">
            Resolve
          </button>
        </div>
        <table class="conflict-leads">
          <thead>
            <tr><th>Company</th><th>Location</th><th>Claimed by</th><th>Claimed</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    })
    .join("");
}

async function loadConflicts(silent = false) {
  if (!silent) {
    els.conflictsSummary.textContent = "Checking…";
    els.conflictsEmpty.hidden = false;
    els.conflictsEmpty.textContent = "Checking…";
  }
  try {
    renderConflicts(await apiGet("admin/conflicts"));
  } catch (err) {
    if (silent) {
      console.log("[admin] conflict refresh failed: " + err.message);
      return;
    }
    els.conflictsSummary.textContent = "Failed to load";
    els.conflictsEmpty.hidden = false;
    els.conflictsEmpty.textContent = "Couldn't load ownership conflicts: " + err.message;
    els.conflictsList.innerHTML = "";
  }
}

function openConflictResolve(groupId) {
  const conflict = state.conflicts.find((c) => c.groupId === groupId);
  if (!conflict) return;
  state.conflictResolveGroupId = groupId;
  els.conflictResolveGroup.textContent = `${conflict.groupName} — ${conflict.leads.length} active claims across ${conflict.owners.length} owners.`;
  // No owner is pre-selected: picking one is the decision being made here,
  // and a default would quietly become the answer.
  els.conflictOwnerOptions.innerHTML = conflict.owners
    .map(
      (owner) => `
      <label class="conflict-owner-option">
        <input type="radio" name="conflictOwner" value="${escapeHtml(owner.userId)}">
        <span>${escapeHtml(owner.displayName)}</span>
        <span class="conflict-owner-count">holds ${owner.leadCount}</span>
      </label>`
    )
    .join("");
  els.conflictReason.value = "";
  els.conflictResolveSubmitBtn.disabled = false;
  els.conflictResolveSubmitBtn.textContent = "Assign owner";
  els.conflictResolveOverlay.hidden = false;
}

function closeConflictResolve() {
  els.conflictResolveOverlay.hidden = true;
  state.conflictResolveGroupId = null;
}

async function handleConflictResolve(event) {
  event.preventDefault();
  const groupId = state.conflictResolveGroupId;
  const selected = els.conflictOwnerOptions.querySelector('input[name="conflictOwner"]:checked');
  if (!groupId) return;
  if (!selected) {
    showToast("Pick which owner keeps this group.", true);
    return;
  }
  const reason = els.conflictReason.value.trim();
  if (!reason) {
    showToast("A reason is required — it's recorded with the decision.", true);
    return;
  }

  els.conflictResolveSubmitBtn.disabled = true;
  els.conflictResolveSubmitBtn.textContent = "Assigning…";
  try {
    const result = await apiPost("admin/conflicts/resolve", { groupId, toUserId: selected.value, reason });
    const moved = result.reassigned_count || 0;
    const skipped = (result.skipped || []).length;
    closeConflictResolve();
    showToast(
      `Reassigned ${moved} lead${moved === 1 ? "" : "s"}.` + (skipped ? ` ${skipped} skipped — see the audit log.` : "")
    );
    await Promise.all([loadConflicts(true), loadAdminOverview(true)]);
  } catch (err) {
    showToast(err.message, true);
    els.conflictResolveSubmitBtn.disabled = false;
    els.conflictResolveSubmitBtn.textContent = "Assign owner";
  }
}

// ---- possible duplicates (admin) ------------------------------------------
// Pairs of NPIs that matched a Tier 2 or Tier 3 identity rule. Unlike
// Tier 1 and the cross-state Tier 2 rule, these are never grouped
// automatically: an admin decides "same business" (merge the two groups) or
// "not the same" (dismiss). A merge never changes who owns anything -- if it
// puts two reps' claims together, the group shows up under Ownership
// conflicts for that decision.

const MATCH_REVIEWS_PAGE = 25;
// All-providers comparison: the Worker caps a page at 100. The first load
// stops at 500 pairs; the registry has far more, and each page is a query.
const REGISTRY_FETCH_PAGE = 100;
const REGISTRY_AUTOLOAD_CAP = 500;
let matchReviewsLoadToken = 0; // lets a newer load cancel an older one still fetching
const MATCH_KEY_LABELS = { name: "Name", state: "State", official: "Authorized official", phone: "Phone" };

function matchReviewKey(review) {
  return `${review.leftNpi}:${review.rightNpi}`;
}

function matchReviewBulkEligibility(review) {
  const owners = [...(review.left?.owners || []), ...(review.right?.owners || [])];
  const ownersById = new Map();
  owners.forEach((owner) => {
    if (owner?.userId) ownersById.set(String(owner.userId), owner.displayName || "(unknown agent)");
  });
  const ownerIds = [...ownersById.keys()];
  if (ownerIds.length > 1) return { eligible: false, reason: "Different agents own these leads; review manually." };
  if (ownerIds.length === 0) return { eligible: true, reason: "Both leads are unclaimed." };
  const ownerName = ownersById.get(ownerIds[0]);
  const leftClaimed = (review.left?.owners || []).length > 0;
  const rightClaimed = (review.right?.owners || []).length > 0;
  return {
    eligible: true,
    reason: leftClaimed && rightClaimed
      ? `Both leads are owned by ${ownerName}; ownership is consistent.`
      : `One lead is unclaimed and the other is owned by ${ownerName}.`,
  };
}

function filteredMatchReviews() {
  const reviews = (state.matchReviews && state.matchReviews.reviews) || [];
  // The registry scope is already filtered by tier on the server.
  if (state.matchReviewsScope === "registry" || state.matchReviewsTier === "all") return reviews;
  return reviews.filter((review) => String(review.tier) === state.matchReviewsTier);
}

// requestedBy: set on the side of a held claim (sql/010) -- that NPI isn't a
// lead yet, someone tried to claim it.
function renderMatchReviewSide(record, requestedBy) {
  // Only the state is compared, so the city is shown as secondary context.
  const location = record.state
    ? `${escapeHtml(record.state)}${record.city ? ` <span class="match-review-note">${escapeHtml(record.city)}</span>` : ""}`
    : escapeHtml(record.city || "—");
  const owners = record.owners.length
    ? record.owners.map((owner) => escapeHtml(owner.displayName)).join(", ")
    : requestedBy
      ? `<span class="match-review-request">Requested by ${escapeHtml(requestedBy.displayName)}</span>`
      : record.isLead === false
        ? "Not a lead yet"
        : "Unclaimed";
  return {
    name: `<div class="company-name">${escapeHtml(record.name || "(no name)")}</div><div class="company-taxonomy mono">${escapeHtml(record.npi)}</div>`,
    state: location,
    official: escapeHtml(record.official || "—"),
    phone: record.phone
      ? `${escapeHtml(record.phone)}${record.phoneSource === "authorized official" ? ' <span class="match-review-note">(official)</span>' : ""}`
      : "—",
    officialPhone: record.officialPhone ? `${escapeHtml(record.officialPhone)} <span class="match-review-note">(official)</span>` : "—",
    group: record.groupSize > 1 ? `${record.groupSize} NPIs` : "Only this NPI",
    owners,
  };
}

function renderMatchReviews() {
  const payload = state.matchReviews;
  if (!payload) return;
  // Only offered for the registry comparison; a run in progress keeps its Stop button.
  els.matchReviewsMergeAllBtn.hidden = state.matchReviewsScope !== "registry" || payload.available === false;

  if (payload.available === false) {
    state.matchReviewSelected.clear();
    renderMatchReviewBulkControls([]);
    els.matchReviewsSummary.textContent = "Not available";
    els.matchReviewsEmpty.hidden = false;
    els.matchReviewsEmpty.textContent = payload.reason || "The review queue isn't installed yet.";
    els.matchReviewsList.innerHTML = "";
    els.matchReviewsMoreBtn.hidden = true;
    return;
  }

  const all = payload.reviews || [];
  const isRegistry = state.matchReviewsScope === "registry";
  const tier2 = all.filter((review) => review.tier === 2).length;
  const tier3 = all.filter((review) => review.tier === 3).length;
  els.matchReviewsSummary.textContent = all.length
    ? isRegistry
      ? `${all.length} pair${all.length === 1 ? "" : "s"} loaded${state.matchReviewsLoading ? " · loading more…" : state.matchReviewsHasMore ? " · more available" : " · all providers"}`
      : `${all.length} pair${all.length === 1 ? "" : "s"} to review · Tier 2: ${tier2} · Tier 3: ${tier3}`
    : "Nothing to review";

  const reviews = filteredMatchReviews();
  renderMatchReviewBulkControls(reviews);
  if (reviews.length === 0) {
    els.matchReviewsEmpty.hidden = false;
    els.matchReviewsEmpty.textContent = all.length
      ? "No pairs in this tier."
      : "No possible duplicates are waiting for a decision.";
    els.matchReviewsList.innerHTML = "";
    els.matchReviewsMoreBtn.hidden = true;
    return;
  }

  els.matchReviewsEmpty.hidden = true;
  const visible = isRegistry ? reviews : reviews.slice(0, state.matchReviewsLimit);
  els.matchReviewsList.innerHTML = visible
    .map((review) => {
      const bulkEligibility = matchReviewBulkEligibility(review);
      const reviewKey = matchReviewKey(review);
      const requestedBy = review.source === "claim_request" ? review.requestedBy : null;
      const left = renderMatchReviewSide(review.left, requestedBy && review.requestedNpi === review.left.npi ? requestedBy : null);
      const right = renderMatchReviewSide(review.right, requestedBy && review.requestedNpi === review.right.npi ? requestedBy : null);
      const matched = new Set(review.matchedKeys);
      const keyChips =
        (requestedBy ? `<span class="match-key-chip match-request-chip">Claim request · ${escapeHtml(requestedBy.displayName)}</span>` : "") +
        review.matchedKeys
          .map((key) => `<span class="match-key-chip">${escapeHtml(MATCH_KEY_LABELS[key] || key)}</span>`)
          .join("");
      const row = (label, field, key) => {
        const isMatch = key && matched.has(key);
        return `
          <tr class="${isMatch ? "is-match" : ""}">
            <th scope="row">${escapeHtml(label)}${isMatch ? ' <span class="match-review-check" aria-label="matches">✓</span>' : ""}</th>
            <td>${left[field]}</td>
            <td>${right[field]}</td>
          </tr>`;
      };
      return `
      <div class="conflict-card match-review-card match-review-tier-${review.tier}${bulkEligibility.eligible ? "" : " match-review-ineligible"}">
        <div class="conflict-card-header">
          <div>
            <label class="checkbox match-review-select">
              <input type="checkbox" data-match-review-select data-review-key="${escapeHtml(reviewKey)}" ${state.matchReviewSelected.has(reviewKey) ? "checked" : ""} ${bulkEligibility.eligible ? "" : "disabled"}>
              <span>${bulkEligibility.eligible ? "Select for bulk merge" : escapeHtml(bulkEligibility.reason)}</span>
            </label>
            <div class="conflict-title">Tier ${review.tier} match</div>
            <div class="match-key-chips">${keyChips}</div>
          </div>
          <div class="match-review-actions">
            <button type="button" class="btn btn-ghost" data-match-review="dismissed" data-review-key="${escapeHtml(matchReviewKey(review))}">
              Not the same
            </button>
            <button type="button" class="btn btn-primary" data-match-review="merged" data-review-key="${escapeHtml(matchReviewKey(review))}">
              Same business — merge
            </button>
          </div>
        </div>
        <div class="match-review-table-wrap">
          <table class="conflict-leads match-review-table">
            <tbody>
              ${row("Name / NPI", "name", "name")}
              ${row("State", "state", "state")}
              ${row("Authorized official", "official", "official")}
              ${row("Phone", "phone", "phone")}
              ${review.left.officialPhone || review.right.officialPhone ? row("Official's phone", "officialPhone", "phone") : ""}
              ${row("Group", "group", null)}
              ${row("Claimed by", "owners", null)}
            </tbody>
          </table>
        </div>
      </div>`;
    })
    .join("");

  if (isRegistry) {
    els.matchReviewsMoreBtn.hidden = !state.matchReviewsHasMore || state.matchReviewsLoading;
    els.matchReviewsMoreBtn.textContent = `Load ${REGISTRY_FETCH_PAGE} more`;
    return;
  }
  const remaining = reviews.length - visible.length;
  els.matchReviewsMoreBtn.hidden = remaining <= 0;
  els.matchReviewsMoreBtn.textContent = `Show ${Math.min(remaining, MATCH_REVIEWS_PAGE)} more (${remaining} left)`;
}

// Provider search reads either from the mirror project over HTTP or from
// this project's own npi_records (sql/018), and NPI_SOURCE decides which.
// This runs one search against both and shows what each returned, so the
// switch gets flipped on evidence: a gap is almost always a provider the
// last monthly refresh hasn't loaded, which is worth seeing before a rep
// does.
const SOURCE_LABELS = { mirror: "the mirror project (fakeNPI)", dmedesk: "DME Desk's own npi_records" };

// Each bucket is a different answer to "why isn't this provider in our
// results?", and only one of them is a problem.
const COVERAGE_LABELS = {
  covered: "in DME Desk, and this search returns them",
  deactivated: "we have them; NPPES has since deactivated them",
  individual: "we have them; they are a person, not an organization",
  differentState: "we have them in a different state",
  differentSpecialty: "we have them under a different specialty",
  missing: "not in DME Desk at all",
};

function coverageHtml(coverage) {
  if (!coverage || !coverage.checked) return "";
  if (coverage.error) return `<div class="claim-result-detail">Couldn't check coverage: ${escapeHtml(coverage.error)}</div>`;

  const rows = Object.keys(COVERAGE_LABELS)
    .filter((bucket) => (coverage.counts[bucket] || 0) > 0)
    .map((bucket) => {
      const samples = (coverage.samples[bucket] || [])
        .map((s) => `<div class="claim-result-detail"><span class="mono">${escapeHtml(s.npi)}</span> ${escapeHtml(s.name)}${s.ours ? ` — mirror says ${escapeHtml(s.mirror || "?")}, we hold ${escapeHtml(s.ours)}` : ""}</div>`)
        .join("");
      return `
        <tr class="${bucket === "missing" ? "is-match" : ""}">
          <th scope="row">${coverage.counts[bucket]}</th>
          <td>${escapeHtml(COVERAGE_LABELS[bucket])}${samples}</td>
        </tr>`;
    })
    .join("");

  return `
    <table class="match-review-table">
      <thead><tr><th scope="col">Of ${coverage.checked}</th><th scope="col">Where the mirror's results are in DME Desk</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderSearchCompare(data) {
  const row = (label, side) => `
    <tr>
      <th scope="row">${escapeHtml(label)}</th>
      <td>${side.ok ? `${Number(side.count).toLocaleString()}${side.countCapped ? "+" : ""} match${side.count === 1 ? "" : "es"}` : `<span class="provider-change-old">${escapeHtml(side.error || "failed")}</span>`}</td>
      <td class="mono">${side.ok ? `${side.returned} returned` : "—"}</td>
      <td class="mono">${side.ms} ms</td>
    </tr>`;

  els.searchCompareEmpty.hidden = true;
  els.searchCompareResult.innerHTML = `
    <div class="conflict-card match-review-card">
      <div class="conflict-card-header">
        <div>
          <div class="conflict-title">${data.coverage && data.coverage.coveredPercent !== null
            ? `${data.coverage.coveredPercent}% of the mirror's results are in DME Desk and returned by this search`
            : "Nothing to compare"}</div>
          <div class="match-key-chips">
            ${Object.entries(data.criteria).filter(([, v]) => v).map(([k, v]) => `<span class="match-key-chip">${escapeHtml(k)}: ${escapeHtml(String(v))}</span>`).join("")}
          </div>
        </div>
      </div>
      <table class="match-review-table">
        <thead><tr><th scope="col">Source</th><th scope="col">Total</th><th scope="col">This page</th><th scope="col">Time</th></tr></thead>
        <tbody>
          ${row("Mirror (fakeNPI)", data.mirror)}
          ${row("DME Desk", data.dmedesk)}
        </tbody>
      </table>
      ${coverageHtml(data.coverage)}
      <div class="claim-result-detail">
        The two sources page in different orders, so the 50 rows above aren't
        the same 50 providers. What matters is the table: only "not in DME
        Desk at all" is a gap.
      </div>
    </div>`;
}

async function compareSearchSources() {
  const params = new URLSearchParams();
  if (els.compareState.value.trim()) params.set("state", els.compareState.value.trim());
  if (els.compareSpecialty.value.trim()) params.set("taxonomyDescription", els.compareSpecialty.value.trim());
  if (![...params.keys()].length) {
    showToast("Give a state or a specialty to compare", true);
    return;
  }
  els.compareSourcesBtn.disabled = true;
  els.searchCompareEmpty.hidden = false;
  els.searchCompareEmpty.textContent = "Running the same search against both…";
  els.searchCompareResult.innerHTML = "";
  try {
    const data = await apiGet(`admin/search-compare?${params.toString()}`);
    els.searchSourceSummary.textContent = `Searches currently read from ${SOURCE_LABELS[data.activeSource] || data.activeSource}`;
    renderSearchCompare(data);
  } catch (err) {
    els.searchCompareEmpty.hidden = false;
    els.searchCompareEmpty.textContent = "Couldn't compare: " + err.message;
  } finally {
    els.compareSourcesBtn.disabled = false;
  }
}

// What the last NPPES refresh changed about leads people own (sql/015).
// The rep sees their own as a badge in Claimed leads; this is where an admin
// works through all of them -- and where a change that moved a lead's
// identity keys gets a decision, since groups are never re-cut on their own.
const PROVIDER_CHANGE_FIELD_LABELS = {
  name: "Organization name",
  phone: "Phone",
  authorizedofficial_firstname: "Authorized official (first name)",
  authorizedofficial_lastname: "Authorized official (last name)",
  authorizedofficial_title: "Authorized official (title)",
  authorizedofficial_phone: "Authorized official phone",
  address_city: "City",
  address_state: "State",
  status: "NPPES status",
  deactivation_date: "Deactivation date",
  replacement_npi: "Replacement NPI",
};
const PROVIDER_CHANGES_PAGE = 25;

function providerChangeFieldLabel(field) {
  return PROVIDER_CHANGE_FIELD_LABELS[field] || field;
}

function renderProviderChanges() {
  const payload = state.providerChanges;
  if (!payload) return;

  if (payload.available === false) {
    els.providerChangesSummary.textContent = "Not available";
    els.providerChangesEmpty.hidden = false;
    els.providerChangesEmpty.textContent = payload.reason || "Provider change alerts aren't installed yet.";
    els.providerChangesList.innerHTML = "";
    els.providerChangesMoreBtn.hidden = true;
    return;
  }

  const all = payload.changes || [];
  const needGroupLook = all.filter((change) => change.groupReview).length;
  els.providerChangesSummary.textContent = all.length
    ? `${all.length} change${all.length === 1 ? "" : "s"} to look at` +
      (needGroupLook ? ` · ${needGroupLook} may affect grouping` : "")
    : "Nothing to look at";

  if (all.length === 0) {
    els.providerChangesEmpty.hidden = false;
    els.providerChangesEmpty.textContent = "No claimed lead changed in the last refresh.";
    els.providerChangesList.innerHTML = "";
    els.providerChangesMoreBtn.hidden = true;
    return;
  }

  els.providerChangesEmpty.hidden = true;
  const visible = all.slice(0, state.providerChangesLimit);
  els.providerChangesList.innerHTML = visible
    .map((change) => {
      const where = [change.city, change.state].filter(Boolean).join(", ");
      const rows = change.changes
        .map(
          (field) => `
          <tr>
            <th scope="row">${escapeHtml(providerChangeFieldLabel(field.field))}</th>
            <td class="provider-change-old">${escapeHtml(field.oldValue || "—")}</td>
            <td class="provider-change-new">${escapeHtml(field.newValue || "—")}</td>
          </tr>`
        )
        .join("");
      return `
      <div class="conflict-card match-review-card">
        <div class="conflict-card-header">
          <div>
            <div class="conflict-title">${escapeHtml(change.companyName || change.npi)}</div>
            <div class="match-key-chips">
              <span class="match-key-chip"><span class="mono">${escapeHtml(change.npi)}</span></span>
              ${where ? `<span class="match-key-chip">${escapeHtml(where)}</span>` : ""}
              <span class="match-key-chip">${escapeHtml(change.ownerName)}</span>
              ${change.groupReview ? '<span class="match-key-chip match-request-chip">May affect grouping</span>' : ""}
            </div>
          </div>
          <div class="match-review-actions">
            <button type="button" class="btn btn-ghost" data-provider-change="dismissed" data-event-id="${escapeHtml(change.eventId)}">
              No action needed
            </button>
            <button type="button" class="btn btn-primary" data-provider-change="approved" data-event-id="${escapeHtml(change.eventId)}">
              Handled
            </button>
          </div>
        </div>
        <table class="match-review-table provider-change-table">
          <thead><tr><th scope="col">Field</th><th scope="col">Was</th><th scope="col">Now</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    })
    .join("");
  els.providerChangesMoreBtn.hidden = all.length <= visible.length;
}

async function loadProviderChanges(silent = false) {
  if (!silent) {
    els.providerChangesSummary.textContent = "Checking…";
    if (!state.providerChanges) {
      els.providerChangesEmpty.hidden = false;
      els.providerChangesEmpty.textContent = "Checking…";
    }
  }
  try {
    state.providerChanges = await apiGet("admin/provider-changes");
    renderProviderChanges();
  } catch (err) {
    if (silent) {
      console.log("[admin] provider change refresh failed: " + err.message);
      return;
    }
    els.providerChangesSummary.textContent = "Failed to load";
    els.providerChangesEmpty.hidden = false;
    els.providerChangesEmpty.textContent = "Couldn't load provider changes: " + err.message;
    els.providerChangesList.innerHTML = "";
  }
}

async function resolveProviderChange(eventId, decision) {
  try {
    const result = await apiPost("admin/provider-changes/resolve", { eventId, decision });
    showToast(result.alreadyDecided ? "Someone else already decided that one." : "Marked as handled.");
    await loadProviderChanges();
  } catch (err) {
    showToast(err.message, true);
  }
}

// append=true (registry scope only) adds the next page to what is already loaded.
async function loadMatchReviews(silent = false, append = false) {
  const token = ++matchReviewsLoadToken;
  if (!silent) {
    els.matchReviewsSummary.textContent = "Checking…";
    if (!state.matchReviews) {
      els.matchReviewsEmpty.hidden = false;
      els.matchReviewsEmpty.textContent = "Checking…";
    }
  }
  try {
    if (state.matchReviewsScope === "registry") {
      // A fresh load fetches pages until REGISTRY_AUTOLOAD_CAP pairs are on
      // screen; the registry holds far more than anyone can review at once, so
      // "Load more" adds one page at a time beyond that.
      let loaded = append && state.matchReviews ? state.matchReviews.reviews || [] : [];
      const target = append ? loaded.length + REGISTRY_FETCH_PAGE : REGISTRY_AUTOLOAD_CAP;
      let hasMore = true;
      state.matchReviewsLoading = true;
      try {
        while (hasMore && loaded.length < target) {
          const params = new URLSearchParams({
            scope: "registry",
            limit: String(Math.min(REGISTRY_FETCH_PAGE, target - loaded.length)),
            offset: String(loaded.length),
          });
          if (state.matchReviewsTier !== "all") params.set("tier", state.matchReviewsTier);
          const page = await apiGet("admin/match-reviews?" + params.toString());
          // The admin changed scope, tier or reloaded while this was fetching.
          if (token !== matchReviewsLoadToken) return;
          hasMore = page.hasMore === true;
          loaded = [...loaded, ...(page.reviews || [])];
          state.matchReviewsHasMore = hasMore;
          state.matchReviews = { ...page, reviews: loaded };
          renderMatchReviews(); // update the count after each page
        }
      } finally {
        if (token === matchReviewsLoadToken) state.matchReviewsLoading = false;
      }
    } else {
      state.matchReviewsHasMore = false;
      state.matchReviewsLoading = false; // a registry load this one replaced no longer owns the flag
      state.matchReviews = await apiGet("admin/match-reviews");
    }
    renderMatchReviews();
  } catch (err) {
    if (silent) {
      console.log("[admin] match review refresh failed: " + err.message);
      return;
    }
    els.matchReviewsSummary.textContent = "Failed to load";
    els.matchReviewsEmpty.hidden = false;
    els.matchReviewsEmpty.textContent = "Couldn't load possible duplicates: " + err.message;
    els.matchReviewsList.innerHTML = "";
    els.matchReviewsMoreBtn.hidden = true;
    state.matchReviewSelected.clear();
    renderMatchReviewBulkControls([]);
  }
}

function openMatchReview(reviewKey, decision) {
  const review = ((state.matchReviews && state.matchReviews.reviews) || []).find((r) => matchReviewKey(r) === reviewKey);
  if (!review) return;
  state.matchReviewPending = { review, decision };

  els.matchReviewPair.textContent =
    `${review.left.name || review.left.npi} (${review.left.npi}) and ${review.right.name || review.right.npi} (${review.right.npi})`;

  const requester = review.source === "claim_request" && review.requestedBy ? review.requestedBy.displayName : null;
  if (decision === "merged") {
    const owners = new Set([...review.left.owners, ...review.right.owners].map((owner) => owner.userId));
    els.matchReviewTitle.textContent = "Merge into one business";
    els.matchReviewEffect.textContent =
      `Their groups (${review.left.groupSize + review.right.groupSize} NPIs in total) become one group. Nobody's claims change.` +
      (owners.size > 1 ? " These NPIs are claimed by different people, so the merged group will appear under Ownership conflicts." : "") +
      (requester ? ` ${requester}'s claim request stays blocked, because the business is already owned.` : "");
    els.matchReviewSubmitBtn.textContent = "Merge";
  } else {
    els.matchReviewTitle.textContent = "Not the same business";
    els.matchReviewEffect.textContent =
      "Nothing is moved. This pair won't be flagged again." + (requester ? ` ${requester} can then claim the lead.` : "");
    els.matchReviewSubmitBtn.textContent = "Dismiss";
  }

  els.matchReviewReason.value = "";
  els.matchReviewSubmitBtn.disabled = false;
  els.matchReviewOverlay.hidden = false;
  els.matchReviewReason.focus();
}

function closeMatchReview() {
  els.matchReviewOverlay.hidden = true;
  state.matchReviewPending = null;
}

async function handleMatchReviewSubmit(event) {
  event.preventDefault();
  const pending = state.matchReviewPending;
  if (!pending) return;
  const reason = els.matchReviewReason.value.trim();
  if (!reason) {
    showToast("A reason is required — it's recorded with the decision.", true);
    return;
  }

  const idleLabel = els.matchReviewSubmitBtn.textContent;
  els.matchReviewSubmitBtn.disabled = true;
  els.matchReviewSubmitBtn.textContent = "Saving…";
  try {
    const { review, decision } = pending;
    const result = await apiPost("admin/match-reviews/resolve", {
      leftNpi: review.leftNpi,
      rightNpi: review.rightNpi,
      decision,
      reason,
      tier: review.tier,
      matchedKeys: review.matchedKeys,
    });
    closeMatchReview();
    if (decision === "merged") {
      showToast(
        "Merged into one group." +
          (result.new_conflict ? " It now has claims from more than one person — resolve it under Ownership conflicts." : "")
      );
    } else {
      showToast("Dismissed. This pair won't be flagged again.");
    }
    await Promise.all([loadMatchReviews(true), loadConflicts(true)]);
  } catch (err) {
    showToast(err.message, true);
    els.matchReviewSubmitBtn.disabled = false;
    els.matchReviewSubmitBtn.textContent = idleLabel;
  }
}

// silent=true is used by the background auto-refresh interval -- no
// skeleton flash over data the admin is currently looking at, and a
// transient failure (e.g. one flaky request) just logs instead of
// throwing an error toast every 30s.
async function loadAdminOverview(silent = false) {
  if (!silent) {
    els.adminSuggestionsBody.innerHTML = skeletonRows(3, 3);
  }
  // Conflicts load in parallel and own their own error handling, so a
  // failure there (e.g. the identity schema isn't installed) degrades to a
  // message in that one panel instead of blanking the whole dashboard.
  const conflictsLoaded = loadConflicts(silent);
  // The review queue is computed from every active lead, so the 30s
  // background refresh skips it; it reloads on open, Refresh, and after
  // each decision. (A click handler passes the event object, not `true`.)
  const reviewsLoaded = silent === true ? Promise.resolve() : loadMatchReviews();
  const providerChangesLoaded = loadProviderChanges(silent);
  try {
    const data = await apiGet("admin/overview");
    renderAdminStats(data.stats);
    renderAdminSuggestions(data.suggestions);
    state.adminLoaded = true;
  } catch (err) {
    if (silent) {
      console.log("[admin] background refresh failed: " + err.message);
      return;
    }
    showToast(err.message, true);
    els.adminSuggestionsBody.innerHTML = `<tr class="empty-row"><td colspan="3">Failed to load.</td></tr>`;
  } finally {
    await Promise.all([conflictsLoaded, reviewsLoaded, providerChangesLoaded]);
  }
}

const ADMIN_LEADS_SORT_COMPARATORS = {
  company: (a, b) => (a.name || "").localeCompare(b.name || ""),
  contact: (a, b) => (a.contactName || "").localeCompare(b.contactName || ""),
  location: (a, b) => `${a.state || ""}|${a.city || ""}`.localeCompare(`${b.state || ""}|${b.city || ""}`),
  specialty: (a, b) => (a.taxonomy || "").localeCompare(b.taxonomy || ""),
  status: (a, b) => (a.status || "").localeCompare(b.status || ""),
  claimedAt: (a, b) => (Date.parse(a.claimedAt) || 0) - (Date.parse(b.claimedAt) || 0),
};
const ADMIN_LEADS_DEFAULT_SORT_DIR = { company: 1, contact: 1, location: 1, specialty: 1, status: 1, claimedAt: -1 };

function applyAdminLeadsFilter(leads) {
  const q = state.adminLeadsSearchQuery.trim().toLowerCase();
  if (!q) return leads;
  return leads.filter((lead) =>
    [lead.name, lead.npi, lead.city, lead.state, lead.contactName, lead.taxonomy]
      .some((v) => (v || "").toLowerCase().includes(q))
  );
}

function renderAdminUserLeadsRows() {
  const leads = applyAdminLeadsFilter(state.adminLeadsAll);
  els.adminUserLeadsSubtitle.textContent = `${leads.length} of ${state.adminLeadsAll.length} claimed lead${state.adminLeadsAll.length === 1 ? "" : "s"} shown`;
  if (leads.length === 0) {
    els.adminUserLeadsBody.innerHTML = `<tr class="empty-row"><td colspan="6">${state.adminLeadsAll.length === 0 ? "Nothing claimed." : "No leads match that search."}</td></tr>`;
    return;
  }
  els.adminUserLeadsBody.innerHTML = leads
    .map((lead) => {
      const location = [lead.city, lead.state].filter(Boolean).join(", ");
      const statusSlug = escapeHtml((lead.status || "").replace(/\s+/g, "-"));
      return `
      <tr>
        <td>
          <div class="company-name">${escapeHtml(lead.name || "")}</div>
          <div class="company-taxonomy mono">${escapeHtml(lead.npi || "")}</div>
        </td>
        <td>
          ${escapeHtml(lead.contactName || "—")}
          ${lead.contactPhone || lead.companyPhone ? `<div class="company-taxonomy mono">${escapeHtml(lead.contactPhone || lead.companyPhone)}</div>` : ""}
        </td>
        <td>${escapeHtml(location || "—")}</td>
        <td>${escapeHtml(lead.taxonomy || "—")}</td>
        <td>${lead.status ? `<span class="status-badge status-${statusSlug}">${escapeHtml(lead.status)}</span>` : "—"}</td>
        <td class="mono">${escapeHtml((lead.claimedAt || "").slice(0, 10))}</td>
      </tr>`;
    })
    .join("");
}

async function openAdminUserLeads(userId, displayName) {
  els.adminUserLeadsTitle.textContent = `${displayName || "User"}'s claimed leads`;
  els.adminUserLeadsSubtitle.textContent = "";
  els.adminUserLeadsSearchInput.value = "";
  state.adminLeadsSearchQuery = "";
  state.adminLeadsAll = [];
  state.adminLeadsSortKey = null;
  state.adminLeadsSortDir = 1;
  updateSortIndicators(els.adminUserLeadsTable, null, 1);
  els.adminUserLeadsBody.innerHTML = skeletonRows(6, 6);
  els.adminUserLeadsOverlay.hidden = false;
  try {
    const data = await apiGet("admin/leads", { userId, displayName });
    state.adminLeadsAll = data.leads || [];
    renderAdminUserLeadsRows();
  } catch (err) {
    els.adminUserLeadsBody.innerHTML = `<tr class="empty-row"><td colspan="6">Failed to load.</td></tr>`;
    showToast(err.message, true);
  }
}

function sortAdminUserLeads(key, defaultDir) {
  state.adminLeadsSortDir = state.adminLeadsSortKey === key ? state.adminLeadsSortDir * -1 : defaultDir;
  state.adminLeadsSortKey = key;
  state.adminLeadsAll.sort((a, b) => ADMIN_LEADS_SORT_COMPARATORS[key](a, b) * state.adminLeadsSortDir);
  updateSortIndicators(els.adminUserLeadsTable, state.adminLeadsSortKey, state.adminLeadsSortDir);
  renderAdminUserLeadsRows();
}

function closeAdminUserLeads() {
  els.adminUserLeadsOverlay.hidden = true;
}

/* ---------- View tabs ---------- */

// Both Claimed Leads and Admin show data that can change from OTHER
// people's actions (a teammate claiming/disconnecting/reassigning a lead
// elsewhere, an admin's own tallies drifting as the team works) -- a
// "load once per session" cache goes stale the moment that happens with
// no way to notice short of a manual Refresh click. Every switch back to
// either tab now re-fetches unconditionally, and a light interval keeps
// it current even while just sitting on the tab, without needing a real
// realtime/websocket subscription.
const AUTO_REFRESH_INTERVAL_MS = 30000;

function stopClaimedAutoRefresh() {
  if (state.claimedRefreshInterval) {
    clearInterval(state.claimedRefreshInterval);
    state.claimedRefreshInterval = null;
  }
}

function stopAdminAutoRefresh() {
  if (state.adminRefreshInterval) {
    clearInterval(state.adminRefreshInterval);
    state.adminRefreshInterval = null;
  }
}

function switchView(view) {
  state.view = view;
  document.querySelectorAll(".view-tabs .tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.view === view);
  });
  els.viewSearch.hidden = view !== "search";
  els.viewClaimed.hidden = view !== "claimed";
  els.viewAdmin.hidden = view !== "admin";
  const viewToday = document.getElementById("viewToday");
  if (viewToday) viewToday.hidden = view !== "today";
  updateSelectionBar();
  window.dmeHooks.onView?.(view);

  stopClaimedAutoRefresh();
  stopAdminAutoRefresh();

  if (view === "claimed") {
    loadClaimedLeads();
    // The interval (not this initial load) skips refreshing while focus is
    // inside the table or a row is checked -- claimedBody has
    // live-editable notes/status inputs, and wiping an in-progress edit
    // or a pending bulk-action selection out from under someone every 30s
    // would be worse than the staleness this is fixing.
    state.claimedRefreshInterval = setInterval(() => {
      if (els.claimedBody.contains(document.activeElement)) return;
      if (state.claimedSelected.size > 0) return;
      loadClaimedLeads(true);
    }, AUTO_REFRESH_INTERVAL_MS);
  } else if (view === "admin") {
    loadAdminOverview();
    state.adminRefreshInterval = setInterval(() => loadAdminOverview(true), AUTO_REFRESH_INTERVAL_MS);
  }
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

// "states", "taxonomyDescriptions", and "lastUpdatedYears" are multi-valued
// (several checkboxes sharing one `name`) -- FormData.entries() would yield
// one params[key] assignment per checked box, each overwriting the last, so
// they're pulled out via getAll() and sent as a single comma-joined value
// instead.
const MULTI_VALUE_FIELDS = ["states", "taxonomyDescriptions", "lastUpdatedYears"];

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
  if (formData.get("resetProgress")) params.resetProgress = "true";
  return applyLookupField(params);
}

// The first field is a smart lookup box. What you type decides what it does:
//   10 digits                    -> an exact NPI (the Worker ignores every other filter)
//   a formatted phone number     -> that business, by its phone or its owner's phone
//   exactly 5 digits             -> a ZIP-code filter (the other filters still apply)
//   anything else                -> a business or owner NAME, wherever it is
// NPI, phone and name lookups mean "find this one business", so the other
// filters are dropped for them. Phone, ZIP and name-by-owner need the DME Desk
// provider table (sql/021); without it a name still works the old way.
const LOOKUP_IGNORED_PARAMS = ["nameContainsTerms", "excludeKeywords", "states", "taxonomyDescriptions", "lastUpdatedYears", "city", "minMedicareClaims",
  "hasPhone", "hasDecisionMaker", "activeMedicare", "zip", "sortBy"];
const ADVANCED_PARAMS = ["hasPhone", "hasDecisionMaker", "activeMedicare", "zip", "sortBy"];

function isNpiLookupValue(value) {
  return /^\d{10}$/.test(String(value || "").trim());
}

function searchAdvancedAvailable() {
  return Boolean(state.searchCaps && state.searchCaps.advanced);
}

// What kind of lookup is this text? { type: "none" | "npi" | "phone" | "zip" | "name", value }
function classifyLookup(raw) {
  const text = String(raw || "").trim();
  if (!text) return { type: "none", value: "" };
  if (isNpiLookupValue(text)) return { type: "npi", value: text };
  const digits = text.replace(/\D/g, "");
  const looksLikePhone = /^\+?1?[\s().-]*\d{3}[\s().-]*\d{3}[\s.-]*\d{4}$/.test(text) && /[\s().+-]/.test(text) && digits.length >= 10;
  if (looksLikePhone) return { type: "phone", value: digits.slice(-10) };
  if (/^\d{5}$/.test(text)) return { type: "zip", value: text };
  return { type: "name", value: text.replace(/,/g, " ").replace(/\s+/g, " ").trim() };
}

function applyLookupField(params) {
  delete params.minScore; // the old fit-score filter (a saved search may still carry it)
  // Controls for options this deployment can't honour (sql/021 not run, or
  // searches still reading the mirror) must not send anything.
  if (!searchAdvancedAvailable()) ADVANCED_PARAMS.forEach((key) => { delete params[key]; });

  const lookup = classifyLookup(params.npi);
  if (lookup.type === "none") { delete params.npi; return params; }
  if (lookup.type === "npi") { params.npi = lookup.value; return params; }

  const advanced = searchAdvancedAvailable();
  if (lookup.type === "zip" && advanced) {
    delete params.npi;
    params.zip = lookup.value;
    return params;
  }

  // Phone, name (or a ZIP/phone this deployment can't use, which falls back to a name search).
  LOOKUP_IGNORED_PARAMS.forEach((key) => { delete params[key]; });
  delete params.npi;
  if (advanced && lookup.type === "phone") params.lookupPhone = lookup.value;
  else if (advanced) params.lookupText = lookup.type === "name" ? lookup.value : String(lookup.value);
  else params.nameContainsTerms = (lookup.type === "name" ? lookup.value : String(lookup.value)).replace(/,/g, " ");
  return params;
}

// A one-line explanation of what the box will do with what is typed.
function lookupHintText(raw) {
  const lookup = classifyLookup(raw);
  const advanced = searchAdvancedAvailable();
  if (lookup.type === "npi") return "Exact NPI lookup. Other filters are ignored.";
  if (lookup.type === "phone") return advanced ? "Phone lookup (company or owner line). Other filters are ignored." : "Phone lookup needs the DME Desk provider table; searching it as text.";
  if (lookup.type === "zip") return advanced ? "Filters to this ZIP code. Your other filters still apply." : "Searching this as text.";
  if (lookup.type === "name") return advanced ? "Finds this company or owner by name. Other filters are ignored." : "Finds companies with this in their name. Other filters are ignored.";
  return "";
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

// Split out from restoreSearchFormState() so loadTaxonomyOptions() (called
// on every login, after the dynamic checkboxes are re-rendered from the
// server) can re-apply JUST the taxonomy selection, not the whole form --
// calling the full restoreSearchFormState() there would also reapply
// values.excludeKeywords/nameContainsTerms from this tab's LAST SEARCH,
// which can belong to a DIFFERENT teammate than the one who just signed in
// (sessionStorage isn't cleared per-user), silently overwriting the
// correct per-user exclude-keywords handleLogin just set moments earlier.
function restoreTaxonomySelectionFromSession() {
  const raw = sessionStorage.getItem(SEARCH_FILTERS_KEY);
  if (!raw) return;
  let values;
  try { values = JSON.parse(raw); } catch { return; }
  if (!Array.isArray(values.taxonomyDescriptions)) return;
  taxonomyOptionsContainer.querySelectorAll('input[name="taxonomyDescriptions"]').forEach((cb) => {
    cb.checked = values.taxonomyDescriptions.includes(cb.value);
  });
  taxonomyAllCheckbox.checked = values.taxonomyDescriptions.length === 0;
  updateTaxonomySummary();
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
  restoreTaxonomySelectionFromSession();
  if (Array.isArray(values.lastUpdatedYears)) {
    yearOptionsContainer.querySelectorAll('input[name="lastUpdatedYears"]').forEach((cb) => {
      cb.checked = values.lastUpdatedYears.includes(cb.value);
    });
    updateYearSummary();
  }
  // The generic loop above just set each hidden input's raw string value --
  // rebuild the actual chip UI from it (the hidden input is a sync target,
  // not the source of truth).
  if (typeof values.excludeKeywords === "string") {
    excludeKeywordsChipInput.setAll(values.excludeKeywords.split(","));
  }
  if (typeof values.nameContainsTerms === "string") {
    nameContainsChipInput.setAll(values.nameContainsTerms.split(","));
  }
  refreshCityOptions(); // programmatic checkbox state above doesn't fire the state options' own change listener
  if (values.city) cityInput.value = values.city;
}

// Every add/remove already auto-persists (see persistExcludeKeywords) -- this
// button is now just an explicit "confirm it saved" affordance, plus a way
// to commit whatever's still sitting in the entry field (typed but not yet
// turned into a chip) so clicking it never silently drops that text.
async function saveExcludeKeywordsDefault() {
  excludeKeywordsChipInput.flushPendingEntry(); // adds + auto-persists, if there was pending text
  els.saveExcludeKeywordsBtn.disabled = true;
  try {
    await persistExcludeKeywords({ silent: false });
  } finally {
    els.saveExcludeKeywordsBtn.disabled = false;
  }
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
  state.searchExhausted = exhausted;
  els.searchMoreBtn.hidden = false;
  syncSearchMoreButton();
}

// The list ran out, yet the count above says leads are still unseen: read the whole list again from
// the top, skipping what was already shown, rather than leaving a button that says "no more".
function syncSearchMoreButton() {
  if (els.searchMoreBtn.hidden) return; // nothing searched yet, or a search that found nothing
  const exhausted = Boolean(state.searchExhausted);
  const left = Number(state.insightsLeft || 0);
  const rescan = exhausted && left > 0 && !state.rescanTried;
  els.searchMoreBtn.dataset.mode = rescan ? "rescan" : "more";
  els.searchMoreBtn.disabled = exhausted && !rescan;
  els.searchMoreLabel.textContent = rescan ? `Rescan for ${left.toLocaleString()} unseen` : exhausted ? "No more leads found" : "Search more";
  els.searchMoreBtn.title = rescan
    ? "The list reached its end but the count says leads are still unseen. Reads it again from the top, skipping everything you have already seen."
    : exhausted
      ? "This search has no more unclaimed leads left in the registry"
      : "Keeps the same filters and pages deeper into the registry, skipping every lead you've already seen for this search";
}

// Locks every filter/control in the search form (text inputs, all the
// multiselects' checkboxes and their toggle/Select-all/Clear/+Add-taxonomy
// buttons, the chip inputs' entry fields and remove buttons, Enrich/Scrape
// checkboxes) while a search is in flight, so a change made mid-search can't
// silently apply to results that were actually fetched under the OLD
// filters. The "is-loading" class is belt-and-suspenders on top of the
// native disabled attributes -- it dims the whole block and blocks pointer
// events outright, since custom checkbox/button styling can make a merely
// `disabled` control still look clickable.
function setSearchFormDisabled(disabled) {
  els.form.classList.toggle("is-loading", disabled);
  els.form.querySelectorAll("input, button, select, textarea").forEach((el) => {
    el.disabled = disabled;
  });
  document.getElementById("resultsRefine")?.querySelectorAll("input, select").forEach((el) => { el.disabled = disabled; });
  document.getElementById("resultsRefine")?.classList.toggle("is-loading", disabled);
  // Shimmering placeholder cards while a search is in flight.
  const kpiStrip = document.getElementById("kpiSearch");
  if (kpiStrip) {
    kpiStrip.classList.toggle("is-loading", disabled);
    if (disabled) kpiStrip.hidden = false;
    else { updateProspectKpis(); scheduleInsights(250); } // a finished search changes what is left for you
  }
}

async function executeSearch(params, { isMore: more = false, isRescan = false } = {}) {
  const isMore = more || isRescan; // both add a page to the ones already on screen
  setSearchFormDisabled(true);
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
    if (isRescan) {
      requestParams.rescan = "true"; // the server starts from the top and skips what this rep has seen
    } else if (isMore) {
      if (Object.keys(state.searchMoreVariantSkips).length) requestParams.variantSkips = JSON.stringify(state.searchMoreVariantSkips);
      if (state.searchMoreSeenNpis.length) requestParams.excludeNpis = state.searchMoreSeenNpis.join(",");
    }

    const data = await apiGet("search/companies", requestParams);

    state.searchMoreVariantSkips = data.variantSkips || {};
    state.searchMoreSeenNpis = state.searchMoreSeenNpis.concat(collectNpisFromCompanies(data.companies));

    const failedPages = data.searchErrors || [];
    if (failedPages.length) {
      // A page the database didn't answer is not the end of the list: nothing is skipped, the next click retries it.
      showToast(`The database didn't answer part of this search (${failedPages[0].message}). Nothing was skipped: press ${isRescan ? "Rescan" : "Search more"} to carry on.`, true);
    }
    if (isMore && data.companies.length === 0) {
      // Nothing new to show -- leave the current table exactly as it was
      // instead of replacing it with an empty state.
      if (!failedPages.length) {
        showToast(isRescan
          ? `Nothing new turned up. The ${Number(state.insightsLeft || 0).toLocaleString()} still counted belong to businesses already claimed through another location or owned by a teammate, so they can't be shown.`
          : "No more leads found for this search");
      }
    } else {
      const page = { companies: data.companies, excludedAsClaimed: data.excludedAsClaimed || 0 };
      if (isMore) {
        // Appends a new page instead of overwriting -- earlier pages stay
        // exactly as they were, one click away via the page-nav below.
        state.resultPages.push(page);
      } else {
        // A brand-new search starts a fresh page list -- see runSearch's
        // comment on why this no longer means "the same leads every time".
        state.resultPages = [page];
      }
      state.sortKey = null; // fresh results start in the server's own order
      state.sortDir = 1;
      updateSortIndicators(els.resultsTable, null, 1);
      goToPage(state.resultPages.length - 1);
    }

    if (!isMore && data.companies.length === 0) {
      els.searchMoreBtn.hidden = true; // nothing was found at all -- no point offering to page deeper
    } else {
      updateSearchMoreButton(Boolean(data.exhaustedRegistry) && !failedPages.length);
    }

    state.lastSearchParams = params;
    setStatus("ready", "Ready");

    // NPPES flat-out rejects some taxonomy_description values (not just
    // "zero matches") when the text isn't one of its own exact registered
    // taxonomy strings -- a real risk for taxonomies added from the shared
    // sheet. The backend now isolates that to just the offending
    // selection(s) instead of losing the whole search, but the rep still
    // needs to know a specialty they picked was silently skipped.
    if (data.rejectedVariants && data.rejectedVariants.length) {
      const names = [...new Set(data.rejectedVariants.map((v) => v.taxonomyDescription).filter(Boolean))];
      showToast(`NPPES rejected ${names.length === 1 ? "this specialty" : "these specialties"}: ${names.join(", ")} — remove/edit it in Taxonomies, other results still loaded`, true);
    }
  } catch (err) {
    // A raw fetch()-level failure (network drop, or the connection getting cut
    // mid-response on an especially slow search) surfaces as a TypeError with
    // an unhelpful browser message like "Failed to fetch" -- broad multi-
    // specialty searches paged many "Search more" clicks deep can take long
    // enough to trigger this. Give a concrete, actionable message instead.
    const message = err instanceof TypeError
      ? "Lost connection or the search took too long — try narrowing your filters (fewer specialties/states) or click Search more again."
      : err.message;
    if (!isMore) els.resultsBody.innerHTML = `<tr class="empty-row"><td colspan="7">${escapeHtml(message)}</td></tr>`;
    setStatus("error", "Error");
    showToast(message, true);
    // A failed click always leaves it re-clickable -- reaching here means it
    // was enabled (not exhausted) when clicked, since an exhausted button is
    // disabled and can't be clicked in the first place.
    els.searchMoreBtn.disabled = false;
  } finally {
    // Deliberately NOT touching els.searchMoreBtn.disabled here -- the
    // success path above already set its final disabled state based on
    // whether the registry is now exhausted, and unconditionally clearing
    // it here would silently re-enable an exhausted button on every search.
    // It's not part of the search form anyway (it lives in the results
    // toolbar), so setSearchFormDisabled(false) below never touches it.
    phaseTimers.forEach(clearTimeout);
    setSearchFormDisabled(false);
  }
}

async function searchMore() {
  if (!state.lastSearchParams) return;
  if (els.searchMoreBtn.dataset.mode === "rescan") {
    state.rescanTried = true; // one rescan per search: if nothing turns up, the rest really can't be shown
    await executeSearch(state.lastSearchParams, { isRescan: true });
    return;
  }
  await executeSearch(state.lastSearchParams, { isMore: true });
}

async function runSearch(evt) {
  evt.preventDefault();
  const formData = new FormData(els.form);
  const params = buildSearchParams(formData);
  saveSearchFormState();

  // Resets this browser tab's OWN "Search more" bookkeeping -- a brand-new
  // search never sends variantSkips of its own, only "Search more" clicks
  // within the resulting page-nav session do. That's deliberate: it's
  // exactly what lets the server fall back to this signed-in user's own
  // persisted SearchProgress bookmark (see CompanyService.searchCompanies),
  // so a plain Search for filters you've searched before continues from
  // wherever you left off rather than always re-showing the same
  // top-of-registry leads.
  state.searchMoreVariantSkips = {};
  state.searchMoreSeenNpis = [];
  state.rescanTried = false;
  state.searchExhausted = false;

  await executeSearch(params);
}

// Switches which fetched page is on screen -- no re-fetch, just a re-render.
// Clears selection/expansion (they're tied to row indices, which don't carry
// meaning across pages) but leaves every page's own data untouched, so
// flipping back to an earlier page shows exactly what it showed originally.
function goToPage(index) {
  if (index < 0 || index >= state.resultPages.length) return;
  state.currentPage = index;
  state.selected.clear();
  state.expandedIndex = null;
  applyCurrentPage();
}

function applyCurrentPage() {
  window.dmeHooks.beforeRender?.(); // may reorder this page ("Keep related together")
  const page = state.resultPages[state.currentPage];
  state.companies = page ? page.companies : [];
  renderResults(page ? page.excludedAsClaimed : 0);
  updatePageNav();
}

function updatePageNav() {
  const total = state.resultPages.length;
  els.pageNav.hidden = total <= 1;
  els.pageInfo.textContent = `Page ${state.currentPage + 1} of ${total}`;
  els.pagePrevBtn.disabled = state.currentPage <= 0;
  els.pageNextBtn.disabled = state.currentPage >= total - 1;
}

function renderResults(excludedAsClaimed) {
  if (excludedAsClaimed !== undefined) state.excludedAsClaimed = excludedAsClaimed; // remembered across re-renders (e.g. a sort click)
  const { companies } = state;
  const excludedNote = state.excludedAsClaimed > 0 ? ` (${state.excludedAsClaimed} already claimed or owned by a teammate, filtered out)` : "";
  els.resultsCount.textContent = `${companies.length} lead${companies.length === 1 ? "" : "s"} found${excludedNote}`;
  els.selectAll.checked = companies.length > 0 && state.selected.size === companies.length;

  if (companies.length === 0) {
    els.resultsBody.innerHTML = emptyRowHtml(7, "search", "No leads matched that search", "Try a wider area, fewer specialties, or remove a filter chip above.");
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
  // Claim Lead, Export to Sheet, and Send to Disconnected have no "nothing
  // checked -> act on everything" fallback -- all three stay disabled until
  // at least one lead is actually checked.
  els.exportSheetsBtn.disabled = count === 0;
  els.exportSheetsLabel.textContent = count > 0 ? `Claim ${count} selected` : "Claim Lead";
  els.exportGoogleSheetBtn.disabled = count === 0;
  els.exportGoogleSheetLabel.textContent = count > 0 ? `Send ${count} to Sheet` : "Export to Sheet";
  els.sendDisconnectedBtn.disabled = count === 0;
  els.sendDisconnectedLabel.textContent = count > 0 ? `Send ${count} to Disconnected` : "Send to Disconnected";
  updateProspectKpis();
  updateSelectionBar();
  window.dmeHooks.onSelectionChanged?.();
}

// Small badges showing which enrichment sources actually contributed data
// for this lead (Foursquare or, as a paid fallback for whatever Foursquare
// didn't cover, Yelp -- OpenStreetMap, CMS Medicare, scraped website) --
// otherwise invisible, even though it affects how much to trust a given
// website/rating.
function sourceBadges(sources) {
  if (!sources) return "";
  const labels = [];
  // sources.places is true for either engine -- sources.yelp distinguishes
  // which one actually supplied THIS company's data (see CompanyService's
  // applyPlacesEnrichment_: Yelp only ever fills in what Foursquare missed).
  if (sources.places) labels.push(sources.yelp ? "YELP" : "FSQ");
  if (sources.osm) labels.push("OSM");
  if (sources.cms) labels.push("CMS");
  if (sources.website) labels.push("SITE");
  if (labels.length === 0) return "";
  return `<div class="source-badges">${labels.map((l) => `<span class="source-badge">${l}</span>`).join("")}</div>`;
}

// The provider's specialty as a readable tag (full text on hover), or a dash.
function specialtyPillHtml(text) {
  const label = String(text || "").trim();
  return label
    ? `<span class="specialty-pill" title="${escapeHtml(label)}">${escapeHtml(label)}</span>`
    : '<span class="specialty-none" title="No specialty on file">\u2014</span>';
}

function leadRowHtml(company, index) {
  const primaryContact = company.decisionMakers?.[0];
  const isSelected = state.selected.has(index);
  return `
    <tr class="lead-row ${isSelected ? "is-selected" : ""}" data-index="${index}" tabindex="0" aria-expanded="false" style="--i:${Math.min(index, 12)}">
      <td onclick="event.stopPropagation()"><input type="checkbox" class="row-check" data-index="${index}" ${isSelected ? "checked" : ""}></td>
      <td>
        <div class="company-name">${escapeHtml(company.name)}${locationsBadge(company.locations)}${priorContactBadgeHtml(company.priorContact)}${window.dmeHooks.relatedChip?.("prospect", index) || ""}</div>
        ${sourceBadges(company.sources)}
        ${leadSignalsHtml({
          phone: primaryContact?.phone || company.phone,
          website: company.website,
          hasContact: Boolean(company.decisionMakers?.length),
        })}
      </td>
      <td class="specialty-cell">${specialtyPillHtml(company.taxonomy?.description)}</td>
      <td class="mono">${escapeHtml(company.address?.city || "")}, ${escapeHtml(company.address?.state || "")}${window.dmeHooks.localTime ? `<div class="tz-line">${window.dmeHooks.localTime(company.address?.state)}</div>` : ""}</td>
      <td>${primaryContact ? escapeHtml(primaryContact.name) : '<span style="color:var(--muted)">—</span>'}</td>
      <td class="mono">${phoneCell(primaryContact?.phone, company.phone)}</td>
      <td><span class="chevron">▸</span></td>
    </tr>
  `;
}

// A lead that was claimed and worked before, then returned to Prospect. The
// Worker sends { status, at, by, note } (see attachPriorContactSafe).
function priorContactSummary(prior) {
  const parts = [];
  if (prior.status) parts.push(`marked "${prior.status}"`);
  if (prior.by) parts.push(`by ${prior.by}`);
  if (prior.at) parts.push(`on ${prior.at}`);
  return parts.join(" ") || "worked earlier";
}

function priorContactBadgeHtml(prior) {
  if (!prior) return "";
  return ` <span class="prior-badge" title="${escapeHtml("Contacted before: " + priorContactSummary(prior))}">Contacted before</span>`;
}

function priorContactBannerHtml(prior) {
  if (!prior) return "";
  return `<div class="prior-banner" role="note">
    <strong>Contacted before.</strong> ${escapeHtml(priorContactSummary(prior))}${prior.note ? `<span class="prior-note">${escapeHtml(prior.note)}</span>` : ""}
  </div>`;
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
  const addr = company.address || {};
  const cityLine = [addr.city, addr.state].filter(Boolean).join(", ");
  const fullAddress = [addr.line1, cityLine, addr.postalCode].filter(Boolean).join(", ");
  const dms = company.decisionMakers || [];
  const firstCallable = dms.findIndex((dm) => (dm.phone || "").trim());
  const mainPhone = (company.phone || "").trim();

  const contactsHtml = dms.map((dm, i) => {
    const phone = (dm.phone || "").trim();
    return `
      <div class="who-row">
        <div class="lead-avatar lead-avatar-sm" aria-hidden="true">${escapeHtml(leadInitials(dm.name))}</div>
        <div class="who-main">
          <div class="who-name">${escapeHtml(dm.name)}${dm.roleCategory ? `<span class="contact-role">${escapeHtml(dm.roleCategory)}</span>` : ""}</div>
          ${dm.title ? `<div class="who-sub">${escapeHtml(dm.title)}</div>` : ""}
          ${phone ? `<div class="who-sub">${escapeHtml(phone)}</div>` : '<div class="who-sub">No direct number</div>'}
        </div>
        <div class="who-actions">
          ${phone ? `<a class="btn ${i === firstCallable ? "btn-primary" : "btn-ghost"} btn-small" href="tel:${escapeHtml(phone)}">${SIGNAL_ICONS.phone}Call</a>
            <button type="button" class="btn btn-ghost btn-small" data-copy-phone="${escapeHtml(phone)}">${SIGNAL_ICONS.copy}Copy</button>` : ""}
          ${dm.email ? `<a class="btn btn-ghost btn-small" href="mailto:${escapeHtml(dm.email)}">Email</a>` : ""}
        </div>
      </div>`;
  }).join("");

  return `
    <tr class="detail-row">
      <td colspan="7">
        <div class="lead-card">
          <div class="lead-card-head">
            <div class="lead-avatar" aria-hidden="true">${escapeHtml(leadInitials(company.name))}</div>
            <div class="lead-card-title">
              <div class="lead-card-name">${escapeHtml(company.name)}</div>
              <div class="lead-card-sub">${escapeHtml([company.taxonomy?.description, cityLine].filter(Boolean).join(" · "))}</div>
            </div>
          </div>
          ${priorContactBannerHtml(company.priorContact)}
          ${window.dmeHooks.relatedBlock?.("prospect", index) || ""}
          <div class="detail-grid detail-grid-2">
            <div class="detail-block">
              <h4>Company</h4>
              ${factsHtml([
                ["Address", fullAddress ? `${escapeHtml(fullAddress)}<br><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}" target="_blank" rel="noopener">Open in Maps</a>` : "—"],
                ["Main line", mainPhone ? `<a href="tel:${escapeHtml(mainPhone)}">${escapeHtml(mainPhone)}</a>` : "—"],
                ["Website", company.website ? websiteLink(company.website) : '<span class="muted-note">No website found</span>'],
                ["Medicare (CMS)", escapeHtml(medicareSummary(company.medicare))],
              ])}
              <details class="more-details">
                <summary>More details</summary>
                ${factsHtml([
                  ["NPI", `<span class="mono">${escapeHtml(company.npi || "—")}</span>`],
                  ["NPPES updated", escapeHtml(company.lastUpdated || "—")],
                  ["Data sources", escapeHtml(sourcesList || "NPPES only")],
                ])}
              </details>
              <div class="brief-link-row"><button type="button" class="text-action" data-brief-index="${index}">${SPARK_ICON}Prep a call brief</button></div>
            </div>
            <div class="detail-block">
              <h4>Who to call</h4>
              ${contactsHtml || '<span class="muted-note">No decision maker identified yet.</span>'}
              ${!dms.length && mainPhone ? `<div class="who-actions" style="margin-top:10px"><a class="btn btn-primary btn-small" href="tel:${escapeHtml(mainPhone)}">${SIGNAL_ICONS.phone}Call main line</a></div>` : ""}
            </div>
          </div>
          ${branchLocationsHtml(company.locations) ? `<div class="detail-grid">${branchLocationsHtml(company.locations)}</div>` : ""}
          <div class="brief-box">
            <div class="brief-output" id="brief-${index}"></div>
          </div>
        </div>
      </td>
    </tr>
  `;
}

/* ---------- Empty states ---------- */

const EMPTY_ICONS = {
  search: '<circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M15.5 15.5L21 21" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  bookmark: '<path d="M6 3h12v18l-6-4.5L6 21Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4-2v-4Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
};

function emptyRowHtml(colspan, icon, title, body, action) {
  return `<tr class="empty-row"><td colspan="${colspan}">
    <div class="empty-state">
      <div class="empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${EMPTY_ICONS[icon]}</svg></div>
      <div class="empty-title">${escapeHtml(title)}</div>
      <p class="empty-body">${escapeHtml(body)}</p>
      ${action ? `<button type="button" class="btn btn-primary" data-empty-action="${action.action}">${escapeHtml(action.label)}</button>` : ""}
    </div>
  </td></tr>`;
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-empty-action]");
  if (!btn) return;
  if (btn.dataset.emptyAction === "go-prospect") switchView("search");
  else if (btn.dataset.emptyAction === "focus-search") {
    setFiltersCollapsed(false);
    document.getElementById("searchPanel").scrollIntoView({ behavior: "smooth", block: "nearest" });
    els.form.elements.npi.focus({ preventScroll: true });
  }
});

/* ---------- Row signal icons and hover quick actions ---------- */

const SIGNAL_ICONS = {
  phone: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 2h2.2l1 3-1.4 1c.7 1.5 1.9 2.7 3.4 3.4l1-1.4 3 1v2.2c0 .8-.7 1.5-1.5 1.5C6.9 12.7 3.3 9.1 3.3 4.2 3.3 3 3.5 2 3.5 2Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  web: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M2.5 8h11M8 2.5c1.6 1.7 2.3 3.5 2.3 5.5S9.6 11.8 8 13.5C6.4 11.8 5.7 10 5.7 8S6.4 4.2 8 2.5Z" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  person: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="5.5" r="2.6" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M3 13.5c.5-2.5 2.5-3.8 5-3.8s4.5 1.3 5 3.8" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  copy: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M10.5 3.5v-.5A1 1 0 0 0 9.5 2h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
};

// Tiny at-a-glance indicators (dimmed when missing) plus hover-only quick
// actions. Wrapped in a stopPropagation so using them never toggles the row.
function leadSignalsHtml({ phone, website, hasContact }) {
  const cleanPhone = (phone || "").trim();
  const signals = `
    <span class="signal ${cleanPhone ? "on" : ""}" title="${cleanPhone ? "Phone number on file" : "No phone number"}">${SIGNAL_ICONS.phone}</span>
    <span class="signal ${website ? "on" : ""}" title="${website ? "Has a website" : "No website"}">${SIGNAL_ICONS.web}</span>
    <span class="signal ${hasContact ? "on" : ""}" title="${hasContact ? "Decision maker identified" : "No decision maker yet"}">${SIGNAL_ICONS.person}</span>`;
  const actions = `
    ${cleanPhone ? `<button type="button" class="quick-btn" data-copy-phone="${escapeHtml(cleanPhone)}" title="Copy phone number">${SIGNAL_ICONS.copy}<span>Copy</span></button>` : ""}
    ${website ? `<a class="quick-btn" href="${escapeHtml(website)}" target="_blank" rel="noopener" title="Open website">${SIGNAL_ICONS.web}<span>Site</span></a>` : ""}`;
  return `<div class="row-meta" onclick="event.stopPropagation()"><span class="signals">${signals}</span><span class="row-quick">${actions}</span></div>`;
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-copy-phone]");
  if (!btn) return;
  e.stopPropagation(); // capture phase: runs before the row's own click handler
  const phone = btn.dataset.copyPhone;
  const done = () => showToast(`Copied ${phone}`);
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(phone).then(done, () => showToast("Couldn't copy — select the number manually", true));
  else showToast("Couldn't copy — select the number manually", true);
}, true);

/* ---------- Call-log (work mode) ---------- */

const SPARK_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l1.3 3.7L13 6.5l-3.7 1.3L8 11.5 6.7 7.8 3 6.5l3.7-1.3ZM12.5 10l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6Z" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>';

// Quick-remind chips: N days from now at 9:00 local time.
function remindDateIso(days) {
  const d = new Date();
  d.setDate(d.getDate() + Number(days));
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

// One-click call logging: an outcome chip and/or a note becomes a single
// timestamped call-log entry ("Voicemail — asked for a callback"), and a
// remind chip sets the callback. Uses the same endpoints as the old notes
// input and reminder dialog -- no new API.
async function saveCallLog(idx) {
  const root = document.querySelector(`.call-log[data-claimed-index="${idx}"]`);
  const lead = state.claimedLeads[idx];
  if (!root || !lead) return;
  const status = root.querySelector(".status-chip.active")?.dataset.status || "";
  const text = root.querySelector(".call-note").value.trim();
  const remind = root.querySelector(".remind-chip.active")?.dataset.remind || "";
  if (!status && !text && !remind) {
    showToast("Pick a result, add a note, or choose a reminder first", true);
    return;
  }
  const saveBtn = root.querySelector("[data-call-save]");
  saveBtn.disabled = true;
  let partlySaved = false;
  try {
    // One action, one story: the result sets the lead's status AND leads the
    // call-log entry, so the two can never disagree.
    if (status && status !== lead.status) {
      const saved = await apiPost("leads/status", { npi: lead.npi, status });
      lead.status = saved.status;
      partlySaved = true;
      syncRowStatusSelect(idx, saved.status);
    }
    if (status || text) {
      const data = await apiPost("leads/notes", { npi: lead.npi, note: [status, text].filter(Boolean).join(" — ") });
      lead.notes = data.notes;
      partlySaved = true;
      updateNotesPreview(idx, data.notes);
    }
    if (remind) {
      const data = await apiPost("leads/reminder", { npi: lead.npi, reminderAt: remindDateIso(remind) });
      lead.reminderAt = data.reminderAt;
    }
    showToast(remind ? "Call logged and reminder set" : "Call logged");
    refreshClaimedRowReminderBadge(idx); // also redraws the open card
    // A callback-style result with no reminder chosen: offer to set a time.
    if (status && isCallbackStatus(status) && !remind) openReminderModal(idx);
  } catch (err) {
    showToast(err.message, true);
    // Part of it may already be saved -- redraw so a retry can't log it twice.
    if (partlySaved) refreshClaimedDetailIfExpanded(idx);
  } finally {
    saveBtn.disabled = false;
  }
}

// Statuses offered as call results: the common ones first, then any custom
// statuses the team has added. "new" and "disconnected" aren't call results.
// The results of a single call, then any custom statuses still in use. Pipeline stages
// (meeting booked, contract sent...) are set by meetings and the status column, not offered here.
const CALL_RESULT_STATUSES = ["called", "voicemail", "no answer", "gatekeeper", "callback", "interested", "follow up", "not interested", "do not call"];
const STAGE_STATUSES = ["new", "meeting booked", "meeting held", "contract sent", "invoice sent", "onboarded", "disconnected"];
function callResultStatuses() {
  const extras = (state.statuses || []).filter((s) => !CALL_RESULT_STATUSES.includes(s) && !STAGE_STATUSES.includes(s));
  return [...CALL_RESULT_STATUSES, ...extras];
}

// Keeps the table row's status pill in step when the status is changed from the card.
function syncRowStatusSelect(idx, status) {
  const select = document.querySelector(`#claimedBody .status-select[data-index="${idx}"]`);
  if (!select) return;
  if (![...select.options].some((o) => o.value === status)) {
    const sentinel = select.querySelector(`option[value="${CSS.escape(ADD_STATUS_SENTINEL)}"]`);
    const html = statusOptionHtml(status, true);
    if (sentinel) sentinel.insertAdjacentHTML("beforebegin", html);
    else select.insertAdjacentHTML("beforeend", html);
  }
  select.value = status;
  select.className = `status-select status-${status.replace(/\s+/g, "-")}`;
}

// "+ New" chip: same custom-status flow as the table's "Add new status…".
function addStatusFromCard(root) {
  const custom = (prompt("New status name (e.g. \"follow-up 2wk\"):") || "").trim();
  if (!custom) return;
  const existing = [...root.querySelectorAll(".status-chip")].find((c) => c.dataset.status.toLowerCase() === custom.toLowerCase());
  if (existing) { root.querySelectorAll(".status-chip").forEach((c) => c.classList.remove("active")); existing.classList.add("active"); return; }
  if (!state.statuses.includes(custom)) {
    state.statuses.push(custom);
    populateStatusFilterOptions();
  }
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "choice-chip status-chip";
  chip.dataset.status = custom;
  chip.textContent = custom;
  root.querySelector("[data-add-status]").insertAdjacentElement("beforebegin", chip);
  chip.addEventListener("click", (e) => { e.stopPropagation(); pickChip(root, ".status-chip", chip); });
  pickChip(root, ".status-chip", chip);
}

function pickChip(root, selector, chip) {
  const wasActive = chip.classList.contains("active");
  root.querySelectorAll(selector).forEach((c) => c.classList.remove("active"));
  if (!wasActive) chip.classList.add("active"); // clicking the active chip again clears it
}

function wireCallLog(idx) {
  const root = document.querySelector(`.call-log[data-claimed-index="${idx}"]`);
  if (!root) return;
  root.querySelectorAll(".status-chip").forEach((chip) => chip.addEventListener("click", (e) => {
    e.stopPropagation();
    pickChip(root, ".status-chip", chip);
  }));
  root.querySelector("[data-add-status]")?.addEventListener("click", (e) => {
    e.stopPropagation();
    addStatusFromCard(root);
  });
  root.querySelectorAll(".remind-chip").forEach((chip) => chip.addEventListener("click", (e) => {
    e.stopPropagation();
    pickChip(root, ".remind-chip", chip);
  }));
  root.querySelector("[data-call-custom-reminder]")?.addEventListener("click", (e) => {
    e.stopPropagation();
    openReminderModal(idx);
  });
  root.querySelector("[data-call-save]")?.addEventListener("click", (e) => {
    e.stopPropagation();
    saveCallLog(idx);
  });
  root.querySelector(".call-note")?.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveCallLog(idx); }
  });
  document.querySelectorAll(`[data-meeting-open="${idx}"]`).forEach((btn) => btn.addEventListener("click", (e) => {
    e.stopPropagation();
    openMeetingModal(idx);
  }));
  document.querySelector(`[data-meeting-cancel="${idx}"]`)?.addEventListener("click", (e) => {
    e.stopPropagation();
    cancelMeeting(idx);
  });
  document.querySelector(`[data-clear-reminder="${idx}"]`)?.addEventListener("click", (e) => {
    e.stopPropagation();
    saveReminder(idx, "");
  });
}

/* ---------- Lead detail card helpers ---------- */

function leadInitials(name) {
  const words = String(name || "").replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] || "?").slice(0, 2);
  return letters.toUpperCase();
}

// rows: [label, already-escaped HTML value] pairs.
function factsHtml(rows) {
  return `<dl class="facts">${rows.map(([label, value]) =>
    `<div class="fact"><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`).join("")}</dl>`;
}

function websiteLink(url) {
  return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>` : "—";
}

// An opened lead is ONE thing: the small row is hidden and the big card, with the
// company's name as its header, takes its place. The header collapses it again,
// and carries a checkbox so the lead can still be ticked while it is open.
const CHEVRON_UP = '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 10 8 5.5 12.5 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function openCardInPlace(row) {
  const detail = row.nextElementSibling;
  const head = detail && detail.querySelector(".lead-card-head");
  if (!head) return;
  const box = row.querySelector(".row-check, .claimed-row-check");
  row.classList.add("is-open");
  head.setAttribute("role", "button");
  head.setAttribute("tabindex", "0");
  head.setAttribute("aria-expanded", "true");
  head.title = "Click to collapse";
  head.dataset.collapse = "1";
  head.insertAdjacentHTML("afterbegin",
    `<label class="lead-card-select" title="Select this lead"><input type="checkbox" data-card-select ${box && box.checked ? "checked" : ""}></label>`);
  head.insertAdjacentHTML("beforeend", `<span class="lead-card-collapse" aria-hidden="true">${CHEVRON_UP}<span>Collapse</span></span>`);
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  detail.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  head.focus({ preventScroll: true });
}

// One delegated listener per table (the rows are rebuilt often).
function wireCardCollapse(tbody, rowIndexOf, toggle, selector) {
  tbody.addEventListener("click", (e) => {
    const head = e.target.closest("[data-collapse]");
    if (!head || e.target.closest("a, button, input, textarea, select, label")) return;
    const row = head.closest(".detail-row")?.previousElementSibling;
    if (row) closeCard(row, rowIndexOf(row), toggle, selector);
  });
  tbody.addEventListener("keydown", (e) => {
    const head = e.target.closest("[data-collapse]");
    if (!head || e.target !== head) return;
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Escape") return;
    e.preventDefault();
    const row = head.closest(".detail-row")?.previousElementSibling;
    if (row) closeCard(row, rowIndexOf(row), toggle, selector);
  });
  tbody.addEventListener("change", (e) => {
    if (!e.target.matches("[data-card-select]")) return;
    const row = e.target.closest(".detail-row")?.previousElementSibling;
    const box = row && row.querySelector(".row-check, .claimed-row-check");
    if (!box) return;
    box.checked = e.target.checked;
    box.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function closeCard(row, idx, toggle, selector) {
  toggle(idx);
  const back = document.querySelector(selector.replace("%i", idx));
  if (back) {
    back.focus({ preventScroll: true });
    back.scrollIntoView({ block: "nearest" });
  }
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
  row?.classList.remove("is-open");
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
  openCardInPlace(row);
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

// Has no "nothing checked -> use everything" fallback -- sending leads to
// Disconnected/Claim/Sheet is a one-way or team-visible action, so it
// always requires an explicit, deliberate selection.
function getSelectedProspectCompanies() {
  return [...state.selected].map((i) => state.companies[i]);
}

// Removes just-claimed or just-disconnected companies from the in-memory
// Prospect results so they disappear from the table immediately, instead of
// lingering until the next search -- matched by the primary company's NPI
// (not branch-location NPIs), since that's how Prospect rows are keyed.
function removeCompaniesFromProspect(companies) {
  const npisToRemove = new Set(companies.map((c) => c.npi).filter(Boolean));
  if (npisToRemove.size === 0) return;
  state.companies = state.companies.filter((c) => !npisToRemove.has(c.npi));
  // state.companies is normally just a reference to the current page's own
  // array (see applyCurrentPage) -- the filter above makes a NEW array, so
  // the page's stored copy needs updating too, or navigating away and back
  // via the page-nav would silently bring the just-removed rows back.
  const currentPageEntry = state.resultPages[state.currentPage];
  if (currentPageEntry) currentPageEntry.companies = state.companies;
  state.selected.clear();
  state.expandedIndex = null;
  renderResults();
}

async function exportSheets() {
  const companies = getSelectedProspectCompanies();
  if (companies.length === 0) {
    showToast("Check at least one lead to claim", true);
    return;
  }
  const who = getSession()?.displayName || "you";
  // Claiming leads is a shared, team-visible action with no undo -- confirm
  // before writing.
  if (!confirm(`Claim ${companies.length} lead(s) under ${who}?`)) return;

  els.exportSheetsBtn.disabled = true; // prevents a double-click from double-claiming
  setStatus("busy", "Claiming…");
  try {
    const data = await apiPost("export/sheets", { companies });
    state.claimedLoaded = false; // claimed view is now stale
    // Claimed (or already-yours) leads leave Prospect, and so do ones a
    // teammate owns: the dialog names the owner, and there is nothing the rep
    // can do with them. Leads held for review stay -- that one is still
    // theirs to get. An older Worker without claimedNpis claimed everything
    // it was sent.
    const done = data.claimedNpis
      ? new Set([...data.claimedNpis, ...(data.alreadyClaimedNpis || []), ...(data.blocked || []).map((b) => b.npi)])
      : new Set(companies.map((c) => String(c.npi)));
    removeCompaniesFromProspect(companies.filter((c) => done.has(String(c.npi))));
    showClaimResult(data);
    setStatus("ready", "Ready");
  } catch (err) {
    showToast(err.message, true);
    setStatus("error", "Error");
  } finally {
    els.exportSheetsBtn.disabled = state.selected.size === 0;
  }
}

// Sending to the Sheet is refused for exactly what claiming would refuse
// (sql/014 runs the claim rules without writing anything): a lead a teammate
// owns can't be copied into this rep's tab, and one waiting on a Tier 2/3
// review waits there too. Same dialog as claiming, different first line.
function sheetExportCountText(data) {
  const n = data.rowsAdded || 0;
  if (n === 0) return "Nothing was sent to the Sheet.";
  return `Added ${n} row${n === 1 ? "" : "s"} to "${data.tab}".`;
}

const SHEET_EXPORT_DIALOG = {
  title: "Send to Sheet results",
  blockedHint: "These belong to a business someone else has claimed, so they can't be claimed or sent to your Sheet. Ask an admin if ownership should change.",
  heldHint: "These may be the same business as a teammate's lead. An admin will decide under Possible duplicates; they can be claimed or sent after that.",
};

function showSheetExportResult(data) {
  const refused = (data.blocked || []).length + (data.heldForReview || []).length;
  if (refused === 0) {
    showToast(sheetExportCountText(data), false, data.sheetUrl);
    return;
  }
  showClaimResult(data, sheetExportCountText(data), SHEET_EXPORT_DIALOG);
}

// Claiming is group-aware (sql/010): a lead whose business a teammate already
// owns is blocked, and a possible duplicate of a teammate's lead is held for
// admin review. A plain toast covers the all-claimed case; anything blocked
// or held gets a dialog, since the rep needs to know who owns what.
const MATCH_KEY_WORDS = { name: "name", state: "state", official: "authorized official", phone: "phone" };

function claimedCountText(data) {
  const n = data.rowsAdded || 0;
  return `Claimed ${n} lead${n === 1 ? "" : "s"} as ${data.claimedBy || "you"}.`;
}

const CLAIM_DIALOG = {
  title: "Claim results",
  blockedHint: "These belong to a business someone else has claimed, so they weren't claimed. Ask an admin if ownership should change.",
  heldHint: "These may be the same business as a teammate's lead. An admin will decide under Possible duplicates; try claiming again after that.",
};

function showClaimResult(data, summaryLead, wording) {
  const blocked = data.blocked || [];
  const held = data.heldForReview || [];
  if (blocked.length === 0 && held.length === 0) {
    showToast(summaryLead || claimedCountText(data));
    return;
  }

  const words = wording || CLAIM_DIALOG;
  els.claimResultTitle.textContent = words.title;
  els.claimResultBlockedHint.textContent = words.blockedHint;
  els.claimResultHeldHint.textContent = words.heldHint;

  const parts = [summaryLead || claimedCountText(data)];
  if (blocked.length) parts.push(`${blocked.length} already owned by a teammate — you can't claim or send ${blocked.length === 1 ? "it" : "them"}.`);
  if (held.length) parts.push(`${held.length} held for admin review.`);
  els.claimResultSummary.textContent = parts.join(" ");

  els.claimResultBlocked.hidden = blocked.length === 0;
  els.claimResultBlockedList.innerHTML = blocked
    .map((b) => {
      const owners = b.owners.length ? b.owners.join(", ") : "a teammate";
      const group = b.groupName && b.groupName.toLowerCase() !== String(b.companyName || "").toLowerCase() ? ` — part of ${escapeHtml(b.groupName)}` : "";
      return `
        <li>
          <div class="company-name">${escapeHtml(b.companyName || b.npi)}</div>
          <div class="claim-result-detail"><span class="mono">${escapeHtml(b.npi)}</span> · Owned by <strong>${escapeHtml(owners)}</strong>${group}</div>
        </li>`;
    })
    .join("");

  els.claimResultHeld.hidden = held.length === 0;
  els.claimResultHeldList.innerHTML = held
    .map((h) => {
      const matches = h.matches
        .map((m) => {
          const keys = m.matchedKeys.map((k) => MATCH_KEY_WORDS[k] || k).join(", ");
          return `<div class="claim-result-detail">May be the same as <strong>${escapeHtml(m.companyName || m.npi)}</strong> (<span class="mono">${escapeHtml(m.npi)}</span>, ${escapeHtml(m.ownerName)}) — same ${escapeHtml(keys)}</div>`;
        })
        .join("");
      return `
        <li>
          <div class="company-name">${escapeHtml(h.companyName || h.npi)} <span class="mono claim-result-npi">${escapeHtml(h.npi)}</span></div>
          ${matches}
        </li>`;
    })
    .join("");

  els.claimResultOverlay.hidden = false;
  els.claimResultCloseBtn.focus();
}

function closeClaimResult() {
  els.claimResultOverlay.hidden = true;
}

// Separate from claiming above -- this doesn't touch the app's own Claimed
// Leads view (backed by Supabase) at all, it just pastes a copy of the
// checked leads into the caller's tab in the actual shared Google Sheet, so
// leads stay selected/visible in Prospect afterward (unlike claiming, which
// removes them).
async function exportToGoogleSheet() {
  const companies = getSelectedProspectCompanies();
  if (companies.length === 0) {
    showToast("Check at least one lead to export to Sheet", true);
    return;
  }

  els.exportGoogleSheetBtn.disabled = true; // prevents a double-click from double-sending
  setStatus("busy", "Exporting to Sheet…");
  try {
    const data = await apiPost("export/google-sheet", { companies });
    // Sent leads stay in Prospect (this isn't claiming, so they are still
    // there to claim), but ones a teammate owns go -- same as claiming.
    const blocked = new Set((data.blocked || []).map((b) => String(b.npi)));
    if (blocked.size) removeCompaniesFromProspect(companies.filter((c) => blocked.has(String(c.npi))));
    showSheetExportResult(data);
    setStatus("ready", "Ready");
  } catch (err) {
    showToast(err.message, true);
    setStatus("error", "Error");
  } finally {
    els.exportGoogleSheetBtn.disabled = state.selected.size === 0;
  }
}

// Sends leads STRAIGHT to the shared Disconnected tab -- these were never
// claimed, so there's no per-teammate Claimed tab to remove them from
// first, just a fresh row landing directly in Disconnected. Deliberately
// requires an explicit checked selection (no "nothing checked -> send
// everything shown" fallback) since this is a one-way move.
async function sendProspectToDisconnected() {
  const companies = getSelectedProspectCompanies();
  if (companies.length === 0) {
    showToast("Check at least one lead to send to Disconnected", true);
    return;
  }
  if (!confirm(`Send ${companies.length} lead(s) straight to the shared Disconnected tab? This can't be undone.`)) return;

  els.sendDisconnectedBtn.disabled = true; // prevents a double-click from double-sending
  setStatus("busy", "Sending to Disconnected…");
  try {
    const data = await apiPost("export/disconnected", { companies });
    showToast(`Sent ${data.rowsAdded} lead(s) to Disconnected`, false, data.sheetUrl);
    removeCompaniesFromProspect(companies);
    setStatus("ready", "Ready");
  } catch (err) {
    showToast(err.message, true);
    setStatus("error", "Error");
  } finally {
    els.sendDisconnectedBtn.disabled = state.selected.size === 0;
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

/* ---------- Meetings (sql/020_lead_meetings.sql) ---------- */

const REMIND_BEFORE_LABELS = { 15: "15 minutes", 30: "30 minutes", 60: "1 hour", 120: "2 hours", 1440: "1 day", 2880: "2 days" };

function formatMeeting(meetingAt) {
  const d = new Date(meetingAt);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function meetingIsPast(lead) {
  const start = Date.parse(lead.meetingAt);
  return !isNaN(start) && start + (Number(lead.meetingDurationMin) || 30) * 60000 < Date.now();
}

function meetingBadgeHtml(lead) {
  if (!lead.meetingAt || !formatMeeting(lead.meetingAt)) return "";
  const past = meetingIsPast(lead);
  return `<span class="reminder-badge meeting-badge ${past ? "is-past" : ""}" title="${past ? "Past meeting" : "Booked meeting"}">${uiIcon("calendar")} ${escapeHtml(formatMeeting(lead.meetingAt))}</span>`;
}

// The Reminder column shows the callback badge and, below it, any booked meeting.
function reminderCellHtml(lead) {
  return reminderBadgeHtml(lead.reminderAt) + meetingBadgeHtml(lead);
}

function meetingMailto(lead) {
  const when = formatMeeting(lead.meetingAt);
  const subject = `Meeting with ${getSession()?.displayName || "our team"}: ${when}`;
  const body = `Hi${lead.contactName ? " " + lead.contactName.split(" ")[0] : ""},\n\nConfirming our meeting on ${when} (${lead.meetingDurationMin || 30} minutes).\n\nTalk soon,\n${getSession()?.displayName || ""}`;
  return `mailto:${encodeURIComponent(lead.meetingEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// The Meeting section of the work-mode card.
function meetingSectionHtml(lead, index) {
  if (!lead.meetingAt) {
    return `<span class="muted-note">Nothing booked</span>
      <div class="callback-actions"><button type="button" class="text-action" data-meeting-open="${index}">Book a meeting</button></div>`;
  }
  const past = meetingIsPast(lead);
  const remind = lead.meetingRemindBeforeMin ? `Reminder ${REMIND_BEFORE_LABELS[lead.meetingRemindBeforeMin] || lead.meetingRemindBeforeMin + " min"} before` : "No reminder";
  return `
    <div class="meeting-when ${past ? "is-past" : ""}">${uiIcon("calendar")} ${escapeHtml(formatMeeting(lead.meetingAt))}${past ? " · past" : ""}</div>
    <div class="who-sub">${escapeHtml(String(lead.meetingDurationMin || 30))} min · ${escapeHtml(remind)}</div>
    ${lead.meetingEmail ? `<div class="who-sub"><a href="mailto:${escapeHtml(lead.meetingEmail)}">${escapeHtml(lead.meetingEmail)}</a></div>` : ""}
    ${lead.meetingOpenerNotes ? `<div class="opener-notes"><div class="opener-label">Your opener</div><div class="opener-text">${escapeHtml(lead.meetingOpenerNotes)}</div></div>` : ""}
    <div class="callback-actions">
      <button type="button" class="text-action" data-meeting-open="${index}">${past ? "Book next" : "Edit"}</button>
      ${lead.meetingEmail ? `<a class="text-action" href="${meetingMailto(lead)}">Email confirmation</a>` : ""}
      <button type="button" class="text-action" data-meeting-cancel="${index}">Cancel meeting</button>
    </div>`;
}

function openMeetingModal(idx) {
  const lead = state.claimedLeads[idx];
  if (!lead) return;
  state.meetingTargetIndex = idx;
  const booked = Boolean(lead.meetingAt) && !meetingIsPast(lead);
  document.getElementById("meetingTitle").textContent = booked ? "Edit meeting" : "Book a meeting";
  document.getElementById("meetingContext").textContent = lead.name;
  const base = booked ? new Date(lead.meetingAt) : new Date(Date.now() + 24 * 3600000);
  if (!booked) base.setHours(10, 0, 0, 0);
  document.getElementById("meetingAtInput").value = toDatetimeLocalValue(base.toISOString());
  document.getElementById("meetingDuration").value = String(booked && lead.meetingDurationMin ? lead.meetingDurationMin : 30);
  document.getElementById("meetingRemind").value = String(booked ? (lead.meetingRemindBeforeMin || 0) : 60);
  document.getElementById("meetingEmail").value = (booked && lead.meetingEmail) || lead.email || "";
  document.getElementById("meetingOpener").value = (booked && lead.meetingOpenerNotes) || "";
  document.getElementById("meetingMarkStatus").checked = !booked && lead.status !== "meeting booked";
  els.meetingOverlay.hidden = false;
  document.getElementById("meetingAtInput").focus();
}

function closeMeetingModal() {
  els.meetingOverlay.hidden = true;
  state.meetingTargetIndex = null;
}

function applyMeetingToLead(lead, data) {
  lead.meetingAt = data.meetingAt;
  lead.meetingDurationMin = data.meetingDurationMin;
  lead.meetingRemindBeforeMin = data.meetingRemindBeforeMin;
  lead.meetingEmail = data.meetingEmail;
  lead.meetingOpenerNotes = data.meetingOpenerNotes;
  lead.notes = data.notes;
}

async function handleMeetingSubmit(evt) {
  evt.preventDefault();
  const idx = state.meetingTargetIndex;
  const lead = state.claimedLeads[idx];
  const when = document.getElementById("meetingAtInput").value;
  if (!lead || !when) return;
  const start = new Date(when);
  const saveBtn = document.getElementById("meetingSaveBtn");
  saveBtn.disabled = true;
  try {
    const data = await apiPost("leads/meeting", {
      npi: lead.npi,
      meetingAt: start.toISOString(),
      durationMinutes: Number(document.getElementById("meetingDuration").value),
      remindBeforeMinutes: Number(document.getElementById("meetingRemind").value),
      email: document.getElementById("meetingEmail").value.trim(),
      openerNotes: document.getElementById("meetingOpener").value.trim(),
      noteLabel: formatMeeting(start.toISOString()),
    });
    applyMeetingToLead(lead, data);
    updateNotesPreview(idx, data.notes);
    if (document.getElementById("meetingMarkStatus").checked && lead.status !== "meeting booked") {
      try {
        await apiPost("leads/status", { npi: lead.npi, status: "meeting booked" });
        lead.status = "meeting booked";
        if (!state.statuses.includes("meeting booked")) { state.statuses.push("meeting booked"); populateStatusFilterOptions(); }
        syncRowStatusSelect(idx, "meeting booked");
      } catch (err) {
        showToast("Meeting saved, but the status didn't update: " + err.message, true);
      }
    }
    closeMeetingModal();
    refreshClaimedRowReminderBadge(idx);
    window.dmeHooks.onClaimedChanged?.();
    showToast("Meeting saved");
  } catch (err) {
    showToast(err.message, true);
  } finally {
    saveBtn.disabled = false;
  }
}

async function cancelMeeting(idx) {
  const lead = state.claimedLeads[idx];
  if (!lead || !confirm(`Cancel your meeting with ${lead.name}? Your opener notes for it will be deleted.`)) return;
  try {
    const data = await apiPost("leads/meeting", { npi: lead.npi, meetingAt: "", noteLabel: "" });
    applyMeetingToLead(lead, data);
    updateNotesPreview(idx, data.notes);
    refreshClaimedRowReminderBadge(idx);
    showToast("Meeting cancelled");
  } catch (err) {
    showToast(err.message, true);
  }
}

function reminderBadgeHtml(reminderAt) {
  const urgency = reminderUrgency(reminderAt);
  if (!urgency) return "";
  return `<span class="reminder-badge reminder-${urgency}">${uiIcon("bell")} ${escapeHtml(formatReminder(reminderAt))}</span>`;
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
  if (cell) cell.innerHTML = reminderCellHtml(state.claimedLeads[idx]);
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
  loadDueLeads();
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
  const now = Date.now();
  (state.dueLeads || []).forEach((lead) => {
    if (lead.reminderAt) {
      const t = Date.parse(lead.reminderAt);
      if (!isNaN(t) && t <= now && state.notifiedReminders.get(lead.npi) !== lead.reminderAt) {
        state.notifiedReminders.set(lead.npi, lead.reminderAt);
        const notification = new Notification(`Callback due: ${lead.name}`, {
          body: `Reminder was set for ${formatReminder(lead.reminderAt)}`,
          tag: `dme-reminder-${lead.npi}`,
        });
        notification.onclick = () => window.focus();
      }
    }

    // Meeting reminder: fires once the "remind me N minutes before" moment
    // arrives, until the meeting has started.
    if (lead.meetingAt && lead.meetingRemindBeforeMin) {
      const start = Date.parse(lead.meetingAt);
      const remindAt = start - Number(lead.meetingRemindBeforeMin) * 60000;
      const key = `meeting:${lead.npi}`;
      if (!isNaN(start) && remindAt <= now && now < start && state.notifiedReminders.get(key) !== lead.meetingAt) {
        state.notifiedReminders.set(key, lead.meetingAt);
        const notification = new Notification(`Meeting soon: ${lead.name}`, {
          body: `${formatMeeting(lead.meetingAt)}${lead.meetingOpenerNotes ? " — your opener notes are in the lead card" : ""}`,
          tag: `dme-meeting-${lead.npi}`,
        });
        notification.onclick = () => window.focus();
      }
    }
  });
}

// The server's short list of callbacks that are due and meetings starting soon (scoped to
// the signed-in rep), fetched only when notifications are on.
async function loadDueLeads() {
  if (!notificationsSupported() || Notification.permission !== "granted") return;
  if (localStorage.getItem(NOTIFY_PREF_KEY) !== "true" || !getSession()) return;
  try {
    state.dueLeads = (await apiGet("leads/due")).leads || [];
    checkDueReminders();
  } catch (err) {
    console.log("[due] " + err.message);
  }
}

// Keeps the current selection if it's still a known status; otherwise falls
// back to "All statuses" -- a custom status could in principle disappear if
// no lead uses it anymore between loads.
function populateStatusFilterOptions() {
  const current = state.statusFilter || els.statusFilter.value;
  els.statusFilter.innerHTML =
    `<option value="">All statuses</option>` +
    state.statuses.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
  els.statusFilter.value = state.statuses.includes(current) ? current : "";
  state.statusFilter = els.statusFilter.value;
}

// What the Claimed table asks the server for: one page, already filtered and sorted.
function endOfTodayIso() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

function claimedQuery() {
  const query = {
    page: state.claimedPage,
    pageSize: state.claimedPageSize,
    status: state.statusFilter,
    q: state.claimedSearchQuery.trim(),
    overdue: state.claimedDueOnly ? "1" : "",
    endOfDay: endOfTodayIso(),
  };
  // Every claimed lead is yours, so sorting by "claimed by" can't change the order.
  if (state.claimedSortKey && state.claimedSortKey !== "claimedBy") {
    query.sort = state.claimedSortKey;
    query.dir = state.claimedSortDir > 0 ? "asc" : "desc";
  }
  if (state.claimedOpenNow && window.dmeTime) query.states = window.dmeTime.openStates().join(",");
  return query;
}

// Back to page one with a fresh sort, then load: used whenever a filter changes.
function reloadClaimedFromStart() {
  state.claimedPage = 1;
  state.claimedSortKey = null;
  state.claimedSortDir = 1;
  updateSortIndicators(els.claimedTable, null, 1);
  loadClaimedLeads();
}

// A lead from outside the table (Today, call mode) that a dialog needs by row index: use its
// row when it is on this page, otherwise keep it alongside the page (it has no row to update).
function claimedIndexFor(lead) {
  let idx = state.claimedLeads.findIndex((l) => l.npi === lead.npi);
  if (idx < 0) { state.claimedLeads.push(lead); idx = state.claimedLeads.length - 1; }
  return idx;
}

function updateClaimedPager() {
  const nav = document.getElementById("claimedPageNav");
  if (!nav) return;
  nav.hidden = state.claimedPages <= 1;
  setText("claimedPageInfo", `Page ${state.claimedPage} of ${state.claimedPages} \u00b7 ${state.claimedTotal.toLocaleString()} leads`);
  document.getElementById("claimedPagePrev").disabled = state.claimedPage <= 1;
  document.getElementById("claimedPageNext").disabled = state.claimedPage >= state.claimedPages;
}

function clearClaimedSelection() {
  state.claimedSelected.clear();
  els.claimedSelectAll.checked = false;
  els.claimedBody.querySelectorAll(".claimed-row-check").forEach((box) => { box.checked = false; });
  els.claimedBody.querySelectorAll(".lead-row").forEach((row) => row.classList.remove("is-selected"));
  updateClaimedSelectionUI();
}

function updateClaimedSelectionUI() {
  const count = state.claimedSelected.size;
  els.claimedSelectionChip.hidden = count === 0;
  els.claimedSelectionCount.textContent = `${count} selected`;
  // No "nothing checked -> act on everything" fallback here -- moving a
  // lead to Disconnected (or back to Prospect) is a one-way move, so both
  // stay disabled until at least one lead is actually checked.
  els.claimedSendDisconnectedBtn.disabled = count === 0;
  els.claimedReturnToProspectBtn.disabled = count === 0;
  els.claimedExportGoogleSheetBtn.disabled = count === 0;
  updateClaimedKpis();
  window.dmeHooks.onSelectionChanged?.();
}

// Returns whichever leads a "Send to Disconnected" or "Return to Prospect"
// click should act on -- only the checked subset. Deliberately has no
// "nothing checked -> every currently-shown lead" fallback, unlike the
// Prospect tab's export buttons.
function getCheckedClaimedLeads() {
  return [...state.claimedSelected].map((i) => state.claimedLeads[i]);
}

// Moves already-claimed leads OUT of wherever they currently live (a
// teammate's own Claimed tab) and INTO the shared Disconnected tab --
// unlike the Prospect version, this is a genuine move, not a fresh append,
// so the affected rows disappear from every teammate's Claimed Leads view.
// Requires an explicit checked selection -- no "nothing checked -> move
// everything shown" fallback, since this is a one-way move.
async function sendClaimedToDisconnected() {
  const leads = getCheckedClaimedLeads();
  if (leads.length === 0) {
    showToast("Check at least one lead to send to Disconnected", true);
    return;
  }
  const npis = leads.map((l) => l.npi).filter(Boolean);
  if (!confirm(`Move ${leads.length} lead(s) out of Claimed and into the shared Disconnected tab? This can't be undone.`)) return;

  els.claimedSendDisconnectedBtn.disabled = true; // prevents a double-click from double-moving
  setStatus("busy", "Moving to Disconnected…");
  try {
    const data = await apiPost("leads/disconnect", { npis });
    showToast(`Moved ${data.movedCount} lead(s) to Disconnected`);
    clearClaimedSelection();
    await loadClaimedLeads(); // moved rows should disappear from this view now
    setStatus("ready", "Ready");
  } catch (err) {
    showToast(err.message, true);
    setStatus("error", "Error");
  } finally {
    els.claimedSendDisconnectedBtn.disabled = state.claimedSelected.size === 0;
  }
}

// Moves already-claimed leads OUT of Claimed entirely -- unlike Disconnected,
// there's no destination tab to move them into: "Prospect" isn't a stored
// view, it's just live NPPES search results filtered against whatever's
// currently claimed. Deleting the row here is the whole feature -- the lead
// naturally resurfaces the next time anyone searches for it.
async function returnClaimedToProspect() {
  const leads = getCheckedClaimedLeads();
  if (leads.length === 0) {
    showToast("Check at least one lead to return to Prospect", true);
    return;
  }
  const npis = leads.map((l) => l.npi).filter(Boolean);
  if (!confirm(`Move ${leads.length} lead(s) out of Claimed and back into Prospect? They'll show up again the next time anyone searches for them.`)) return;

  els.claimedReturnToProspectBtn.disabled = true; // prevents a double-click from double-returning
  setStatus("busy", "Returning to Prospect…");
  try {
    const data = await apiPost("leads/return-to-prospect", { npis });
    showToast(`Returned ${data.returnedCount} lead(s) to Prospect`);
    clearClaimedSelection();
    await loadClaimedLeads(); // returned rows should disappear from this view now
    setStatus("ready", "Ready");
  } catch (err) {
    showToast(err.message, true);
    setStatus("error", "Error");
  } finally {
    els.claimedReturnToProspectBtn.disabled = state.claimedSelected.size === 0;
  }
}

// Claimed leads view's own version of exportToGoogleSheet -- pastes a copy
// of the checked leads into the caller's tab in the shared Google Sheet
// without touching their status in the app (unlike Send to Disconnected /
// Return to Prospect above, this doesn't move or remove them from here).
async function exportClaimedToGoogleSheet() {
  const leads = getCheckedClaimedLeads();
  if (leads.length === 0) {
    showToast("Check at least one lead to export to Sheet", true);
    return;
  }
  const npis = leads.map((l) => l.npi).filter(Boolean);

  els.claimedExportGoogleSheetBtn.disabled = true; // prevents a double-click from double-sending
  setStatus("busy", "Exporting to Sheet…");
  try {
    const data = await apiPost("export/google-sheet/claimed", { npis });
    showToast(`Added ${data.rowsAdded} row(s) to "${data.tab}"`, false, data.sheetUrl);
    setStatus("ready", "Ready");
  } catch (err) {
    showToast(err.message, true);
    setStatus("error", "Error");
  } finally {
    els.claimedExportGoogleSheetBtn.disabled = state.claimedSelected.size === 0;
  }
}

// silent=true is used by the background auto-refresh interval -- no
// skeleton flash (and no selection-clearing re-render) over a table the
// user might currently be looking at or working in, and a transient
// failure just logs instead of throwing an error toast every 30s. The
// interval caller also skips calling this at all while focus is inside
// the table or something's checked -- see switchView.
async function loadClaimedLeads(silent = false) {
  if (!silent) {
    els.claimedBody.innerHTML = skeletonRows(5, 10);
    els.staleNudge.hidden = true;
    document.getElementById("kpiClaimed")?.classList.add("is-loading");
  }
  els.refreshClaimedBtn.classList.add("is-spinning");
  try {
    // Always scoped server-side to the signed-in user's own claimed leads.
    const seq = ++state.claimedSeq;
    let data = await apiGet("leads/page", claimedQuery());
    // Leads left this view (moved, returned) and the page we were on no longer exists.
    if (data.leads.length === 0 && data.page > 1 && data.pages < data.page) {
      state.claimedPage = data.pages;
      data = await apiGet("leads/page", claimedQuery());
    }
    if (seq !== state.claimedSeq) return; // a newer request has been made since; its answer is the one to show
    state.statuses = data.statuses || [];
    populateStatusFilterOptions();
    state.claimedLoaded = true;
    state.claimedLoadedAt = Date.now();
    state.claimedPage = data.page;
    state.claimedPages = data.pages;
    state.claimedTotal = data.total;
    state.claimedCounts = data.counts;
    state.claimedLeadsAll = data.leads || []; // this page; the full list is no longer held in the browser
    renderClaimedLeads(state.claimedLeadsAll);
    updateClaimedPager();
    els.refreshClaimedBtn.classList.remove("is-spinning");
    updateClaimedUpdatedLabel();
    window.dmeHooks.onClaimedLoaded?.();
  } catch (err) {
    els.refreshClaimedBtn.classList.remove("is-spinning");
    document.getElementById("kpiClaimed")?.classList.remove("is-loading");
    if (silent) {
      console.log("[claimed] background refresh failed: " + err.message);
      return;
    }
    els.claimedBody.innerHTML = `<tr class="empty-row"><td colspan="10">${escapeHtml(err.message)}</td></tr>`;
    showToast(err.message, true);
  }
}

function renderClaimedLeads(leads) {
  state.claimedLeads = leads;
  state.claimedExpandedIndex = null;
  // Indices are about to be rebuilt from scratch -- a remembered selection
  // would silently point at the wrong rows otherwise (e.g. after a reload,
  // sort, or status-filter change).
  state.claimedSelected.clear();
  const total = state.claimedTotal;
  const everything = state.claimedCounts.total;
  els.claimedCount.textContent = total === everything
    ? `${total.toLocaleString()} claimed lead${total === 1 ? "" : "s"}`
    : `${total.toLocaleString()} of ${everything.toLocaleString()} claimed leads`;
  checkDueReminders();

  if (leads.length === 0) {
    const filtered = everything > 0;
    els.claimedBody.innerHTML = filtered
      ? emptyRowHtml(10, "filter", "No claimed leads match", "Clear the search box, status filter or overdue filter to see everything.")
      : emptyRowHtml(10, "bookmark", "No claimed leads yet", "Search in Prospect, check the leads you want, and claim them. They'll show up here.", { action: "go-prospect", label: "Go to Prospect" });
    updateClaimedSelectionUI();
    return;
  }

  els.claimedBody.innerHTML = leads.map((lead, i) => claimedLeadRowHtml(lead, i)).join("");
  attachClaimedRowHandlers();
  updateClaimedSelectionUI();
}

// A claimed lead is one NPI, but leadsRepo sends along the other NPIs in the
// same identity group (sql/010) -- branch locations of the same business, or
// NPIs an admin merged in Possible duplicates. The Prospect view folds
// branches into one search result; here each branch keeps its own row, since
// each has its own status, call log and reminder, so the link between them
// is shown as a badge instead.
const BRANCH_OWNERSHIP_LABELS = {
  yours: "yours",
  teammate: "claimed by a teammate",
  none: "not claimed",
  disconnected: "disconnected",
};

// The last NPPES refresh changed something about this provider that its rep
// needs to know -- a new phone, a new authorized official, a deactivation.
// It clears when an admin has decided on every open alert for the lead.
function providerChangeBadge(change) {
  if (!change) return "";
  const fields = (change.fields || []).map((field) => providerChangeFieldLabel(field).toLowerCase());
  const title = fields.length
    ? `NPPES changed ${fields.join(", ")} since this was claimed`
    : "NPPES data changed since this was claimed";
  return ` <span class="provider-change-badge" title="${escapeHtml(title)}">Provider data changed</span>`;
}

function providerChangeDetailHtml(change) {
  if (!change) return "";
  const fields = (change.fields || []).map((field) => `<li>${escapeHtml(providerChangeFieldLabel(field))}</li>`).join("");
  return `
    <div class="detail-block">
      <h4>NPPES changed this provider</h4>
      <ul class="provider-change-fields">${fields}</ul>
      <div class="claim-result-detail">
        ${change.groupReview
          ? "The name, phone or authorized official moved, so an admin is checking whether it still belongs with the same business."
          : "An admin has this in their queue."}
      </div>
    </div>
  `;
}

function claimedBranchesBadge(branches) {
  if (!branches || branches.length === 0) return "";
  const total = branches.length + 1;
  const mine = branches.filter((b) => b.ownership === "yours").length + 1;
  const title = mine === total
    ? `Same business: you hold all ${total} locations`
    : `Same business: ${total} locations, ${mine} of them yours`;
  return ` <span class="locations-badge" title="${escapeHtml(title)}">${total} locations</span>`;
}

function claimedBranchesHtml(branches) {
  if (!branches || branches.length === 0) return "";
  return `
    <div class="detail-block">
      <h4>Other locations of this business (${branches.length})</h4>
      ${branches.map((branch) => `
        <div class="contact-item">
          <div>
            ${escapeHtml(branch.name || "—")}
            <span class="contact-role">${escapeHtml(BRANCH_OWNERSHIP_LABELS[branch.ownership] || branch.ownership)}</span>
          </div>
          <div class="mono" style="font-size:13px; line-height:1.6;">
            NPI: ${escapeHtml(branch.npi)}<br>
            ${escapeHtml(branch.addressLine1 || "")}<br>
            ${escapeHtml(branch.city || "")}, ${escapeHtml(branch.state || "")} ${escapeHtml(branch.postalCode || "")}<br>
            ${escapeHtml(branch.phone || "—")}${branch.ownership === "yours" ? ` &middot; ${escapeHtml(branch.status)}` : ""}
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function claimedLeadRowHtml(lead, index) {
  const contactLine = lead.contactName
    ? `${escapeHtml(lead.contactName)}${lead.contactTitle ? ` — ${escapeHtml(lead.contactTitle)}` : ""}`
    : "";
  const isSelected = state.claimedSelected.has(index);
  return `
    <tr class="lead-row ${isSelected ? "is-selected" : ""}" data-claimed-index="${index}" tabindex="0" aria-expanded="false" style="--i:${Math.min(index, 12)}">
      <td onclick="event.stopPropagation()"><input type="checkbox" class="claimed-row-check" data-index="${index}" ${isSelected ? "checked" : ""}></td>
      <td>
        <div class="company-name">${escapeHtml(lead.name)}${claimedBranchesBadge(lead.branches)}${providerChangeBadge(lead.providerChange)}${window.dmeHooks.relatedChip?.("claimed", index) || ""}</div>
        ${contactLine ? `<div class="company-taxonomy">${contactLine}</div>` : ""}
        ${lead.taxonomy ? specialtyPillHtml(lead.taxonomy) : ""}
        ${leadSignalsHtml({
          phone: lead.contactPhone || lead.companyPhone,
          website: lead.website,
          hasContact: Boolean(lead.contactName),
        })}
      </td>
      <td class="mono">${escapeHtml(lead.city)}, ${escapeHtml(lead.state)}${window.dmeHooks.localTime ? `<div class="tz-line">${window.dmeHooks.localTime(lead.state)}</div>` : ""}</td>
      <td class="mono">${phoneCell(lead.contactPhone, lead.companyPhone)}</td>
      <td>${escapeHtml(lead.claimedBy || "—")}</td>
      <td class="mono">${escapeHtml((lead.lastUpdated || "").slice(0, 10))}</td>
      <td onclick="event.stopPropagation()">
        <select class="status-select status-${escapeHtml(lead.status).replace(/\s+/g, "-")}" data-npi="${escapeHtml(lead.npi)}" data-index="${index}">
          ${state.statuses.map((s) => statusOptionHtml(s, s === lead.status)).join("")}
          <option value="${ADD_STATUS_SENTINEL}">+ Add new status…</option>
        </select>
      </td>
      <td class="reminder-cell">${reminderCellHtml(lead)}</td>
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
  const medicareLine = lead.medicareClaims !== ""
    ? `${Number(lead.medicareClaims).toLocaleString()} claims` +
      (lead.medicareBeneficiaries !== "" ? `, ${Number(lead.medicareBeneficiaries).toLocaleString()} beneficiaries` : "") +
      (lead.medicarePayment !== "" ? `, $${Math.round(Number(lead.medicarePayment)).toLocaleString()} paid` : "")
    : "No CMS claims data found";
  const cityLine = [lead.city, lead.state].filter(Boolean).join(", ");
  const fullAddress = [lead.addressLine1, cityLine, lead.postalCode].filter(Boolean).join(", ");
  const callPhone = (lead.contactPhone || lead.companyPhone || "").trim();
  const urgency = lead.reminderAt ? reminderUrgency(lead.reminderAt) : null;

  return `
    <tr class="detail-row">
      <td colspan="10">
        <div class="lead-card">
          <div class="lead-card-head">
            <div class="lead-avatar" aria-hidden="true">${escapeHtml(leadInitials(lead.name))}</div>
            <div class="lead-card-title">
              <div class="lead-card-name">${escapeHtml(lead.name)}</div>
              <div class="lead-card-sub">${escapeHtml([lead.taxonomy, cityLine].filter(Boolean).join(" · "))}</div>
            </div>
          </div>
          ${window.dmeHooks.relatedBlock?.("claimed", index) || ""}
          <div class="detail-grid detail-grid-work">
            <div class="detail-block call-log" data-claimed-index="${index}">
              <h4>Log this call</h4>
              <div class="chip-row" role="group" aria-label="What happened. Also sets the lead's status.">
                ${callResultStatuses().map((s) => `<button type="button" class="choice-chip status-chip ${s === lead.status ? "is-current" : ""}" data-status="${escapeHtml(s)}" title="${s === lead.status ? "Current status" : "Sets the lead's status to this"}">${escapeHtml(s)}</button>`).join("")}
                <button type="button" class="choice-chip choice-chip-add" data-add-status title="Add a new status">+ New</button>
              </div>
              <div class="muted-note chip-hint">Picking a result also updates the lead's status${lead.status ? ` (now: ${escapeHtml(lead.status)})` : ""}.</div>
              <textarea class="call-note" rows="2" placeholder="Add a note about the call…" aria-label="Call note"></textarea>
              <div class="call-log-foot">
                <div class="chip-row" role="group" aria-label="Remind me">
                  <span class="muted-note">Remind me</span>
                  <button type="button" class="choice-chip remind-chip" data-remind="1">Tomorrow</button>
                  <button type="button" class="choice-chip remind-chip" data-remind="3">3 days</button>
                  <button type="button" class="choice-chip remind-chip" data-remind="7">1 week</button>
                  <button type="button" class="choice-chip" data-call-custom-reminder>Pick a time…</button>
                </div>
                <button type="button" class="btn btn-primary btn-small" data-call-save>Save</button>
              </div>
              <div class="reasons-title">History</div>
              ${notesHistoryHtml(lead.notes, index)}
            </div>
            <div class="detail-block">
              <h4>Contact</h4>
              ${lead.contactName ? `
                <div class="who-row">
                  <div class="lead-avatar lead-avatar-sm" aria-hidden="true">${escapeHtml(leadInitials(lead.contactName))}</div>
                  <div class="who-main">
                    <div class="who-name">${escapeHtml(lead.contactName)}${lead.contactRole ? `<span class="contact-role">${escapeHtml(lead.contactRole)}</span>` : ""}</div>
                    ${lead.contactTitle ? `<div class="who-sub">${escapeHtml(lead.contactTitle)}</div>` : ""}
                  </div>
                </div>` : '<span class="muted-note">No decision maker identified.</span>'}
              ${callPhone ? `
                <a class="btn btn-primary call-wide" href="tel:${escapeHtml(callPhone)}">${SIGNAL_ICONS.phone}Call ${escapeHtml(callPhone)}</a>
                <button type="button" class="text-action" data-copy-phone="${escapeHtml(callPhone)}">${SIGNAL_ICONS.copy}Copy number</button>` : ""}
              ${Number(lead.additionalContacts) > 0 ? `<div class="muted-note" style="margin-top:8px;">+${escapeHtml(lead.additionalContacts)} other contact(s) found (see Sheet)</div>` : ""}
              <div class="reminder-block next-callback">
                <div class="reasons-title">Next callback</div>
                ${lead.reminderAt
                  ? `<div class="reminder-current reminder-${urgency}">${uiIcon("bell")} ${escapeHtml(formatReminder(lead.reminderAt))}${urgency === "overdue" ? " · overdue" : ""}</div>
                     <div class="callback-actions"><button type="button" class="text-action" data-reminder-index="${index}">Change</button><button type="button" class="text-action" data-clear-reminder="${index}">Clear</button></div>`
                  : `<span class="muted-note">None set</span>
                     <div class="callback-actions"><button type="button" class="text-action" data-reminder-index="${index}">Set a reminder</button></div>`}
              </div>
              <div class="reminder-block next-callback meeting-block">
                <div class="reasons-title">Meeting</div>
                ${meetingSectionHtml(lead, index)}
              </div>
              <div class="sep-line"></div>
              <div class="who-sub">${escapeHtml(fullAddress)}</div>
              ${fullAddress ? `<a class="text-action" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}" target="_blank" rel="noopener">Open in Maps</a>` : ""}
              <div class="brief-link-row"><button type="button" class="text-action" data-claimed-brief-index="${index}">${SPARK_ICON}Prep a call brief</button></div>
            </div>
          </div>
          <details class="more-details more-details-card">
            <summary>Company details, branches and sources</summary>
            <div class="detail-grid">
              <div class="detail-block">
                <h4>Details</h4>
                ${factsHtml([
                  ["NPI", `<span class="mono">${escapeHtml(lead.npi || "—")}</span>`],
                  ["Company phone", escapeHtml(lead.companyPhone || "—")],
                  ["Website", websiteLink(lead.website)],
                  ["Medicare (CMS)", escapeHtml(medicareLine)],
                  ["NPPES updated", escapeHtml(lead.nppesLastUpdated || "—")],
                  ["Data sources", escapeHtml(sourcesList || "NPPES only")],
                ])}
              </div>
              ${claimedBranchesHtml(lead.branches)}
              ${providerChangeDetailHtml(lead.providerChange)}
            </div>
          </details>
          <div class="brief-box">
            <div class="brief-output" id="claimed-brief-${index}"></div>
          </div>
        </div>
      </td>
    </tr>
  `;
}

function renderMatchReviewBulkControls(reviews) {
  const eligible = reviews.filter((review) => matchReviewBulkEligibility(review).eligible);
  const excluded = reviews.length - eligible.length;
  const eligibleKeys = new Set(eligible.map(matchReviewKey));
  for (const key of state.matchReviewSelected) {
    if (!eligibleKeys.has(key)) state.matchReviewSelected.delete(key);
  }
  const selectedCount = state.matchReviewSelected.size;
  const allSelected = eligible.length > 0 && eligible.every((review) => state.matchReviewSelected.has(matchReviewKey(review)));
  els.matchReviewsSelectAll.disabled = eligible.length === 0;
  els.matchReviewsSelectAll.checked = allSelected;
  els.matchReviewsSelectAll.indeterminate = selectedCount > 0 && !allSelected;
  els.matchReviewsBulkMergeBtn.disabled = selectedCount === 0;
  els.matchReviewsBulkMergeBtn.textContent = selectedCount ? `Merge selected (${selectedCount})` : "Merge selected";
  els.matchReviewsBulkSummary.textContent = reviews.length
    ? `Eligible ${eligible.length} · selected ${selectedCount} · excluded ${excluded}`
    : "";
}

const BULK_MERGE_BATCH_SIZE = 20;

// "Merge all eligible" (registry comparison): count first, ask, then run
// server batches until none are left. The same button becomes Stop while it runs.
let mergeAllRunning = false;
let mergeAllStopRequested = false;
let mergeAllClock = null;

function formatElapsed(ms) {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// fraction = null shows the sliding "working" bar; a number fills the bar.
function setMergeAllProgress(text, fraction) {
  const box = document.getElementById("mergeAllProgress");
  box.hidden = false;
  box.classList.toggle("is-indeterminate", fraction === null);
  document.getElementById("mergeAllProgressText").textContent = text;
  document.getElementById("mergeAllProgressFill").style.width = fraction === null ? "" : `${Math.round(fraction * 100)}%`;
}

function stopMergeAllClock() {
  if (mergeAllClock) clearInterval(mergeAllClock);
  mergeAllClock = null;
}

async function mergeAllEligibleRegistry() {
  if (mergeAllRunning) {
    mergeAllStopRequested = true;
    els.matchReviewsMergeAllBtn.disabled = true;
    els.matchReviewsMergeAllBtn.textContent = "Stopping…";
    setMergeAllProgress("Stopping after the batch in progress…", null);
    return;
  }

  // Say something the instant it is clicked: counting can take several seconds.
  const btn = els.matchReviewsMergeAllBtn;
  btn.disabled = true;
  btn.textContent = "Counting…";
  document.querySelector("#mergeAllProgress .spinner").hidden = false;
  setMergeAllProgress("Counting the matches that can be merged…", null);
  document.getElementById("mergeAllProgressTime").textContent = "";

  let preview;
  try {
    preview = await apiGet("admin/match-reviews/merge-all-preview");
  } catch (err) {
    document.getElementById("mergeAllProgress").hidden = true;
    btn.disabled = false;
    btn.textContent = "Merge all eligible…";
    showToast(err.message, true);
    return;
  }
  const backToIdle = () => {
    document.getElementById("mergeAllProgress").hidden = true;
    btn.disabled = false;
    btn.textContent = "Merge all eligible…";
  };
  if (!preview.mergeable) {
    backToIdle();
    showToast(preview.total ? "Every matching pair is held back: different agents own parts of those groups." : "Nothing matches the merge rules.");
    return;
  }
  const ok = confirm(
    `Merge about ${preview.mergeable.toLocaleString()} pair${preview.mergeable === 1 ? "" : "s"}?\n\n` +
      "Rules: Tier 2 matches (three of name, state, official, phone), or the same authorized official AND phone. " +
      "Name-and-phone or name-and-official matches alone are not touched.\n\n" +
      (preview.blocked ? `${preview.blocked.toLocaleString()} matching pair${preview.blocked === 1 ? " is" : "s are"} held back because different agents own NPIs in those groups.\n\n` : "") +
      "Nobody's claims change, but a merge can't be undone from the app. It keeps going until none are left; you can stop it at any time."
  );
  if (!ok) {
    backToIdle();
    return;
  }

  mergeAllRunning = true;
  mergeAllStopRequested = false;
  const startedAt = Date.now();
  let after = null;
  let merged = 0;
  let held = 0;
  let failed = 0;
  let batches = 0;
  let error = null;

  const timeEl = document.getElementById("mergeAllProgressTime");
  const refresh = () => {
    const done = merged + held + failed;
    // The total is an estimate (merging one pair can settle others), so the bar
    // holds back from 100% until the run really ends.
    const fraction = preview.total ? Math.min(done / preview.total, 0.97) : null;
    btn.disabled = false;
    btn.textContent = `Stop — merged ${merged.toLocaleString()}`;
    setMergeAllProgress(
      `Merging… ${merged.toLocaleString()} merged` +
        (held ? ` · ${held.toLocaleString()} held back` : "") +
        (failed ? ` · ${failed.toLocaleString()} failed` : "") +
        ` · about ${preview.mergeable.toLocaleString()} to go`,
      fraction
    );
  };
  // The clock ticks every second even while a batch is in flight, so a slow
  // batch still shows the run is alive.
  mergeAllClock = setInterval(() => { timeEl.textContent = formatElapsed(Date.now() - startedAt); }, 1000);
  timeEl.textContent = "0:00";
  refresh();

  try {
    while (!mergeAllStopRequested) {
      let result;
      try {
        result = await apiPost("admin/match-reviews/merge-all", { after });
      } catch (err) {
        // A batch that timed out may still have merged some pairs; asking again
        // from the same place is safe because decided pairs are skipped.
        try {
          result = await apiPost("admin/match-reviews/merge-all", { after });
        } catch (retryErr) {
          error = retryErr;
          break;
        }
      }
      batches += 1;
      merged += result.merged?.length || 0;
      held += result.skipped?.length || 0;
      failed += result.failed?.length || 0;
      refresh();
      if (result.done || !result.next) break;
      after = result.next;
    }
  } finally {
    const stopped = mergeAllStopRequested;
    stopMergeAllClock();
    mergeAllRunning = false;
    mergeAllStopRequested = false;
    btn.disabled = false;
    btn.textContent = "Merge all eligible…";
    setMergeAllProgress(
      `${stopped ? "Stopped" : error ? "Paused" : "Finished"} in ${formatElapsed(Date.now() - startedAt)} — ` +
        `${merged.toLocaleString()} merged` + (held ? `, ${held.toLocaleString()} held back` : "") +
        (failed ? `, ${failed.toLocaleString()} failed` : "") + (error ? `. ${error.message}` : "."),
      stopped || error ? Math.min((merged + held + failed) / Math.max(preview.total, 1), 0.97) : 1
    );
    document.getElementById("mergeAllProgress").querySelector(".spinner").hidden = true;
    showToast(
      `${stopped ? "Stopped. " : error ? "Paused: " + error.message + " " : "Done. "}` +
        `Merged ${merged.toLocaleString()}` +
        (held ? `, held back ${held.toLocaleString()}` : "") +
        (failed ? `, ${failed.toLocaleString()} failed` : "") + ".",
      Boolean(error) || failed > 0
    );
    await Promise.all([loadMatchReviews(true), loadConflicts(true)]);
  }
}
async function bulkMergeSelectedMatchReviews() {
  const reviews = filteredMatchReviews().filter((review) => state.matchReviewSelected.has(matchReviewKey(review)));
  if (reviews.length === 0) return;
  const eligible = reviews.filter((review) => matchReviewBulkEligibility(review).eligible);
  const allReviews = filteredMatchReviews();
  const excluded = allReviews.filter((review) => !matchReviewBulkEligibility(review).eligible).length;
  const message = `Merge ${eligible.length} selected eligible pair${eligible.length === 1 ? "" : "s"}?` +
    (excluded ? ` ${excluded} pair${excluded === 1 ? " is" : "s are"} excluded from bulk selection because different agents own them.` : "") +
    " Each merge will be recorded with an automatic ownership-consistency reason.";
  if (!confirm(message)) return;

  els.matchReviewsBulkMergeBtn.disabled = true;
  els.matchReviewsBulkMergeBtn.textContent = `Merging 0/${eligible.length}…`;
  let merged = 0;
  let skipped = 0;
  let failedBatches = 0;
  try {
    for (let offset = 0; offset < eligible.length; offset += BULK_MERGE_BATCH_SIZE) {
      const batch = eligible.slice(offset, offset + BULK_MERGE_BATCH_SIZE);
      try {
        const result = await apiPost("admin/match-reviews/bulk-merge", {
          pairs: batch.map((review) => ({ leftNpi: review.leftNpi, rightNpi: review.rightNpi })),
        });
        merged += result.merged?.length || 0;
        skipped += (result.skipped?.length || 0) + (result.failed?.length || 0);
      } catch (err) {
        // A retry is safe: pairs completed before a timeout are no longer in
        // the pending queue and the Worker reports them as skipped.
        failedBatches += 1;
      }
      els.matchReviewsBulkMergeBtn.textContent = `Merging ${Math.min(offset + batch.length, eligible.length)}/${eligible.length}…`;
    }
    state.matchReviewSelected.clear();
    showToast(`Merged ${merged} pair${merged === 1 ? "" : "s"}.` +
      (skipped ? ` ${skipped} skipped or failed; refresh to review them.` : "") +
      (failedBatches ? ` ${failedBatches} batch${failedBatches === 1 ? "" : "es"} timed out or failed.` : ""));
    await Promise.all([loadMatchReviews(true), loadConflicts(true)]);
  } catch (err) {
    showToast(err.message, true);
    renderMatchReviewBulkControls(filteredMatchReviews());
  }
}

async function bookClaimedMeeting(index) {
  const lead = state.claimedLeads[index];
  if (!lead) return;

  const entered = (prompt("Meeting start time (local), e.g. 2026-09-23T21:30:") || "").trim();
  if (!entered) return;
  const start = new Date(entered);
  if (Number.isNaN(start.getTime())) {
    showToast("Enter a valid date and time", true);
    return;
  }

  const button = document.querySelector(`[data-book-meeting-index="${index}"]`);
  const result = document.getElementById(`booking-result-${index}`);
  if (button) button.disabled = true;
  if (result) result.textContent = "Booking…";

  try {
    const data = await apiPost("leads/book-meeting", {
      npi: lead.npi,
      startTime: start.toISOString(),
      durationMinutes: 30,
    });
    const label = data.displayText || "Meeting booked";
    if (result) {
      result.innerHTML = `<a href="${escapeHtml(data.eventUrl)}" target="_blank" rel="noopener"><strong>${escapeHtml(label)}</strong></a>${data.alreadyBooked ? " <span>(already booked)</span>" : ""}`;
    }
    showToast(data.alreadyBooked ? "Existing meeting found" : "Meeting booked");
  } catch (err) {
    if (result) result.textContent = err.message;
    showToast(err.message, true);
  } finally {
    if (button) button.disabled = false;
  }
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
  row?.classList.remove("is-open");
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
  openCardInPlace(row);
  document.querySelector(`[data-claimed-brief-index="${idx}"]`)?.addEventListener("click", (e) => {
    e.stopPropagation();
    generateClaimedBrief(idx);
  });
  document.querySelector(`[data-reminder-index="${idx}"]`)?.addEventListener("click", (e) => {
    e.stopPropagation();
    openReminderModal(idx);
  });
  document.querySelector(`[data-book-meeting-index="${idx}"]`)?.addEventListener("click", (e) => {
    e.stopPropagation();
    bookClaimedMeeting(idx);
  });
  wireNotesHistoryHandlers(idx);
  wireCallLog(idx);
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

  els.claimedBody.querySelectorAll(".claimed-row-check").forEach((box) => {
    box.addEventListener("change", (e) => {
      const idx = Number(e.target.dataset.index);
      const row = e.target.closest(".lead-row");
      if (e.target.checked) { state.claimedSelected.add(idx); row?.classList.add("is-selected"); }
      else { state.claimedSelected.delete(idx); row?.classList.remove("is-selected"); }
      els.claimedSelectAll.checked = state.claimedLeads.length > 0 && state.claimedSelected.size === state.claimedLeads.length;
      updateClaimedSelectionUI();
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
        status = (await apiPost("leads/status", { npi, status })).status; // as the server tidied it
        syncRowStatusSelect(Number(e.target.dataset.index), status);
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
  renderFilterChips();
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

/* "Last updated (year)" multi-select -- NPPES's own per-record "last
   updated" year, going back to 2015 (well before this app existed) since
   unlike the Claimed Leads "Updated" filter, this covers the registry's
   whole history, not just recent rep activity. Purely a local filter (see
   NppesService.searchProviders), so no NPPES query-variant fanout is
   needed -- any number of years can be OR'd together in one pass. */

const YEAR_RANGE_START = 2015;

const yearMultiselect = document.getElementById("yearMultiselect");
const yearOptionsContainer = document.getElementById("yearOptions");
setupMultiselectToggle(yearMultiselect);

(function () {
  const thisYear = new Date().getFullYear();
  for (let y = thisYear; y >= YEAR_RANGE_START; y--) {
    const label = document.createElement("label");
    label.className = "multiselect-option";
    label.innerHTML = `<input type="checkbox" name="lastUpdatedYears" value="${y}"><span>${y}</span>`;
    yearOptionsContainer.appendChild(label);
  }
})();

function updateYearSummary() {
  updateMultiselectSummary(yearMultiselect, 'input[name="lastUpdatedYears"]', "Any year", "years");
}

yearOptionsContainer.addEventListener("change", updateYearSummary);
document.getElementById("yearClearBtn").addEventListener("click", () => {
  yearOptionsContainer.querySelectorAll('input[name="lastUpdatedYears"]:checked').forEach((cb) => { cb.checked = false; });
  updateYearSummary();
});
updateYearSummary();

/* Specialty/taxonomy multi-select -- "All specialties" is mutually exclusive
   with the specific checkboxes below it (picking one clears "All", and
   checking "All" clears every specific pick), since "no filter" and "OR of
   these specific filters" are two different underlying queries, not a
   spectrum -- there's no meaningful "All + Prosthetic" combination.

   Unlike State/Year, this list isn't fixed -- it's fetched from the shared
   "Taxonomies" sheet tab (see loadTaxonomyOptions below) and can grow at
   any time (any signed-in teammate can add a new one via the search panel
   below), so the specific checkboxes are rendered dynamically rather than
   written directly in the HTML. Their change handling is wired via event
   delegation on taxonomyOptionsContainer (one listener, attached once)
   instead of per-checkbox listeners, so newly-added checkboxes work
   immediately without any re-wiring step. */

const taxonomyMultiselect = document.getElementById("taxonomyMultiselect");
const taxonomyAllCheckbox = document.getElementById("taxonomyAllCheckbox");
const taxonomyOptionsContainer = document.getElementById("taxonomyOptionsContainer");
setupMultiselectToggle(taxonomyMultiselect);

function updateTaxonomySummary() {
  updateMultiselectSummary(taxonomyMultiselect, 'input[name="taxonomyDescriptions"]', "All specialties", "specialties");
}

// Rebuilds the dynamic (non-"All") checkboxes from the server's current
// enabled list. Only the dynamically-added labels (marked with
// data-dynamic-taxonomy) are removed/replaced -- the static "All
// specialties" label at the top is never touched.
function renderTaxonomyOptions(taxonomies) {
  taxonomyOptionsContainer.querySelectorAll("[data-dynamic-taxonomy]").forEach((el) => el.remove());
  taxonomies.forEach((t) => {
    const label = document.createElement("label");
    label.className = "multiselect-option";
    label.dataset.dynamicTaxonomy = "true";
    // The checkbox's VALUE (what's actually submitted as taxonomyDescription
    // -- NPPES's own search field) is the Description column, not the
    // Facility Type label -- the server already falls back to Facility Type
    // for the 5 legacy rows that predate Description. Facility Type is only
    // ever the readable text shown next to the checkbox.
    label.innerHTML = `<input type="checkbox" name="taxonomyDescriptions" value="${escapeHtml(t.description)}"><span>${escapeHtml(t.facilityType)}</span>`;
    taxonomyOptionsContainer.appendChild(label);
  });
}

// The admin's chosen starting specialty, ticked for a brand-new session only: anything already
// remembered for this tab (a saved search, or a deliberate "All specialties") is left alone.
function applyDefaultTaxonomy(taxonomies) {
  if (sessionStorage.getItem(SEARCH_FILTERS_KEY)) return;
  const preferred = taxonomies.find((t) => t.defaultForSearch);
  if (!preferred) return;
  const box = [...taxonomyOptionsContainer.querySelectorAll('input[name="taxonomyDescriptions"]')].find((cb) => cb.value === preferred.description);
  if (!box) return;
  box.checked = true;
  taxonomyAllCheckbox.checked = false;
  updateTaxonomySummary();
}

async function loadTaxonomyOptions() {
  try {
    const data = await apiGet("taxonomies/list");
    renderTaxonomyOptions(data.taxonomies || []);
    // Re-applies just the taxonomy selection from sessionStorage now that
    // the checkboxes actually exist to check -- deliberately NOT the full
    // restoreSearchFormState() (see its comment on
    // restoreTaxonomySelectionFromSession for why that would be a bug here).
    restoreTaxonomySelectionFromSession();
    applyDefaultTaxonomy(data.taxonomies || []);
  } catch (err) {
    console.log("[Taxonomies] Failed to load options: " + err.message);
  }
}

taxonomyAllCheckbox.addEventListener("change", () => {
  if (taxonomyAllCheckbox.checked) {
    taxonomyOptionsContainer.querySelectorAll('input[name="taxonomyDescriptions"]').forEach((cb) => { cb.checked = false; });
  }
  updateTaxonomySummary();
});
taxonomyOptionsContainer.addEventListener("change", (e) => {
  if (!e.target.matches('input[name="taxonomyDescriptions"]')) return;
  if (e.target.checked) taxonomyAllCheckbox.checked = false; // picking a specific one cancels "All"
  updateTaxonomySummary();
});
document.getElementById("taxonomySelectAllBtn").addEventListener("click", () => {
  taxonomyAllCheckbox.checked = false;
  taxonomyOptionsContainer.querySelectorAll('input[name="taxonomyDescriptions"]').forEach((cb) => { cb.checked = true; });
  updateTaxonomySummary();
});
document.getElementById("taxonomyClearBtn").addEventListener("click", () => {
  taxonomyAllCheckbox.checked = true;
  taxonomyOptionsContainer.querySelectorAll('input[name="taxonomyDescriptions"]').forEach((cb) => { cb.checked = false; });
  updateTaxonomySummary();
});
updateTaxonomySummary();

/* ---------- Add taxonomy: search the shared reference sheet + enable one ---------- */

let taxonomySearchToken = 0; // guards against a slow earlier search response overwriting a newer one's results

function renderTaxonomyAddResults(results) {
  if (results.length === 0) {
    els.taxonomyAddResults.innerHTML = `<div class="taxonomy-add-empty">No matches</div>`;
    return;
  }
  els.taxonomyAddResults.innerHTML = results
    .map(
      (r) => `<button type="button" class="taxonomy-add-result" data-row-number="${r.rowNumber}" title="${escapeHtml(r.description || "")}">
        <span class="facility-type">${escapeHtml(r.facilityType)}</span><span class="taxonomy-code">${escapeHtml(r.code || "")}</span>
      </button>`
    )
    .join("");
}

async function runTaxonomySearch(keyword) {
  const thisSearch = ++taxonomySearchToken;
  if (!keyword.trim()) {
    els.taxonomyAddResults.innerHTML = "";
    return;
  }
  try {
    const data = await apiGet("taxonomies/search", { q: keyword });
    if (thisSearch !== taxonomySearchToken) return; // a newer keystroke's search already superseded this one
    renderTaxonomyAddResults(data.results || []);
  } catch (err) {
    if (thisSearch !== taxonomySearchToken) return;
    els.taxonomyAddResults.innerHTML = `<div class="taxonomy-add-empty">${escapeHtml(err.message)}</div>`;
  }
}

let taxonomySearchDebounce = null;
els.taxonomyAddInput.addEventListener("input", () => {
  clearTimeout(taxonomySearchDebounce);
  const keyword = els.taxonomyAddInput.value;
  taxonomySearchDebounce = setTimeout(() => runTaxonomySearch(keyword), 300);
});

els.taxonomyAddResults.addEventListener("click", async (e) => {
  const btn = e.target.closest(".taxonomy-add-result");
  if (!btn) return;
  const rowNumber = btn.dataset.rowNumber;
  const facilityType = btn.querySelector(".facility-type").textContent;
  btn.disabled = true;
  try {
    const data = await apiPost("taxonomies/enable", { rowNumber });
    const taxonomies = data.taxonomies || [];
    renderTaxonomyOptions(taxonomies);
    // Auto-checks the just-added one so it's immediately part of THIS search
    // too -- matched by rowNumber (not facilityType/description text, which
    // aren't guaranteed unique) to find its checkbox VALUE, which is the
    // Description text, not the facilityType label used elsewhere here.
    const justAdded = taxonomies.find((t) => String(t.rowNumber) === String(rowNumber));
    if (justAdded) {
      taxonomyOptionsContainer.querySelectorAll('input[name="taxonomyDescriptions"]').forEach((cb) => {
        if (cb.value === justAdded.description) cb.checked = true;
      });
    }
    taxonomyAllCheckbox.checked = false;
    updateTaxonomySummary();
    els.taxonomyAddInput.value = "";
    els.taxonomyAddResults.innerHTML = "";
    els.taxonomyAddPanel.hidden = true;
    showToast(`"${facilityType}" added -- now available to everyone`);
  } catch (err) {
    showToast(err.message, true);
    btn.disabled = false;
  }
});

els.taxonomyAddBtn.addEventListener("click", () => {
  els.taxonomyAddPanel.hidden = !els.taxonomyAddPanel.hidden;
  if (!els.taxonomyAddPanel.hidden) els.taxonomyAddInput.focus();
});

restoreSearchFormState();

/* ---------- Wiring ---------- */

els.form.addEventListener("submit", runSearch);
els.saveExcludeKeywordsBtn.addEventListener("click", saveExcludeKeywordsDefault);
// Note: the Exclude keywords and Company name (contains) chip inputs'
// entry-field keydown/blur handling (Enter/comma to add, Backspace-on-empty
// to remove last, blur to commit pending text) is already wired inside
// createChipInput() itself when each instance was created above.
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
wireCardCollapse(els.resultsBody, (row) => Number(row.dataset.index), toggleRowDetail, '.lead-row[data-index="%i"]');
wireCardCollapse(els.claimedBody, (row) => Number(row.dataset.claimedIndex), toggleClaimedRowDetail, '#claimedBody .lead-row[data-claimed-index="%i"]');
els.searchMoreBtn.addEventListener("click", searchMore);
els.pagePrevBtn.addEventListener("click", () => goToPage(state.currentPage - 1));
els.pageNextBtn.addEventListener("click", () => goToPage(state.currentPage + 1));
els.exportSheetsBtn.addEventListener("click", exportSheets);
els.exportGoogleSheetBtn.addEventListener("click", exportToGoogleSheet);
els.sendDisconnectedBtn.addEventListener("click", sendProspectToDisconnected);

els.loginForm.addEventListener("submit", handleLogin);
els.signOutBtn.addEventListener("click", handleSignOut);
els.suggestBtn.addEventListener("click", openSuggestionBox);
els.suggestionForm.addEventListener("submit", handleSuggestionSubmit);
els.suggestionCancelBtn.addEventListener("click", closeSuggestionBox);
els.suggestionOverlay.addEventListener("click", (e) => { if (e.target === els.suggestionOverlay) closeSuggestionBox(); });
els.refreshAdminBtn.addEventListener("click", loadAdminOverview);
els.adminUserLeadsCloseBtn.addEventListener("click", closeAdminUserLeads);
els.adminUserLeadsCloseX.addEventListener("click", closeAdminUserLeads);
els.adminUserLeadsOverlay.addEventListener("click", (e) => { if (e.target === els.adminUserLeadsOverlay) closeAdminUserLeads(); });
els.adminUserLeadsSearchInput.addEventListener("input", () => {
  state.adminLeadsSearchQuery = els.adminUserLeadsSearchInput.value;
  renderAdminUserLeadsRows();
});
wireSortableHeaders(els.adminUserLeadsTable, ADMIN_LEADS_DEFAULT_SORT_DIR, sortAdminUserLeads);
// Event delegation, not a per-row listener -- the conflict list is fully
// re-rendered on every load and after every resolution, same reasoning as the
// taxonomy checkboxes (see renderTaxonomyOptions' comment).
els.conflictsList.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-resolve-conflict]");
  if (!btn) return;
  openConflictResolve(btn.dataset.groupId);
});
els.conflictResolveForm.addEventListener("submit", handleConflictResolve);
els.conflictResolveCancelBtn.addEventListener("click", closeConflictResolve);
els.conflictResolveOverlay.addEventListener("click", (e) => {
  if (e.target === els.conflictResolveOverlay) closeConflictResolve();
});
els.claimResultCloseBtn.addEventListener("click", closeClaimResult);
els.claimResultOverlay.addEventListener("click", (e) => {
  if (e.target === els.claimResultOverlay) closeClaimResult();
});
els.matchReviewsList.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-match-review]");
  if (!btn) return;
  openMatchReview(btn.dataset.reviewKey, btn.dataset.matchReview);
});
els.matchReviewsList.addEventListener("change", (e) => {
  const box = e.target.closest("[data-match-review-select]");
  if (!box || box.disabled) return;
  if (box.checked) state.matchReviewSelected.add(box.dataset.reviewKey);
  else state.matchReviewSelected.delete(box.dataset.reviewKey);
  renderMatchReviewBulkControls(filteredMatchReviews());
});
els.matchReviewsSelectAll.addEventListener("change", (e) => {
  const reviews = filteredMatchReviews();
  reviews.forEach((review) => {
    const key = matchReviewKey(review);
    if (!matchReviewBulkEligibility(review).eligible) return;
    if (e.target.checked) state.matchReviewSelected.add(key);
    else state.matchReviewSelected.delete(key);
  });
  renderMatchReviews();
});
els.matchReviewsBulkMergeBtn.addEventListener("click", bulkMergeSelectedMatchReviews);
els.matchReviewsMergeAllBtn.addEventListener("click", mergeAllEligibleRegistry);
els.compareSourcesBtn.addEventListener("click", compareSearchSources);
els.providerChangesList.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-provider-change]");
  if (!btn) return;
  resolveProviderChange(btn.dataset.eventId, btn.dataset.providerChange);
});
els.providerChangesMoreBtn.addEventListener("click", () => {
  state.providerChangesLimit += PROVIDER_CHANGES_PAGE;
  renderProviderChanges();
});
els.matchReviewsTierFilter.addEventListener("change", () => {
  state.matchReviewsTier = els.matchReviewsTierFilter.value;
  state.matchReviewsLimit = MATCH_REVIEWS_PAGE;
  state.matchReviewSelected.clear();
  // Registry pages are filtered by the Worker, so a new tier means a new query.
  if (state.matchReviewsScope === "registry") loadMatchReviews();
  else renderMatchReviews();
});
els.matchReviewsScope.addEventListener("change", () => {
  state.matchReviewsScope = els.matchReviewsScope.value;
  state.matchReviewsLimit = MATCH_REVIEWS_PAGE;
  state.matchReviewSelected.clear();
  state.matchReviews = null;
  loadMatchReviews();
});
els.matchReviewsMoreBtn.addEventListener("click", () => {
  if (state.matchReviewsScope === "registry") {
    els.matchReviewsMoreBtn.disabled = true;
    loadMatchReviews(true, true).finally(() => { els.matchReviewsMoreBtn.disabled = false; });
    return;
  }
  state.matchReviewsLimit += MATCH_REVIEWS_PAGE;
  renderMatchReviews();
});
els.matchReviewForm.addEventListener("submit", handleMatchReviewSubmit);
els.matchReviewCancelBtn.addEventListener("click", closeMatchReview);
els.matchReviewOverlay.addEventListener("click", (e) => {
  if (e.target === els.matchReviewOverlay) closeMatchReview();
});
els.reminderForm.addEventListener("submit", handleReminderSubmit);
els.reminderCancelBtn.addEventListener("click", closeReminderModal);
els.reminderClearBtn.addEventListener("click", handleReminderClear);
els.reminderOverlay.addEventListener("click", (e) => { if (e.target === els.reminderOverlay) closeReminderModal(); });
document.getElementById("meetingForm").addEventListener("submit", handleMeetingSubmit);
document.getElementById("meetingCancelBtn").addEventListener("click", closeMeetingModal);
els.meetingOverlay.addEventListener("click", (e) => { if (e.target === els.meetingOverlay) closeMeetingModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !els.meetingOverlay.hidden) closeMeetingModal(); });
// Two toggle buttons exist (header + login card, so theme can be changed
// even before signing in) -- both share the .theme-toggle class.
document.querySelectorAll(".theme-toggle").forEach((btn) => btn.addEventListener("click", toggleTheme));
document.querySelectorAll(".view-tabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => switchView(tab.dataset.view));
});
// Both the search box and the status dropdown filter client-side over the
// already-fetched list -- no new server round-trip needed, since the whole
// (already user-scoped) set is loaded once by loadClaimedLeads.
// The search and the filters are answered by the server (one page of results), so the
// search waits a moment for typing to pause.
let claimedSearchTimer = null;
els.claimedSearchInput.addEventListener("input", () => {
  state.claimedSearchQuery = els.claimedSearchInput.value;
  clearTimeout(claimedSearchTimer);
  claimedSearchTimer = setTimeout(reloadClaimedFromStart, 300);
});
els.statusFilter.addEventListener("change", () => {
  state.statusFilter = els.statusFilter.value;
  reloadClaimedFromStart();
});
document.getElementById("claimedOpenNow")?.addEventListener("change", (e) => {
  state.claimedOpenNow = e.target.checked;
  reloadClaimedFromStart();
});
document.getElementById("claimedPagePrev")?.addEventListener("click", () => { state.claimedPage = Math.max(1, state.claimedPage - 1); loadClaimedLeads(); });
document.getElementById("claimedPageNext")?.addEventListener("click", () => { state.claimedPage = Math.min(state.claimedPages, state.claimedPage + 1); loadClaimedLeads(); });
els.refreshClaimedBtn.addEventListener("click", loadClaimedLeads);
els.staleNudge.addEventListener("click", loadClaimedLeads);
els.claimedSelectAll.addEventListener("change", (e) => {
  els.claimedBody.querySelectorAll(".claimed-row-check").forEach((box) => {
    box.checked = e.target.checked;
    const idx = Number(box.dataset.index);
    const row = box.closest(".lead-row");
    if (e.target.checked) { state.claimedSelected.add(idx); row?.classList.add("is-selected"); }
    else { state.claimedSelected.delete(idx); row?.classList.remove("is-selected"); }
  });
  updateClaimedSelectionUI();
});
els.claimedClearSelectionBtn.addEventListener("click", clearClaimedSelection);
els.claimedSendDisconnectedBtn.addEventListener("click", sendClaimedToDisconnected);
els.claimedReturnToProspectBtn.addEventListener("click", returnClaimedToProspect);
els.claimedExportGoogleSheetBtn.addEventListener("click", exportClaimedToGoogleSheet);

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
  if (++dueTick % 4 === 0) loadDueLeads();
}, 15000);
let dueTick = 0;

els.enableNotifications.addEventListener("change", handleNotificationToggle);
initNotificationToggle();
loadDueLeads();

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

/* ---------- UI shell: KPIs, filter chips, selection bar, quick actions ---------- */

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function updateProspectKpis() {
  const strip = document.getElementById("kpiSearch");
  if (!strip) return;
  // Totals cover every page fetched in this search ("Search more" adds pages);
  // the sub-line says how many are on the page being viewed.
  const list = state.resultPages.length ? state.resultPages.flatMap((p) => p.companies) : (state.companies || []);
  strip.hidden = state.resultPages.length === 0 && !strip.classList.contains("is-loading");
  const withPhone = list.filter((c) => (c.phone || "").trim() || (c.decisionMakers || []).some((dm) => (dm.phone || "").trim())).length;
  const medicareActive = list.filter((c) => typeof c.medicare?.totalClaims === "number" && c.medicare.totalClaims > 0).length;
  const share = (n) => (list.length ? `${Math.round((n / list.length) * 100)}% of results` : "\u00a0");
  setKpi("kpiFound", list.length);
  const hiddenTotal = state.resultPages.reduce((n, p) => n + (p.excludedAsClaimed || 0), 0);
  setText("kpiFoundSub", state.resultPages.length > 1
    ? `${(state.companies || []).length} on page ${state.currentPage + 1} of ${state.resultPages.length}`
    : (hiddenTotal > 0 ? `${hiddenTotal} already claimed, hidden` : "this search"));
  setKpi("kpiPhone", withPhone);
  setText("kpiPhoneSub", share(withPhone));
  setKpi("kpiMedicare", medicareActive);
  setText("kpiMedicareSub", share(medicareActive));
  setKpi("kpiSelected", state.selected.size);
}

// Counts up from whatever the card currently shows, so a refresh feels alive
// instead of snapping. Skipped for reduced-motion users and big jumps are
// capped at ~0.5s.
function setKpi(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const from = Number(el.dataset.value ?? 0);
  el.dataset.value = String(target);
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || from === target || el.offsetParent === null) {
    el.textContent = target.toLocaleString();
    return;
  }
  cancelAnimationFrame(Number(el.dataset.raf || 0));
  const start = performance.now();
  const duration = 480;
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(from + (target - from) * eased).toLocaleString();
    if (t < 1) el.dataset.raf = String(requestAnimationFrame(step));
  };
  el.dataset.raf = String(requestAnimationFrame(step));
}

function setClaimedBadge(total) {
  const badge = document.getElementById("claimedTabBadge");
  if (!badge) return;
  badge.hidden = !total;
  badge.textContent = total;
}

function updateClaimedKpis() {
  const c = state.claimedCounts;
  document.getElementById("kpiClaimed")?.classList.remove("is-loading");
  setKpi("kpiClaimedTotal", c.total);
  setKpi("kpiClaimedDue", c.due);
  setKpi("kpiClaimedReminders", c.withReminder);
  setKpi("kpiClaimedSelected", state.claimedSelected.size);
  updateReminderStrip();
  if (state.claimedLoaded) setClaimedBadge(c.total);
}

function updateSelectionBar() {
  const bar = document.getElementById("selectionBar");
  if (!bar) return;
  const count = state.selected.size;
  bar.hidden = !(count > 0 && state.view === "search");
  setText("selectionBarCount", `${count} selected`);
}

/* Overdue-callback strip (Claimed view) */

function updateReminderStrip() {
  const strip = document.getElementById("reminderStrip");
  if (!strip) return;
  const overdue = state.claimedCounts.overdue;
  strip.hidden = overdue === 0 && !state.claimedDueOnly;
  setText("reminderStripText", overdue === 0
    ? "No overdue callbacks."
    : `${overdue} callback${overdue === 1 ? " is" : "s are"} overdue.`);
  setText("reminderStripBtn", state.claimedDueOnly ? "Show all leads" : "Show only these");
}

document.getElementById("reminderStripBtn").addEventListener("click", () => {
  state.claimedDueOnly = !state.claimedDueOnly;
  reloadClaimedFromStart();
});

document.getElementById("selectionBarClaim").addEventListener("click", () => els.exportSheetsBtn.click());
document.getElementById("selectionBarClear").addEventListener("click", clearSelection);

// Summarises the current search form as removable chips, so the filters
// stay visible when the form itself is collapsed. Reads the DOM directly
// (not module-level consts) because updateMultiselectSummary() calls this
// while the page is still wiring up.
function renderFilterChips() {
  const host = document.getElementById("filterChips");
  const form = document.getElementById("searchForm");
  if (!host || !form) return;
  const value = (name) => (form.elements[name]?.value || "").trim();
  const checked = (name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)];
  const summarize = (items, noun) => (items.length <= 3 ? items.join(", ") : `${items.length} ${noun}`);
  const chips = [];

  if (value("npi")) {
    const lookup = classifyLookup(value("npi"));
    const label = { npi: `NPI ${lookup.value}`, phone: `Phone ${value("npi")}`, zip: `ZIP ${lookup.value}`, name: `Name lookup: ${value("npi")}` }[lookup.type];
    if (label) chips.push({ key: "npi", label });
  }
  if (form.elements.hasPhone && form.elements.hasPhone.checked) chips.push({ key: "hasPhone", label: "Has phone" });
  if (form.elements.hasDecisionMaker && form.elements.hasDecisionMaker.checked) chips.push({ key: "hasDecisionMaker", label: "Has decision maker" });
  if (form.elements.activeMedicare && form.elements.activeMedicare.checked) chips.push({ key: "activeMedicare", label: "Active Medicare biller" });
  const states = checked("states").map((cb) => cb.value);
  if (states.length) chips.push({ key: "states", label: `State: ${summarize(states, "states")}` });
  if (value("city")) chips.push({ key: "city", label: `City: ${value("city")}` });
  const specialties = checked("taxonomyDescriptions").map((cb) => cb.nextElementSibling?.textContent || cb.value);
  if (specialties.length) chips.push({ key: "taxonomy", label: `Specialty: ${summarize(specialties, "specialties")}` });
  const years = checked("lastUpdatedYears").map((cb) => cb.value);
  if (years.length) chips.push({ key: "years", label: `Updated: ${summarize(years, "years")}` });
  if (value("minMedicareClaims")) chips.push({ key: "minMedicareClaims", label: `Medicare claims ≥ ${value("minMedicareClaims")}` });
  const nameTerms = value("nameContainsTerms").split(",").map((t) => t.trim()).filter(Boolean);
  if (nameTerms.length) chips.push({ key: "nameContains", label: `Name has: ${summarize(nameTerms, "terms")}` });

  scheduleInsights();
  host.innerHTML = chips.length
    ? chips.map((c) => `<span class="filter-chip">${escapeHtml(c.label)}<button type="button" class="filter-chip-x" data-chip="${c.key}" aria-label="Remove filter: ${escapeHtml(c.label)}">×</button></span>`).join("")
    : "";
}

function removeFilterChip(key) {
  const form = els.form;
  if (["npi", "city", "minMedicareClaims"].includes(key)) form.elements[key].value = "";
  else if (["hasPhone", "hasDecisionMaker", "activeMedicare"].includes(key)) form.elements[key].checked = false;
  else if (key === "states") document.getElementById("stateClearBtn").click();
  else if (key === "taxonomy") document.getElementById("taxonomyClearBtn").click();
  else if (key === "years") document.getElementById("yearClearBtn").click();
  else if (key === "nameContains") nameContainsChipInput.setAll([]);
  renderFilterChips();
  showToast("Filter removed — search again to apply it");
}

document.getElementById("filterChips").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-chip]");
  if (btn) removeFilterChip(btn.dataset.chip);
});
["input", "change", "keyup", "focusout"].forEach((evt) => els.form.addEventListener(evt, renderFilterChips));
renderFilterChips();

const FILTERS_COLLAPSED_KEY = "dmeProspectorFiltersCollapsed";
function setFiltersCollapsed(collapsed) {
  document.getElementById("searchPanel").classList.toggle("is-collapsed", collapsed);
  const toggle = document.getElementById("filtersToggle");
  toggle.setAttribute("aria-expanded", String(!collapsed));
  setText("filtersToggleLabel", collapsed ? "Show filters" : "Hide filters");
  try { localStorage.setItem(FILTERS_COLLAPSED_KEY, collapsed ? "1" : "0"); } catch { /* storage can be blocked; the toggle still works for this page view */ }
}
document.getElementById("filtersToggle").addEventListener("click", () => {
  setFiltersCollapsed(!document.getElementById("searchPanel").classList.contains("is-collapsed"));
});
try { if (localStorage.getItem(FILTERS_COLLAPSED_KEY) === "1") setFiltersCollapsed(true); } catch { /* ignore */ }

/* Collapsible sidebar */

const NAV_PREF_KEY = "dmeProspectorNav"; // "collapsed" | "expanded" | unset (follow window width)

function readNavPref() {
  try { return localStorage.getItem(NAV_PREF_KEY); } catch { return null; }
}

function applyNavRail() {
  const pref = readNavPref();
  const rail = pref === "collapsed" || (pref !== "expanded" && window.innerWidth < 1280);
  document.documentElement.classList.toggle("nav-rail", rail);
  const btn = document.getElementById("navCollapse");
  btn.setAttribute("aria-expanded", String(!rail));
  btn.title = rail ? "Expand sidebar" : "Collapse sidebar";
}

document.getElementById("navCollapse").addEventListener("click", () => {
  const wasRail = document.documentElement.classList.contains("nav-rail");
  try { localStorage.setItem(NAV_PREF_KEY, wasRail ? "expanded" : "collapsed"); } catch { /* storage blocked: toggle only lasts until reload */ }
  document.documentElement.classList.toggle("nav-rail", !wasRail);
  const btn = document.getElementById("navCollapse");
  btn.setAttribute("aria-expanded", String(wasRail));
  btn.title = wasRail ? "Collapse sidebar" : "Expand sidebar";
});
window.addEventListener("resize", applyNavRail);
applyNavRail();

/* ---------- Search insights: availability, quick picks, progress, territory ---------- */

// Which "remove this" chip action undoes each suggestion the server offers.
const RELAX_TO_CHIP = {
  hasPhone: "hasPhone", hasDecisionMaker: "hasDecisionMaker", activeMedicare: "activeMedicare",
  minMedicareClaims: "minMedicareClaims", lastUpdatedYears: "years", city: "city", nameContains: "nameContains", taxonomy: "taxonomy",
};

function formatCount(n, capped) {
  return Number(n || 0).toLocaleString() + (capped ? "+" : "");
}

async function loadSearchCapabilities() {
  try {
    state.searchCaps = await apiGet("search/capabilities");
  } catch {
    state.searchCaps = { advanced: false }; // counts are a convenience; searching still works without them
  }
  applySearchCaps();
  applySourceTrialUi(); // hides the switch once everyone is on DME Desk
}

// Shows the controls this deployment supports and hides the rest, so nothing
// on screen promises something the server can't do.
function applySearchCaps() {
  const on = searchAdvancedAvailable();
  document.getElementById("resultsRefine").hidden = !on;
  document.getElementById("territoryBtn").hidden = !on;
  document.getElementById("availability").hidden = true;
  document.getElementById("quickPicks").hidden = true;
  document.getElementById("searchProgress").hidden = true;
  // Only promise phone, ZIP and owner-name lookups where they work.
  const label = document.querySelector("label.field:has(#lookupInput) > span");
  if (label) label.textContent = on ? "Lookup: NPI, phone, ZIP or name" : "NPI or company name (lookup)";
  document.getElementById("lookupInput").placeholder = on ? "NPI, (954) 907-8765, 33024, or a name" : "1234567890 or company name";
  updateLookupHint();
  if (on) scheduleInsights(0);
}

/* Admin trial: which provider table my searches read from */

function applySourceTrialUi() {
  const btn = document.getElementById("sourceTrialBtn");
  if (!btn) return;
  const isAdmin = Boolean(getSession()?.isAdmin);
  // Once the Worker itself reads from DME Desk there is nothing left to try.
  const caps = state.searchCaps;
  const everyoneOnDmedesk = Boolean(caps && caps.source === "dmedesk" && !caps.trial);
  btn.hidden = !isAdmin || everyoneOnDmedesk;
  if (btn.hidden) return;
  const on = sourceTrialActive();
  btn.title = on
    ? "Your searches read from DME Desk's own provider table (trial)."
    : "Admins only. Switch your searches to DME Desk's own provider table (trial).";
  btn.classList.toggle("is-on", on);
  btn.setAttribute("aria-pressed", String(on));
  document.getElementById("sourceTrialLabel").textContent = on ? "Search source: DME Desk (trial)" : "Search source: current";
}

document.getElementById("sourceTrialBtn").addEventListener("click", () => {
  const turningOn = !sourceTrialActive();
  try { localStorage.setItem(SOURCE_TRIAL_KEY, turningOn ? "on" : "off"); } catch { /* storage blocked: the choice lasts until reload */ }
  applySourceTrialUi();
  // Paging memory belongs to the source it was made on, so start clean.
  state.lastSearchParams = null;
  state.searchMoreSeenNpis = [];
  els.searchMoreBtn.hidden = true;
  loadSearchCapabilities();
  showToast(turningOn ? "Your searches now read from DME Desk's own provider table (trial). Search again." : "Your searches are back on the current source. Search again.");
});

function updateLookupHint() {
  const hint = document.getElementById("lookupHint");
  if (hint) hint.textContent = lookupHintText(document.getElementById("lookupInput").value);
}
document.getElementById("lookupInput").addEventListener("input", updateLookupHint);

// What the form currently asks for, in the shape the server's /search/* routes read.
function insightParams() {
  const params = buildSearchParams(new FormData(els.form));
  ["limit", "enrich", "scrape", "resetProgress"].forEach((key) => { delete params[key]; });
  return params;
}

function scheduleInsights(delay = 700) {
  if (!searchAdvancedAvailable()) return;
  clearTimeout(state.insightsTimer);
  document.getElementById("availability").classList.add("is-stale");
  state.insightsTimer = setTimeout(runInsights, delay);
}

async function runInsights() {
  // The form is locked while a search runs, and a locked form posts nothing.
  if (els.form.classList.contains("is-loading")) { scheduleInsights(600); return; }
  const seq = ++state.insightsSeq;
  const params = insightParams();
  try {
    const [insights, picks] = await Promise.all([
      apiGet("search/insights", params),
      loadQuickPicks(params),
    ]);
    if (seq !== state.insightsSeq) return; // a newer question is already on its way
    renderAvailability(insights);
    renderQuickPicks(picks, insights);
    renderSearchProgress(insights);
    state.insightsLeft = insights.lookup || insights.empty ? 0 : insights.left;
    syncSearchMoreButton();
  } catch (err) {
    if (seq !== state.insightsSeq) return;
    console.log("[insights] " + err.message);
    const box = document.getElementById("availability");
    box.classList.remove("is-stale");
    box.hidden = true;
  }
}

// Quick picks are counted on top of the location and specialty only, so they
// only change when those do.
async function loadQuickPicks(params) {
  const key = [params.states, params.city, params.taxonomyDescriptions].join("|");
  const cache = state.quickPickCache;
  if (cache && cache.key === key && Date.now() - cache.at < 2 * 60000) return cache.picks;
  const data = await apiGet("search/quickpicks", params).catch(() => null);
  const picks = data && data.picks;
  if (picks) state.quickPickCache = { key, at: Date.now(), picks };
  return picks || null;
}

// Sort and the "only show" boxes sit above the results and re-run the search
// when changed, so they behave like part of the table rather than a hidden setting.
document.getElementById("resultsRefine").addEventListener("change", () => {
  renderFilterChips();
  if (els.form.classList.contains("is-loading")) return;
  if (!state.resultPages.length) return; // nothing searched yet: the choice is used by the first search
  els.form.requestSubmit();
});

// The panel scrolls away with the page now, so the results bar offers a way back to it.
document.getElementById("editFiltersBtn").addEventListener("click", () => {
  setFiltersCollapsed(false);
  const panel = document.getElementById("searchPanel");
  const headerH = document.querySelector(".app-header").getBoundingClientRect().height;
  window.scrollTo({ top: Math.max(0, panel.getBoundingClientRect().top + window.scrollY - headerH - 12), behavior: "smooth" });
});

function renderAvailability(ins) {
  const box = document.getElementById("availability");
  box.classList.remove("is-stale");
  if (ins.lookup) { box.hidden = true; return; }
  box.hidden = false;
  box.title = "Counted by provider. A business a teammate already owns through another location is only spotted as you page through, so this can read a little high until you have.";
  if (ins.empty) {
    box.className = "availability is-hint";
    box.innerHTML = '<span class="avail-main">Pick a state, city or specialty to see how many leads are available.</span>';
    return;
  }
  const none = ins.matched === 0 || ins.left === 0;
  box.className = `availability${none ? " is-empty" : ""}`;
  let html = `<span class="avail-main"><strong>${formatCount(ins.matched, ins.capped.matched)}</strong> providers match
    <span class="avail-dot">·</span> <strong>${formatCount(ins.unclaimed, ins.capped.unclaimed)}</strong> not yet claimed
    <span class="avail-dot">·</span> <strong class="avail-left">${formatCount(ins.left, ins.capped.left)}</strong> left for you</span>`;
  if (ins.seenCount) html += `<span class="avail-sub">You've already seen ${formatCount(ins.seenCount)} from this search.</span>`;
  if (none) {
    const intro = ins.matched === 0 ? "Nothing matches these filters." : "You've been through everything here.";
    html += ins.suggestions && ins.suggestions.length
      ? `<div class="avail-suggest"><span>${intro} Try:</span>${ins.suggestions.map((sug) =>
          `<button type="button" class="suggest-btn" data-relax="${escapeHtml(sug.key)}">${escapeHtml(sug.label)}<b>+${formatCount(sug.left, sug.capped)}</b></button>`).join("")}</div>`
      : `<div class="avail-suggest"><span>${intro} Try a wider area or fewer filters.</span></div>`;
  }
  box.innerHTML = html;
}

document.getElementById("availability").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-relax]");
  if (btn && RELAX_TO_CHIP[btn.dataset.relax]) removeFilterChip(RELAX_TO_CHIP[btn.dataset.relax]);
});

/* Quick picks */

function quickPickActive(patch) {
  return Object.entries(patch).every(([key, value]) => {
    if (key === "lastUpdatedYears") return value.every((y) => els.form.querySelector(`input[name="lastUpdatedYears"][value="${y}"]`)?.checked);
    return Boolean(els.form.elements[key] && els.form.elements[key].checked);
  });
}

function setQuickPick(patch, on) {
  Object.entries(patch).forEach(([key, value]) => {
    if (key === "lastUpdatedYears") {
      value.forEach((y) => {
        const box = els.form.querySelector(`input[name="lastUpdatedYears"][value="${y}"]`);
        if (box) box.checked = on;
      });
      updateYearSummary();
    } else if (els.form.elements[key]) {
      els.form.elements[key].checked = on;
    }
  });
}

function renderQuickPicks(picks, ins) {
  const host = document.getElementById("quickPicks");
  if (!picks || !picks.length || (ins && ins.lookup)) { host.hidden = true; return; }
  host.hidden = false;
  host.innerHTML = '<span class="muted-note">Quick picks</span>' + picks.map((pick) => {
    const active = quickPickActive(pick.patch);
    const empty = pick.unclaimed === 0 && !active;
    return `<button type="button" class="pick-chip${active ? " is-active" : ""}" data-pick="${escapeHtml(pick.id)}" ${empty ? "disabled" : ""}
      title="${active ? "Click to remove this filter" : "Apply this filter"}">${escapeHtml(pick.label)}${pick.unclaimed == null ? "" : `<span class="pick-count">${formatCount(pick.unclaimed, pick.capped)}</span>`}</button>`;
  }).join("");
  host._picks = picks;
}

document.getElementById("quickPicks").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-pick]");
  const host = document.getElementById("quickPicks");
  const pick = btn && (host._picks || []).find((p) => p.id === btn.dataset.pick);
  if (!pick) return;
  const wasActive = quickPickActive(pick.patch);
  setQuickPick(pick.patch, !wasActive);
  renderFilterChips();
  showToast(wasActive ? `Removed "${pick.label}"` : `Applied "${pick.label}" — press Search to run it`);
});

/* "How much of this have I worked?" */

function renderSearchProgress(ins) {
  const box = document.getElementById("searchProgress");
  const worked = ins.seenCount || 0;
  if (ins.lookup || ins.empty || !state.resultPages.length || worked === 0) { box.hidden = true; return; }
  const total = worked + ins.left;
  document.getElementById("searchProgressFill").style.width = `${total ? Math.min(100, Math.round((worked / total) * 100)) : 100}%`;
  document.getElementById("searchProgressText").textContent = `${formatCount(worked)} worked · ${formatCount(ins.left, ins.capped.left)} left`;
  box.hidden = false;
}

/* Territory explorer */

const territory = {
  overlay: document.getElementById("territoryOverlay"),
  body: document.getElementById("territoryBody"),
  data: null,
  loadedAt: 0,
};

async function openTerritory() {
  territory.overlay.hidden = false;
  if (territory.data && !territory.data.pending && Date.now() - territory.loadedAt < 5 * 60000) { renderTerritory(territory.data); return; }
  territory.body.innerHTML = '<span class="muted-note">Counting leads…</span>';
  try {
    territory.data = await apiGet("search/territory");
    territory.loadedAt = Date.now();
    renderTerritory(territory.data);
  } catch (err) {
    territory.body.innerHTML = `<span class="muted-note">${escapeHtml(err.message)}</span>`;
  }
}

function renderTerritory(data) {
  if (!data.states.length || !data.specialties.length) {
    territory.body.innerHTML = data.pending
      ? `<span class="muted-note">Counting ${data.pending} specialt${data.pending === 1 ? "y" : "ies"} for the first time. Close this and open it again in a minute.</span>`
      : '<span class="muted-note">No enabled specialties with leads yet.</span>';
    return;
  }

  // The five richest state-and-specialty pairs, as shortcuts.
  const best = [];
  data.states.forEach((st) => data.specialties.forEach((sp) => {
    const cell = st.cells[sp.code];
    if (cell && cell.unclaimed) best.push({ st, sp, cell });
  }));
  best.sort((a, b) => b.cell.unclaimed - a.cell.unclaimed);
  const top = best.slice(0, 5);
  const topMax = top.length ? top[0].cell.unclaimed : 1;
  const bestHtml = top.map(({ st, sp, cell }) => `
    <button type="button" class="best-card" data-state="${escapeHtml(st.state)}" data-desc="${escapeHtml(sp.description || sp.label)}"
      title="${escapeHtml(`${st.state} · ${sp.label}: ${cell.unclaimed.toLocaleString()} unclaimed of ${cell.total.toLocaleString()}`)}">
      <span class="best-where">${escapeHtml(st.state)}</span>
      <span class="best-what">${escapeHtml(sp.label)}</span>
      <span class="best-count">${cell.unclaimed.toLocaleString()}</span>
      <span class="best-bar"><i style="width:${Math.max(8, Math.round((cell.unclaimed / topMax) * 100))}%"></i></span>
    </button>`).join("");

  territory.body.innerHTML = `
    <div class="territory-best">
      <div class="territory-label">Best bets</div>
      <div class="best-row">${bestHtml}</div>
    </div>
    <div class="territory-tools">
      <input type="search" id="territorySearch" placeholder="Filter states…" aria-label="Filter states" autocomplete="off">
      <div class="territory-legend" aria-hidden="true"><span>Fewer</span><i class="legend-bar"></i><span>More leads</span></div>
    </div>
    <div class="territory-scroll"><table class="territory-table"><thead></thead><tbody></tbody></table></div>
    <p class="muted-note territory-foot">Active organizations nobody has claimed or disconnected. Updated ${escapeHtml(new Date(data.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}.${data.pending ? ` Still counting ${data.pending} specialt${data.pending === 1 ? "y" : "ies"}: close this and open it again in a minute to see them.` : ""}</p>`;

  drawTerritoryTable("");
  document.getElementById("territorySearch").addEventListener("input", (e) => drawTerritoryTable(e.target.value));
}

function drawTerritoryTable(filterText) {
  const data = territory.data;
  const table = territory.body.querySelector(".territory-table");
  if (!data || !table) return;
  const needle = String(filterText || "").trim().toLowerCase();
  const nameOf = (code) => (typeof US_STATE_NAMES !== "undefined" && US_STATE_NAMES[code]) || code;
  const states = data.states.filter((st) => !needle || st.state.toLowerCase().includes(needle) || nameOf(st.state).toLowerCase().includes(needle));
  const max = Math.max(1, ...data.states.flatMap((st) => data.specialties.map((sp) => (st.cells[sp.code] || {}).unclaimed || 0)));

  table.querySelector("thead").innerHTML = `<tr><th scope="col" class="terr-corner">State</th>${data.specialties.map((sp) =>
    `<th scope="col" title="${escapeHtml(sp.label)}"><span>${escapeHtml(sp.label)}</span></th>`).join("")}</tr>`;

  table.querySelector("tbody").innerHTML = states.length ? states.map((st) => {
    const cells = data.specialties.map((sp) => {
      const cell = st.cells[sp.code];
      if (!cell || !cell.unclaimed) return '<td><span class="heat-empty">–</span></td>';
      const heat = Math.max(0.1, cell.unclaimed / max).toFixed(2);
      return `<td><button type="button" class="heat-cell${heat >= 0.55 ? " is-hot" : ""}" style="--heat:${heat}" data-state="${escapeHtml(st.state)}" data-desc="${escapeHtml(sp.description || sp.label)}"
        title="${escapeHtml(`${st.state} · ${sp.label}: ${cell.unclaimed.toLocaleString()} unclaimed of ${cell.total.toLocaleString()}`)}">${cell.unclaimed.toLocaleString()}</button></td>`;
    }).join("");
    return `<tr><th scope="row"><button type="button" class="heat-state" data-state="${escapeHtml(st.state)}" title="Search all of ${escapeHtml(nameOf(st.state))}">
      <b>${escapeHtml(st.state)}</b><em>${escapeHtml(nameOf(st.state))}</em><span>${st.unclaimed.toLocaleString()}</span></button></th>${cells}</tr>`;
  }).join("") : `<tr><td colspan="${data.specialties.length + 1}" class="terr-none">No state matches "${escapeHtml(filterText)}".</td></tr>`;
}

function applyTerritorySelection(stateCode, description) {
  stateOptionsContainer.querySelectorAll('input[name="states"]').forEach((box) => { box.checked = box.value === stateCode; });
  cityInput.value = "";
  updateStateSummary();
  refreshCityOptions();
  if (description) {
    taxonomyOptionsContainer.querySelectorAll('input[name="taxonomyDescriptions"]').forEach((box) => { box.checked = box.value === description; });
    taxonomyAllCheckbox.checked = false;
    updateTaxonomySummary();
  }
  territory.overlay.hidden = true;
  setFiltersCollapsed(false);
  renderFilterChips();
  showToast(`Filters set to ${stateCode}${description ? " and that specialty" : ""} — press Search to run it`);
}

document.getElementById("territoryBtn").addEventListener("click", openTerritory);
document.getElementById("territoryClose").addEventListener("click", () => { territory.overlay.hidden = true; });
territory.overlay.addEventListener("click", (e) => {
  if (e.target === territory.overlay) { territory.overlay.hidden = true; return; }
  const btn = e.target.closest("[data-state]");
  if (btn) applyTerritorySelection(btn.dataset.state, btn.dataset.desc || "");
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !territory.overlay.hidden) territory.overlay.hidden = true; });

/* Dropdown menus (saved searches, column chooser) */

function setupMenu(btn, panel) {
  const close = () => { panel.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const opening = panel.hidden;
    document.querySelectorAll(".menu-panel").forEach((p) => { p.hidden = true; });
    panel.hidden = !opening;
    btn.setAttribute("aria-expanded", String(opening));
  });
  document.addEventListener("click", (e) => { if (!panel.contains(e.target)) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  return close;
}

/* Row density */

const DENSITY_KEY = "dmeProspectorDensity"; // "compact" | unset (comfortable)

function applyDensity(compact) {
  document.documentElement.classList.toggle("density-compact", compact);
  const btn = document.getElementById("densityToggle");
  btn.setAttribute("aria-pressed", String(compact));
  btn.title = compact ? "Switch to comfortable rows" : "Switch to compact rows";
}

function toggleDensity() {
  const compact = !document.documentElement.classList.contains("density-compact");
  try { localStorage.setItem(DENSITY_KEY, compact ? "compact" : "comfortable"); } catch { /* storage blocked: lasts until reload */ }
  applyDensity(compact);
}
document.getElementById("densityToggle").addEventListener("click", toggleDensity);
applyDensity(document.documentElement.classList.contains("density-compact"));

/* Claimed table column chooser */

const CLAIMED_COLS_KEY = "dmeProspectorClaimedHiddenCols";
const columnsPanel = document.getElementById("columnsPanel");

function applyHiddenColumns(hidden) {
  els.claimedTable.className = els.claimedTable.className.replace(/\bhide-c\d+\b/g, "").trim();
  hidden.forEach((n) => els.claimedTable.classList.add(`hide-c${n}`));
  columnsPanel.querySelectorAll("input[data-col]").forEach((box) => { box.checked = !hidden.includes(Number(box.dataset.col)); });
}

function readHiddenColumns() {
  try {
    const list = JSON.parse(localStorage.getItem(CLAIMED_COLS_KEY) || "[]");
    return Array.isArray(list) ? list.filter((n) => [3, 4, 5, 6, 8, 9].includes(n)) : [];
  } catch { return []; }
}

setupMenu(document.getElementById("columnsBtn"), columnsPanel);
columnsPanel.addEventListener("change", () => {
  const hidden = [...columnsPanel.querySelectorAll("input[data-col]")].filter((b) => !b.checked).map((b) => Number(b.dataset.col));
  try { localStorage.setItem(CLAIMED_COLS_KEY, JSON.stringify(hidden)); } catch { /* storage blocked: lasts until reload */ }
  applyHiddenColumns(hidden);
});
applyHiddenColumns(readHiddenColumns());

/* "Updated 2 min ago" label next to Refresh */

function updateClaimedUpdatedLabel() {
  const el = document.getElementById("claimedUpdated");
  if (!el) return;
  if (!state.claimedLoadedAt) { el.textContent = ""; return; }
  const mins = Math.floor((Date.now() - state.claimedLoadedAt) / 60000);
  el.textContent = mins < 1 ? "Updated just now" : `Updated ${mins} min ago`;
}
setInterval(updateClaimedUpdatedLabel, 20000);

/* Saved searches (this browser only) */

const SAVED_SEARCHES_KEY = "dmeProspectorSavedSearches";
const MAX_SAVED_SEARCHES = 12;

function readSavedSearches() {
  try {
    const list = JSON.parse(localStorage.getItem(SAVED_SEARCHES_KEY) || "[]");
    return Array.isArray(list) ? list.filter((s) => s && typeof s.name === "string" && s.values && typeof s.values === "object") : [];
  } catch { return []; }
}

function writeSavedSearches(list) {
  try { localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(list)); return true; }
  catch { showToast("Couldn't save — this browser is blocking storage", true); return false; }
}

// Same shape saveSearchFormState() keeps in the session, minus the fields that
// shouldn't ride along in a preset: the per-account exclude-keywords default
// and the one-shot "start over" switch.
function currentFilterValues() {
  const formData = new FormData(els.form);
  const values = {};
  for (const el of els.form.elements) {
    if (!el.name || MULTI_VALUE_FIELDS.includes(el.name)) continue;
    values[el.name] = el.type === "checkbox" ? el.checked : formData.get(el.name) || "";
  }
  for (const key of MULTI_VALUE_FIELDS) values[key] = formData.getAll(key);
  delete values.excludeKeywords;
  delete values.resetProgress;
  return values;
}

function savedSearchSummary(values) {
  const parts = [];
  if (values.states?.length) parts.push(values.states.slice(0, 3).join(", ") + (values.states.length > 3 ? "…" : ""));
  if (values.taxonomyDescriptions?.length) parts.push(`${values.taxonomyDescriptions.length} specialt${values.taxonomyDescriptions.length === 1 ? "y" : "ies"}`);
  if (values.city) parts.push(values.city);
  if (values.minMedicareClaims) parts.push(`≥${values.minMedicareClaims} claims`);
  return parts.join(" · ") || "All leads";
}

// A preset saved before the quality filters existed doesn't mention them, and
// restoring only touches what a preset names -- so put them back to their
// defaults first, or the new search would inherit whatever was set before.
function resetAdvancedFields() {
  ["hasPhone", "hasDecisionMaker", "activeMedicare"].forEach((name) => { if (els.form.elements[name]) els.form.elements[name].checked = false; });
  if (els.form.elements.sortBy) els.form.elements.sortBy.value = "";
}

function applySavedSearch(search) {
  resetAdvancedFields();
  sessionStorage.setItem(SEARCH_FILTERS_KEY, JSON.stringify(search.values));
  restoreSearchFormState();
  renderFilterChips();
  setFiltersCollapsed(false);
  showToast(`Applied "${search.name}" — press Search to run it`);
  snapshotSavedSearch(search.name); // "new since last time" now counts from today
}

// A saved search's values (the form-state shape) -> the query the server's
// /search/* routes read, so it can be counted without touching the form.
function savedValuesToParams(values) {
  const params = {};
  for (const [key, value] of Object.entries(values)) {
    if (["enrich", "scrape", "limit", "excludeKeywords", "resetProgress"].includes(key)) continue;
    if (Array.isArray(value)) { if (value.length) params[key] = value.join(","); }
    else if (value === true) params[key] = "on";
    else if (value !== false && value !== "" && value != null) params[key] = String(value);
  }
  return applyLookupField(params);
}

async function countForSavedSearch(search) {
  if (!searchAdvancedAvailable()) return null;
  try {
    const ins = await apiGet("search/insights", savedValuesToParams(search.values));
    return ins.lookup || ins.empty ? null : ins;
  } catch {
    return null;
  }
}

// Remembers how many unclaimed leads a saved search held when it was saved or
// last used, so the menu can say how many are new since.
async function snapshotSavedSearch(name) {
  const entry = readSavedSearches().find((s) => s.name === name);
  if (!entry) return;
  const ins = await countForSavedSearch(entry);
  if (!ins) return;
  const list = readSavedSearches(); // re-read: the list may have changed while counting
  const current = list.find((s) => s.name === name);
  if (!current) return;
  current.snapshot = { unclaimed: ins.unclaimed, at: Date.now() };
  writeSavedSearches(list);
}

function paintSavedBadge(el, ins, snapshot) {
  if (!ins) { el.textContent = ""; el.className = "saved-badge"; return; }
  const now = ins.unclaimed;
  const capped = ins.capped.unclaimed;
  if (snapshot && !capped && now > snapshot.unclaimed) { el.className = "saved-badge is-new"; el.textContent = `+${now - snapshot.unclaimed} new`; }
  else if (snapshot && !capped && now < snapshot.unclaimed) { el.className = "saved-badge is-down"; el.textContent = `${snapshot.unclaimed - now} claimed`; }
  else { el.className = "saved-badge"; el.textContent = `${formatCount(now, capped)} available`; }
}

async function refreshSavedBadges() {
  if (!searchAdvancedAvailable()) return;
  const list = readSavedSearches();
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      const ins = await countForSavedSearch(list[i]);
      const el = document.querySelector(`[data-saved-badge="${i}"]`);
      if (el) paintSavedBadge(el, ins, list[i].snapshot);
    }
  };
  await Promise.all([worker(), worker(), worker()]); // three at a time, so a long list doesn't flood the server
}

function renderSavedSearches() {
  const list = readSavedSearches();
  document.getElementById("savedList").innerHTML = list.length
    ? list.map((s, i) => `
        <div class="saved-item">
          <button type="button" class="saved-apply" data-saved-apply="${i}">
            <span class="saved-name">${escapeHtml(s.name)}</span>
            <span class="saved-sub">${escapeHtml(savedSearchSummary(s.values))}</span>
            <span class="saved-badge" data-saved-badge="${i}"></span>
          </button>
          <button type="button" class="saved-del" data-saved-del="${i}" aria-label="Delete saved search ${escapeHtml(s.name)}">×</button>
        </div>`).join("")
    : '<div class="saved-empty">No saved searches yet. Set your filters, name them below, and save.</div>';

  const chips = document.getElementById("emptySavedSearches");
  if (chips) {
    chips.innerHTML = list.length
      ? `<span class="muted-note">Saved searches</span>${list.slice(0, 6).map((s, i) => `<button type="button" class="filter-chip saved-chip" data-saved-apply="${i}">${escapeHtml(s.name)}</button>`).join("")}`
      : "";
  }
}

const closeSavedMenu = setupMenu(document.getElementById("savedSearchesBtn"), document.getElementById("savedPanel"));
document.getElementById("savedForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("savedName");
  const name = input.value.trim();
  if (!name) { input.focus(); showToast("Give the search a name first", true); return; }
  const list = readSavedSearches().filter((s) => s.name.toLowerCase() !== name.toLowerCase());
  list.unshift({ name, values: currentFilterValues() });
  if (!writeSavedSearches(list.slice(0, MAX_SAVED_SEARCHES))) return;
  input.value = "";
  renderSavedSearches();
  showToast(`Saved "${name}"`);
  snapshotSavedSearch(name).then(refreshSavedBadges);
});
// Opening the menu counts each saved search (a few at a time) and shows what changed.
document.getElementById("savedSearchesBtn").addEventListener("click", () => {
  setTimeout(() => { if (!document.getElementById("savedPanel").hidden) refreshSavedBadges(); }, 0);
});
document.addEventListener("click", (e) => {
  const apply = e.target.closest("[data-saved-apply]");
  const del = e.target.closest("[data-saved-del]");
  if (!apply && !del) return;
  const list = readSavedSearches();
  if (apply) {
    const search = list[Number(apply.dataset.savedApply)];
    if (search) { applySavedSearch(search); closeSavedMenu(); }
  } else {
    list.splice(Number(del.dataset.savedDel), 1);
    writeSavedSearches(list);
    renderSavedSearches();
  }
});
renderSavedSearches();

/* Quick actions (Ctrl/Cmd+K) */

const palette = {
  overlay: document.getElementById("paletteOverlay"),
  input: document.getElementById("paletteInput"),
  list: document.getElementById("paletteList"),
  items: [],
  index: 0,
};

function paletteCommands() {
  const cmds = [
    { label: "Go to Today", hint: "View", run: () => switchView("today") },
    { label: "Go to Prospect", hint: "View", run: () => switchView("search") },
    { label: "Go to Claimed leads", hint: "View", run: () => switchView("claimed") },
  ];
  if (!els.adminTab.hidden) cmds.push({ label: "Go to Admin", hint: "View", run: () => switchView("admin") });
  cmds.push(
    { label: "Run search with current filters", hint: "Prospect", run: () => { switchView("search"); els.form.requestSubmit(); } },
    { label: "Look up an NPI or company name", hint: "Prospect", run: () => { switchView("search"); setFiltersCollapsed(false); els.form.elements.npi.focus(); } },
    { label: document.getElementById("searchPanel").classList.contains("is-collapsed") ? "Show filters" : "Hide filters", hint: "Prospect", run: () => document.getElementById("filtersToggle").click() },
    { label: "Switch light/dark theme", hint: "Appearance", run: toggleTheme },
    { label: document.documentElement.classList.contains("density-compact") ? "Use comfortable rows" : "Use compact rows", hint: "Appearance", run: toggleDensity },
    ...readSavedSearches().slice(0, 6).map((s) => ({
      label: `Apply saved search: ${s.name}`,
      hint: "Prospect",
      run: () => { switchView("search"); applySavedSearch(s); },
    })),
  );
  window.dmeHooks.paletteCommands?.().forEach((cmd) => cmds.push(cmd));
  if (!els.suggestBtn.hidden) cmds.push({ label: "Send a suggestion", hint: "Help", run: openSuggestionBox });
  if (!els.userChip.hidden) cmds.push({ label: "Sign out", hint: "Account", run: handleSignOut });
  return cmds;
}

function paletteMatches(query) {
  const q = query.trim().toLowerCase();
  const items = paletteCommands().filter((c) => !q || c.label.toLowerCase().includes(q));
  if (q.length >= 2 && state.paletteQuery === q) {
    (state.paletteHits || [])
      .slice(0, 6)
      .forEach((lead) => items.push({
        label: lead.name,
        hint: `Claimed · ${[lead.city, lead.state].filter(Boolean).join(", ")}`,
        run: () => {
          switchView("claimed");
          els.claimedSearchInput.value = lead.name;
          els.claimedSearchInput.dispatchEvent(new Event("input", { bubbles: true }));
        },
      }));
  }
  return items;
}

function renderPalette() {
  palette.items = paletteMatches(palette.input.value);
  palette.index = Math.min(palette.index, Math.max(0, palette.items.length - 1));
  palette.list.innerHTML = palette.items.length
    ? palette.items.map((item, i) => `<button type="button" role="option" aria-selected="${i === palette.index}" class="palette-item ${i === palette.index ? "active" : ""}" data-palette-index="${i}"><span>${escapeHtml(item.label)}</span><span class="palette-hint">${escapeHtml(item.hint)}</span></button>`).join("")
    : '<div class="palette-empty">Nothing matches that.</div>';
}

function openPalette() {
  if (!els.loginOverlay.hidden) return; // nothing to navigate before sign-in
  palette.input.value = "";
  palette.index = 0;
  palette.overlay.hidden = false;
  renderPalette();
  palette.input.focus();
}

function closePalette() {
  palette.overlay.hidden = true;
}

function runPaletteItem(i) {
  const item = palette.items[i];
  if (!item) return;
  closePalette();
  item.run();
}

document.getElementById("paletteBtn").addEventListener("click", openPalette);
let paletteSearchTimer = null;
palette.input.addEventListener("input", () => {
  palette.index = 0;
  renderPalette();
  const q = palette.input.value.trim().toLowerCase();
  clearTimeout(paletteSearchTimer);
  if (q.length < 2) { state.paletteHits = []; state.paletteQuery = ""; return; }
  paletteSearchTimer = setTimeout(async () => {
    try {
      const data = await apiGet("leads/page", { q, pageSize: 10, endOfDay: endOfTodayIso() });
      state.paletteHits = data.leads || [];
      state.paletteQuery = q;
      if (palette.input.value.trim().toLowerCase() === q) renderPalette();
    } catch { /* the quick actions still work without lead results */ }
  }, 250);
});
palette.list.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-palette-index]");
  if (btn) runPaletteItem(Number(btn.dataset.paletteIndex));
});
palette.overlay.addEventListener("click", (e) => { if (e.target === palette.overlay) closePalette(); });
palette.input.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const n = palette.items.length;
    if (!n) return;
    palette.index = (palette.index + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
    renderPalette();
    palette.list.querySelector(".active")?.scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter") {
    e.preventDefault();
    runPaletteItem(palette.index);
  }
});
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (palette.overlay.hidden) openPalette(); else closePalette();
  } else if (e.key === "Escape" && !palette.overlay.hidden) {
    closePalette();
  }
});

// Keeps the sticky search-panel/toolbar/thead stack (see the CSS comments on
// .search-panel/.results-toolbar/.results-table thead th) correctly offset
// from each other. Their heights genuinely change -- field-grid wraps at
// narrow widths, a selection chip appearing grows the toolbar, the search
// panel doesn't exist at all in the Claimed view -- so a fixed CSS value
// can't track them, but a live-measured custom property can.
(function setUpStickyOffsets() {
  const header = document.querySelector(".app-header");
  const searchPanel = document.querySelector(".search-panel");
  const toolbars = document.querySelectorAll(".results-toolbar");
  if (!header && !searchPanel && toolbars.length === 0) return;

  const root = document.documentElement;
  function refresh() {
    if (header) root.style.setProperty("--header-h", `${header.getBoundingClientRect().height}px`);
    // A hidden ancestor (display:none via the [hidden] attribute on
    // whichever view isn't active) makes getBoundingClientRect() report 0
    // height -- exactly the "not currently relevant" value this stack
    // wants, so no per-view branching is needed here at all.
    // The panel scrolls with the page (a tall form must never cover the
    // results), so it only pushes the toolbar and table header down if it has
    // been made sticky again.
    if (searchPanel) {
      const stuck = getComputedStyle(searchPanel).position === "sticky";
      root.style.setProperty("--search-panel-h", stuck ? `${searchPanel.getBoundingClientRect().height}px` : "0px");
    }
    let toolbarH = 0;
    toolbars.forEach((el) => { toolbarH = Math.max(toolbarH, el.getBoundingClientRect().height); });
    root.style.setProperty("--toolbar-h", `${toolbarH}px`);
  }

  const observer = new ResizeObserver(refresh);
  if (header) observer.observe(header);
  if (searchPanel) observer.observe(searchPanel);
  toolbars.forEach((el) => observer.observe(el));
  refresh();
})();

if (getSession()) {
  hideLogin();
  loadTaxonomyOptions(); // page was reloaded while already signed in -- this also re-applies restoreSearchFormState() once the taxonomy checkboxes exist
} else {
  showLogin();
}
