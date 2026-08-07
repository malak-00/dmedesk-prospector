// Port of appscript/services/EnrichmentCache.js -- CacheService (Apps
// Script's built-in KV) becomes the `enrichment_cache` Supabase table
// (already part of the schema, see MIGRATION_TO_VERCEL_SUPABASE.md).
// Same TTL and same "undefined = never looked up" vs "null = looked up,
// found nothing, still a real cached value" distinction.
const TTL_SECONDS = 3600; // 1h

function key(namespace, npi) {
  return `${namespace}_${npi}`;
}

export async function get(supabase, namespace, npi) {
  if (!npi) return undefined;
  const { data, error } = await supabase
    .from("enrichment_cache")
    .select("payload, created_at")
    .eq("cache_key", key(namespace, npi))
    .maybeSingle();
  if (error || !data) return undefined;
  const ageSeconds = (Date.now() - new Date(data.created_at).getTime()) / 1000;
  if (ageSeconds > TTL_SECONDS) return undefined;
  return data.payload;
}

export async function put(supabase, namespace, npi, value) {
  if (!npi) return;
  await supabase.from("enrichment_cache").upsert({
    cache_key: key(namespace, npi),
    payload: value === undefined ? null : value,
    created_at: new Date().toISOString(),
  });
}
