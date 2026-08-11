// Port of appscript/services/CompanyService.js -- orchestrates
// NPPES -> dedup -> enrich (Foursquare/OSM) -> optionally scrape -> CMS ->
// score -> sort. Logic is unchanged from the Apps Script version; only the
// I/O calls (Sheets -> Supabase, UrlFetchApp -> fetch) and the
// warn-once-per-execution comments (meaningless on a stateless Worker
// request) were dropped.
import * as Nppes from "./nppes.js";
import * as Cms from "./cms.js";
import * as Foursquare from "./foursquare.js";
import * as Osm from "./osm.js";
import * as Scraper from "./scraper.js";
import { classifyRole } from "../lib/roleClassifier.js";
import { createCompany } from "../lib/companyModel.js";
import { scoreCompany } from "../lib/scoring.js";
import * as leadsRepo from "../repos/leadsRepo.js";
import * as searchProgressRepo from "../repos/searchProgressRepo.js";

const NPPES_PAGE_SIZE = 200;
const NPPES_MAX_SKIP = 1000;
const MAX_NPPES_FETCHES_PER_REQUEST = 30;

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
    fax: provider.fax,
    taxonomy: provider.taxonomy,
    decisionMakers: nppesDM ? [nppesDM] : [],
    lastUpdated: provider.lastUpdated,
    sources: { nppes: true },
  });
}

function branchDedupKeys(company) {
  const official = company.decisionMakers && company.decisionMakers[0];
  if (!official || !official.name) return { namePhone: null, companyName: null };
  const namePart = String(company.name || "").trim().toLowerCase();
  const officialPart = official.name.trim().toLowerCase();
  const phonePart = official.phone ? String(official.phone).trim() : "";

  return {
    namePhone: officialPart && phonePart ? officialPart + "|" + phonePart : null,
    companyName: namePart && officialPart ? namePart + "|" + officialPart : null,
  };
}

function createBranchMerger() {
  const keyToIndex = {};
  const merged = [];

  function add(company) {
    const keys = branchDedupKeys(company);
    const branch = { npi: company.npi, address: company.address, phone: company.phone, fax: company.fax };

    const namePhoneKey = keys.namePhone ? "np:" + keys.namePhone : null;
    const companyNameKey = keys.companyName ? "cn:" + keys.companyName : null;

    let matchIndex = null;
    if (namePhoneKey && Object.prototype.hasOwnProperty.call(keyToIndex, namePhoneKey)) {
      matchIndex = keyToIndex[namePhoneKey];
    } else if (companyNameKey && Object.prototype.hasOwnProperty.call(keyToIndex, companyNameKey)) {
      matchIndex = keyToIndex[companyNameKey];
    }

    if (matchIndex != null) {
      merged[matchIndex].locations.push(branch);
    } else {
      matchIndex = merged.length;
      merged.push(Object.assign({}, company, { locations: [branch] }));
    }

    if (namePhoneKey) keyToIndex[namePhoneKey] = matchIndex;
    if (companyNameKey) keyToIndex[companyNameKey] = matchIndex;
  }

  return { add, list: () => merged, get length() { return merged.length; } };
}

async function applyPlacesEnrichment(config, supabase, companies) {
  let dataByNpi;
  try {
    dataByNpi = await Foursquare.enrichCompanies(config, supabase, companies);
  } catch (err) {
    if (err.name === "FoursquareNotConfiguredError") {
      console.log("[companyService] Places enrichment skipped: FOURSQUARE_SERVICE_API_KEY not set");
    } else {
      console.log("[companyService] Places enrichment failed: " + err.message);
    }
    return companies;
  }

  return companies.map((company) => {
    const data = company.npi != null ? dataByNpi[String(company.npi)] : null;
    if (!data) return company;

    return Object.assign({}, company, {
      website: data.website != null ? data.website : company.website,
      phone: company.phone || data.phone || null,
      places: { placeId: data.placeId, rating: data.rating, ratingCount: data.ratingCount, isClosed: data.isClosed },
      sources: Object.assign({}, company.sources, { places: true }),
    });
  });
}

async function tryEnrichWithOsm(supabase, company) {
  if (company.website) return company;
  try {
    const website = await Osm.lookupWebsite(supabase, company);
    if (!website) return company;
    return Object.assign({}, company, { website, sources: Object.assign({}, company.sources, { osm: true }) });
  } catch (err) {
    console.log(`[companyService] OSM enrichment failed for "${company.name}": ${err.message}`);
    return company;
  }
}

