import { searchProviders } from "./nppes.service.js";
import { lookupByNpis } from "./cms.service.js";
import foursquareService, { FoursquareNotConfiguredError } from "./foursquare.service.js";
import yelpService, { YelpNotConfiguredError } from "./yelp.service.js";
import { lookupWebsite as lookupOsmWebsite } from "./osm.service.js";
import { scrapeCompanyWebsite } from "./scraper.service.js";
import { createCompany } from "../models/company.model.js";
import { scoreCompany } from "./scoring.service.js";
import { classifyRole } from "../utils/roleClassifier.js";
import { getClaimedNpis, SheetsNotConfiguredError } from "./sheetsExport.service.js";

const NPPES_PAGE_SIZE = 200; // NPPES hard cap per request
const NPPES_MAX_SKIP = 1000; // NPPES hard cap on pagination depth

let hasWarnedNoKey = false;
let hasWarnedNoYelpKey = false;
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

// Two independent, exact (never "contains") dedup keys for companies where
// NPPES's own authorized official is known -- a scraped/website contact
// isn't reliable enough to key an automatic merge on, so this runs right
// after fromNppesProvider (before any enrichment adds other decision
// makers). Either key alone is enough to merge two rows together:
//  - namePhone: the official's name + phone match exactly -- catches the
//    same owner/officer operating under a genuinely different registered
//    company name (a DBA, a renamed entity, etc.).
//  - companyName: the company name + official's name match exactly -- the
//    original behavior, for branches sharing a name but with no phone on
//    file (or a phone that happens to differ per location).
// A key is null when it can't be computed (missing official/phone/etc.),
// which callers treat as "this key never merges anything".
function branchDedupKeys(company) {
  const official = company.decisionMakers?.[0];
  if (!official?.name) return { namePhone: null, companyName: null };
  const namePart = String(company.name || "").trim().toLowerCase();
  const officialPart = official.name.trim().toLowerCase();
  const phonePart = official.phone ? String(official.phone).trim() : "";

  return {
    namePhone: officialPart && phonePart ? `${officialPart}|${phonePart}` : null,
    companyName: namePart && officialPart ? `${namePart}|${officialPart}` : null,
  };
}

