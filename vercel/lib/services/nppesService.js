// Port of appscript/services/NppesService.js -- UrlFetchApp -> native fetch
// (Node 18+); everything else (normalization, retry, pagination contract,
// the local state/taxonomy/nameContains/year/excludeKeywords re-filtering)
// is unchanged, since NPPES is a plain public JSON API either way.

import config from "../config.js";

const BASE_URL = "https://npiregistry.cms.hhs.gov/api/";
const MAX_ATTEMPTS = 2; // one retry, for transient failures only
const RETRY_DELAY_MS = 400;

function buildQueryString(params) {
  const parts = [];
  for (const key of Object.keys(params)) {
    if (params[key] === undefined || params[key] === null) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`);
  }
  return parts.join("&");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// One attempt at the request. Never throws for a bad HTTP status -- callers
// decide whether that's retryable based on `retryable`.
async function attemptFetch(url) {
  let response;
  try {
    response = await fetch(url);
  } catch (err) {
    const unreachable = new Error("Failed to reach NPPES API");
    unreachable.status = 504;
    unreachable.details = String(err);
    return { ok: false, retryable: true, error: unreachable };
  }

  if (response.status >= 400) {
    const upstreamError = new Error(`NPPES API responded with status ${response.status}`);
    upstreamError.status = 502;
    upstreamError.details = await response.text().catch(() => "");
    // A 5xx is NPPES's own transient trouble, worth one retry; a 4xx is a
    // real problem with the request itself and won't change on retry.
    return { ok: false, retryable: response.status >= 500, error: upstreamError };
  }

  const data = await response.json();

  // NPPES rejects some query shapes (e.g. a bare state with no name,
  // taxonomy, or NPI) with an HTTP 200 whose body is just an "Errors" array
  // instead of a real 4xx -- left unchecked, that silently looks like "zero
  // real results" to the rest of the pipeline instead of the rejection it
  // actually is. Surface it as a real, non-retryable error.
  if (Array.isArray(data.Errors) && data.Errors.length > 0) {
    const rejectionError = new Error(`NPPES rejected the search: ${data.Errors.map((e) => e.description).join("; ")}`);
    rejectionError.status = 400;
    return { ok: false, retryable: false, error: rejectionError };
  }

  return { ok: true, data };
}

async function fetchFromNppes(params) {
  const url = `${BASE_URL}?${buildQueryString({ version: config.nppesVersion, ...params })}`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await attemptFetch(url);
    if (result.ok) return result.data;
    if (!result.retryable || attempt === MAX_ATTEMPTS) throw result.error;
    await sleep(RETRY_DELAY_MS);
  }
}

// NPPES exposes a provider's last-updated date two ways: basic.last_updated
// as a ready-to-use "YYYY-MM-DD" string (what the public registry site
// displays), and a top-level last_updated_epoch (seconds) as a fallback.
// Handle both shapes rather than assuming one.
function parseNppesDate(value) {
  if (value === undefined || value === null || value === "") return null;
  const str = String(value);

  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];

  const mdy = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1]}-${mdy[2]}`;

  if (/^\d+$/.test(str)) {
    let n = Number(str);
    if (n < 1e11) n *= 1000; // seconds -> ms
    const d = new Date(n);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }

  return null;
}

function extractLastUpdated(raw, basic) {
  return parseNppesDate(basic.last_updated) || parseNppesDate(raw.last_updated_epoch);
}

// Normalizes a single raw NPPES result into a lean, predictable shape.
function normalizeProvider(raw) {
  const basic = raw.basic || {};
  const addresses = raw.addresses || [];
  const taxonomies = raw.taxonomies || [];

  const primaryAddress = addresses.find((a) => a.address_purpose === "LOCATION") || addresses[0] || {};
  const primaryTaxonomy = taxonomies.find((t) => t.primary) || taxonomies[0] || {};

  const isOrganization = raw.enumeration_type === "NPI-2";

  let authorizedOfficial = null;
  if (isOrganization && basic.authorized_official_last_name) {
    authorizedOfficial = {
      firstName: basic.authorized_official_first_name || null,
      lastName: basic.authorized_official_last_name || null,
      credential: basic.authorized_official_credential || null,
      title: basic.authorized_official_title_or_position || null,
      phone: basic.authorized_official_telephone_number || null,
    };
  }

  return {
    npi: raw.number,
    enumerationType: raw.enumeration_type, // "NPI-1" (individual) or "NPI-2" (org)
    name: isOrganization ? basic.organization_name : [basic.first_name, basic.last_name].filter(Boolean).join(" "),
    isOrganization,
    status: basic.status || null,
    address: {
      line1: primaryAddress.address_1 || null,
      line2: primaryAddress.address_2 || null,
      city: primaryAddress.city || null,
      state: primaryAddress.state || null,
      postalCode: primaryAddress.postal_code || null,
      countryCode: primaryAddress.country_code || null,
    },
    phone: primaryAddress.telephone_number || null,
    taxonomy: {
      code: primaryTaxonomy.code || null,
      description: primaryTaxonomy.desc || null,
      license: primaryTaxonomy.license || null,
      state: primaryTaxonomy.state || null,
    },
    authorizedOfficial,
    lastUpdated: extractLastUpdated(raw, basic), // "YYYY-MM-DD" or null
  };
}

// criteria: { npi, organizationName, city, state, taxonomyDescription, limit=20, skip=0 }
export async function searchProviders(criteria = {}) {
  const limit = criteria.limit || 20;
  const skip = criteria.skip || 0;

  // An exact NPI lookup is unambiguous -- it identifies at most one record,
  // so none of the fuzzy name/taxonomy/year filters below should apply.
  // enumeration_type is also skipped so a sole-proprietor (NPI-1) lookup
  // isn't excluded just because this app otherwise targets organizations.
  const isExactNpiLookup = Boolean(criteria.npi);

  const data = await fetchFromNppes({
    number: criteria.npi || undefined,
    enumeration_type: isExactNpiLookup ? undefined : "NPI-2",
    organization_name: isExactNpiLookup ? undefined : criteria.organizationName || undefined,
    city: isExactNpiLookup ? undefined : criteria.city || undefined,
    state: isExactNpiLookup ? undefined : criteria.state || undefined,
    taxonomy_description: isExactNpiLookup ? undefined : criteria.taxonomyDescription || undefined,
    limit,
    skip,
  });

  let results = Array.isArray(data.results) ? data.results.map(normalizeProvider) : [];

  // How many NPPES actually sent back for this page, before our local
  // filters below trim it. Pagination must use this -- not the filtered
  // length -- to decide whether NPPES has more pages.
  const rawCount = results.length;

  if (!isExactNpiLookup) {
    // NPPES's state filter can match against ANY address it has on file for
    // a provider (e.g. a mailing address), not specifically the practice/
    // service-location address this app actually displays -- enforce it
    // ourselves against the same primaryAddress shown in the UI.
    if (criteria.state) {
      const stateUpper = String(criteria.state).toUpperCase();
      results = results.filter((r) => r.address?.state && String(r.address.state).toUpperCase() === stateUpper);
    }

    // NPPES's taxonomy_description filter doesn't reliably behave as a
    // strict match -- enforce it ourselves as a safety net.
    if (criteria.taxonomyDescription) {
      const term = criteria.taxonomyDescription.toLowerCase();
      results = results.filter((r) => r.taxonomy?.description && r.taxonomy.description.toLowerCase().includes(term));
    }

    // NPPES's organization_name only matches from the start of the name, so
    // a "name contains" search can't be expressed in the API query at all --
    // local substring filter, OR match across every keyword.
    // `nameContainsTerms` (array, multi-keyword chip input) is preferred;
    // the older singular `nameContains` is still honored for back-compat.
    const nameTerms = criteria.nameContainsTerms?.length
      ? criteria.nameContainsTerms.map((t) => String(t).toLowerCase())
      : criteria.nameContains
        ? [String(criteria.nameContains).toLowerCase()]
        : [];
    if (nameTerms.length) {
      results = results.filter((r) => {
        const nameLower = (r.name || "").toLowerCase();
        return nameTerms.some((term) => term && nameLower.includes(term));
      });
    }

    // Filters to providers whose NPPES record was last updated in one of the
    // given years -- OR match, local filter (no server-side equivalent).
    const yearTerms = criteria.lastUpdatedYears?.length
      ? criteria.lastUpdatedYears.map(String)
      : criteria.lastUpdatedYear
        ? [String(criteria.lastUpdatedYear)]
        : [];
    if (yearTerms.length) {
      results = results.filter((r) => r.lastUpdated && yearTerms.includes(r.lastUpdated.slice(0, 4)));
    }

    // Excludes any provider whose organization name contains one of the
    // user's saved/typed exclusion keywords.
    if (criteria.excludeKeywords?.length) {
      const excludeTerms = criteria.excludeKeywords.map((k) => String(k).toLowerCase());
      results = results.filter((r) => {
        const nameLower = (r.name || "").toLowerCase();
        return !excludeTerms.some((term) => term && nameLower.includes(term));
      });
    }
  }

  return {
    count: data.result_count != null ? data.result_count : results.length,
    rawCount,
    results,
  };
}

export default { searchProviders };
