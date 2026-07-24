// Port of appscript/services/CompanyService.js -- orchestrates
// NPPES -> branch-merge dedup -> claimed-lead exclusion -> enrich
// (Foursquare/OSM/CMS) -> optionally scrape -> score -> sort. The
// round-robin/fair-share/branch-merge/resume logic is unchanged from the
// Apps Script version; only the I/O underneath it changed (UrlFetchApp ->
// fetch, SheetsStore -> Supabase).
//
// Unlike Apps Script (~6-minute hard execution cap that could kill a slow
// request mid-flight with no response ever sent -- see ARCHITECTURE.md),
// Vercel functions configured with a longer maxDuration (see vercel.json)
// don't have that specific failure mode, but MAX_NPPES_FETCHES_PER_REQUEST
// is kept anyway as a sane bound on how much work one request should do.

import { searchProviders } from "./nppesService.js";
import { scoreCompany } from "./scoringService.js";
import { createCompany } from "./companyModel.js";
import { classifyRole } from "./roleClassifier.js";
import * as foursquareService from "./foursquareService.js";
import * as osmService from "./osmService.js";
import * as cmsService from "./cmsService.js";
import * as scraperService from "./scraperService.js";
import * as leadsService from "./leadsService.js";
import * as searchProgressService from "./searchProgressService.js";
import { createServiceClient } from "../supabaseClient.js";

const NPPES_PAGE_SIZE = 200; // NPPES hard cap per request
const NPPES_MAX_SKIP = 1000; // NPPES hard cap on pagination depth
const MAX_NPPES_FETCHES_PER_REQUEST = 30;

// vercel.json gives this function a 60s maxDuration; a hard timeout kills
// the invocation with no response body at all (the client sees an opaque
// FUNCTION_INVOCATION_TIMEOUT, not JSON). Everything below budgets its own
// work against a deadline well inside that cap -- most importantly OSM
// enrichment, which is deliberately throttled to ~1 req/sec (see
// osmService.js) and runs once per company with no website. Without
// Foursquare configured (FOURSQUARE_SERVICE_API_KEY unset), every company
// falls through to that throttled OSM lookup, so a limit=50 search alone
// needs ~55s just for enrichment -- comfortably over budget on its own
// before NPPES pagination is even counted. Stopping early and returning
// what's already gathered beats a dead invocation and no data at all.
const SEARCH_TIME_BUDGET_MS = 45000;

function buildNppesDecisionMaker(provider) {
  const off = provider.authorizedOfficial;
  if (!off || !off.lastName) return null;
  const name = [off.firstName, off.lastName].filter(Boolean).join(" ");
  return {
    name,
    title: off.title || null,
    roleCategory: classifyRole(off.title || "authorized official"),
    phone: off.phone || null,
    source: "nppes",
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
    taxonomy: provider.taxonomy,
    decisionMakers: nppesDM ? [nppesDM] : [],
    lastUpdated: provider.lastUpdated,
    sources: { nppes: true },
  });
}

// Two independent, exact dedup keys for companies where NPPES's own
// authorized official is known -- see CompanyService.js's comment for the
// full reasoning (chains registering a separate NPI per branch location).
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

function createBranchMerger() {
  const keyToIndex = new Map();
  const merged = [];

  function add(company) {
    const keys = branchDedupKeys(company);
    const branch = { npi: company.npi, address: company.address, phone: company.phone };

    const namePhoneKey = keys.namePhone ? `np:${keys.namePhone}` : null;
    const companyNameKey = keys.companyName ? `cn:${keys.companyName}` : null;

    let matchIndex = null;
    if (namePhoneKey && keyToIndex.has(namePhoneKey)) matchIndex = keyToIndex.get(namePhoneKey);
    else if (companyNameKey && keyToIndex.has(companyNameKey)) matchIndex = keyToIndex.get(companyNameKey);

    if (matchIndex != null) {
      merged[matchIndex].locations.push(branch);
    } else {
      matchIndex = merged.length;
      merged.push({ ...company, locations: [branch] });
    }

    if (namePhoneKey) keyToIndex.set(namePhoneKey, matchIndex);
    if (companyNameKey) keyToIndex.set(companyNameKey, matchIndex);
  }

  return { add, list: () => merged, get length() { return merged.length; } };
}

