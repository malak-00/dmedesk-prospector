// Provider search against this project's own npi_records (sql/018's
// search_providers), as an alternative to the mirror project over HTTP
// (nppes.js). Same criteria in, same shape out -- providerSource.js picks
// between them -- so nothing downstream knows or cares which one answered.
//
// The differences that matter are both in our favour: every filter runs in
// SQL rather than half of them in the Worker after paging, so a page of 200
// is 200 usable rows; and it's a database call inside the same project
// rather than an HTTP round trip to a Nano-tier instance that 500s when
// several searches land at once.

import { toFilterPayload } from "../lib/searchFilters.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Postgres numerics arrive as strings through some drivers and as numbers
// through others. The mirror always returns numbers, and scoring does
// arithmetic on these, so they are numbers here too whatever the driver did.
function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// One flat row from search_providers -> the shape nppes.js's
// normalizeProvider produces. Kept literal on purpose: every field here has
// a counterpart there, and a missing one shows up as a blank in the UI
// rather than an error.
function toProvider(row) {
  const isOrganization = row.is_organization !== false;
  const hasOfficial = Boolean(row.official_last_name || row.official_first_name);
  const medicare =
    row.medicare_total_claims != null ||
    row.medicare_total_services != null ||
    row.medicare_total_beneficiaries != null ||
    row.medicare_payment != null ||
    row.medicare_allowed != null;

  return {
    npi: String(row.npi),
    enumerationType: row.enumeration_type || (isOrganization ? "NPI-2" : "NPI-1"),
    name: row.name || null,
    isOrganization,
    status: row.status || null,
    address: {
      line1: row.address_line1 || null,
      line2: row.address_line2 || null,
      city: row.city || null,
      state: row.state || null,
      postalCode: row.postal_code || null,
      countryCode: row.country_code || null,
    },
    phone: row.phone || null,
    taxonomy: {
      code: row.taxonomy_code || null,
      description: row.taxonomy_description || null,
      // npi_records keeps one taxonomy per provider, without the licence
      // and licence-state the NPPES API returns. Nothing reads them.
      license: null,
      state: null,
    },
    authorizedOfficial:
      isOrganization && hasOfficial
        ? {
            firstName: row.official_first_name || null,
            lastName: row.official_last_name || null,
            credential: row.official_credential || null,
            title: row.official_title || null,
            phone: row.official_phone || null,
          }
        : null,
    lastUpdated: row.last_updated || null,
    medicare: medicare
      ? {
          totalClaims: toNumber(row.medicare_total_claims),
          totalServices: toNumber(row.medicare_total_services),
          totalBeneficiaries: toNumber(row.medicare_total_beneficiaries),
          medicarePayment: toNumber(row.medicare_payment),
          medicareAllowed: toNumber(row.medicare_allowed),
        }
      : null,
  };
}

export async function searchProviders(supabase, criteria = {}) {
  const limit = criteria.limit || 20;
  const skip = criteria.skip || 0;

  // Every search of DME Desk's own table goes through sql/021's
  // search_providers_v2 (kept current by sql/022 and sql/024).
  const payload = Object.assign(toFilterPayload(criteria, { collapsed: Boolean(criteria.collapsed) }),
    criteria.includeCount === false ? { includeCount: false } : {});

  const { data, error } = await supabase.rpc("search_providers_v2", {
    p_criteria: payload,
    p_limit: limit,
    p_skip: skip,
  });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883" || /Could not find the function/i.test(error.message || "")) {
      throw httpError(503, "Searching DME Desk's own provider table isn't installed yet. Run sql/021_search_insights.sql and sql/022_search_speed.sql, or set NPI_SOURCE=mirror.");
    }
    throw httpError(502, "Provider search failed: " + error.message);
  }

  const rows = data || [];
  const results = rows.map(toProvider);
  return {
    // Every row carries the same match count; with no rows there is nothing
    // to carry, and nothing matched. Counting stops at sql/018's cap, so a
    // very broad search reports "this many or more" -- countCapped says so,
    // and paging past it is unaffected. A caller that asked not to count
    // gets the size of the page it was given, which is all it reads anyway.
    count: rows.length ? (rows[0].total_count == null ? results.length : Number(rows[0].total_count)) : 0,
    countCapped: rows.length ? rows[0].count_capped === true : false,
    // The mirror returns a page and then loses rows to filters the Worker
    // applies afterwards; here the two are always the same number. Kept so
    // callers (companyService's paging loop) can treat both sources alike.
    rawCount: results.length,
    results,
  };
}
