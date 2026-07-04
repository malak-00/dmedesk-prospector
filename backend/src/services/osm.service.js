import axios from "axios";

// Free, keyless fallback for a company's website when Foursquare doesn't
// have one. Foursquare's dataset is consumer/check-in oriented and often
// lacks website data for small B2B medical suppliers; OpenStreetMap's
// community-mapped POIs frequently carry a website / contact:website tag
// for exactly this kind of small local business, so it's a good second
// source to try before giving up.
//
// Uses the public Nominatim search API (no API key required). Nominatim's
// usage policy caps unauthenticated use at roughly 1 request/second and
// requires an identifying User-Agent -- both are enforced here.

const BASE_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "DME-Desk-Prospector/1.0 (free lead-gen tool for DMEPOS suppliers)";
const MIN_INTERVAL_MS = 1100; // stay comfortably under Nominatim's 1 req/sec limit

let lastRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttle() {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

/**
 * Returns a website URL string, or null if not found.
 * Callers MUST await these one at a time (not Promise.all) -- the internal
 * throttle only serializes calls made in sequence within this process.
 */
export async function lookupWebsite(company) {
  const near = [company.address?.city, company.address?.state].filter(Boolean).join(", ");
  if (!company.name || !near) return null;

  await throttle();

  try {
    const response = await axios.get(BASE_URL, {
      params: {
        q: `${company.name}, ${near}`,
        format: "json",
        extratags: 1,
        limit: 1,
      },
      headers: { "User-Agent": USER_AGENT },
      timeout: 10000,
    });

    const place = response.data?.[0];
    const tags = place?.extratags;
    if (!tags) return null;

    return tags.website || tags["contact:website"] || null;
  } catch (err) {
    console.warn(`[osm.service] Nominatim lookup failed for "${company.name}": ${err.message}`);
    return null;
  }
}

export default { lookupWebsite };
