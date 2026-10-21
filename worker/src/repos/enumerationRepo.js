// When each provider got its NPI (NPPES enumeration date), for the New / Established badge.
// Read-only, and best-effort for the callers: a failure just leaves the badge off.
const CHUNK = 200;

export async function enumerationDatesFor(supabase, npis) {
  const list = [...new Set((npis || []).map(String).filter(Boolean))];
  const out = new Map();
  for (let i = 0; i < list.length; i += CHUNK) {
    const { data, error } = await supabase.from("npi_records").select("npi, enumeration_date").in("npi", list.slice(i, i + CHUNK));
    if (error) throw new Error("Failed to read enumeration dates: " + error.message);
    (data || []).forEach((r) => { if (r.enumeration_date) out.set(String(r.npi), String(r.enumeration_date).slice(0, 10)); });
  }
  return out;
}
