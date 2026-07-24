// Port of appscript/services/OsmService.js -- free, keyless fallback for a
// company's website when Foursquare doesn't have one, via OpenStreetMap's
// Nominatim search API. Nominatim's usage policy caps unauthenticated use
// at roughly 1 request/second and requires an identifying User-Agent --
// both enforced here, same as the Apps Script version.

import { get as cacheGet, put as cachePut } from "./enrichmentCache.js";

const BASE_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "DME-Desk-Prospector/1.0 (free lead-gen tool for DMEPOS suppliers)";
const MIN_INTERVAL_MS = 1100; // stay comfortably under Nominatim's 1 req/sec limit
const FETCH_TIMEOUT_MS = 6000; // a single hung request shouldn't be able to eat the whole function's time budget
const CACHE_NAMESPACE = "osm";

// A 429 means Nominatim is rate-limiting this whole burst of calls, not
// just one query -- once seen, every subsequent call in the same batch
// will fail the same way, so the caller should stop spending the 1.1s
// throttle on calls that are guaranteed to fail rather than keep retrying
// per company.
export class OsmRateLimitedError extends Error {
  constructor() {
    super("Nominatim rate-limited this request (429)");
    this.name = "OsmRateLimitedError";
  }
}

// Module-level throttle state -- fine within one function invocation
// (sequential lookups in one request), which is the only place this
// matters: concurrent Vercel invocations are separate processes anyway, so
// there's no cross-request throttling coordination happening here or in
// the original Apps Script version either (its own throttle was similarly
// scoped to one execution).
let lastRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttle() {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

// Returns { ok, website }. ok=false means a transient failure (don't cache
// it); ok=true with website=null means we genuinely checked and Nominatim
// has nothing for this business.
async function fetchWebsite(company, near) {
  const url = `${BASE_URL}?q=${encodeURIComponent(`${company.name}, ${near}`)}&format=json&extratags=1&limit=1`;

  let response;
  try {
    response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (err) {
    console.error(`[osmService] Failed to reach Nominatim: ${err.message}`);
    return { ok: false, website: null };
  }

  if (response.status === 429) {
    console.error("[osmService] Nominatim rate-limited this request (429) -- stopping further OSM lookups for this search");
    throw new OsmRateLimitedError();
  }

  if (response.status >= 400) {
    console.error(`[osmService] Nominatim responded with status ${response.status}`);
    return { ok: false, website: null };
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    return { ok: false, website: null };
  }

  const place = Array.isArray(data) ? data[0] : null;
  const tags = place?.extratags;
  return { ok: true, website: tags?.website || tags?.["contact:website"] || null };
}

// Returns a website URL string, or null if not found. `supabase` is a
// service-role client (see enrichmentCache.js). Checks the cache first --
// a cache hit skips the throttle entirely, since there's no request
// actually happening.
export async function lookupWebsite(supabase, company) {
  const npi = company.npi != null ? String(company.npi) : null;
  if (npi) {
    const cached = await cacheGet(supabase, CACHE_NAMESPACE, npi);
    if (cached !== undefined) return cached;
  }

  const address = company.address || {};
  const near = [address.city, address.state].filter(Boolean).join(", ");
  if (!company.name || !near) return null;

  await throttle();
  const result = await fetchWebsite(company, near);
  if (npi && result.ok) await cachePut(supabase, CACHE_NAMESPACE, npi, result.website);
  return result.website;
}

export default { lookupWebsite };
