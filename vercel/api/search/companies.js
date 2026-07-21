// Replaces Code.js's "search/companies" route. Query params instead of
// ?path=/&token= -- see ARCHITECTURE.md's CORS section for why the old app
// needed that workaround and why a real host doesn't.

import { withAuth, sendData, sendError } from "../../lib/http.js";
import { searchCompanies } from "../../lib/services/companyService.js";

function parseCommaList(value) {
  if (!value) return [];
  return String(value).split(",").map((s) => s.trim()).filter(Boolean);
}

function parseVariantSkips(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function readSearchCriteria(query) {
  return {
    npi: query.npi || undefined,
    organizationName: query.organizationName || undefined,
    nameContains: query.nameContains || undefined,
    nameContainsTerms: parseCommaList(query.nameContainsTerms),
    city: query.city || undefined,
    state: query.state || undefined,
    states: parseCommaList(query.states),
    taxonomyDescription: query.taxonomyDescription || undefined,
    taxonomyDescriptions: parseCommaList(query.taxonomyDescriptions),
    lastUpdatedYear: query.lastUpdatedYear || undefined,
    lastUpdatedYears: parseCommaList(query.lastUpdatedYears),
    excludeKeywords: parseCommaList(query.excludeKeywords),
    limit: query.limit ? Number(query.limit) : undefined,
    skip: query.skip ? Number(query.skip) : undefined,
    variantSkips: parseVariantSkips(query.variantSkips),
    excludeNpis: parseCommaList(query.excludeNpis),
  };
}

// Prevents an all-blank query from silently paging through the entire
// national NPI-2 registry. `state`/`states` deliberately doesn't count on
// its own -- NPPES rejects a bare state with "Field state requires
// additional search criteria".
function hasAnySearchCriteria(criteria) {
  return Boolean(
    criteria.npi ||
      criteria.organizationName ||
      criteria.nameContains ||
      criteria.nameContainsTerms?.length ||
      criteria.city ||
      criteria.taxonomyDescription ||
      criteria.taxonomyDescriptions?.length
  );
}

export default withAuth(async (req, res) => {
  if (req.method !== "GET") return sendError(res, 405, "Method not allowed");

  const criteria = readSearchCriteria(req.query);
  if (!hasAnySearchCriteria(criteria)) {
    return sendError(res, 400, "At least one of NPI, company name, city, or specialty is required -- a state alone isn't specific enough for NPPES");
  }

  const data = await searchCompanies(criteria, {
    enrichPlaces: req.query.enrich !== "false",
    scrapeWebsites: req.query.scrape === "true",
    enrichCms: req.query.cms !== "false",
    userId: req.user.id,
    userSupabase: req.supabase,
    // True only for an explicit "Search more" continuation (the frontend
    // already sent its own remembered variantSkips) -- a plain fresh Search
    // never does, which is exactly when searchCompanies should fall back
    // to this user's persisted SearchProgress bookmark instead.
    clientProvidedVariantSkips: Boolean(req.query.variantSkips),
  });

  sendData(res, data);
});
