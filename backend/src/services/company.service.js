import { searchProviders } from "./nppes.service.js";
import foursquareService, {
  FoursquareNotConfiguredError,
} from "./foursquare.service.js";
import { createCompany } from "../models/company.model.js";
import { scoreCompany } from "./scoring.service.js";

let hasWarnedNoKey = false;

function fromNppesProvider(provider) {
  return createCompany({
    npi: provider.npi,
    name: provider.name,
    address: provider.address,
    phone: provider.phone,
    fax: provider.fax,
    taxonomy: provider.taxonomy,
    sources: { nppes: true },
  });
}

async function tryEnrichWithPlaces(company) {
  try {
    const data = await foursquareService.enrichCompany({
      name: company.name,
      address: company.address,
    });

    if (!data) return company;

    return {
      ...company,
      website: data.website ?? company.website,
      phone: company.phone || data.phone || null,
      places: {
        placeId: data.placeId,
        rating: data.rating,
        ratingCount: data.ratingCount,
        isClosed: data.isClosed,
      },
      sources: { ...company.sources, places: true },
    };
  } catch (err) {
    if (err instanceof FoursquareNotConfiguredError) {
      if (!hasWarnedNoKey) {
        console.warn(
          "[company.service] Enrichment skipped: FOURSQUARE_SERVICE_API_KEY not set"
        );
        hasWarnedNoKey = true;
      }
      return company;
    }
    console.warn(
      `[company.service] Enrichment failed for "${company.name}": ${err.message}`
    );
    return company;
  }
}

export async function searchCompanies(criteria = {}, enrich = true) {
  const { results: providers } = await searchProviders(criteria);

  let companies = providers.map(fromNppesProvider);

  if (enrich) {
    companies = await Promise.all(companies.map(tryEnrichWithPlaces));
  }

  companies = companies.map((company) => ({
    ...company,
    score: scoreCompany(company),
  }));

  companies.sort((a, b) => b.score.value - a.score.value);

  return {
    count: companies.length,
    companies,
  };
}

export default { searchCompanies };