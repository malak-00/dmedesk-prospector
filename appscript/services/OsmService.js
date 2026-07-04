// Free, keyless fallback for a company's website when Foursquare doesn't
// have one. Foursquare's dataset is consumer/check-in oriented and often
// lacks website data for small B2B medical suppliers; OpenStreetMap's
// community-mapped POIs frequently carry a website / contact:website tag
// for exactly this kind of small local business, so it's a good second
// source to try before giving up.
//
// Uses the public Nominatim search API (no API key required). Nominatim's
// usage policy caps unauthenticated use at roughly 1 request/second and
// requires an identifying User-Agent -- both are enforced here.

var OsmService = (function () {
  var BASE_URL = "https://nominatim.openstreetmap.org/search";
  var USER_AGENT = "DME-Desk-Prospector/1.0 (free lead-gen tool for DMEPOS suppliers)";
  var MIN_INTERVAL_MS = 1100; // stay comfortably under Nominatim's 1 req/sec limit
  var lastRequestAt = 0;

  function throttle_() {
    var wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) Utilities.sleep(wait);
    lastRequestAt = Date.now();
  }

  // Returns a website URL string, or null if not found / not configured to find one.
  function lookupWebsite(company) {
    var address = company.address || {};
    var near = [address.city, address.state].filter(Boolean).join(", ");
    if (!company.name || !near) return null;

    throttle_();

    var url = BASE_URL +
      "?q=" + encodeURIComponent(company.name + ", " + near) +
      "&format=json&extratags=1&limit=1";

    var response;
    try {
      response = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        headers: { "User-Agent": USER_AGENT },
      });
    } catch (err) {
      console.log("[OsmService] Failed to reach Nominatim: " + err);
      return null;
    }

    if (response.getResponseCode() >= 400) {
      console.log("[OsmService] Nominatim responded with status " + response.getResponseCode());
      return null;
    }

    var data;
    try {
      data = JSON.parse(response.getContentText());
    } catch (err) {
      return null;
    }

    var place = Array.isArray(data) ? data[0] : null;
    var tags = place && place.extratags;
    if (!tags) return null;

    return tags.website || tags["contact:website"] || null;
  }

  return { lookupWebsite: lookupWebsite };
})();
