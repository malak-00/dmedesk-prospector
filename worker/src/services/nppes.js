// Port of appscript/services/NppesService.js -- UrlFetchApp -> fetch, and
// the retry loop uses a real async sleep instead of Utilities.sleep.
// Everything else (normalization, pagination contract, local filters) is
// unchanged since NPPES is a plain public JSON API.
//
// Points at fakeNPI (github.com/prodbyabdo/fakeNPI), our self-hosted NPPES
// replica, via config.fakeNpiBaseUrl() -- same request/response shape as
// the real NPPES API, confirmed working, but with no cap on `skip`.
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 400;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildQueryString(params) {
  const parts = [];
  for (const key of Object.keys(params)) {
    if (params[key] === undefined || params[key] === null) continue;
    parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(params[key]));
  }
  return parts.join("&");
}

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

  const code = response.status;
  if (code >= 400) {
    const upstreamError = new Error("NPPES API responded with status " + code);
    upstreamError.status = 502;
    upstreamError.details = await response.text().catch(() => "");
    return { ok: false, retryable: code >= 500, error: upstreamError };
  }

  const data = await response.json();

  if (Array.isArray(data.Errors) && data.Errors.length > 0) {
    const rejectionError = new Error(
      "NPPES rejected the search: " + data.Errors.map((e) => e.description).join("; ")
    );
    rejectionError.status = 400;
    return { ok: false, retryable: false, error: rejectionError };
  }

  return { ok: true, data };
}

async function fetchFromNppes(config, params) {
  const url = config.fakeNpiBaseUrl() + "?" + buildQueryString(Object.assign({ version: config.nppesVersion() }, params));

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await attemptFetch(url);
    if (result.ok) return result.data;
    if (!result.retryable || attempt === MAX_ATTEMPTS) throw result.error;
    await sleep(RETRY_DELAY_MS);
  }
}

function parseNppesDate(value) {
  if (value === undefined || value === null || value === "") return null;
  const str = String(value);

  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];

  const mdy = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (mdy) return mdy[3] + "-" + mdy[1] + "-" + mdy[2];

  if (/^\d+$/.test(str)) {
    let n = Number(str);
    if (n < 1e11) n = n * 1000;
    const d = new Date(n);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }

  return null;
}

function extractLastUpdated(raw, basic) {
  return parseNppesDate(basic.last_updated) || parseNppesDate(raw.last_updated_epoch);
}

// fakeNPI-only extension (not part of the real NPPES API): every result
// carries a `medicare` field joined in from npi_cms_enrichment, so we get
// CMS data in the same call instead of a separate lookup per NPI (see
// cms.js -- no longer called from companyService.js because of this).
function normalizeMedicare(raw) {
  const m = raw.medicare;
  if (!m) return null;
  return {
    totalClaims: m.total_claims ?? null,
    totalServices: m.total_services ?? null,
    totalBeneficiaries: m.total_beneficiaries ?? null,
    medicarePayment: m.medicare_payment ?? null,
    medicareAllowed: m.medicare_allowed ?? null,
  };
}

function normalizeProvider(raw) {
  const basic = raw.basic || {};
  const addresses = raw.addresses || [];
  const taxonomies = raw.taxonomies || [];

  let primaryAddress = addresses.find((a) => a.address_purpose === "LOCATION") || addresses[0] || {};
  let primaryTaxonomy = taxonomies.find((t) => t.primary) || taxonomies[0] || {};

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
    enumerationType: raw.enumeration_type,
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
    fax: primaryAddress.fax_number || null,
    taxonomy: {
      code: primaryTaxonomy.code || null,
      description: primaryTaxonomy.desc || null,
      license: primaryTaxonomy.license || null,
      state: primaryTaxonomy.state || null,
    },
    authorizedOfficial,
    lastUpdated: extractLastUpdated(raw, basic),
    medicare: normalizeMedicare(raw),
  };
}

export async function searchProviders(config, criteria = {}) {
  const limit = criteria.limit || 20;
  const skip = criteria.skip || 0;
  const isExactNpiLookup = Boolean(criteria.npi);

  const data = await fetchFromNppes(config, {
    number: criteria.npi || undefined,
    enumeration_type: isExactNpiLookup ? undefined : "NPI-2",
    organization_name: isExactNpiLookup ? undefined : criteria.organizationName || undefined,
    city: isExactNpiLookup ? undefined : criteria.city || undefined,
    state: isExactNpiLookup ? undefined : criteria.state || undefined,
    // fakeNPI's npi_records has taxonomy_code populated but not
    // taxonomy_description (see header comment) -- prefer the exact-match
    // code, and only fall back to the (currently unpopulated) description
    // filter when the caller couldn't resolve a code for it.
    taxonomy_code: isExactNpiLookup ? undefined : criteria.taxonomyCode || undefined,
    taxonomy_description: isExactNpiLookup || criteria.taxonomyCode ? undefined : criteria.taxonomyDescription || undefined,
    limit,
    skip,
  });

  let results = Array.isArray(data.results) ? data.results.map(normalizeProvider) : [];
  const rawCount = results.length;

  if (!isExactNpiLookup) {
    if (criteria.state) {
      const stateUpper = String(criteria.state).toUpperCase();
      results = results.filter((r) => r.address && r.address.state && String(r.address.state).toUpperCase() === stateUpper);
    }

    if (criteria.taxonomyCode) {
      results = results.filter((r) => r.taxonomy && r.taxonomy.code === criteria.taxonomyCode);
    } else if (criteria.taxonomyDescription) {
      const term = criteria.taxonomyDescription.toLowerCase();
      results = results.filter(
        (r) => r.taxonomy && r.taxonomy.description && r.taxonomy.description.toLowerCase().indexOf(term) !== -1
      );
    }

    const nameTerms = criteria.nameContainsTerms && criteria.nameContainsTerms.length
      ? criteria.nameContainsTerms.map((t) => String(t).toLowerCase())
      : criteria.nameContains
      ? [String(criteria.nameContains).toLowerCase()]
      : [];
    if (nameTerms.length) {
      results = results.filter((r) => {
        const nameLower = (r.name || "").toLowerCase();
        return nameTerms.some((term) => term && nameLower.indexOf(term) !== -1);
      });
    }

    const yearTerms = criteria.lastUpdatedYears && criteria.lastUpdatedYears.length
      ? criteria.lastUpdatedYears.map(String)
      : criteria.lastUpdatedYear
      ? [String(criteria.lastUpdatedYear)]
      : [];
    if (yearTerms.length) {
      results = results.filter((r) => r.lastUpdated && yearTerms.indexOf(r.lastUpdated.slice(0, 4)) !== -1);
    }

    if (criteria.excludeKeywords && criteria.excludeKeywords.length) {
      const excludeTerms = criteria.excludeKeywords.map((k) => String(k).toLowerCase());
      results = results.filter((r) => {
        const nameLower = (r.name || "").toLowerCase();
        return !excludeTerms.some((term) => term && nameLower.indexOf(term) !== -1);
      });
    }
  }

  return {
    count: data.result_count != null ? data.result_count : results.length,
    rawCount,
    results,
  };
}
