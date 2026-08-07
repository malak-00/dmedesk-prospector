// Replaces appscript/services/TaxonomyService.js's "Taxonomies" tab with the
// `taxonomies` table. The frontend treats `rowNumber` as an opaque string
// identifier (see docs/app.js's taxonomy-enable button, matched only by
// String() equality) -- so the table's real `id` (uuid) is returned as
// `rowNumber` with zero frontend changes needed.
const MAX_SEARCH_RESULTS = 25;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function toDTO(row) {
  return {
    rowNumber: row.id,
    facilityType: row.facility_type,
    code: row.code || "",
    description: row.description || row.facility_type,
  };
}

export async function listEnabled(supabase) {
  const { data, error } = await supabase.from("taxonomies").select("*").eq("enabled", true).order("facility_type");
  if (error) throw httpError(500, "Failed to load taxonomies: " + error.message);
  return (data || []).map(toDTO);
}

export async function search(supabase, keyword) {
  const term = String(keyword || "").trim();
  if (!term) return [];

  const { data, error } = await supabase
    .from("taxonomies")
    .select("*")
    .or(`facility_type.ilike.%${term}%,code.ilike.%${term}%,description.ilike.%${term}%`)
    .limit(MAX_SEARCH_RESULTS);
  if (error) throw httpError(500, "Failed to search taxonomies: " + error.message);
  return (data || []).map(toDTO);
}

export async function enable(supabase, rowNumber) {
  if (!rowNumber) throw httpError(400, "A valid rowNumber is required");

  const { data, error } = await supabase.from("taxonomies").update({ enabled: true }).eq("id", rowNumber).select().maybeSingle();
  if (error) throw httpError(500, "Failed to enable taxonomy: " + error.message);
  if (!data) throw httpError(404, "No taxonomy row with id " + rowNumber);

  return listEnabled(supabase);
}
