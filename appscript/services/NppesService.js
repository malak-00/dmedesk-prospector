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

  // NPPES exposes a provider's last-updated date two ways: basic.last_updated
  // as a ready-to-use "YYYY-MM-DD" string (what the public registry site
  // displays), and a top-level last_updated_epoch (seconds) as a fallback.
  // Handle both shapes rather than assuming one.
  function parseNppesDate_(value) {
    if (value === undefined || value === null || value === "") return null;
    var str = String(value);

    var iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[0];

    var mdy = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (mdy) return mdy[3] + "-" + mdy[1] + "-" + mdy[2];

    if (/^\d+$/.test(str)) {
      var n = Number(str);
      if (n < 1e11) n = n * 1000; // seconds -> ms
      var d = new Date(n);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }

    return null;
  }

  function extractLastUpdated_(raw, basic) {
    return parseNppesDate_(basic.last_updated) || parseNppesDate_(raw.last_updated_epoch);
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
      lastUpdated: extractLastUpdated_(raw, basic), // "YYYY-MM-DD" or null
    };
  }

  // criteria: { npi, organizationName, city, state, postalCode, taxonomyDescription, limit=20, skip=0 }
  function searchProviders(criteria) {
    criteria = criteria || {};
    var limit = criteria.limit || 20;
    var skip = criteria.skip || 0;

    // An exact NPI lookup is unambiguous -- it identifies at most one record,
    // so none of the fuzzy name/taxonomy/year filters below should apply.
    // Applying them anyway (e.g. a stale taxonomy dropdown left at its
    // default) could silently hide the exact record the user asked for,
    // which defeats the point of a "pull this specific lead" lookup.
    // enumeration_type is also skipped so a sole-proprietor (NPI-1) lookup
    // isn't excluded just because this app otherwise targets organizations.
    var isExactNpiLookup = Boolean(criteria.npi);

    var data = fetchFromNppes({
      number: criteria.npi || undefined,
      enumeration_type: isExactNpiLookup ? undefined : "NPI-2",
      organization_name: isExactNpiLookup ? undefined : (criteria.organizationName || undefined),
      city: isExactNpiLookup ? undefined : (criteria.city || undefined),
      state: isExactNpiLookup ? undefined : (criteria.state || undefined),
      postal_code: isExactNpiLookup ? undefined : (criteria.postalCode || undefined),
      taxonomy_description: isExactNpiLookup ? undefined : (criteria.taxonomyDescription || undefined),
      limit: limit,
      skip: skip,
    });

    var results = Array.isArray(data.results) ? data.results.map(normalizeProvider) : [];

    // How many NPPES actually sent back for this page, before our local
    // filters below trim it. Pagination must use this -- not the filtered
    // length -- to decide whether NPPES has more pages.
    var rawCount = results.length;

    if (!isExactNpiLookup) {
      // NPPES's taxonomy_description filter doesn't reliably behave as a
      // strict match -- it can return unrelated taxonomies (pharmacy, home
      // contractor, transport, etc.) alongside genuine matches when the term
      // isn't an exact registered taxonomy string. Enforce it ourselves as a
      // safety net so a DME search doesn't surface unrelated provider types.
      if (criteria.taxonomyDescription) {
        var term = criteria.taxonomyDescription.toLowerCase();
        results = results.filter(function (r) {
          return r.taxonomy && r.taxonomy.description && r.taxonomy.description.toLowerCase().indexOf(term) !== -1;
        });
      }

      // NPPES's organization_name only matches from the start of the name
      // (trailing wildcard allowed, leading wildcard not supported), so a
      // "name contains" search can't be expressed in the API query at all --
      // it has to be a local substring filter over fetched pages.
      if (criteria.nameContains) {
        var nameTerm = criteria.nameContains.toLowerCase();
        results = results.filter(function (r) {
          return r.name && r.name.toLowerCase().indexOf(nameTerm) !== -1;
        });
      }

      // Filters to providers whose NPPES record was last updated in a given
      // year (the registry's own "Last Updated" field, not our claimed-lead
      // tracking). NPPES has no server-side way to query this, so -- same as
      // taxonomy/nameContains above -- it's a local filter and must not
      // affect the rawCount-based pagination check.
      if (criteria.lastUpdatedYear) {
        var yearTerm = String(criteria.lastUpdatedYear);
        results = results.filter(function (r) {
          return r.lastUpdated && r.lastUpdated.slice(0, 4) === yearTerm;
        });
      }
    }

    return {
      count: data.result_count != null ? data.result_count : results.length,
      rawCount: rawCount,
      results: results,
    };
  }

  return { searchProviders: searchProviders };
})();
