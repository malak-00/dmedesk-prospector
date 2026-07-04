// 1:1 port of backend/src/models/company.model.js

var CompanyModel = (function () {
  function createCompany(opts) {
    opts = opts || {};
    var address = opts.address || {};
    var taxonomy = opts.taxonomy || {};
    var sources = opts.sources || {};
    var npi = opts.npi != null ? opts.npi : null;
    var placeId = opts.placeId != null ? opts.placeId : null;

    return {
      id: npi || placeId || null,
      name: opts.name || null,
      npi: npi,
      website: opts.website != null ? opts.website : null,
      email: opts.email != null ? opts.email : null,
      phone: opts.phone != null ? opts.phone : null,
      fax: opts.fax != null ? opts.fax : null,
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
        placeId: placeId,
        rating: opts.rating != null ? opts.rating : null,
        ratingCount: opts.ratingCount != null ? opts.ratingCount : null,
        isClosed: opts.isClosed != null ? opts.isClosed : null,
      },
      decisionMakers: opts.decisionMakers || [], // [{ name, title, roleCategory, phone, source, sourceUrl }]
      // { totalClaims, totalServices, totalBeneficiaries, medicarePayment, medicareAllowed } or null
      medicare: opts.medicare != null ? opts.medicare : null,
      lastUpdated: opts.lastUpdated != null ? opts.lastUpdated : null, // NPPES's own "Last Updated" date, "YYYY-MM-DD" or null
      sources: {
        nppes: Boolean(sources.nppes),
        places: Boolean(sources.places),
        website: Boolean(sources.website),
        cms: Boolean(sources.cms),
      },
      score: null,
    };
  }

  return { createCompany: createCompany };
})();
