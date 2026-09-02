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
  return token ? { Authorization: `Bearer ${token}` } : {};
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
  adminUsersBody: document.getElementById("adminUsersBody"),
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

/* ---------- Sign in ---------- */

function showLogin() {
  els.loginOverlay.hidden = false;
  els.userChip.hidden = true;
  els.suggestBtn.hidden = true;
  els.adminTab.hidden = true;
  els.devNotice.hidden = true;
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
    els.devNotice.hidden = false; // shown fresh on every sign-in/page open, not persisted
    applyExcludeKeywordsDefaultIfBlank();
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
    saveSession({ token: data.token, username: data.username, displayName: data.displayName, excludeKeywords: data.excludeKeywords, isAdmin: data.isAdmin });
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

function renderAdminUsers(users) {
  if (users.length === 0) {
    els.adminUsersBody.innerHTML = `<tr class="empty-row"><td colspan="7">No users found.</td></tr>`;
    return;
  }
  els.adminUsersBody.innerHTML = users
    .map(
      (u) => `
    <tr>
      <td>${escapeHtml(u.displayName || "")}${u.isAdmin ? ' <span class="reminder-badge reminder-upcoming">admin</span>' : ""}</td>
      <td>${escapeHtml(u.username || "")}</td>
      <td class="mono">${u.claimedCount}</td>
      <td class="mono">${u.disconnectedCount}</td>
      <td class="mono">${u.suggestionsCount}</td>
      <td class="mono">${u.distinctSearches}</td>
      <td><button type="button" class="link-btn" data-admin-view-leads data-user-id="${escapeHtml(u.id)}" data-display-name="${escapeHtml(u.displayName || "")}">View leads</button></td>
    </tr>`
    )
    .join("");
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
      return `
      <div class="conflict-card">
        <div class="conflict-card-header">
          <div>
            <div class="conflict-title">${escapeHtml(conflict.groupName)}</div>
            <div class="conflict-subtitle">${escapeHtml(subtitle)}</div>
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

// silent=true is used by the background auto-refresh interval -- no
// skeleton flash over data the admin is currently looking at, and a
// transient failure (e.g. one flaky request) just logs instead of
// throwing an error toast every 30s.
async function loadAdminOverview(silent = false) {
  if (!silent) {
    els.adminUsersBody.innerHTML = skeletonRows(4, 7);
    els.adminSuggestionsBody.innerHTML = skeletonRows(3, 3);
  }
  // Conflicts load in parallel and own their own error handling, so a
  // failure there (e.g. the identity schema isn't installed) degrades to a
  // message in that one panel instead of blanking the whole dashboard.
  const conflictsLoaded = loadConflicts(silent);
  try {
    const data = await apiGet("admin/overview");
    renderAdminStats(data.stats);
    renderAdminUsers(data.users);
    renderAdminSuggestions(data.suggestions);
    state.adminLoaded = true;
  } catch (err) {
    if (silent) {
      console.log("[admin] background refresh failed: " + err.message);
      return;
    }
    showToast(err.message, true);
    els.adminUsersBody.innerHTML = `<tr class="empty-row"><td colspan="7">Failed to load.</td></tr>`;
    els.adminSuggestionsBody.innerHTML = `<tr class="empty-row"><td colspan="3">Failed to load.</td></tr>`;
  } finally {
    await conflictsLoaded;
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
  completeAddress: "Complete address on file",
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
  els.searchMoreBtn.hidden = false;
  els.searchMoreBtn.disabled = exhausted;
  els.searchMoreLabel.textContent = exhausted ? "No more leads found" : "Search more";
  els.searchMoreBtn.title = exhausted
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
}

async function executeSearch(params, { isMore = false } = {}) {
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
      state.sortKey = null; // fresh results start in the server's own order (score desc)
      state.sortDir = 1;
      updateSortIndicators(els.resultsTable, null, 1);
      goToPage(state.resultPages.length - 1);
    }

    if (!isMore && data.companies.length === 0) {
      els.searchMoreBtn.hidden = true; // nothing was found at all -- no point offering to page deeper
    } else {
      updateSearchMoreButton(data.exhaustedRegistry);
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
  const excludedNote = state.excludedAsClaimed > 0 ? ` (${state.excludedAsClaimed} already claimed, filtered out)` : "";
  els.resultsCount.textContent = `${companies.length} lead${companies.length === 1 ? "" : "s"} found${excludedNote}`;
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
  // Claim Lead, Export to Sheet, and Send to Disconnected have no "nothing
  // checked -> act on everything" fallback -- all three stay disabled until
  // at least one lead is actually checked.
  els.exportSheetsBtn.disabled = count === 0;
  els.exportSheetsLabel.textContent = count > 0 ? `Claim ${count} selected` : "Claim Lead";
  els.exportGoogleSheetBtn.disabled = count === 0;
  els.exportGoogleSheetLabel.textContent = count > 0 ? `Send ${count} to Sheet` : "Export to Sheet";
  els.sendDisconnectedBtn.disabled = count === 0;
  els.sendDisconnectedLabel.textContent = count > 0 ? `Send ${count} to Disconnected` : "Send to Disconnected";
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
    showToast(`Claimed ${data.rowsAdded} lead(s) as ${data.claimedBy || "you"}`);
    state.claimedLoaded = false; // claimed view is now stale
    removeCompaniesFromProspect(companies); // claimed leads shouldn't linger in the Prospect view
    setStatus("ready", "Ready");
  } catch (err) {
    showToast(err.message, true);
    setStatus("error", "Error");
  } finally {
    els.exportSheetsBtn.disabled = state.selected.size === 0;
  }
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
    showToast(`Added ${data.rowsAdded} row(s) to "${data.tab}"`, false, data.sheetUrl);
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

// Plain client-side substring match (no server round-trip) across the
// fields a rep would actually recall a claimed lead by -- name, NPI, city,
// state -- since the full set is already loaded in state.claimedLeadsAll.
function applyClaimedSearchFilter(leads) {
  const term = state.claimedSearchQuery.trim().toLowerCase();
  if (!term) return leads;
  return leads.filter((lead) => {
    return (
      (lead.name || "").toLowerCase().includes(term) ||
      (lead.npi || "").toLowerCase().includes(term) ||
      (lead.city || "").toLowerCase().includes(term) ||
      (lead.state || "").toLowerCase().includes(term)
    );
  });
}

function applyClaimedFilters(leads) {
  return applyClaimedSearchFilter(applyStatusFilter(leads));
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
  }
  try {
    // Always scoped server-side to the signed-in user's own claimed leads --
    // no params needed, there's no team-wide view to opt into anymore.
    const data = await apiGet("leads/list");
    state.statuses = data.statuses || [];
    populateStatusFilterOptions();
    state.claimedLoaded = true;
    state.claimedLoadedAt = Date.now();
    state.claimedSortKey = null; // fresh data starts in the server's own order (last updated desc)
    state.claimedSortDir = 1;
    updateSortIndicators(els.claimedTable, null, 1);
    state.claimedLeadsAll = data.leads || [];
    renderClaimedLeads(applyClaimedFilters(state.claimedLeadsAll));
  } catch (err) {
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
  els.claimedCount.textContent = `${leads.length} claimed lead${leads.length === 1 ? "" : "s"}`;
  checkDueReminders();

  if (leads.length === 0) {
    els.claimedBody.innerHTML = `<tr class="empty-row"><td colspan="10">Nothing claimed yet — export some leads to Sheets first.</td></tr>`;
    updateClaimedSelectionUI();
    return;
  }

  els.claimedBody.innerHTML = leads.map((lead, i) => claimedLeadRowHtml(lead, i)).join("");
  attachClaimedRowHandlers();
  updateClaimedSelectionUI();
}

function claimedLeadRowHtml(lead, index) {
  const contactLine = lead.contactName
    ? `${escapeHtml(lead.contactName)}${lead.contactTitle ? ` — ${escapeHtml(lead.contactTitle)}` : ""}`
    : "";
  const isSelected = state.claimedSelected.has(index);
  return `
    <tr class="lead-row ${isSelected ? "is-selected" : ""}" data-claimed-index="${index}" tabindex="0" aria-expanded="false">
      <td onclick="event.stopPropagation()"><input type="checkbox" class="claimed-row-check" data-index="${index}" ${isSelected ? "checked" : ""}></td>
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
      <td colspan="10">
        <div class="detail-grid">
          <div class="detail-block">
            <h4>Details</h4>
            <div class="mono" style="font-size:13px; line-height:1.8;">
              NPI: ${escapeHtml(lead.npi || "—")}<br>
              ${escapeHtml(lead.addressLine1 || "")}<br>
              ${escapeHtml(lead.city || "")}, ${escapeHtml(lead.state || "")} ${escapeHtml(lead.postalCode || "")}<br>
              Company phone: ${escapeHtml(lead.companyPhone || "—")}<br>
              Website: ${lead.website ? `<a href="${escapeHtml(lead.website)}" target="_blank">${escapeHtml(lead.website)}</a>` : "—"}<br>
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

async function loadTaxonomyOptions() {
  try {
    const data = await apiGet("taxonomies/list");
    renderTaxonomyOptions(data.taxonomies || []);
    // Re-applies just the taxonomy selection from sessionStorage now that
    // the checkboxes actually exist to check -- deliberately NOT the full
    // restoreSearchFormState() (see its comment on
    // restoreTaxonomySelectionFromSession for why that would be a bug here).
    restoreTaxonomySelectionFromSession();
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
// Event delegation, not a per-row listener -- adminUsersBody is fully
// re-rendered on every load, same reasoning as the taxonomy checkboxes
// (see renderTaxonomyOptions' comment).
// Same event-delegation reasoning as adminUsersBody -- the conflict list is
// fully re-rendered on every load and after every resolution.
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
els.adminUsersBody.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-admin-view-leads]");
  if (!btn) return;
  openAdminUserLeads(btn.dataset.userId, btn.dataset.displayName);
});
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
// Both the search box and the status dropdown filter client-side over the
// already-fetched list -- no new server round-trip needed, since the whole
// (already user-scoped) set is loaded once by loadClaimedLeads.
els.claimedSearchInput.addEventListener("input", () => {
  state.claimedSearchQuery = els.claimedSearchInput.value;
  state.claimedSortKey = null; // matches the status filter's "fresh view resets sort" behavior
  state.claimedSortDir = 1;
  updateSortIndicators(els.claimedTable, null, 1);
  renderClaimedLeads(applyClaimedFilters(state.claimedLeadsAll));
});
els.statusFilter.addEventListener("change", () => {
  state.statusFilter = els.statusFilter.value;
  state.claimedSortKey = null; // matches the other filters' "fresh view resets sort" behavior
  state.claimedSortDir = 1;
  updateSortIndicators(els.claimedTable, null, 1);
  renderClaimedLeads(applyClaimedFilters(state.claimedLeadsAll));
});
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

// Keeps the sticky search-panel/toolbar/thead stack (see the CSS comments on
// .search-panel/.results-toolbar/.results-table thead th) correctly offset
// from each other. Their heights genuinely change -- field-grid wraps at
// narrow widths, a selection chip appearing grows the toolbar, the search
// panel doesn't exist at all in the Claimed view -- so a fixed CSS value
// can't track them, but a live-measured custom property can.
(function setUpStickyOffsets() {
  const searchPanel = document.querySelector(".search-panel");
  const toolbars = document.querySelectorAll(".results-toolbar");
  if (!searchPanel && toolbars.length === 0) return;

  const root = document.documentElement;
  function refresh() {
    // A hidden ancestor (display:none via the [hidden] attribute on
    // whichever view isn't active) makes getBoundingClientRect() report 0
    // height -- exactly the "not currently relevant" value this stack
    // wants, so no per-view branching is needed here at all.
    if (searchPanel) root.style.setProperty("--search-panel-h", `${searchPanel.getBoundingClientRect().height}px`);
    let toolbarH = 0;
    toolbars.forEach((el) => { toolbarH = Math.max(toolbarH, el.getBoundingClientRect().height); });
    root.style.setProperty("--toolbar-h", `${toolbarH}px`);
  }

  const observer = new ResizeObserver(refresh);
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
