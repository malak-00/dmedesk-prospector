const WEIGHTS = {
  hasPhone: 15,
  hasFax: 5,
  hasWebsite: 20,
  activeStatus: 15,
  completeAddress: 10,
  placesVerified: 15,
  goodRating: 10,
  establishedPresence: 10,
};

const MAX_POSSIBLE_SCORE = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);

export function scoreCompany(company) {
  const breakdown = {};

  breakdown.hasPhone = company.phone ? WEIGHTS.hasPhone : 0;
  breakdown.hasFax = company.fax ? WEIGHTS.hasFax : 0;
  breakdown.hasWebsite = company.website ? WEIGHTS.hasWebsite : 0;

  // isClosed === false means confirmed open; null means unknown (no enrichment)
  breakdown.activeStatus =
    company.places?.isClosed === false ? WEIGHTS.activeStatus : 0;

  const addr = company.address || {};
  breakdown.completeAddress =
    addr.line1 && addr.city && addr.state && addr.postalCode
      ? WEIGHTS.completeAddress
      : 0;

  breakdown.placesVerified = company.sources?.places ? WEIGHTS.placesVerified : 0;

  // Foursquare ratings are 0-10, not 0-5
  breakdown.goodRating =
    typeof company.places?.rating === "number" && company.places.rating >= 8.0
      ? WEIGHTS.goodRating
      : 0;

  breakdown.establishedPresence =
    typeof company.places?.ratingCount === "number" &&
    company.places.ratingCount >= 10
      ? WEIGHTS.establishedPresence
      : 0;

  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);

  return {
    value: total,
    maxPossible: MAX_POSSIBLE_SCORE,
    percentage: Math.round((total / MAX_POSSIBLE_SCORE) * 100),
    breakdown,
  };
}

export default { scoreCompany, WEIGHTS, MAX_POSSIBLE_SCORE };