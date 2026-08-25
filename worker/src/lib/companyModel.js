// 1:1 port of appscript/models/CompanyModel.js
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
    website: opts.website != null ? opts.website : null,
    email: opts.email != null ? opts.email : null,
    phone: opts.phone != null ? opts.phone : null,
    address: {
      line1: address.line1 != null ? address.line1 : null,
      line2: address.line2 != null ? address.line2 : null,
      city: address.city != null ? address.city : null,
      state: address.state != null ? address.state : null,
      postalCode: address.postalCode != null ? address.postalCode : null,
      countryCode: address.countryCode != null ? address.countryCode : null,
    },
    taxonomy: {
      code: taxonomy.code != null ? taxonomy.code : null,
      description: taxonomy.description != null ? taxonomy.description : null,
    },
    places: {
      placeId,
      rating: opts.rating != null ? opts.rating : null,
      ratingCount: opts.ratingCount != null ? opts.ratingCount : null,
      isClosed: opts.isClosed != null ? opts.isClosed : null,
    },
    decisionMakers: opts.decisionMakers || [],
    medicare: opts.medicare != null ? opts.medicare : null,
    lastUpdated: opts.lastUpdated != null ? opts.lastUpdated : null,
    sources: {
      nppes: Boolean(sources.nppes),
      places: Boolean(sources.places),
      website: Boolean(sources.website),
      cms: Boolean(sources.cms),
    },
    score: null,
  };
}
