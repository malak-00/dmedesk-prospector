// A SECOND "Places"-style enrichment source, used only for companies
// Foursquare's free tier didn't cover (see CompanyService's
// applyPlacesEnrichment_, which tries Foursquare first and only falls
// through to this for whatever's left) -- Yelp itself doesn't offer a
// public search API, so this goes through SerpApi's Yelp Search Engine
// Results API instead (https://serpapi.com/yelp-search-api).
//
// Unlike FoursquareService, there's no bulk/batch endpoint on SerpApi's
// side and every request is a billed "search" (250/month free, then paid),
// so this is deliberately called with as few companies as possible -- never
// as the first enrichment attempt.

var YelpNotConfiguredError = function () {
  var err = new Error("SERPAPI_API_KEY is not configured");
  err.name = "YelpNotConfiguredError";
  return err;
};

var YelpService = (function () {
  var BASE_URL = "https://serpapi.com/search";
  var CACHE_NAMESPACE = "yelp";

  function assertConfigured() {
    if (!Config.serpapiApiKey()) throw YelpNotConfiguredError();
  }

  function buildRequest_(company) {
    var address = company.address || {};
    var loc = [address.city, address.state].filter(Boolean).join(", ");
    if (!company.name || !loc) return null;

    var query =
      "?engine=yelp" +
      "&find_desc=" + encodeURIComponent(company.name) +
      "&find_loc=" + encodeURIComponent(loc) +
      "&api_key=" + encodeURIComponent(Config.serpapiApiKey());

    return { url: BASE_URL + query, muteHttpExceptions: true };
  }

  // Yelp's review count normally comes back as a plain integer in SerpApi's
  // JSON, but this is parsed defensively in case it's ever a "42 reviews"
  // style string instead.
  function parseReviewCount_(reviews) {
    if (typeof reviews === "number") return reviews;
    var match = String(reviews || "").match(/\d+/);
    return match ? Number(match[0]) : null;
  }

  // Parses one response from the batch. Returns { ok, data } rather than
  // throwing on a bad status/SerpApi-level error -- one company's request
  // failing must not discard every other company's results in the same
  // batch. `ok: false` also signals the caller not to cache the failure as
  // if it were a confirmed "no data found" (a transient SerpApi hiccup or an
  // exhausted quota should be retried later, not remembered as a no-match).
  function parseResponse_(response, companyName) {
    var code = response.getResponseCode();
    if (code >= 400) {
      console.log("[YelpService] API responded with status " + code + " for \"" + companyName + "\"");
      return { ok: false, data: null };
    }

    var data;
    try {
      data = JSON.parse(response.getContentText());
    } catch (err) {
      console.log("[YelpService] Failed to parse response for \"" + companyName + "\": " + err);
      return { ok: false, data: null };
    }

    if (data.error) {
      console.log("[YelpService] SerpApi error for \"" + companyName + "\": " + data.error);
      return { ok: false, data: null };
    }

    var place = data.organic_results && data.organic_results[0];
    if (!place) return { ok: true, data: null };

    // Yelp ratings are 0-5, but ScoringService's goodRating/
    // establishedPresence thresholds assume Foursquare's 0-10 scale (see the
    // comment in ScoringService.js) -- scaled up here so the same "good
    // rating" bar applies regardless of which service actually supplied the
    // data, instead of Yelp-sourced companies silently never qualifying.
    var rating = typeof place.rating === "number" ? place.rating * 2 : null;

    return {
      ok: true,
      data: {
        placeId: place.place_id || null,
        website: null, // Yelp's own search results don't expose the business's website URL
        phone: place.phone || null,
        rating: rating,
        ratingCount: parseReviewCount_(place.reviews),
        isClosed: null, // unknown -- the Yelp SERP result doesn't say either way
      },
    };
  }

  // Same shape/contract as FoursquareService.enrichCompanies -- a plain
  // object mapping NPI -> enrichment data (or null when no match was found /
  // the company had no usable name+location). Throws YelpNotConfiguredError
  // if unset; throws only if the whole batch request couldn't be sent at all
  // (network unreachable) -- an individual company's bad response degrades
  // to null for that company only.
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
      var unreachable = new Error("Failed to reach SerpApi");
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
        if (parsed.ok) EnrichmentCache.put(CACHE_NAMESPACE, npi2, parsed.data);
      }
    }

    return results;
  }

  return { enrichCompanies: enrichCompanies };
})();
