// 1:1 port of backend/src/services/scoring.service.js -- pure logic, no I/O,
// so this ports without any behavior changes.

var ScoringService = (function () {
  var WEIGHTS = {
    hasPhone: 15,
    hasFax: 5,
    hasWebsite: 20,
    activeStatus: 15,
    completeAddress: 10,
    placesVerified: 15,
    goodRating: 10,
    establishedPresence: 10,
    hasDecisionMaker: 15,
    medicareActive: 10,
  };

  var MAX_POSSIBLE_SCORE = Object.keys(WEIGHTS).reduce(function (sum, key) {
    return sum + WEIGHTS[key];
  }, 0);

  function scoreCompany(company) {
    var breakdown = {};
    var places = company.places || {};
    var addr = company.address || {};

    breakdown.hasPhone = company.phone ? WEIGHTS.hasPhone : 0;
    breakdown.hasFax = company.fax ? WEIGHTS.hasFax : 0;
    breakdown.hasWebsite = company.website ? WEIGHTS.hasWebsite : 0;

    // isClosed === false means confirmed open; null/undefined means unknown (no enrichment)
    breakdown.activeStatus = places.isClosed === false ? WEIGHTS.activeStatus : 0;

    breakdown.completeAddress =
      addr.line1 && addr.city && addr.state && addr.postalCode ? WEIGHTS.completeAddress : 0;

    breakdown.placesVerified = (company.sources && company.sources.places) ? WEIGHTS.placesVerified : 0;

    // Foursquare ratings are 0-10, not 0-5
    breakdown.goodRating =
      typeof places.rating === "number" && places.rating >= 8.0 ? WEIGHTS.goodRating : 0;

    breakdown.establishedPresence =
      typeof places.ratingCount === "number" && places.ratingCount >= 10
        ? WEIGHTS.establishedPresence
        : 0;

    breakdown.hasDecisionMaker =
      Array.isArray(company.decisionMakers) && company.decisionMakers.length > 0
        ? WEIGHTS.hasDecisionMaker
        : 0;

    // Confirmed active Medicare DMEPOS biller per CMS claims data --
    // the strongest public signal that this is a real, revenue-generating
    // supplier rather than a stale registration.
    breakdown.medicareActive =
      company.medicare && typeof company.medicare.totalClaims === "number" && company.medicare.totalClaims > 0
        ? WEIGHTS.medicareActive
        : 0;

    var total = Object.keys(breakdown).reduce(function (sum, key) {
      return sum + breakdown[key];
    }, 0);

    return {
      value: total,
      maxPossible: MAX_POSSIBLE_SCORE,
      percentage: Math.round((total / MAX_POSSIBLE_SCORE) * 100),
      breakdown: breakdown,
    };
  }

  return {
    scoreCompany: scoreCompany,
    WEIGHTS: WEIGHTS,
    MAX_POSSIBLE_SCORE: MAX_POSSIBLE_SCORE,
  };
})();