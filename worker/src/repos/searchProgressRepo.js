// Replaces appscript/services/SearchProgressService.js's "SearchProgress"
// tab with the `search_progress` table (unique on user_id + filter
// fingerprint, see MIGRATION_TO_VERCEL_SUPABASE.md's schema). Same
// fingerprinting logic, unchanged -- it's pure and has no I/O.
function normalizeList(list) {
  return (list || [])
    .map((v) => String(v).trim().toLowerCase())
    .filter(Boolean)
    .sort();
}

export function fingerprint(criteria = {}) {
  const norm = (v) => (v === undefined || v === null ? "" : String(v).trim().toLowerCase());
  const parts = {
    npi: norm(criteria.npi),
    organizationName: norm(criteria.organizationName),
    nameContains: normalizeList(
      criteria.nameContainsTerms && criteria.nameContainsTerms.length ? criteria.nameContainsTerms : criteria.nameContains ? [criteria.nameContains] : []
    ),
    city: norm(criteria.city),
    states: normalizeList(criteria.states && criteria.states.length ? criteria.states : [criteria.state]),
    taxonomies: normalizeList(
      criteria.taxonomyDescriptions && criteria.taxonomyDescriptions.length ? criteria.taxonomyDescriptions : [criteria.taxonomyDescription]
    ),
    years: normalizeList(criteria.lastUpdatedYears && criteria.lastUpdatedYears.length ? criteria.lastUpdatedYears : [criteria.lastUpdatedYear]),
    excludeKeywords: normalizeList(criteria.excludeKeywords),
  };
  return JSON.stringify(parts);
}

const MAX_SEEN_NPIS = 4000;

// Never throws -- a resume/persist hiccup should never break an otherwise-
// working search, same guarantee CompanyService relied on from the Sheets version.
export async function getProgress(supabase, userId, criteria) {
  if (!userId) return null;
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
    console.log("[searchProgressRepo] getProgress failed: " + err.message);
    return null;
  }
}

export async function saveProgress(supabase, userId, criteria, variantSkips, seenNpis) {
  if (!userId) return;
  try {
    const fp = fingerprint(criteria);
    const capped = (seenNpis || []).map(String).slice(-MAX_SEEN_NPIS);
    await supabase.from("search_progress").upsert(
      {
        user_id: userId,
        filter_fingerprint: fp,
        variant_skips: variantSkips || {},
        seen_npis: capped,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,filter_fingerprint" }
    );
  } catch (err) {
    console.log("[searchProgressRepo] saveProgress failed: " + err.message);
  }
}
