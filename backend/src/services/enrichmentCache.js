// In-memory, NPI-keyed cache for enrichment results (Foursquare, OSM, CMS).
// Node parity for appscript/services/EnrichmentCache.js -- Apps Script needs
// this to spare a shared daily quota, but even for the long-lived Node
// process it avoids re-fetching the same NPI's data on every re-run of a
// search with slightly different filters.
//
// Distinguishes "never looked up" (undefined) from "looked up, found
// nothing" (null, still a real cached value) so a confirmed-empty result
// isn't refetched either.

const TTL_MS = 60 * 60 * 1000; // 1h -- balances quota/latency savings against data freshness

const store = new Map(); // "namespace:npi" -> { value, expiresAt }

function key(namespace, npi) {
  return `${namespace}:${npi}`;
}

export function get(namespace, npi) {
  if (!npi) return undefined;
  const entry = store.get(key(namespace, npi));
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key(namespace, npi));
    return undefined;
  }
  return entry.value;
}

export function put(namespace, npi, value) {
  if (!npi) return;
  store.set(key(namespace, npi), { value, expiresAt: Date.now() + TTL_MS });
}

export default { get, put };
