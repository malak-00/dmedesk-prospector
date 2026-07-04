import axios from "axios";
import config from "../config/index.js";

const NPPES_BASE_URL = "https://npiregistry.cms.hhs.gov/api/";

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
    if (n < 1e11) n = n * 1000; // seconds -> ms
    const d = new Date(n);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }

  return null;
}

function extractLastUpdated(raw, basic) {
  return parseNppesDate(basic.last_updated) || parseNppesDate(raw.last_updated_epoch);
}

/**
 * Raw call to the NPPES NPI Registry API.
 * Kept private to this module — controllers never see raw NPPES shapes.
 */
async function fetchFromNppes(params) {
  try {
    const response = await axios.get(NPPES_BASE_URL, {
      params: {
        version: config.nppesVersion,
        ...params,
      },
      timeout: 10000,
    });
    return response.data;
  } catch (err) {
    // Distinguish "NPPES responded with an error" from "we couldn't reach it"
    if (err.response) {
      const error = new Error(
        `NPPES API responded with status ${err.response.status}`
      );
      error.status = 502; // Bad Gateway — upstream provider failed
      error.details = err.response.data;
      throw error;
    }

    const error = new Error("Failed to reach NPPES API");
    error.status = 504; // Gateway Timeout
    error.details = err.message;
    throw error;
  }
}

/**
 * Normalizes a single raw NPPES result into a lean, predictable shape.
 * This is intentionally NOT the final unified Company model yet —
 * just a clean NPPES-specific representation.
 */
function normalizeProvider(raw) {
  const basic = raw.basic || {};
  const addresses = raw.addresses || [];
  const taxonomies = raw.taxonomies || [];

  const primaryAddress =
    addresses.find((a) => a.address_purpose === "LOCATION") ||
    addresses[0] ||
    {};

  const primaryTaxonomy = taxonomies.find((t) => t.primary) || taxonomies[0] || {};

  const isOrganization = raw.enumeration_type === "NPI-2";

  const lastUpdated = extractLastUpdated(raw, basic);

  const authorizedOfficial =
  isOrganization && basic.authorized_official_last_name
    ? {
        firstName: basic.authorized_official_first_name || null,
        lastName: basic.authorized_official_last_name || null,
        credential: basic.authorized_official_credential || null,
        title: basic.authorized_official_title_or_position || null,
        phone: basic.authorized_official_telephone_number || null,
      }
    : null;

  return {
    npi: raw.number,
    enumerationType: raw.enumeration_type, // "NPI-1" (individual) or "NPI-2" (org)
    name: isOrganization
      ? basic.organization_name
      : [basic.first_name, basic.last_name].filter(Boolean).join(" "),
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
    lastUpdated, // "YYYY-MM-DD" or null
  };
}

/**
 * Public search function used by the controller layer.
 *
 * @param {Object} criteria
 * @param {string} [criteria.organizationName]
 * @param {string} [criteria.city]
 * @param {string} [criteria.state]
 * @param {string} [criteria.postalCode]
 * @param {string} [criteria.taxonomyDescription]
 * @param {number} [criteria.limit=20]
 * @returns {Promise<{count: number, results: Array<Object>}>}
 */
export async function searchProviders(criteria = {}) {
  const {
    organizationName,
    nameContains,
    city,
    state,
    postalCode,
    taxonomyDescription,
    lastUpdatedYear,
    limit = 20,
    skip = 0,
  } = criteria;

  const params = {
    enumeration_type: "NPI-2",
    organization_name: organizationName || undefined,
    city: city || undefined,
    state: state || undefined,
    postal_code: postalCode || undefined,
    taxonomy_description: taxonomyDescription || undefined,
    limit,
    skip,
  };

  const data = await fetchFromNppes(params);

  let results = Array.isArray(data.results)
    ? data.results.map(normalizeProvider)
    : [];

  // How many NPPES actually sent back for this page, before our local
  // filters below trim it. Pagination must use this -- not the filtered
  // length -- to decide whether NPPES has more pages.
  const rawCount = results.length;

  // NPPES's taxonomy_description filter doesn't reliably behave as a strict
  // match -- it can return unrelated taxonomies (pharmacy, home contractor,
  // transport, etc.) alongside genuine matches when the term isn't an exact
  // registered taxonomy string. Enforce it ourselves as a safety net so a
  // DME search doesn't surface unrelated provider types.
  if (taxonomyDescription) {
    const term = taxonomyDescription.toLowerCase();
    results = results.filter((r) => r.taxonomy?.description?.toLowerCase().includes(term));
  }

  // NPPES's organization_name only matches from the start of the name
  // (trailing wildcard allowed, leading wildcard not supported), so a
  // "name contains" search can't be expressed in the API query at all --
  // it has to be a local substring filter over fetched pages.
  if (nameContains) {
    const term = nameContains.toLowerCase();
    results = results.filter((r) => r.name?.toLowerCase().includes(term));
  }

  // Filters to providers whose NPPES record was last updated in a given
  // year (the registry's own "Last Updated" field, not our claimed-lead
  // tracking). NPPES has no server-side way to query this, so -- same as
  // taxonomy/nameContains above -- it's a local filter and must not affect
  // the rawCount-based pagination check.
  if (lastUpdatedYear) {
    const yearTerm = String(lastUpdatedYear);
    results = results.filter((r) => r.lastUpdated?.slice(0, 4) === yearTerm);
  }

  return {
    count: data.result_count ?? results.length,
    rawCount,
    results,
  };
}

export default { searchProviders };