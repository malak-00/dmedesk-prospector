import axios from "axios";
import config from "../config/index.js";
import enrichmentCache from "./enrichmentCache.js";

const CACHE_NAMESPACE = "fsq";

const BASE_URL = "https://places-api.foursquare.com/places/search";
const API_VERSION = "2025-06-17";

// If rating/stats fields ever get billed as Premium on your account,
// remove "rating" and "stats" from this list — everything else stays free-tier Pro.
const FIELDS = "fsq_place_id,name,tel,website,rating,stats,location,date_closed";

class FoursquareNotConfiguredError extends Error {
  constructor() {
    super("FOURSQUARE_SERVICE_API_KEY is not configured");
    this.name = "FoursquareNotConfiguredError";
  }
}

function assertConfigured() {
  if (!config.foursquareApiKey) {
    throw new FoursquareNotConfiguredError();
  }
}

/**
 * Looks up a business by name + locality string.
 * Returns null if not found. Throws FoursquareNotConfiguredError if no key set.
 */
async function enrichCompany({ npi, name, address }) {
  assertConfigured();

  const npiKey = npi != null ? String(npi) : null;
  if (npiKey) {
    const cached = enrichmentCache.get(CACHE_NAMESPACE, npiKey);
    if (cached !== undefined) return cached;
  }

  const near = [address?.city, address?.state].filter(Boolean).join(", ");
  if (!name || !near) return null;

  let response;
  try {
    response = await axios.get(BASE_URL, {
      params: {
        query: name,
        near,
        fields: FIELDS,
        limit: 1,
      },
      headers: {
        Authorization: `Bearer ${config.foursquareApiKey}`,
        "X-Places-Api-Version": API_VERSION,
        Accept: "application/json",
      },
      timeout: 10000,
    });
  } catch (err) {
    if (err.response) {
      const error = new Error(
        `Foursquare API responded with status ${err.response.status}`
      );
      error.status = 502;
      error.details = err.response.data;
      throw error;
    }
    const error = new Error("Failed to reach Foursquare API");
    error.status = 504;
    error.details = err.message;
    throw error;
  }

  const place = response.data?.results?.[0];
  const result = place
    ? {
        placeId: place.fsq_place_id || null,
        website: place.website || null,
        phone: place.tel || null,
        rating: typeof place.rating === "number" ? place.rating : null,
        ratingCount: place.stats?.total_ratings ?? null,
        isClosed: Boolean(place.date_closed),
      }
    : null;

  if (npiKey) enrichmentCache.put(CACHE_NAMESPACE, npiKey, result);
  return result;
}

export { FoursquareNotConfiguredError };
export default { enrichCompany };