async function applyPlacesEnrichment(serviceSupabase, companies) {
  let dataByNpi;
  try {
    dataByNpi = await foursquareService.enrichCompanies(serviceSupabase, companies);
  } catch (err) {
    if (err.name === "FoursquareNotConfiguredError") {
      console.log("[companyService] Places enrichment skipped: FOURSQUARE_SERVICE_API_KEY not set");
    } else {
      console.log(`[companyService] Places enrichment failed: ${err.message}`);
    }
    return companies;
  }

  return companies.map((company) => {
    const data = company.npi != null ? dataByNpi[String(company.npi)] : null;
    if (!data) return company;
    return {
      ...company,
      website: data.website ?? company.website,
      phone: company.phone || data.phone || null,
      places: { placeId: data.placeId, rating: data.rating, ratingCount: data.ratingCount, isClosed: data.isClosed },
      sources: { ...company.sources, places: true },
    };
  });
}

async function tryEnrichWithOsm(serviceSupabase, company) {
  if (company.website) return company;
  try {
    const website = await osmService.lookupWebsite(serviceSupabase, company);
    if (!website) return company;
    return { ...company, website, sources: { ...company.sources, osm: true } };
  } catch (err) {
    console.log(`[companyService] OSM enrichment failed for "${company.name}": ${err.message}`);
    return company;
  }
}

async function tryEnrichWithScrape(company) {
  if (!company.website) return company;
  try {
    const result = await scraperService.scrapeCompanyWebsite(company.website);
    if (!result.scraped) return company;

    const existingNames = new Set(company.decisionMakers.map((d) => d.name.toLowerCase()));
    const scrapedDMs = result.decisionMakers
      .filter((d) => !existingNames.has(d.name.toLowerCase()))
      .map((d) => ({ name: d.name, title: d.title, roleCategory: d.roleCategory, phone: null, source: "website", sourceUrl: d.sourceUrl }));

    return {
      ...company,
      email: company.email || result.emails[0] || null,
      decisionMakers: [...company.decisionMakers, ...scrapedDMs],
      sources: { ...company.sources, website: true },
    };
  } catch (err) {
    console.log(`[companyService] Scrape failed for "${company.name}": ${err.message}`);
    return company;
  }
}

async function getClaimedNpisSafe(serviceSupabase) {
  try {
    return await leadsService.getClaimedNpis(serviceSupabase);
  } catch (err) {
    console.log(`[companyService] Dedup check failed: ${err.message}`);
    return new Set();
  }
}

async function getSearchProgressSafe(userSupabase, userId, criteria) {
  try {
    return await searchProgressService.getProgress(userSupabase, userId, criteria);
  } catch (err) {
    console.log(`[companyService] SearchProgress resume failed: ${err.message}`);
    return null;
  }
}

async function saveSearchProgressSafe(userSupabase, userId, criteria, variantSkips, seenNpis) {
  try {
    await searchProgressService.saveProgress(userSupabase, userId, criteria, variantSkips, seenNpis);
  } catch (err) {
    console.log(`[companyService] SearchProgress save failed: ${err.message}`);
  }
}

// NPPES only accepts ONE state and ONE taxonomy_description per request --
// multi-select is implemented as one query variant per state x taxonomy
// combination, merged afterward.
function buildCriteriaVariants(criteria) {
  const states = criteria.states?.length ? criteria.states : [criteria.state || undefined];
  const taxonomies = criteria.taxonomyDescriptions?.length ? criteria.taxonomyDescriptions : [criteria.taxonomyDescription || undefined];

  const variants = [];
  for (const state of states) {
    for (const taxonomyDescription of taxonomies) {
      variants.push({ ...criteria, state, taxonomyDescription });
    }
  }
  return variants;
}

