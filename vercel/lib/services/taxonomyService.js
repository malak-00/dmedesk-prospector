// Supabase-backed replacement for appscript/services/TaxonomyService.js.
// Much simpler than the Sheets version: the 5 legacy default taxonomies are
// seeded directly by supabase/migrations/0001_init.sql (no more
// runtime "seed on first read" dance), and rows are identified by a real
// UUID primary key instead of an unreliable Sheets row number. Any
// signed-in user can read/write (see the table's RLS policy) -- same trust
// model as the Sheets version: no approval step, anyone can add or enable
// a row.

const MAX_SEARCH_RESULTS = 25;

export async function listEnabled(supabase) {
  const { data, error } = await supabase
    .from("taxonomies")
    .select("id, facility_type, code, description")
    .eq("enabled", true);
  if (error) throw error;
  return data.map((r) => ({
    id: r.id,
    facilityType: r.facility_type,
    code: r.code,
    // Falls back to facilityType only for rows with no Description --
    // Description is what actually gets sent to NPPES as
    // taxonomy_description (see the migration's comment on this table).
    description: r.description || r.facility_type,
  }));
}

// Keyword search across Facility Type + Code + Description, across EVERY
// row (enabled or not) -- a rep needs to find and enable ones that aren't
// active yet.
export async function search(supabase, keyword) {
  const term = String(keyword || "").trim();
  if (!term) return [];

  const { data, error } = await supabase
    .from("taxonomies")
    .select("id, facility_type, code, description, enabled")
    .or(`facility_type.ilike.%${term}%,code.ilike.%${term}%,description.ilike.%${term}%`)
    .limit(MAX_SEARCH_RESULTS);
  if (error) throw error;
  return data.map((r) => ({ id: r.id, facilityType: r.facility_type, code: r.code, description: r.description, enabled: r.enabled }));
}

// Flips one specific row's enabled flag on, identified by its UUID.
export async function enable(supabase, id) {
  if (!id) {
    const err = new Error("A valid taxonomy id is required");
    err.status = 400;
    throw err;
  }

  const { data, error } = await supabase.from("taxonomies").update({ enabled: true }).eq("id", id).select("id");
  if (error) throw error;
  if (data.length === 0) {
    const err = new Error(`No taxonomy row with id ${id}`);
    err.status = 404;
    throw err;
  }

  return listEnabled(supabase);
}

export default { listEnabled, search, enable };
