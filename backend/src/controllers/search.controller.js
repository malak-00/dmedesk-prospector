import { searchProviders } from "../services/nppes.service.js";

// A comma-joined query param (e.g. "?states=FL,GA,TX") -> a clean array,
// dropping any blank segments. Empty/missing input returns [].
function parseCommaList(value) {
  if (!value) return [];
  return String(value).split(",").map((s) => s.trim()).filter(Boolean);
}

// The "Search more" button's opaque per-variant resume-position map, sent
// back exactly as searchCompanies returned it on the previous response.
function parseVariantSkips(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * GET /api/search/nppes
 * Query params: organizationName, city, state(s), postalCode, taxonomyDescription(s), limit
 */
export async function searchNppes(req, res, next) {
  try {
    const {
      npi,
      organizationName,
      nameContains,
      city,
      state,
      states,
      postalCode,
      taxonomyDescription,
      taxonomyDescriptions,
      lastUpdatedYear,
      limit,
    } = req.query;

    const taxonomyDescriptionsList = parseCommaList(taxonomyDescriptions);

    // `state`/`states` deliberately does NOT count on its own here: NPPES
    // rejects a bare state (paired only with the enumeration_type=NPI-2
    // this app always sends) with "Field state requires additional search
    // criteria" -- it has to be paired with one of the fields below.
    // Catching that client-side gives a clear, immediate message instead of
    // a round-trip to NPPES for a rejection.
    const hasEnoughCriteria =
      npi || organizationName || nameContains || city || postalCode ||
      taxonomyDescription || taxonomyDescriptionsList.length;

    if (!hasEnoughCriteria) {
      const error = new Error(
        "At least one of NPI, organization name, city, postal code, or specialty is required -- a state alone isn't specific enough for NPPES"
      );
      error.status = 400;
      throw error;
    }

    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    if (limit && (Number.isNaN(parsedLimit) || parsedLimit <= 0)) {
      const error = new Error("limit must be a positive integer");
      error.status = 400;
      throw error;
    }

    const result = await searchProviders({
      npi,
      organizationName,
      nameContains,
      city,
      state,
      states: parseCommaList(states),
      postalCode,
      taxonomyDescription,
      taxonomyDescriptions: taxonomyDescriptionsList,
      lastUpdatedYear,
      limit: parsedLimit,
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    next(err);
  }
}

export default { searchNppes };

import { searchCompanies } from "../services/company.service.js";

export async function searchCompaniesHandler(req, res, next) {
  try {
    const {
      npi,
      organizationName,
      nameContains,
      city,
      state,
      states,
      postalCode,
      taxonomyDescription,
      taxonomyDescriptions,
      lastUpdatedYear,
      limit,
      enrich,
      scrape,
      variantSkips,
      excludeNpis,
    } = req.query;

    const taxonomyDescriptionsList = parseCommaList(taxonomyDescriptions);

    // `state`/`states` deliberately does NOT count on its own here: NPPES
    // rejects a bare state (paired only with the enumeration_type=NPI-2
    // this app always sends) with "Field state requires additional search
    // criteria" -- it has to be paired with one of the fields below.
    // Catching that client-side gives a clear, immediate message instead of
    // a round-trip to NPPES for a rejection.
    const hasEnoughCriteria =
      npi || organizationName || nameContains || city || postalCode ||
      taxonomyDescription || taxonomyDescriptionsList.length;

    if (!hasEnoughCriteria) {
      const error = new Error(
        "At least one of NPI, company name, city, postal code, or specialty is required -- a state alone isn't specific enough for NPPES"
      );
      error.status = 400;
      throw error;
    }

    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    if (limit && (Number.isNaN(parsedLimit) || parsedLimit <= 0)) {
      const error = new Error("limit must be a positive integer");
      error.status = 400;
      throw error;
    }

    const shouldEnrich = enrich !== "false"; // enrich by default
    const shouldScrape = scrape === "true"; // opt-in: scraping is slower, off by default

    const result = await searchCompanies(
      {
        npi, organizationName, nameContains, city, state, states: parseCommaList(states),
        postalCode, taxonomyDescription, taxonomyDescriptions: taxonomyDescriptionsList,
        lastUpdatedYear, limit: parsedLimit,
        variantSkips: parseVariantSkips(variantSkips),
        excludeNpis: parseCommaList(excludeNpis),
      },
      { enrichPlaces: shouldEnrich, scrapeWebsites: shouldScrape }
    );

    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}