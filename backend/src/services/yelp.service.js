import axios from "axios";
import config from "../config/index.js";
import enrichmentCache from "./enrichmentCache.js";

// A SECOND "Places"-style enrichment source, used only for companies
// Foursquare's free tier didn't cover (see company.service.js's
// tryEnrichWithYelp, which only runs for a company tryEnrichWithPlaces left
// unenriched) -- Yelp itself doesn't offer a public search API, so this goes
// through SerpApi's Yelp Search Engine Results API instead
// (https://serpapi.com/yelp-search-api). Unlike Foursquare, every request
// here is a billed "search" (250/month free, then paid), so this should
// never be the first enrichment attempt.

const CACHE_NAMESPACE = "yelp";
const BASE_URL = "https://serpapi.com/search";

class YelpNotConfiguredError extends Error {
  constructor() {
    super("SERPAPI_API_KEY is not configured");
    this.name = "YelpNotConfiguredError";
  }
}

function assertConfigured() {
  if (!config.serpapiApiKey) {
    throw new YelpNotConfiguredError();
  }
}

// Yelp's review count normally comes back as a plain integer in SerpApi's
// JSON, but this is parsed defensively in case it's ever a "42 reviews"
// style string instead.
function parseReviewCount(reviews) {
  if (typeof reviews === "number") return reviews;
  const match = String(reviews ?? "").match(/\d+/);
  return match ? Number(match[0]) : null;
}

/**
 * Looks up a business by name + locality string via SerpApi's Yelp engine.
 * Returns null if not found. Throws YelpNotConfiguredError if no key set.
 */
async function enrichCompany({ npi, name, address }) {
  assertConfigured();

  const npiKey = npi != null ? String(npi) : null;
  if (npiKey) {
    const cached = enrichmentCache.get(CACHE_NAMESPACE, npiKey);
    if (cached !== undefined) return cached;
  }

  const findLoc = [address?.city, address?.state].filter(Boolean).join(", ");
  if (!name || !findLoc) return null;

  let response;
  try {
    response = await axios.get(BASE_URL, {
      params: {
        engine: "yelp",
        find_desc: name,
        find_loc: findLoc,
        api_key: config.serpapiApiKey,
      },
      timeout: 10000,
    });
  } catch (err) {
    if (err.response) {
      const error = new Error(`SerpApi responded with status ${err.response.status}`);
      error.status = 502;
      error.details = err.response.data;
      throw error;
    }
    const error = new Error("Failed to reach SerpApi");
    error.status = 504;
    error.details = err.message;
    throw error;
  }

  if (response.data?.error) {
    const error = new Error(`SerpApi error: ${response.data.error}`);
    error.status = 502;
    throw error;
  }

  const place = response.data?.organic_results?.[0];
  // Yelp ratings are 0-5, but scoring.service.js's goodRating/
  // establishedPresence thresholds assume Foursquare's 0-10 scale -- scaled
  // up here so the same "good rating" bar applies regardless of which
  // service actually supplied the data.
  const result = place
    ? {
        placeId: place.place_id || null,
        website: null, // Yelp's own search results don't expose the business's website URL
        phone: place.phone || null,
        rating: typeof place.rating === "number" ? place.rating * 2 : null,
        ratingCount: parseReviewCount(place.reviews),
        isClosed: null, // unknown -- the Yelp SERP result doesn't say either way
      }
    : null;

  if (npiKey) enrichmentCache.put(CACHE_NAMESPACE, npiKey, result);
  return result;
}

export { YelpNotConfiguredError };
export default { enrichCompany };
