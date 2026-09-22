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

// Resolves each of `descriptions` to its taxonomy code (falls back to
// skipping the description if it's unknown or has no code on file).
// Used to send fakeNPI's exact-match taxonomy_code filter instead of
// taxonomy_description, since fakeNPI's npi_records don't have
// taxonomy_description populated.
export async function getCodesByDescriptions(supabase, descriptions) {
  const codeByDescription = new Map();
  const wanted = [...new Set((descriptions || []).filter(Boolean))];
  if (wanted.length === 0) return codeByDescription;

  const { data, error } = await supabase.from("taxonomies").select("description, facility_type, code").in("description", wanted);
  if (error) throw httpError(500, "Failed to resolve taxonomy codes: " + error.message);

  const addRows = (rows) => {
    (rows || []).forEach((row) => {
      // listEnabled() exposes description || facility_type to the browser;
      // resolve against that same effective value so legacy rows with a
      // blank Description still become exact taxonomy-code searches.
      const key = row.description || row.facility_type;
      if (key && row.code && wanted.includes(key)) codeByDescription.set(key, row.code);
    });
  };

  addRows(data);

  const unresolved = wanted.filter((description) => !codeByDescription.has(description));
  if (unresolved.length > 0) {
    const fallback = await supabase
      .from("taxonomies")
      .select("description, facility_type, code")
      .in("facility_type", unresolved);
    if (fallback.error) throw httpError(500, "Failed to resolve legacy taxonomy codes: " + fallback.error.message);
    addRows(fallback.data);
  }
  return codeByDescription;
}

// The reverse of getCodesByDescriptions -- fakeNPI's npi_records has
// taxonomy_code populated but not taxonomy_description (see nppes.js's
// header comment), so every search result comes back with a blank
// taxonomy.description. Resolving it here from our own `taxonomies`
// table (which does have real descriptions) is what makes the specialty
// actually show up in the UI and in exports again.
export async function getDescriptionsByCodes(supabase, codes) {
  const descriptionByCode = new Map();
  const wanted = [...new Set((codes || []).filter(Boolean))];
  if (wanted.length === 0) return descriptionByCode;

  const { data, error } = await supabase.from("taxonomies").select("code, description").in("code", wanted);
  if (error) throw httpError(500, "Failed to resolve taxonomy descriptions: " + error.message);

  (data || []).forEach((row) => {
    if (row.code && row.description) descriptionByCode.set(row.code, row.description);
  });
  return descriptionByCode;
}

export async function enable(supabase, rowNumber) {
  if (!rowNumber) throw httpError(400, "A valid rowNumber is required");

  const { data, error } = await supabase.from("taxonomies").update({ enabled: true }).eq("id", rowNumber).select().maybeSingle();
  if (error) throw httpError(500, "Failed to enable taxonomy: " + error.message);
  if (!data) throw httpError(404, "No taxonomy row with id " + rowNumber);

  return listEnabled(supabase);
}