function variantKey(variant) {
  return `${variant.state || ""}|${variant.taxonomyDescription || ""}`;
}

// Pages through NPPES (round-robin across every state x taxonomy variant),
// filtering out already-claimed NPIs, until we have `desiredLimit` distinct
// COMPANIES (after branch-merging) or every variant runs out / hits its
// skip cap. See CompanyService.js's extensive comments for the full
// reasoning behind round-robin + fair-share quota + incremental merging.
async function fetchFreshProviders(serviceSupabase, criteria, desiredLimit, claimedNpis, deadline) {
  const variants = criteria.npi ? [criteria] : buildCriteriaVariants(criteria);
  const mergeBranches = !criteria.npi;
  const merger = createBranchMerger();

  const fresh = [];
  let totalScanned = 0;
  let excludedAsClaimed = 0;
  const seenNpis = new Set((criteria.excludeNpis || []).map(String));

  const variantSkips = { ...(criteria.variantSkips || {}) };
  let fetchesUsed = 0;
  let hitScanBudget = false;
  let hitTimeBudget = false;
  const rejectedVariants = [];

  function acceptedCount() {
    return mergeBranches ? merger.length : fresh.length;
  }

  const variantExhausted = variants.map((v) => (variantSkips[variantKey(v)] || 0) > NPPES_MAX_SKIP);
  function anyVariantLeft() {
    return variantExhausted.some((done) => !done);
  }

  while (acceptedCount() < desiredLimit && !hitScanBudget && !hitTimeBudget && anyVariantLeft()) {
    const remainingVariants = variantExhausted.filter((done) => !done).length;
    const roundQuota = Math.max(1, Math.ceil((desiredLimit - acceptedCount()) / remainingVariants));

    for (let v = 0; v < variants.length; v++) {
      if (variantExhausted[v]) continue;
      if (acceptedCount() >= desiredLimit) break;
      if (fetchesUsed >= MAX_NPPES_FETCHES_PER_REQUEST) {
        hitScanBudget = true;
        break;
      }
      if (Date.now() >= deadline) {
        hitTimeBudget = true;
        break;
      }

      const variant = variants[v];
      const key = variantKey(variant);
      let skip = variantSkips[key] || 0;
      fetchesUsed++;

      let result;
      try {
        result = await searchProviders({ ...variant, limit: NPPES_PAGE_SIZE, skip });
      } catch (err) {
        console.log(`[companyService] NPPES query variant failed, skipping it: ${key} -- ${err.message}`);
        rejectedVariants.push({ state: variant.state || null, taxonomyDescription: variant.taxonomyDescription || null, message: err.message });
        variantExhausted[v] = true;
        continue;
      }
      const results = result.results;
      const fetched = result.rawCount != null ? result.rawCount : results.length;

      if (fetched === 0) {
        variantExhausted[v] = true;
      } else {
        totalScanned += fetched;
        const acceptedBeforeThisTurn = acceptedCount();
        for (const provider of results) {
          if (acceptedCount() >= desiredLimit) break;
          if (acceptedCount() - acceptedBeforeThisTurn >= roundQuota) break;
          const normalizedNpi = provider.npi ? leadsService.normalizeNpi(provider.npi) : "";
          if (normalizedNpi && seenNpis.has(normalizedNpi)) continue;

          const isClaimed = normalizedNpi && claimedNpis.has(normalizedNpi);
          if (isClaimed) {
            excludedAsClaimed++;
          } else {
            fresh.push(provider);
            if (mergeBranches) merger.add(fromNppesProvider(provider));
          }
          if (normalizedNpi) seenNpis.add(normalizedNpi);
        }

        if (fetched < NPPES_PAGE_SIZE) variantExhausted[v] = true;
        skip += NPPES_PAGE_SIZE;
      }

      variantSkips[key] = skip;
      if (skip > NPPES_MAX_SKIP) variantExhausted[v] = true;
    }
  }

  return {
    companies: mergeBranches ? merger.list() : fresh.map(fromNppesProvider),
    totalScanned,
    excludedAsClaimed,
    variantSkips,
    hitScanBudget,
    hitTimeBudget,
    allSeenNpis: [...seenNpis],
    rejectedVariants,
  };
}

