// Port of appscript/services/FoursquareService.js -- UrlFetchApp.fetchAll ->
// Promise.all(fetch(...)) for the same one-batched-call-not-one-per-company
// behavior.
import * as EnrichmentCache from "../lib/enrichmentCache.js";

export function FoursquareNotConfiguredError() {
  const err = new Error("FOURSQUARE_SERVICE_API_KEY is not configured");
  err.name = "FoursquareNotConfiguredError";
  return err;
}

const BASE_URL = "https://places-api.foursquare.com/places/search";
const API_VERSION = "2025-06-17";
const FIELDS = "fsq_place_id,name,tel,website,rating,stats,location,date_closed";
const CACHE_NAMESPACE = "fsq";

function assertConfigured(config) {
  if (!config.foursquareApiKey()) throw FoursquareNotConfiguredError();
}

function buildRequest(config, company) {
  const address = company.address || {};
  const near = [address.city, address.state].filter(Boolean).join(", ");
  if (!company.name || !near) return null;

  const query =
    "?query=" + encodeURIComponent(company.name) + "&near=" + encodeURIComponent(near) + "&fields=" + encodeURIComponent(FIELDS) + "&limit=1";

  return {
    url: BASE_URL + query,
    headers: {
      Authorization: "Bearer " + config.foursquareApiKey(),
      "X-Places-Api-Version": API_VERSION,
      Accept: "application/json",
    },
  };
}

async function parseResponse(response, companyName) {
  if (response.status >= 400) {
    console.log(`[foursquare] API responded with status ${response.status} for "${companyName}"`);
    return { ok: false, data: null };
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    console.log(`[foursquare] Failed to parse response for "${companyName}": ${err}`);
    return { ok: false, data: null };
  }

  const place = data.results && data.results[0];
  if (!place) return { ok: true, data: null };

  return {
    ok: true,
    data: {
      placeId: place.fsq_place_id || null,
      website: place.website || null,
      phone: place.tel || null,
      rating: typeof place.rating === "number" ? place.rating : null,
      ratingCount: place.stats ? place.stats.total_ratings ?? null : null,
      isClosed: Boolean(place.date_closed),
    },
  };
}

export async function enrichCompanies(config, supabase, companies) {
  assertConfigured(config);

  const results = {};
  const cached = await EnrichmentCache.getMany(
    supabase,
    CACHE_NAMESPACE,
    (companies || []).map((c) => c.npi).filter((npi) => npi != null)
  );

  const toFetchRequests = [];
  const toFetchCompanies = [];

  for (const company of companies || []) {
    const npi = company.npi != null ? String(company.npi) : null;

    if (npi && cached.has(npi)) {
      results[npi] = cached.get(npi);
      continue;
    }

    const request = buildRequest(config, company);
    if (!request) {
      if (npi) results[npi] = null;
      continue;
    }

    toFetchRequests.push(request);
    toFetchCompanies.push(company);
  }

  if (toFetchRequests.length === 0) return results;

  let responses;
  try {
    responses = await Promise.all(toFetchRequests.map((req) => fetch(req.url, { headers: req.headers })));
  } catch (err) {
    const unreachable = new Error("Failed to reach Foursquare API");
    unreachable.status = 504;
    unreachable.details = String(err);
    throw unreachable;
  }

  const toCache = [];
  for (let i = 0; i < toFetchCompanies.length; i++) {
    const company = toFetchCompanies[i];
    const npi = company.npi != null ? String(company.npi) : null;
    const parsed = await parseResponse(responses[i], company.name);
    if (npi) {
      results[npi] = parsed.data;
      if (parsed.ok) toCache.push({ npi, value: parsed.data });
    }
  }
  await EnrichmentCache.putMany(supabase, CACHE_NAMESPACE, toCache);

  return results;
}

export async function testConnection(config) {
  if (!config.foursquareApiKey()) return { configured: false };

  const url =
    BASE_URL + "?query=" + encodeURIComponent("coffee") + "&near=" + encodeURIComponent("New York, NY") + "&fields=" + encodeURIComponent(FIELDS) + "&limit=1";

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: "Bearer " + config.foursquareApiKey(),
        "X-Places-Api-Version": API_VERSION,
        Accept: "application/json",
      },
    });
    const body = await response.text();
    return {
      configured: true,
      status: response.status,
      body: body.length > 500 ? body.slice(0, 500) + "…" : body,
    };
  } catch (err) {
    return { configured: true, status: null, error: String(err) };
  }
}
