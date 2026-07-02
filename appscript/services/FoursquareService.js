// Port of backend/src/services/foursquare.service.js.
// Custom "not configured" error still exists so Code.js can distinguish
// "not configured" (skip gracefully) from "actually failed" (report it).

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

  function assertConfigured() {
    if (!Config.foursquareApiKey()) throw FoursquareNotConfiguredError();
  }

  // Looks up a business by name + locality string. Returns null if not found.
  function enrichCompany(company) {
    assertConfigured();

    var address = company.address || {};
    var near = [address.city, address.state].filter(Boolean).join(", ");
    if (!company.name || !near) return null;

    var query =
      "?query=" + encodeURIComponent(company.name) +
      "&near=" + encodeURIComponent(near) +
      "&fields=" + encodeURIComponent(FIELDS) +
      "&limit=1";

    var response;
    try {
      response = UrlFetchApp.fetch(BASE_URL + query, {
        muteHttpExceptions: true,
        headers: {
          Authorization: "Bearer " + Config.foursquareApiKey(),
          "X-Places-Api-Version": API_VERSION,
          Accept: "application/json",
        },
      });
    } catch (err) {
      var unreachable = new Error("Failed to reach Foursquare API");
      unreachable.status = 504;
      unreachable.details = String(err);
      throw unreachable;
    }

    var code = response.getResponseCode();
    if (code >= 400) {
      var upstreamError = new Error("Foursquare API responded with status " + code);
      upstreamError.status = 502;
      upstreamError.details = response.getContentText();
      throw upstreamError;
    }

    var data = JSON.parse(response.getContentText());
    var place = data.results && data.results[0];
    if (!place) return null;

    return {
      placeId: place.fsq_place_id || null,
      website: place.website || null,
      phone: place.tel || null,
      rating: typeof place.rating === "number" ? place.rating : null,
      ratingCount: place.stats ? (place.stats.total_ratings != null ? place.stats.total_ratings : null) : null,
      isClosed: Boolean(place.date_closed),
    };
  }

  return { enrichCompany: enrichCompany };
})();
