// The event log behind the App insights dashboard (sql/046): which requests are worth recording, and
// what exactly gets stored. Pure, so it is tested without a database.
//
// Privacy: no request bodies, no typed text, no phone numbers or NPIs. A search keeps only its state(s),
// specialty and the NAMES of the filters used.

// Features worth counting, by the request that proves they were used.
export const FEATURES = [
  { name: "call_tap", label: "Tapped a phone number", match: ["POST /leads/dial"] },
  { name: "note", label: "Wrote a call note", match: ["POST /leads/notes", "POST /leads/notes/replace"] },
  { name: "status_change", label: "Changed a lead's status", match: ["POST /leads/status"] },
  { name: "callback", label: "Set a callback reminder", match: ["POST /leads/reminder"] },
  { name: "book_meeting", label: "Booked a meeting", match: ["POST /leads/book-meeting", "POST /leads/meeting"] },
  { name: "bad_number", label: "Flagged a bad number", match: ["POST /leads/bad-number"] },
  { name: "brief", label: "Generated an AI call brief", match: ["POST /brief/generate"] },
  { name: "website_scrape", label: "Looked up a website", match: ["GET /scrape/website"] },
  { name: "quick_picks", label: "Used quick picks", match: ["GET /search/quickpicks"] },
  { name: "territory", label: "Opened the territory view", match: ["GET /search/territory"] },
  { name: "export_csv", label: "Exported to CSV", match: ["POST /export/csv"] },
  { name: "export_sheet", label: "Exported to Google Sheets", match: ["POST /export/sheets", "POST /export/google-sheet", "POST /export/google-sheet/claimed", "POST /export/disconnected"] },
  { name: "disconnect", label: "Moved a lead to disconnected", match: ["POST /leads/disconnect"] },
  { name: "return_to_prospect", label: "Returned a lead to Prospect", match: ["POST /leads/return-to-prospect"] },
  { name: "related_check", label: "Checked for related claims", match: ["POST /leads/related-check"] },
  { name: "suggestion", label: "Sent a suggestion", match: ["POST /suggestions/submit"] },
  { name: "avatar_reply", label: "Reacted or replied to an avatar note", match: ["POST /buddy/react"] },
  { name: "kudos", label: "Gave kudos", match: ["POST /buddy/kudos"] },
];

const FEATURE_BY_ROUTE = new Map(FEATURES.flatMap((f) => f.match.map((m) => [m, f.name])));
const SEARCHES = new Map([["GET /search/companies", "companies"], ["GET /search/nppes", "nppes"]]);

// Query names that say what was searched for rather than which filters were on.
const WHERE_AND_WHAT = new Set(["state", "states", "taxonomyDescription", "taxonomyDescriptions"]);
// Typed text and identifiers: never kept, not even their names count as a "filter".
const NEVER_KEEP = new Set(["nameContains", "nameContainsTerms", "excludeKeywords", "token", "npi", "lookupText", "lookupPhone", "companyName", "name", "city", "zip", "postalCode", "phone", "firstName", "lastName", "organizationName"]);
// Plumbing, not filters.
const PLUMBING = new Set(["excludeNpis", "source", "scrape", "rescan", "resetProgress", "variantSkips", "sortBy", "day", "limit", "skip", "page", "pageSize"]);

const list = (v) => String(v || "").split(/[|,]/).map((x) => x.trim()).filter(Boolean);
const clip = (v, n) => String(v ?? "").slice(0, n);

// query: URLSearchParams or a plain object of the request's query string.
export function summarizeSearch(query) {
  const get = (k) => (typeof query.get === "function" ? query.get(k) : query[k]);
  const keys = typeof query.keys === "function" ? [...query.keys()] : Object.keys(query || {});
  const states = list(get("states") || get("state")).map((s) => s.toUpperCase()).slice(0, 5);
  const specialties = list(get("taxonomyDescriptions") || get("taxonomyDescription")).map((s) => clip(s, 60)).slice(0, 3);
  const filters = [...new Set(keys.filter((k) => !WHERE_AND_WHAT.has(k) && !NEVER_KEEP.has(k) && !PLUMBING.has(k) && String(get(k) ?? "") !== "" && String(get(k)) !== "false"))].sort().slice(0, 12);
  const typed = keys.some((k) => NEVER_KEEP.has(k) && String(get(k) ?? "") !== "");
  return { states, specialties, filters, typed };
}

// -> a row for public.app_events, or null when this request isn't worth recording.
// ctx: { method, path, status, ms, userId, query, resultCount, errorMessage }
export function buildEvent({ method, path, status, ms, userId, query = {}, resultCount = null, errorMessage = "" }) {
  const route = `${String(method || "").toUpperCase()} ${path}`;
  const code = Number(status) || 0;
  const base = { user_id: userId || null, status: code || null, ms: Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : null };

  const failed = code >= 500 || (code >= 400 && code !== 401 && code !== 403 && code !== 404 && (SEARCHES.has(route) || FEATURE_BY_ROUTE.has(route)));
  if (failed) {
    return { ...base, kind: "error", name: clip(route, 80), result_count: null, detail: { message: clip(errorMessage, 200) || null } };
  }
  if (code >= 400) return null; // signed out, not allowed, not found: not interesting

  if (SEARCHES.has(route)) {
    return { ...base, kind: "search", name: SEARCHES.get(route), result_count: Number.isFinite(resultCount) ? Math.max(0, Math.round(resultCount)) : null, detail: summarizeSearch(query) };
  }
  if (FEATURE_BY_ROUTE.has(route)) return { ...base, kind: "feature", name: FEATURE_BY_ROUTE.get(route), result_count: null, detail: null };
  return null;
}

export const isSearchRoute = (method, path) => SEARCHES.has(`${String(method || "").toUpperCase()} ${path}`);
