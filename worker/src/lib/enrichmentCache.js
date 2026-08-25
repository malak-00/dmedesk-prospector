// Port of appscript/services/EnrichmentCache.js -- CacheService (Apps
// Script's built-in KV) becomes the `enrichment_cache` Supabase table
// (already part of the schema, see MIGRATION_TO_VERCEL_SUPABASE.md).
// Same TTL and same "undefined = never looked up" vs "null = looked up,
// found nothing, still a real cached value" distinction.
const TTL_SECONDS = 3600; // 1h

function key(namespace, npi) {
  return `${namespace}_${npi}`;
}

// One round trip covering every npi instead of one round trip per npi.
// Returns a Map of npi -> cached value, containing only entries that were
// actually found and not expired (absent = never looked up).
export async function getMany(supabase, namespace, npis) {
  const found = new Map();
  const candidates = [...new Set((npis || []).map(String).filter(Boolean))];
  if (candidates.length === 0) return found;

  const keyToNpi = new Map(candidates.map((npi) => [key(namespace, npi), npi]));
  const { data, error } = await supabase
    .from("enrichment_cache")
    .select("cache_key, payload, created_at")
    .in("cache_key", [...keyToNpi.keys()]);
  if (error || !data) return found;

  const now = Date.now();
  for (const row of data) {
    const npi = keyToNpi.get(row.cache_key);
    if (!npi) continue;
    const ageSeconds = (now - new Date(row.created_at).getTime()) / 1000;
    if (ageSeconds > TTL_SECONDS) continue;
    found.set(npi, row.payload);
  }
  return found;
}

// One upsert covering every entry instead of one per npi. `entries` is an
// array of { npi, value }.
export async function putMany(supabase, namespace, entries) {
  const rows = (entries || [])
    .filter((e) => e && e.npi)
    .map((e) => ({
      cache_key: key(namespace, String(e.npi)),
      payload: e.value === undefined ? null : e.value,
      created_at: new Date().toISOString(),
    }));
  if (rows.length === 0) return;
  await supabase.from("enrichment_cache").upsert(rows);
}
