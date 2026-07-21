// Supabase-backed replacement for
// appscript/services/SearchProgressService.js. fingerprint() is pure logic
// and ports unchanged; getProgress/saveProgress become a real upsert
// against the search_progress table (unique on (user_id,
// filter_fingerprint)) instead of a linear scan of a Sheets tab.

function normalizeList(list) {
  return (list || [])
    .map((v) => String(v).trim().toLowerCase())
    .filter(Boolean)
    .sort();
}

// A stable identity for "this exact combination of search filters" --
// independent of pagination knobs (limit/skip/variantSkips/excludeNpis),
// independent of array order, case-insensitive on free-text fields.
export function fingerprint(criteria = {}) {
  const norm = (v) => (v === undefined || v === null ? "" : String(v).trim().toLowerCase());
  const parts = {
    npi: norm(criteria.npi),
    organizationName: norm(criteria.organizationName),
    nameContains: normalizeList(criteria.nameContainsTerms?.length ? criteria.nameContainsTerms : criteria.nameContains ? [criteria.nameContains] : []),
    city: norm(criteria.city),
    states: normalizeList(criteria.states?.length ? criteria.states : [criteria.state]),
    taxonomies: normalizeList(criteria.taxonomyDescriptions?.length ? criteria.taxonomyDescriptions : [criteria.taxonomyDescription]),
    years: normalizeList(criteria.lastUpdatedYears?.length ? criteria.lastUpdatedYears : [criteria.lastUpdatedYear]),
    excludeKeywords: normalizeList(criteria.excludeKeywords),
  };
  return JSON.stringify(parts);
}

// Returns { variantSkips, seenNpis } for this user's last-known position on
// this exact filter set, or null if there's no bookmark yet. Never throws.
export async function getProgress(supabase, userId, criteria) {
  try {
    const fp = fingerprint(criteria);
    const { data, error } = await supabase
      .from("search_progress")
      .select("variant_skips, seen_npis")
      .eq("user_id", userId)
      .eq("filter_fingerprint", fp)
      .maybeSingle();
    if (error || !data) return null;
    return { variantSkips: data.variant_skips || {}, seenNpis: data.seen_npis || [] };
  } catch (err) {
    console.error("[searchProgressService] getProgress failed:", err.message);
    return null;
  }
}

const MAX_SEEN_NPIS = 4000; // same cap as the Sheets version -- see SearchProgressService.js's comment

// Upserts this user's bookmark for this filter set. Never throws.
export async function saveProgress(supabase, userId, criteria, variantSkips, seenNpis) {
  try {
    const fp = fingerprint(criteria);
    const capped = (seenNpis || []).map(String).slice(-MAX_SEEN_NPIS);

    const { error } = await supabase
      .from("search_progress")
      .upsert(
        {
          user_id: userId,
          filter_fingerprint: fp,
          variant_skips: variantSkips || {},
          seen_npis: capped,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,filter_fingerprint" }
      );
    if (error) throw error;
  } catch (err) {
    console.error("[searchProgressService] saveProgress failed:", err.message);
  }
}

export default { getProgress, saveProgress, fingerprint };
