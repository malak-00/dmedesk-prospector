import axios from "axios";
import config from "../config/index.js";

const NPPES_BASE_URL = "https://npiregistry.cms.hhs.gov/api/";

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
    city,
    state,
    postalCode,
    taxonomyDescription,
    limit = 20,
  } = criteria;

  const params = {
    enumeration_type: "NPI-2", // organizations only — DME suppliers are orgs, not individuals
    organization_name: organizationName || undefined,
    city: city || undefined,
    state: state || undefined,
    postal_code: postalCode || undefined,
    taxonomy_description: taxonomyDescription || undefined,
    limit,
  };

  const data = await fetchFromNppes(params);

  const results = Array.isArray(data.results)
    ? data.results.map(normalizeProvider)
    : [];

  return {
    count: data.result_count ?? results.length,
    results,
  };
}

export default { searchProviders };