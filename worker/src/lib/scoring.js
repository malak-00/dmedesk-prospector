// 1:1 port of appscript/services/ScoringService.js -- pure logic, no I/O,
// EXCEPT the weights below no longer include the Foursquare/OSM-only
// signals (hasWebsite, activeStatus, placesVerified, goodRating,
// establishedPresence) now that neither enrichment source runs -- those
// fields would always score 0, silently capping every company's
// percentage well below 100 regardless of lead quality. Scoring is now
// based only on data NPPES/fakeNPI and CMS actually provide.
export const WEIGHTS = {
  hasPhone: 25,
  completeAddress: 20,
  hasDecisionMaker: 30,
  medicareActive: 25,
};

export const MAX_POSSIBLE_SCORE = Object.values(WEIGHTS).reduce((sum, v) => sum + v, 0);

export function scoreCompany(company) {
  const breakdown = {};
  const addr = company.address || {};

  breakdown.hasPhone = company.phone ? WEIGHTS.hasPhone : 0;
  breakdown.completeAddress = addr.line1 && addr.city && addr.state && addr.postalCode ? WEIGHTS.completeAddress : 0;
  breakdown.hasDecisionMaker =
    Array.isArray(company.decisionMakers) && company.decisionMakers.length > 0 ? WEIGHTS.hasDecisionMaker : 0;
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
