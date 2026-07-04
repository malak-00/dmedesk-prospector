import { searchProviders } from "../services/nppes.service.js";

/**
 * GET /api/search/nppes
 * Query params: organizationName, city, state, postalCode, taxonomyDescription, limit
 */
export async function searchNppes(req, res, next) {
  try {
    const {
      npi,
      organizationName,
      nameContains,
      city,
      state,
      postalCode,
      taxonomyDescription,
      lastUpdatedYear,
      limit,
    } = req.query;

    const hasAnyCriteria =
      npi || organizationName || nameContains || city || state || postalCode || taxonomyDescription;

    if (!hasAnyCriteria) {
      const error = new Error(
        "At least one search parameter is required (npi, organizationName, city, state, postalCode, or taxonomyDescription)"
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
      postalCode,
      taxonomyDescription,
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
      postalCode,
      taxonomyDescription,
      lastUpdatedYear,
      limit,
      enrich,
      scrape
    } = req.query;

    const hasAnyCriteria =
      npi || organizationName || nameContains || city || state || postalCode || taxonomyDescription;

    if (!hasAnyCriteria) {
      const error = new Error(
        "At least one search parameter is required (npi, organizationName, nameContains, city, state, postalCode, or taxonomyDescription)"
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
  { npi, organizationName, nameContains, city, state, postalCode, taxonomyDescription, lastUpdatedYear, limit: parsedLimit },
  { enrichPlaces: shouldEnrich, scrapeWebsites: shouldScrape }
);

    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}