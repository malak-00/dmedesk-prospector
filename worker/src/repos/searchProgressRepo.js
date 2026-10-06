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
  // The quality filters and sort order change which leads a search holds and
  // in what order, so a different one is a different search with its own
  // bookmark. They are added only when set, so every search made before they
  // existed keeps exactly the fingerprint (and saved progress) it had.
  const advanced = {};
  if (criteria.hasPhone) advanced.hasPhone = true;
  if (criteria.hasDecisionMaker) advanced.hasDecisionMaker = true;
  if (criteria.activeMedicare) advanced.activeMedicare = true;
  if (criteria.zip) advanced.zip = String(criteria.zip);
  if (criteria.sortBy) advanced.sortBy = String(criteria.sortBy);
  // The Medicare minimum only counts once the database applies it (any of the
  // options above in play); on its own it is still the old after-the-fact
  // filter, and old searches must keep their fingerprint.
  if (Object.keys(advanced).length && criteria.minMedicareClaims != null && criteria.minMedicareClaims !== "" && Number(criteria.minMedicareClaims) > 0) {
    advanced.minMedicareClaims = Number(criteria.minMedicareClaims);
  }
  if (Object.keys(advanced).length) parts.advanced = advanced;
  // Searches read from DME Desk's own table keep their own bookmarks. A bookmark is
  // a position in one source's ordering, so a position saved against the mirror
  // would skip or repeat leads here. The old bookmark is left untouched (so
  // switching back loses nothing) and getProgress carries over what was already seen.
  if (criteria.source === "dmedesk") parts.src = "dmedesk";
  return JSON.stringify(parts);
}

const MAX_SEEN_NPIS = 4000;

// Bookmarks saved before this version moved by a whole page even when only part
// of it had been shown, so they sit past rows nobody ever saw. They carry no
// marker; on first use their position is dropped (what was SEEN is kept, so
// nothing is shown twice) and the search re-reads from the top, skipping the
// seen rows. New bookmarks are stamped so this happens once.
const POSITION_VERSION = 2;
export function readPositions(stored) {
  const { _v, ...rest } = stored || {};
  return _v === POSITION_VERSION ? rest : {};
}

// Never throws -- a resume/persist hiccup should never break an otherwise-
// working search, same guarantee CompanyService relied on from the Sheets version.
export async function getProgress(supabase, userId, criteria) {
  if (!userId) return null;
  try {
    const lookup = async (fp) => supabase
      .from("search_progress")
      .select("variant_skips, seen_npis")
      .eq("user_id", userId)
      .eq("filter_fingerprint", fp)
      .maybeSingle();

    const { data, error } = await lookup(fingerprint(criteria));
    if (!error && data) return { variantSkips: readPositions(data.variant_skips), seenNpis: data.seen_npis || [] };

    // First time this rep runs this search against DME Desk's own table: their
    // old bookmark counts positions in the mirror's ordering, which would skip or
    // repeat leads here, so the position starts fresh. What they have already
    // SEEN carries over, so they are not shown the same leads again.
    if (criteria.source === "dmedesk") {
      const legacy = await lookup(fingerprint({ ...criteria, source: undefined }));
      if (!legacy.error && legacy.data) return { variantSkips: {}, seenNpis: legacy.data.seen_npis || [] };
    }
    return null;
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
        variant_skips: { ...(variantSkips || {}), _v: POSITION_VERSION },
        seen_npis: capped,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,filter_fingerprint" }
    );
  } catch (err) {
    console.log("[searchProgressRepo] saveProgress failed: " + err.message);
  }
}
