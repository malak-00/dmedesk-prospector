import { searchProviders } from "./nppes.service.js";
import { lookupByNpis } from "./cms.service.js";
import foursquareService, { FoursquareNotConfiguredError } from "./foursquare.service.js";
import { lookupWebsite as lookupOsmWebsite } from "./osm.service.js";
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
      npi: company.npi,
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

// Runs only when Foursquare didn't find a website -- OpenStreetMap often
// has one for small local businesses that Foursquare's dataset misses.
// Callers MUST run this sequentially (not Promise.all) -- lookupOsmWebsite
// throttles itself to respect Nominatim's rate limit, which only works if
// calls are actually made one at a time.
async function tryEnrichWithOsm(company) {
  if (company.website) return company;
  try {
    const website = await lookupOsmWebsite(company);
    if (!website) return company;
    return { ...company, website, sources: { ...company.sources, osm: true } };
  } catch (err) {
    console.warn(`[company.service] OSM enrichment failed for "${company.name}": ${err.message}`);
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
  // Counts ONLY providers actually skipped for being claimed -- deliberately
  // NOT "totalScanned - fresh.length", which used to also fold in providers
  // that never matched a local nameContains/taxonomy/year filter (rawCount
  // is pre-filter) and ones simply never looked at because desiredLimit was
  // already hit mid-page. That made "already claimed" wildly overcount
  // whenever a search had a narrow filter, even with zero actual claims.
  let excludedAsClaimed = 0;

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
      // An explicit NPI lookup is a deliberate "pull this exact lead"
      // action -- it should never come back empty just because someone
      // already claimed it, so dedup is skipped in that case only.
      const isClaimed = !criteria.npi && provider.npi && claimedNpis.has(String(provider.npi));
      if (isClaimed) {
        excludedAsClaimed++;
      } else {
        fresh.push(provider);
      }
    }

    if (fetched < NPPES_PAGE_SIZE) break; // last page from NPPES
    skip += NPPES_PAGE_SIZE;
  }

  return { fresh, totalScanned, excludedAsClaimed };
}

export async function searchCompanies(
  criteria = {},
  { enrichPlaces = true, scrapeWebsites = false, enrichCms = true } = {}
) {
  const desiredLimit = criteria.limit || 20;
  const claimedNpis = await getClaimedNpisSafe();

  const { fresh: providers, totalScanned, excludedAsClaimed } = await fetchFreshProviders(
    criteria,
    desiredLimit,
    claimedNpis
  );

  let companies = providers.map(fromNppesProvider);

  if (enrichPlaces) {
    companies = await Promise.all(companies.map(tryEnrichWithPlaces));
    // Sequential, not Promise.all -- OSM/Nominatim enforces its own rate limit.
    const withOsm = [];
    for (const company of companies) {
      withOsm.push(await tryEnrichWithOsm(company));
    }
    companies = withOsm;
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