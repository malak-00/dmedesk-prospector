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
let lastRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttle() {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
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

export async function lookupWebsite(supabase, company) {
  const npi = company.npi != null ? String(company.npi) : null;
  if (npi) {
    const cached = await EnrichmentCache.get(supabase, CACHE_NAMESPACE, npi);
    if (cached !== undefined) return cached;
  }

  const address = company.address || {};
  const near = [address.city, address.state].filter(Boolean).join(", ");
  if (!company.name || !near) return null;

  await throttle();
  const result = await fetchWebsite(company, near);
  if (npi && result.ok) await EnrichmentCache.put(supabase, CACHE_NAMESPACE, npi, result.website);
  return result.website;
}
