import { searchProviders } from "./nppes.service.js";
import { lookupByNpis } from "./cms.service.js";
import foursquareService, { FoursquareNotConfiguredError } from "./foursquare.service.js";
import { scrapeCompanyWebsite } from "./scraper.service.js";
import { createCompany } from "../models/company.model.js";
import { scoreCompany } from "./scoring.service.js";
import { classifyRole } from "../utils/roleClassifier.js";
import { getClaimedNpis, SheetsNotConfiguredError } from "./sheetsExport.service.js";

const NPPES_PAGE_SIZE = 200; // NPPES hard cap per request
const NPPES_MAX_SKIP = 1000; // NPPES hard cap on pagination depth

let hasWarnedNoKey = false;
let hasWarnedNoDedup = false;

function buildNppesDecisionMaker(provider) {
  const off = provider.authorizedOfficial;
  if (!off || !off.lastName) return null;
  const name = [off.firstName, off.lastName].filter(Boolean).join(" ");
  return {
    name,
    title: off.title || null,
    roleCategory: classifyRole(off.title || "authorized official"),
    phone: off.phone || null,
    source: "nppes", // self-reported registration data -- high reliability
    sourceUrl: null,
  };
}

function fromNppesProvider(provider) {
  const nppesDM = buildNppesDecisionMaker(provider);
  return createCompany({
    npi: provider.npi,
    name: provider.name,
    address: provider.address,
    phone: provider.phone,
    fax: provider.fax,
    taxonomy: provider.taxonomy,
    decisionMakers: nppesDM ? [nppesDM] : [],
    lastUpdated: provider.lastUpdated,
    sources: { nppes: true },
  });
}

async function tryEnrichWithPlaces(company) {
  try {
    const data = await foursquareService.enrichCompany({
      name: company.name,
      address: company.address,
    });
    if (!data) return company;

    return {
      ...company,
      website: data.website ?? company.website,
      phone: company.phone || data.phone || null,
      places: {
        placeId: data.placeId,
        rating: data.rating,
        ratingCount: data.ratingCount,
        isClosed: data.isClosed,
      },
      sources: { ...company.sources, places: true },
    };
  } catch (err) {
    if (err instanceof FoursquareNotConfiguredError) {
      if (!hasWarnedNoKey) {
        console.warn(
          "[company.service] Places enrichment skipped: FOURSQUARE_SERVICE_API_KEY not set"
        );
        hasWarnedNoKey = true;
      }
      return company;
    }
    console.warn(`[company.service] Places enrichment failed for "${company.name}": ${err.message}`);
    return company;
  }
}

/**
 * Only runs if the company has a website (usually found via Places enrichment).
 * Merges scraped decision-makers with NPPES ones, deduped by name.
 * NPPES entries are never overwritten -- scraping only adds names NPPES doesn't have.
 */
async function tryEnrichWithScrape(company) {
  if (!company.website) return company;

  try {
    const result = await scrapeCompanyWebsite(company.website);
    if (!result.scraped) return company;

    const existingNames = new Set(
      company.decisionMakers.map((d) => d.name.toLowerCase())
    );
    const scrapedDMs = result.decisionMakers
      .filter((d) => !existingNames.has(d.name.toLowerCase()))
      .map((d) => ({
        name: d.name,
        title: d.title,
        roleCategory: d.roleCategory,
        phone: null,
        source: "website",
        sourceUrl: d.sourceUrl,
      }));

    return {
      ...company,
      email: company.email || result.emails[0] || null,
      decisionMakers: [...company.decisionMakers, ...scrapedDMs],
      sources: { ...company.sources, website: true },
    };
  } catch (err) {
    console.warn(`[company.service] Scrape failed for "${company.name}": ${err.message}`);
    return company;
  }
}

async function getClaimedNpisSafe() {
  try {
    return await getClaimedNpis();
  } catch (err) {
    if (err instanceof SheetsNotConfiguredError) {
      if (!hasWarnedNoDedup) {
        console.warn("[company.service] Dedup skipped: Google Sheets not configured");
        hasWarnedNoDedup = true;
      }
    } else {
      console.warn(`[company.service] Dedup check failed: ${err.message}`);
    }
    return new Set();
  }
}

/**
 * Pages through NPPES, filtering out already-claimed NPIs, until we have
 * `desiredLimit` fresh leads or NPPES runs out of results / hits its skip cap.
 */
async function fetchFreshProviders(criteria, desiredLimit, claimedNpis) {
  const fresh = [];
  let skip = 0;
  let totalScanned = 0;

  while (fresh.length < desiredLimit && skip <= NPPES_MAX_SKIP) {
    const { results, rawCount } = await searchProviders({
      ...criteria,
      limit: NPPES_PAGE_SIZE,
      skip,
    });

    // Last-page checks must use rawCount (what NPPES actually returned),
    // not results.length -- local taxonomy/keyword filters can trim a full
    // page and would otherwise end pagination early.
    const fetched = rawCount ?? results.length;
    if (fetched === 0) break; // NPPES has no more matches at all

    totalScanned += fetched;
    for (const provider of results) {
      if (fresh.length >= desiredLimit) break;
      if (!provider.npi || !claimedNpis.has(String(provider.npi))) {
        fresh.push(provider);
      }
    }

    if (fetched < NPPES_PAGE_SIZE) break; // last page from NPPES
    skip += NPPES_PAGE_SIZE;
  }

  return { fresh, totalScanned };
}

export async function searchCompanies(
  criteria = {},
  { enrichPlaces = true, scrapeWebsites = false, enrichCms = true } = {}
) {
  const desiredLimit = criteria.limit || 20;
  const claimedNpis = await getClaimedNpisSafe();

  const { fresh: providers, totalScanned } = await fetchFreshProviders(
    criteria,
    desiredLimit,
    claimedNpis
  );

  const excludedAsClaimed = totalScanned - providers.length;
  let companies = providers.map(fromNppesProvider);

  if (enrichPlaces) {
    companies = await Promise.all(companies.map(tryEnrichWithPlaces));
  }
  if (scrapeWebsites) {
    companies = await Promise.all(companies.map(tryEnrichWithScrape));
  }
  if (enrichCms) {
    const medicareByNpi = await lookupByNpis(companies.map((c) => c.npi));
    companies = companies.map((company) => {
      const medicare = company.npi != null ? medicareByNpi.get(String(company.npi)) : null;
      if (!medicare) return company;
      return { ...company, medicare, sources: { ...company.sources, cms: true } };
    });
  }

  companies = companies.map((company) => ({ ...company, score: scoreCompany(company) }));
  companies.sort((a, b) => b.score.value - a.score.value);

  return {
    count: companies.length,
    scannedFromRegistry: totalScanned,
    excludedAsClaimed,
    exhaustedRegistry: providers.length < desiredLimit,
    companies,
  };
}

export default { searchCompanies };