// Chains with a large employer can register a separate NPI per branch
// location, which otherwise shows up as several near-identical rows for
// what a rep considers one lead. Folds those into a single row carrying
// every branch's NPI/address/phone/fax, keeping the first-seen branch's
// fields (name, taxonomy, etc.) as the row's primary display data. Two rows
// merge if EITHER branchDedupKeys() key matches -- this company's own two
// keys are then both registered against whichever group it joined (or a
// brand-new group), so a third row matching via the OTHER key still joins
// the same group. Runs before enrichment so Places/OSM/scrape/CMS calls
// aren't repeated per branch -- only the primary branch gets enriched.
function mergeDuplicateBranches(companies) {
  const keyToIndex = new Map(); // "np:"/"cn:" prefixed key -> index into `merged`
  const merged = [];

  for (const company of companies) {
    const keys = branchDedupKeys(company);
    const branch = { npi: company.npi, address: company.address, phone: company.phone, fax: company.fax };

    const namePhoneKey = keys.namePhone ? `np:${keys.namePhone}` : null;
    const companyNameKey = keys.companyName ? `cn:${keys.companyName}` : null;

    let matchIndex = null;
    if (namePhoneKey && keyToIndex.has(namePhoneKey)) {
      matchIndex = keyToIndex.get(namePhoneKey);
    } else if (companyNameKey && keyToIndex.has(companyNameKey)) {
      matchIndex = keyToIndex.get(companyNameKey);
    }

    if (matchIndex != null) {
      merged[matchIndex].locations.push(branch);
    } else {
      matchIndex = merged.length;
      merged.push({ ...company, locations: [branch] });
    }

    if (namePhoneKey) keyToIndex.set(namePhoneKey, matchIndex);
    if (companyNameKey) keyToIndex.set(companyNameKey, matchIndex);
  }

  return merged;
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

// A SECOND "Places"-style enrichment attempt, via SerpApi's Yelp Search API,
// used only for companies tryEnrichWithPlaces above didn't already enrich
// (Foursquare found no match, or Foursquare itself failed/is unconfigured).
// Unlike Foursquare, every request here is a billed SerpApi search, so this
// deliberately never runs for a company Foursquare already covered.
async function tryEnrichWithYelp(company) {
  if (company.sources?.places) return company; // Foursquare already covered this one
  try {
    const data = await yelpService.enrichCompany({
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
      sources: { ...company.sources, places: true, yelp: true },
    };
  } catch (err) {
    if (err instanceof YelpNotConfiguredError) {
      if (!hasWarnedNoYelpKey) {
        console.warn("[company.service] Yelp enrichment skipped: SERPAPI_API_KEY not set");
        hasWarnedNoYelpKey = true;
      }
      return company;
    }
    console.warn(`[company.service] Yelp enrichment failed for "${company.name}": ${err.message}`);
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

// NPPES only accepts ONE state and ONE taxonomy_description per request --
// there's no server-side "OR" across values. Multi-select on either field is
// implemented by running one query variant per combination (cartesian
// product) and merging the results, rather than by widening a single query
// and filtering locally: sending only one taxonomy to NPPES would have it
// pre-filter out every OTHER selected taxonomy's real matches before they
// ever reach this app.
//
// A single-value legacy criteria.state/taxonomyDescription (no
// states/taxonomyDescriptions array) still produces exactly one variant, so
// this is a no-op for every search that isn't using multi-select.
function buildCriteriaVariants(criteria) {
  const states = criteria.states?.length ? criteria.states : [criteria.state || undefined];
  const taxonomies = criteria.taxonomyDescriptions?.length
    ? criteria.taxonomyDescriptions
    : [criteria.taxonomyDescription || undefined];

  const variants = [];
  for (const state of states) {
    for (const taxonomyDescription of taxonomies) {
      variants.push({ ...criteria, state, taxonomyDescription });
    }
  }
  return variants;
}

// A stable key identifying one query variant, used to remember (across
// separate "Search more" requests) exactly which NPPES skip depth this
// variant last stopped at.
function variantKey(variant) {
  return `${variant.state || ""}|${variant.taxonomyDescription || ""}`;
}

/**
 * Pages through NPPES (across every state x taxonomy variant, in the
 * multi-select case), filtering out already-claimed NPIs, until we have
 * `desiredLimit` fresh leads or every variant runs out of results / hits its
 * skip cap.
 *
 * `criteria.variantSkips` (an opaque map from variantKey() -> skip) resumes
 * each variant from wherever a previous call for this exact search left
 * off, instead of always starting at 0 -- this is what backs the frontend's
 * "Search more" button (rerun the identical filters and see leads beyond
 * what's already been shown, rather than the same top results every time).
 * Returned back to the caller so it can be replayed on the next "Search
 * more" click. `criteria.excludeNpis` similarly skips any NPI already shown
 * earlier in this search session, so a company reachable through more than
 * one variant can't reappear either.
 */
async function fetchFreshProviders(criteria, desiredLimit, claimedNpis) {
  // An explicit NPI lookup ignores state/taxonomy entirely (see
  // nppes.service.js's searchProviders), so multiple variants would just
  // repeat the identical lookup -- always exactly one variant in that case.
  const variants = criteria.npi ? [criteria] : buildCriteriaVariants(criteria);

  const fresh = [];
  let totalScanned = 0;
  // Counts ONLY providers actually skipped for being claimed -- deliberately
  // NOT "totalScanned - fresh.length", which used to also fold in providers
  // that never matched a local nameContains/taxonomy/year filter (rawCount
  // is pre-filter) and ones simply never looked at because desiredLimit was
  // already hit mid-page. That made "already claimed" wildly overcount
  // whenever a search had a narrow filter, even with zero actual claims.
  let excludedAsClaimed = 0;
  // Dedupes across variants -- e.g. a company whose registered taxonomy
  // happens to match two different selected specialties would otherwise be
  // fetched (and counted) once per matching variant. Seeded with whatever's
  // already been shown in an earlier "Search more" click for this exact
  // search, so continuing doesn't repeat those either.
  const seenNpis = new Set(criteria.excludeNpis || []);

  const variantSkips = { ...(criteria.variantSkips || {}) };

  for (const variant of variants) {
    if (fresh.length >= desiredLimit) break;
    const key = variantKey(variant);
    let skip = variantSkips[key] || 0;

    while (fresh.length < desiredLimit && skip <= NPPES_MAX_SKIP) {
      const { results, rawCount } = await searchProviders({
        ...variant,
        limit: NPPES_PAGE_SIZE,
        skip,
      });

      // Last-page checks must use rawCount (what NPPES actually returned),
      // not results.length -- local taxonomy/keyword filters can trim a full
      // page and would otherwise end pagination early.
      const fetched = rawCount ?? results.length;
      if (fetched === 0) break; // NPPES has no more matches for this variant

      totalScanned += fetched;
      for (const provider of results) {
        if (fresh.length >= desiredLimit) break;
        if (provider.npi && seenNpis.has(String(provider.npi))) continue;

        // An explicit NPI lookup is a deliberate "pull this exact lead"
        // action -- it should never come back empty just because someone
        // already claimed it, so dedup is skipped in that case only.
        const isClaimed = !criteria.npi && provider.npi && claimedNpis.has(String(provider.npi));
        if (isClaimed) {
          excludedAsClaimed++;
        } else {
          fresh.push(provider);
        }
        if (provider.npi) seenNpis.add(String(provider.npi));
      }

      if (fetched < NPPES_PAGE_SIZE) break; // last page from NPPES for this variant
      skip += NPPES_PAGE_SIZE;
    }

    variantSkips[key] = skip; // remember exactly where this variant stopped for next time
  }

  return { fresh, totalScanned, excludedAsClaimed, variantSkips };
}

export async function searchCompanies(
  criteria = {},
  { enrichPlaces = true, scrapeWebsites = false, enrichCms = true } = {}
) {
  const desiredLimit = criteria.limit || 20;
  const claimedNpis = await getClaimedNpisSafe();

  const { fresh: providers, totalScanned, excludedAsClaimed, variantSkips } = await fetchFreshProviders(
    criteria,
    desiredLimit,
    claimedNpis
  );

  let companies = providers.map(fromNppesProvider);
  // An explicit NPI lookup already identifies one exact record -- merging
  // would be a no-op at best and confusing at worst, so it's skipped there.
  if (!criteria.npi) companies = mergeDuplicateBranches(companies);

  if (enrichPlaces) {
    companies = await Promise.all(companies.map(tryEnrichWithPlaces));
    companies = await Promise.all(companies.map(tryEnrichWithYelp));
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
    variantSkips,
    companies,
  };
}

export default { searchCompanies };