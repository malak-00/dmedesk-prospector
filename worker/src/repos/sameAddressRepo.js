// Other providers registered at the same building as one lead (chains, shared offices). Read-only and
// on demand: asked for when a Prospect card is opened, not for every row of a search. Uses the
// existing city index, so it needs no new SQL.
import { buildSameAddress, escapeLike, streetKey, usableStreetKey } from "../lib/sameAddress.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const CANDIDATES = 80;

export async function findSameAddress(supabase, npi, excludeNpis = []) {
  const id = String(npi || "").trim();
  if (!/^\d{6,12}$/.test(id)) throw httpError(400, "Send a valid NPI.");

  const mine = await supabase
    .from("npi_records")
    .select("npi, address_line1, address_city, address_state, address_postalcode")
    .eq("npi", id)
    .maybeSingle();
  if (mine.error) throw httpError(500, "Failed to look up the lead's address: " + mine.error.message);
  const me = mine.data;
  const key = me ? streetKey(me.address_line1) : "";
  if (!me || !usableStreetKey(key) || !me.address_city || !me.address_state) return { total: 0, matches: [] };

  const found = await supabase
    .from("npi_records")
    .select("npi, name, phone, status, taxonomy_description, address_line1, address_postalcode")
    .eq("address_state", me.address_state)
    .eq("address_city", me.address_city)
    .ilike("address_line1", escapeLike(key) + "%")
    .limit(CANDIDATES);
  if (found.error) throw httpError(500, "Failed to look up the address: " + found.error.message);

  const result = buildSameAddress({ npi: id, ...me }, found.data || [], new Map(), excludeNpis);
  if (!result.matches.length) return result;

  // Mark the ones a teammate already holds, so a rep doesn't call into an account someone owns.
  const leads = await supabase.from("leads").select("npi, claimed_by, status").in("npi", result.matches.map((m) => m.npi)).not("claimed_by", "is", null);
  if (leads.error || !(leads.data || []).length) return result;
  const ids = [...new Set(leads.data.map((l) => l.claimed_by))];
  const users = await supabase.from("app_users").select("id, display_name").in("id", ids);
  const names = new Map((users.data || []).map((u) => [u.id, u.display_name]));
  const claims = new Map(leads.data.map((l) => [String(l.npi), { by: names.get(l.claimed_by) || "", status: l.status || "" }]));
  return buildSameAddress({ npi: id, ...me }, found.data || [], claims, excludeNpis);
}
