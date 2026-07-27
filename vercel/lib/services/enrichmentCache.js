// Supabase-backed replacement for appscript/services/EnrichmentCache.js
// (which wrapped Apps Script's CacheService) and backend/src/services/
// enrichmentCache.js (which used an in-memory Map). Neither of those
// approaches survives here: Vercel serverless functions are stateless
// between invocations, so an in-memory Map would just miss on every single
// request -- there IS no long-lived process to hold it in memory. A real
// table is the only option that actually persists across invocations.
//
// Distinguishes "never looked up" (undefined) from "looked up, found
// nothing" (null, still a real cached value) so a confirmed-empty result
// isn't refetched either -- same contract as both prior versions.

const TTL_MS = 60 * 60 * 1000; // 1h -- balances quota/latency savings against data freshness

function cacheKey(namespace, npi) {
  return `${namespace}:${npi}`;
}

// `supabase` here is always a service-role client -- this table has no RLS
// (server-only, never queried from the browser), and enrichment lookups
// happen before/independent of which user is searching, so there's no
// per-user scoping to apply.
export async function get(supabase, namespace, npi) {
  if (!npi) return undefined;
  const { data, error } = await supabase
    .from("enrichment_cache")
    .select("payload, created_at")
    .eq("cache_key", cacheKey(namespace, npi))
    .maybeSingle();

  if (error || !data) return undefined;
  if (Date.now() - new Date(data.created_at).getTime() > TTL_MS) return undefined; // stale -- treat as a miss
  return data.payload;
}

export async function put(supabase, namespace, npi, value) {
  if (!npi) return;
  await supabase
    .from("enrichment_cache")
    .upsert({ cache_key: cacheKey(namespace, npi), payload: value === undefined ? null : value, created_at: new Date().toISOString() });
}

// Batch version of get() -- one Supabase round-trip for N keys instead of N
// sequential round-trips. Returns a plain object where a key being present
// (even with a null value) means cache hit; a key absent means cache miss.
export async function getMany(supabase, namespace, npis) {
  const valid = (npis || []).filter(Boolean).map(String);
  if (valid.length === 0) return {};
  const keys = valid.map((npi) => cacheKey(namespace, npi));
  const { data, error } = await supabase
    .from("enrichment_cache")
    .select("cache_key, payload, created_at")
    .in("cache_key", keys);
  if (error || !data) return {};
  const now = Date.now();
  const result = {};
  for (const row of data) {
    if (now - new Date(row.created_at).getTime() > TTL_MS) continue; // stale -- treat as miss
    const npi = row.cache_key.slice(namespace.length + 1);
    result[npi] = row.payload; // null is a valid cached value ("confirmed empty")
  }
  return result;
}

export default { get, put, getMany };
