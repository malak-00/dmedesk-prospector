// Port of appscript/services/OsmService.js -- free, keyless OpenStreetMap
// Nominatim fallback for a company website when Foursquare doesn't have one.
import * as EnrichmentCache from "../lib/enrichmentCache.js";

const BASE_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "DME-Desk-Prospector/1.0 (free lead-gen tool for DMEPOS suppliers)";
const MIN_INTERVAL_MS = 1100; // stay comfortably under Nominatim's 1 req/sec limit
const CACHE_NAMESPACE = "osm";

// Best-effort, per-isolate throttle (module-scope state persists across
// requests handled by the same warm isolate, same intent as the Apps
// Script version's single-execution module state, just less strict since a
// Worker can run several isolates concurrently under load).
//
// This is a promise chain, not a bare "check timestamp, maybe wait"
// compare-then-set -- the latter is racy when multiple lookups start
// concurrently (e.g. via Promise.all): each one reads the same stale
// `lastRequestAt` before any of them updates it, so they'd all sleep the
// same short wait and then fire in a burst, blowing straight through
// Nominatim's 1 req/sec limit. Chaining onto `throttleChain` forces every
// caller to actually wait its turn, one at a time.
let throttleChain = Promise.resolve();
let lastRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function throttle() {
  const turn = throttleChain.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
  });
  // Don't let one failed turn wedge the queue for everyone behind it.
  throttleChain = turn.catch(() => {});
  return turn;
}

async function fetchWebsite(company, near) {
  const url = BASE_URL + "?q=" + encodeURIComponent(company.name + ", " + near) + "&format=json&extratags=1&limit=1";

  let response;
  try {
    response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  } catch (err) {
    console.log("[osm] Failed to reach Nominatim: " + err);
    return { ok: false, website: null };
  }

  if (response.status >= 400) {
    console.log("[osm] Nominatim responded with status " + response.status);
    return { ok: false, website: null };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return { ok: false, website: null };
  }

  const place = Array.isArray(data) ? data[0] : null;
  const tags = place && place.extratags;
  return { ok: true, website: (tags && (tags.website || tags["contact:website"])) || null };
}

// One cache round trip covering every candidate company, then Nominatim
// lookups only for the cache misses (still throttled to 1/sec via
// `throttle`, which is Nominatim's real limit and the one part of this
// that can't be sped up). Returns a Map of npi -> website (string or null).
export async function lookupWebsites(supabase, companies) {
  const results = new Map();
  const candidates = (companies || []).filter((c) => c.npi != null);
  if (candidates.length === 0) return results;

  const cached = await EnrichmentCache.getMany(supabase, CACHE_NAMESPACE, candidates.map((c) => c.npi));

  const toFetch = [];
  for (const company of candidates) {
    const npi = String(company.npi);
    if (cached.has(npi)) {
      results.set(npi, cached.get(npi));
      continue;
    }
    const address = company.address || {};
    const near = [address.city, address.state].filter(Boolean).join(", ");
    if (!company.name || !near) continue;
    toFetch.push({ npi, company, near });
  }

  const toCache = [];
  for (const { npi, company, near } of toFetch) {
    await throttle();
    const result = await fetchWebsite(company, near);
    if (result.ok) {
      results.set(npi, result.website);
      toCache.push({ npi, value: result.website });
    }
  }
  await EnrichmentCache.putMany(supabase, CACHE_NAMESPACE, toCache);

  return results;
}
