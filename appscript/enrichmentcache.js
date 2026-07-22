// Thin wrapper around CacheService for NPI-keyed enrichment results
// (Foursquare, OSM, CMS). All three enrichment sources are keyed by NPI and
// rarely change minute to minute, so caching them avoids re-fetching the
// same data every time a search is re-run with slightly different filters --
// this matters because every teammate's UrlFetch calls draw from the same
// Apps Script owner's daily quota.
//
// Distinguishes "never looked up" (undefined) from "looked up, found
// nothing" (null/false/etc, still a real cached value) so a confirmed-empty
// result isn't refetched every time either.

var EnrichmentCache = (function () {
  var TTL_SECONDS = 3600; // 1h -- balances quota savings against data freshness

  function key_(namespace, npi) {
    return "enrich_" + namespace + "_" + npi;
  }

  // Returns the cached value, or undefined on a cache miss.
  function get(namespace, npi) {
    if (!npi) return undefined;
    var raw = CacheService.getScriptCache().get(key_(namespace, npi));
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw);
    } catch (err) {
      return undefined;
    }
  }

  function put(namespace, npi, value) {
    if (!npi) return;
    CacheService.getScriptCache().put(key_(namespace, npi), JSON.stringify(value === undefined ? null : value), TTL_SECONDS);
  }

  return { get: get, put: put };
})();