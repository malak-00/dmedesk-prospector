// Port of backend/src/services/nppes.service.js.
// axios -> UrlFetchApp; everything else (normalization, pagination contract)
// is unchanged since NPPES is a plain public JSON API.

var NppesService = (function () {
  var BASE_URL = "https://npiregistry.cms.hhs.gov/api/";

  function buildQueryString(params) {
    var parts = [];
    for (var key in params) {
      if (params[key] === undefined || params[key] === null) continue;
      parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(params[key]));
    }
    return parts.join("&");
  }

  function fetchFromNppes(params) {
    var url = BASE_URL + "?" + buildQueryString(
      Object.assign({ version: Config.nppesVersion() }, params)
    );

    var response;
    try {
      response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    } catch (err) {
      var unreachable = new Error("Failed to reach NPPES API");
      unreachable.status = 504;
      unreachable.details = String(err);
      throw unreachable;
    }

    var code = response.getResponseCode();
    if (code >= 400) {
      var upstreamError = new Error("NPPES API responded with status " + code);
      upstreamError.status = 502;
      upstreamError.details = response.getContentText();
      throw upstreamError;
    }

    return JSON.parse(response.getContentText());
  }

  // Normalizes a single raw NPPES result into a lean, predictable shape --
  // same intent as the Node version, not yet the final unified Company model.
  function normalizeProvider(raw) {
    var basic = raw.basic || {};
    var addresses = raw.addresses || [];
    var taxonomies = raw.taxonomies || [];

    var primaryAddress = null;
    for (var i = 0; i < addresses.length; i++) {
      if (addresses[i].address_purpose === "LOCATION") { primaryAddress = addresses[i]; break; }
    }
    if (!primaryAddress) primaryAddress = addresses[0] || {};

    var primaryTaxonomy = null;
    for (var j = 0; j < taxonomies.length; j++) {
      if (taxonomies[j].primary) { primaryTaxonomy = taxonomies[j]; break; }
    }
    if (!primaryTaxonomy) primaryTaxonomy = taxonomies[0] || {};

    var isOrganization = raw.enumeration_type === "NPI-2";

    var authorizedOfficial = null;
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
      name: isOrganization
        ? basic.organization_name
        : [basic.first_name, basic.last_name].filter(Boolean).join(" "),
      isOrganization: isOrganization,
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
      authorizedOfficial: authorizedOfficial,
    };
  }

  // criteria: { organizationName, city, state, postalCode, taxonomyDescription, limit=20, skip=0 }
  function searchProviders(criteria) {
    criteria = criteria || {};
    var limit = criteria.limit || 20;
    var skip = criteria.skip || 0;

    var data = fetchFromNppes({
      enumeration_type: "NPI-2",
      organization_name: criteria.organizationName || undefined,
      city: criteria.city || undefined,
      state: criteria.state || undefined,
      postal_code: criteria.postalCode || undefined,
      taxonomy_description: criteria.taxonomyDescription || undefined,
      limit: limit,
      skip: skip,
    });

    var results = Array.isArray(data.results) ? data.results.map(normalizeProvider) : [];

    return {
      count: data.result_count != null ? data.result_count : results.length,
      results: results,
    };
  }

  return { searchProviders: searchProviders };
})();