async function tryEnrichWithScrape(company) {
  if (!company.website) return company;

  try {
    const result = await Scraper.scrapeCompanyWebsite(company.website);
    if (!result.scraped) return company;

    const existingNames = new Set(company.decisionMakers.map((d) => d.name.toLowerCase()));
    const scrapedDMs = result.decisionMakers
      .filter((d) => !existingNames.has(d.name.toLowerCase()))
      .map((d) => ({ name: d.name, title: d.title, roleCategory: d.roleCategory, phone: null, source: "website", sourceUrl: d.sourceUrl }));

    return Object.assign({}, company, {
      email: company.email || result.emails[0] || null,
      decisionMakers: company.decisionMakers.concat(scrapedDMs),
      sources: Object.assign({}, company.sources, { website: true }),
    });
  } catch (err) {
    console.log(`[companyService] Scrape failed for "${company.name}": ${err.message}`);
    return company;
  }
}

let claimedNpisCache = null;
let claimedNpisCacheTime = 0;
const CLAIMED_NPIS_TTL_MS = 60000;

async function getClaimedNpisSafe(supabase) {
  const now = Date.now();
  if (claimedNpisCache && (now - claimedNpisCacheTime < CLAIMED_NPIS_TTL_MS)) {
    return claimedNpisCache;
  }
  try {
    const res = await leadsRepo.getClaimedNpis(supabase);
    claimedNpisCache = res;
    claimedNpisCacheTime = now;
    return res;
  } catch (err) {
    console.log("[companyService] Dedup check failed: " + err.message);
    return claimedNpisCache || new Set();
  }
}

async function getSearchProgressSafe(supabase, userId, criteria) {
  try {
    return await searchProgressRepo.getProgress(supabase, userId, criteria);
  } catch (err) {
    console.log("[companyService] SearchProgress resume failed: " + err.message);
    return null;
  }
}

async function saveSearchProgressSafe(supabase, userId, criteria, variantSkips, seenNpis) {
  try {
    await searchProgressRepo.saveProgress(supabase, userId, criteria, variantSkips, seenNpis);
  } catch (err) {
    console.log("[companyService] SearchProgress save failed: " + err.message);
  }
}

function buildCriteriaVariants(criteria) {
  const states = criteria.states && criteria.states.length ? criteria.states : [criteria.state || undefined];
  const taxonomies = criteria.taxonomyDescriptions && criteria.taxonomyDescriptions.length ? criteria.taxonomyDescriptions : [criteria.taxonomyDescription || undefined];

  const variants = [];
  states.forEach((state) => {
    taxonomies.forEach((taxonomyDescription) => {
      variants.push(Object.assign({}, criteria, { state, taxonomyDescription }));
    });
  });
  return variants;
}

function variantKey(variant) {
  return (variant.state || "") + "|" + (variant.taxonomyDescription || "");
}

async function fetchFreshProviders(config, criteria, desiredLimit, claimedNpis) {
  const variants = criteria.npi ? [criteria] : buildCriteriaVariants(criteria);
  const mergeBranches = !criteria.npi;
  const merger = createBranchMerger();

  const fresh = [];
  let totalScanned = 0;
  let excludedAsClaimed = 0;
  const seenNpis = {};
  (criteria.excludeNpis || []).forEach((npi) => (seenNpis[String(npi)] = true));

  let variantSkips = Object.assign({}, criteria.variantSkips || {});
  let fetchesUsed = 0;
  let hitScanBudget = false;
  const rejectedVariants = [];

  const acceptedCount = () => (mergeBranches ? merger.length : fresh.length);

  const variantExhausted = variants.map((variant) => (variantSkips[variantKey(variant)] || 0) > NPPES_MAX_SKIP);
  const anyVariantLeft = () => variantExhausted.some((done) => !done);

  while (acceptedCount() < desiredLimit && !hitScanBudget && anyVariantLeft()) {
    const remainingVariants = variantExhausted.filter((done) => !done).length;
    const roundQuota = Math.max(1, Math.ceil((desiredLimit - acceptedCount()) / remainingVariants));

    const activeIndices = [];
    for (let v = 0; v < variants.length; v++) {
      if (!variantExhausted[v] && fetchesUsed + activeIndices.length < MAX_NPPES_FETCHES_PER_REQUEST) {
        activeIndices.push(v);
        if (activeIndices.length >= 5) break;
      }
    }
    if (activeIndices.length === 0) {
      if (fetchesUsed >= MAX_NPPES_FETCHES_PER_REQUEST) hitScanBudget = true;
      break;
    }
    fetchesUsed += activeIndices.length;

    const batchResults = await Promise.all(
      activeIndices.map(async (v) => {
        const variant = variants[v];
        const key = variantKey(variant);
        const skip = variantSkips[key] || 0;
        try {
          const res = await Nppes.searchProviders(config, Object.assign({}, variant, { limit: NPPES_PAGE_SIZE, skip }));
          return { v, key, skip, res, err: null };
        } catch (err) {
          return { v, key, skip, res: null, err };
        }
      })
    );

    for (const item of batchResults) {
      const { v, key, skip: currentSkip, res, err } = item;
      if (err) {
        console.log("[companyService] NPPES query variant failed, skipping it: " + key + " -- " + err.message);
        rejectedVariants.push({ state: variants[v].state || null, taxonomyDescription: variants[v].taxonomyDescription || null, message: err.message });
        variantExhausted[v] = true;
        continue;
      }
      const results = res.results;
      const fetched = res.rawCount != null ? res.rawCount : results.length;

      if (fetched === 0) {
        variantExhausted[v] = true;
      } else {
        totalScanned += fetched;
        const acceptedBeforeThisTurn = acceptedCount();
        for (let i = 0; i < results.length; i++) {
          if (acceptedCount() >= desiredLimit) break;
          if (acceptedCount() - acceptedBeforeThisTurn >= roundQuota) break;
          const provider = results[i];
          if (provider.npi && Object.prototype.hasOwnProperty.call(seenNpis, String(provider.npi))) continue;

          const isClaimed = provider.npi && claimedNpis.has(String(provider.npi));
          if (isClaimed) {
            excludedAsClaimed++;
          } else {
            fresh.push(provider);
            if (mergeBranches) merger.add(fromNppesProvider(provider));
          }
          if (provider.npi) seenNpis[String(provider.npi)] = true;
        }

        const nextSkip = currentSkip + NPPES_PAGE_SIZE;
        variantSkips[key] = nextSkip;
        if (fetched < NPPES_PAGE_SIZE || nextSkip > NPPES_MAX_SKIP) {
          variantExhausted[v] = true;
        }
      }
    }
  }

  return {
    companies: mergeBranches ? merger.list() : fresh.map(fromNppesProvider),
    totalScanned,
    excludedAsClaimed,
    variantSkips,
    hitScanBudget,
    allSeenNpis: Object.keys(seenNpis),
    rejectedVariants,
  };
}

