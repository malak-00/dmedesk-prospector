export function createCompany({
  npi = null,
  name,
  address = {},
  phone = null,
  fax = null,
  website = null,
  email = null,
  taxonomy = {},
  placeId = null,
  rating = null,
  ratingCount = null,
  isClosed = null,
  decisionMakers = [],
  sources = {},
} = {}) {
  return {
    id: npi || placeId || null,
    name: name || null,
    npi,
    website,
    email,
    phone,
    fax,
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
    places: { placeId, rating, ratingCount, isClosed },
    decisionMakers, // [{ name, title, roleCategory, phone, source, sourceUrl }]
    sources: {
      nppes: Boolean(sources.nppes),
      places: Boolean(sources.places),
      website: Boolean(sources.website),
    },
    score: null,
  };
}

export default { createCompany };