// Port of appscript/services/FoursquareService.js -- UrlFetchApp.fetchAll ->
// Promise.all of native fetch() calls (real concurrent requests on a real
// Node runtime, same effective "one round trip's worth of latency" as the
// Apps Script batching). Supabase-backed cache instead of CacheService/
// in-memory Map -- see enrichmentCache.js for why.

import config from "../config.js";
import { get as cacheGet, put as cachePut } from "./enrichmentCache.js";

const BASE_URL = "https://places-api.foursquare.com/places/search";
const API_VERSION = "2025-06-17";
// If rating/stats fields ever get billed as Premium on your account, remove
// "rating" and "stats" from this list -- everything else stays free-tier Pro.
const FIELDS = "fsq_place_id,name,tel,website,rating,stats,location,date_closed";
const CACHE_NAMESPACE = "fsq";

export class FoursquareNotConfiguredError extends Error {
  constructor() {
    super("FOURSQUARE_SERVICE_API_KEY is not configured");
    this.name = "FoursquareNotConfiguredError";
  }
}

function assertConfigured() {
  if (!config.foursquareApiKey) throw new FoursquareNotConfiguredError();
}

function buildUrl(company) {
  const address = company.address || {};
  const near = [address.city, address.state].filter(Boolean).join(", ");
  if (!company.name || !near) return null;

  const query =
    `?query=${encodeURIComponent(company.name)}` +
    `&near=${encodeURIComponent(near)}` +
    `&fields=${encodeURIComponent(FIELDS)}` +
    `&limit=1`;
  return BASE_URL + query;
}

function authHeaders() {
  return {
    Authorization: `Bearer ${config.foursquareApiKey}`,
    "X-Places-Api-Version": API_VERSION,
    Accept: "application/json",
  };
}

// Fetches one company's data. Returns { ok, data } rather than throwing on
// a bad status -- one company's request failing (rate limit, transient
// 5xx, etc.) must not discard every other company's results in the same
// batch. `ok: false` also signals the caller not to cache the failure as if
// it were a confirmed "no data found".
async function fetchOne(url, companyName) {
  let response;
  try {
    response = await fetch(url, { headers: authHeaders() });
  } catch (err) {
    console.error(`[foursquareService] Network error for "${companyName}": ${err.message}`);
    return { ok: false, data: null };
  }

  if (response.status >= 400) {
    console.error(`[foursquareService] API responded with status ${response.status} for "${companyName}"`);
    return { ok: false, data: null };
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    console.error(`[foursquareService] Failed to parse response for "${companyName}": ${err.message}`);
    return { ok: false, data: null };
  }

  const place = data.results?.[0];
  if (!place) return { ok: true, data: null };

  return {
    ok: true,
    data: {
      placeId: place.fsq_place_id || null,
      website: place.website || null,
      phone: place.tel || null,
      rating: typeof place.rating === "number" ? place.rating : null,
      ratingCount: place.stats?.total_ratings ?? null,
      isClosed: Boolean(place.date_closed),
    },
  };
}

// Returns a plain object mapping NPI -> enrichment data (or null when no
// match was found / the company had no usable name+location). `supabase`
// is a service-role client (see enrichmentCache.js).
export async function enrichCompanies(supabase, companies) {
  assertConfigured();

  const results = {};
  const toFetch = [];

  for (const company of companies || []) {
    const npi = company.npi != null ? String(company.npi) : null;

    if (npi) {
      const cached = await cacheGet(supabase, CACHE_NAMESPACE, npi);
      if (cached !== undefined) {
        results[npi] = cached;
        continue;
      }
    }

    const url = buildUrl(company);
    if (!url) {
      if (npi) results[npi] = null;
      continue;
    }
    toFetch.push({ npi, name: company.name, url });
  }

  if (toFetch.length === 0) return results;

  const responses = await Promise.all(toFetch.map((c) => fetchOne(c.url, c.name)));

  await Promise.all(
    toFetch.map(async (c, i) => {
      const parsed = responses[i];
      if (c.npi) {
        results[c.npi] = parsed.data;
        // Only cache a genuine result (match or confirmed no-match) -- not a
        // transient failure, which should be retried on the next search.
        if (parsed.ok) await cachePut(supabase, CACHE_NAMESPACE, c.npi, parsed.data);
      }
    })
  );

  return results;
}

// One-off diagnostic: makes a single real request with a known-good query
// and reports back the raw status/body.
export async function testConnection() {
  if (!config.foursquareApiKey) return { configured: false };

  const url =
    `${BASE_URL}?query=${encodeURIComponent("coffee")}` +
    `&near=${encodeURIComponent("New York, NY")}` +
    `&fields=${encodeURIComponent(FIELDS)}` +
    `&limit=1`;

  try {
    const response = await fetch(url, { headers: authHeaders() });
    const body = await response.text();
    return {
      configured: true,
      status: response.status,
      body: body.length > 500 ? `${body.slice(0, 500)}…` : body,
    };
  } catch (err) {
    return { configured: true, status: null, error: String(err) };
  }
}

export default { enrichCompanies, testConnection, FoursquareNotConfiguredError };
