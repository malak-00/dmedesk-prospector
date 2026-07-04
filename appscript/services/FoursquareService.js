// Port of backend/src/services/foursquare.service.js.
// Custom "not configured" error still exists so Code.js can distinguish
// "not configured" (skip gracefully) from "actually failed" (report it).
//
// enrichCompanies() looks up a whole batch of companies in parallel via
// UrlFetchApp.fetchAll (one HTTP round-trip total, not one per company) and
// checks EnrichmentCache first so a company already looked up recently never
// re-hits the network at all -- both matter because Apps Script Web Apps run
// serially and every teammate's calls draw from the same daily quota.

var FoursquareNotConfiguredError = function () {
  var err = new Error("FOURSQUARE_SERVICE_API_KEY is not configured");
  err.name = "FoursquareNotConfiguredError";
  return err;
};

var FoursquareService = (function () {
  var BASE_URL = "https://places-api.foursquare.com/places/search";
  var API_VERSION = "2025-06-17";
  // If rating/stats fields ever get billed as Premium on your account,
  // remove "rating" and "stats" from this list -- everything else stays free-tier Pro.
  var FIELDS = "fsq_place_id,name,tel,website,rating,stats,location,date_closed";
  var CACHE_NAMESPACE = "fsq";

  function assertConfigured() {
    if (!Config.foursquareApiKey()) throw FoursquareNotConfiguredError();
  }

  function buildRequest_(company) {
    var address = company.address || {};
    var near = [address.city, address.state].filter(Boolean).join(", ");
    if (!company.name || !near) return null;

    var query =
      "?query=" + encodeURIComponent(company.name) +
      "&near=" + encodeURIComponent(near) +
      "&fields=" + encodeURIComponent(FIELDS) +
      "&limit=1";

    return {
      url: BASE_URL + query,
      muteHttpExceptions: true,
      headers: {
        Authorization: "Bearer " + Config.foursquareApiKey(),
        "X-Places-Api-Version": API_VERSION,
        Accept: "application/json",
      },
    };
  }

  // Parses one response from the batch. Returns { ok, data } rather than
  // throwing on a bad status -- one company's request failing (rate limit,
  // transient 5xx, etc.) must not discard every other company's results in
  // the same batch, the way a single .map()'d call used to only affect
  // itself. `ok: false` also signals the caller not to cache the failure as
  // if it were a confirmed "no data found".
  function parseResponse_(response, companyName) {
    var code = response.getResponseCode();
    if (code >= 400) {
      console.log("[FoursquareService] API responded with status " + code + " for \"" + companyName + "\"");
      return { ok: false, data: null };
    }

    var data;
    try {
      data = JSON.parse(response.getContentText());
    } catch (err) {
      console.log("[FoursquareService] Failed to parse response for \"" + companyName + "\": " + err);
      return { ok: false, data: null };
    }

    var place = data.results && data.results[0];
    if (!place) return { ok: true, data: null };

    return {
      ok: true,
      data: {
        placeId: place.fsq_place_id || null,
        website: place.website || null,
        phone: place.tel || null,
        rating: typeof place.rating === "number" ? place.rating : null,
        ratingCount: place.stats ? (place.stats.total_ratings != null ? place.stats.total_ratings : null) : null,
        isClosed: Boolean(place.date_closed),
      },
    };
  }

  // Returns a plain object mapping NPI -> enrichment data (or null when no
  // match was found / the company had no usable name+location). Throws
  // FoursquareNotConfiguredError if unset; throws only if the whole batch
  // request couldn't be sent at all (network unreachable) -- an individual
  // company's bad response degrades to null for that company only.
  function enrichCompanies(companies) {
    assertConfigured();

    var results = {};
    var toFetchRequests = [];
    var toFetchCompanies = [];

    (companies || []).forEach(function (company) {
      var npi = company.npi != null ? String(company.npi) : null;

      if (npi) {
        var cached = EnrichmentCache.get(CACHE_NAMESPACE, npi);
        if (cached !== undefined) {
          results[npi] = cached;
          return;
        }
      }

      var request = buildRequest_(company);
      if (!request) {
        if (npi) results[npi] = null;
        return;
      }

      toFetchRequests.push(request);
      toFetchCompanies.push(company);
    });

    if (toFetchRequests.length === 0) return results;

    var responses;
    try {
      responses = UrlFetchApp.fetchAll(toFetchRequests);
    } catch (err) {
      var unreachable = new Error("Failed to reach Foursquare API");
      unreachable.status = 504;
      unreachable.details = String(err);
      throw unreachable;
    }

    for (var i = 0; i < toFetchCompanies.length; i++) {
      var company = toFetchCompanies[i];
      var npi2 = company.npi != null ? String(company.npi) : null;
      var parsed = parseResponse_(responses[i], company.name);
      if (npi2) {
        results[npi2] = parsed.data;
        // Only cache a genuine result (match or confirmed no-match) -- not
        // a transient failure, which should be retried on the next search.
        if (parsed.ok) EnrichmentCache.put(CACHE_NAMESPACE, npi2, parsed.data);
      }
    }

    return results;
  }

  // One-off diagnostic: makes a single real request with a known-good query
  // and reports back the raw status/body, so a live auth/config problem can
  // be seen from the browser (Network tab / console) without needing access
  // to the Apps Script project's own Executions log.
  function testConnection() {
    if (!Config.foursquareApiKey()) return { configured: false };

    var url = BASE_URL +
      "?query=" + encodeURIComponent("coffee") +
      "&near=" + encodeURIComponent("New York, NY") +
      "&fields=" + encodeURIComponent(FIELDS) +
      "&limit=1";

    try {
      var response = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        headers: {
          Authorization: "Bearer " + Config.foursquareApiKey(),
          "X-Places-Api-Version": API_VERSION,
          Accept: "application/json",
        },
      });
      var body = response.getContentText();
      return {
        configured: true,
        status: response.getResponseCode(),
        body: body.length > 500 ? body.slice(0, 500) + "…" : body,
      };
    } catch (err) {
      return { configured: true, status: null, error: String(err) };
    }
  }

  return { enrichCompanies: enrichCompanies, testConnection: testConnection };
})();
