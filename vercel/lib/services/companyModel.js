// 1:1 port of appscript/models/CompanyModel.js -- no `fax` field, matching
// the current app (removed 2026-07-21).

export function createCompany(opts = {}) {
  const address = opts.address || {};
  const taxonomy = opts.taxonomy || {};
  const sources = opts.sources || {};
  const npi = opts.npi != null ? opts.npi : null;
  const placeId = opts.placeId != null ? opts.placeId : null;

  return {
    id: npi || placeId || null,
    name: opts.name || null,
    npi,
    website: opts.website ?? null,
    email: opts.email ?? null,
    phone: opts.phone ?? null,
    address: {
      line1: address.line1 ?? null,
      line2: address.line2 ?? null,
      city: address.city ?? null,
      state: address.state ?? null,
      postalCode: address.postalCode ?? null,
      countryCode: address.countryCode ?? null,
    },
    taxonomy: {
      code: taxonomy.code ?? null,
      description: taxonomy.description ?? null,
    },
    places: {
      placeId,
      rating: opts.rating ?? null,
      ratingCount: opts.ratingCount ?? null,
      isClosed: opts.isClosed ?? null,
    },
    decisionMakers: opts.decisionMakers || [], // [{ name, title, roleCategory, phone, source, sourceUrl }]
    medicare: opts.medicare ?? null, // { totalClaims, totalServices, totalBeneficiaries, medicarePayment, medicareAllowed } or null
    lastUpdated: opts.lastUpdated ?? null, // NPPES's own "Last Updated" date, "YYYY-MM-DD" or null
    sources: {
      nppes: Boolean(sources.nppes),
      places: Boolean(sources.places),
      website: Boolean(sources.website),
      cms: Boolean(sources.cms),
    },
    score: null,
  };
}

export default { createCompany };