// options: { enrichPlaces = true, scrapeWebsites = false, enrichCms = true,
//            userId, userSupabase, clientProvidedVariantSkips }
export async function searchCompanies(criteria = {}, options = {}) {
  const enrichPlaces = options.enrichPlaces !== false;
  const scrapeWebsites = Boolean(options.scrapeWebsites);
  const enrichCms = options.enrichCms !== false;
  const serviceSupabase = createServiceClient();
  const deadline = Date.now() + SEARCH_TIME_BUDGET_MS;

  const desiredLimit = criteria.limit || 20;
  const claimedNpis = await getClaimedNpisSafe(serviceSupabase);

  const trackProgress = Boolean(options.userId) && !criteria.npi;
  let effectiveCriteria = criteria;
  if (trackProgress && !options.clientProvidedVariantSkips) {
    const progress = await getSearchProgressSafe(options.userSupabase, options.userId, criteria);
    if (progress) {
      effectiveCriteria = { ...criteria, variantSkips: progress.variantSkips, excludeNpis: [...(criteria.excludeNpis || []), ...progress.seenNpis] };
    }
  }

  const fetchResult = await fetchFreshProviders(serviceSupabase, effectiveCriteria, desiredLimit, claimedNpis, deadline);
  let companies = fetchResult.companies;

  if (trackProgress) {
    await saveSearchProgressSafe(options.userSupabase, options.userId, criteria, fetchResult.variantSkips, fetchResult.allSeenNpis);
  }

  if (enrichPlaces) {
    companies = await applyPlacesEnrichment(serviceSupabase, companies);
    // Sequential, not Promise.all -- OSM/Nominatim enforces its own rate
    // limit (~1 req/sec). With Foursquare unconfigured, every company still
    // needs this lookup, so a large result set can outrun the function's
    // time budget on its own -- stop once the deadline's hit and leave the
    // rest with whatever website they already have rather than let the
    // whole invocation get killed with no response.
    const withOsm = [];
    for (const company of companies) {
      if (Date.now() >= deadline) {
        withOsm.push(company);
        continue;
      }
      withOsm.push(await tryEnrichWithOsm(serviceSupabase, company));
    }
    companies = withOsm;
  }
  if (scrapeWebsites) {
    companies = await Promise.all(companies.map(tryEnrichWithScrape));
  }
  if (enrichCms) {
    const medicareByNpi = await cmsService.lookupByNpis(serviceSupabase, companies.map((c) => c.npi));
    companies = companies.map((company) => {
      const medicare = company.npi != null ? medicareByNpi[String(company.npi)] : null;
      if (!medicare) return company;
      return { ...company, medicare, sources: { ...company.sources, cms: true } };
    });
  }

  companies = companies.map((company) => ({ ...company, score: scoreCompany(company) }));
  companies.sort((a, b) => b.score.value - a.score.value);

  return {
    count: companies.length,
    scannedFromRegistry: fetchResult.totalScanned,
    excludedAsClaimed: fetchResult.excludedAsClaimed,
    exhaustedRegistry: companies.length < desiredLimit && !fetchResult.hitScanBudget && !fetchResult.hitTimeBudget,
    timeBudgetExceeded: fetchResult.hitTimeBudget || Date.now() >= deadline,
    variantSkips: fetchResult.variantSkips,
    rejectedVariants: fetchResult.rejectedVariants,
    companies,
  };
}

export default { searchCompanies };
