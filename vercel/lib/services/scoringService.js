// 1:1 port of appscript/services/ScoringService.js -- pure logic, no I/O,
// no `hasFax` weight (removed 2026-07-21).

const WEIGHTS = {
  hasPhone: 15,
  hasWebsite: 20,
  activeStatus: 15,
  completeAddress: 10,
  placesVerified: 15,
  goodRating: 10,
  establishedPresence: 10,
  hasDecisionMaker: 15,
  medicareActive: 10,
};

const MAX_POSSIBLE_SCORE = Object.values(WEIGHTS).reduce((sum, w) => sum + w, 0);

export function scoreCompany(company) {
  const breakdown = {};
  const places = company.places || {};
  const addr = company.address || {};

  breakdown.hasPhone = company.phone ? WEIGHTS.hasPhone : 0;
  breakdown.hasWebsite = company.website ? WEIGHTS.hasWebsite : 0;

  // isClosed === false means confirmed open; null/undefined means unknown (no enrichment)
  breakdown.activeStatus = places.isClosed === false ? WEIGHTS.activeStatus : 0;

  breakdown.completeAddress =
    addr.line1 && addr.city && addr.state && addr.postalCode ? WEIGHTS.completeAddress : 0;

  breakdown.placesVerified = company.sources?.places ? WEIGHTS.placesVerified : 0;

  // Foursquare ratings are 0-10, not 0-5
  breakdown.goodRating = typeof places.rating === "number" && places.rating >= 8.0 ? WEIGHTS.goodRating : 0;

  breakdown.establishedPresence =
    typeof places.ratingCount === "number" && places.ratingCount >= 10 ? WEIGHTS.establishedPresence : 0;

  breakdown.hasDecisionMaker =
    Array.isArray(company.decisionMakers) && company.decisionMakers.length > 0 ? WEIGHTS.hasDecisionMaker : 0;

  // Confirmed active Medicare DMEPOS biller per CMS claims data -- the
  // strongest public signal that this is a real, revenue-generating
  // supplier rather than a stale registration.
  breakdown.medicareActive =
    company.medicare && typeof company.medicare.totalClaims === "number" && company.medicare.totalClaims > 0
      ? WEIGHTS.medicareActive
      : 0;

  const total = Object.values(breakdown).reduce((sum, v) => sum + v, 0);

  return {
    value: total,
    maxPossible: MAX_POSSIBLE_SCORE,
    percentage: Math.round((total / MAX_POSSIBLE_SCORE) * 100),
    breakdown,
  };
}

export default { scoreCompany, WEIGHTS, MAX_POSSIBLE_SCORE };