export async function searchCompanies(config, supabase, criteria = {}, options = {}) {
  const requireCmsClaims = Boolean(options.requireCmsClaims || criteria.requireCmsClaims);
  const enrichPlaces = options.enrichPlaces !== false;
  const scrapeWebsites = Boolean(options.scrapeWebsites);
  const enrichCms = requireCmsClaims || options.enrichCms !== false;

  const desiredLimit = criteria.limit || 20;
  const claimedNpis = await getClaimedNpisSafe(supabase);

  const trackProgress = Boolean(options.userId) && !criteria.npi;
  let effectiveCriteria = criteria;
  if (trackProgress && !options.clientProvidedVariantSkips) {
    const progress = await getSearchProgressSafe(supabase, options.userId, criteria);
    if (progress) {
      effectiveCriteria = Object.assign({}, criteria, {
        variantSkips: progress.variantSkips,
        excludeNpis: (criteria.excludeNpis || []).concat(progress.seenNpis),
      });
    }
  }

  const fetchResult = await fetchFreshProviders(config, effectiveCriteria, desiredLimit, claimedNpis);
  const totalScanned = fetchResult.totalScanned;
  const excludedAsClaimed = fetchResult.excludedAsClaimed;
  let companies = fetchResult.companies;

  if (trackProgress) {
    await saveSearchProgressSafe(supabase, options.userId, criteria, fetchResult.variantSkips, fetchResult.allSeenNpis);
  }

  if (enrichPlaces) {
    companies = await applyPlacesEnrichment(config, supabase, companies);
    companies = await Promise.all(companies.map((c) => tryEnrichWithOsm(supabase, c)));
  }
  if (scrapeWebsites) {
    companies = await Promise.all(companies.map(tryEnrichWithScrape));
  }
  if (enrichCms) {
    const medicareByNpi = await Cms.lookupByNpis(supabase, companies.map((c) => c.npi));
    companies = companies.map((company) => {
      const medicare = company.npi != null ? medicareByNpi[String(company.npi)] : null;
      if (!medicare) return company;
      return Object.assign({}, company, { medicare, sources: Object.assign({}, company.sources, { cms: true }) });
    });
  }

  if (requireCmsClaims) {
    companies = companies.filter((company) => company.medicare && typeof company.medicare.totalClaims === "number" && company.medicare.totalClaims > 0);
  }

  companies = companies.map((company) => Object.assign({}, company, { score: scoreCompany(company) }));
  companies.sort((a, b) => b.score.value - a.score.value);

  return {
    count: companies.length,
    scannedFromRegistry: totalScanned,
    excludedAsClaimed,
    exhaustedRegistry: companies.length < desiredLimit && !fetchResult.hitScanBudget,
    variantSkips: fetchResult.variantSkips,
    rejectedVariants: fetchResult.rejectedVariants,
    companies,
  };
}
