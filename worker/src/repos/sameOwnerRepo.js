// Other businesses run by the same authorized official (see lib/sameOwner.js). Read-only and on demand: asked for
// when a Prospect card is opened.
import { buildSameOwner, ownerName } from "../lib/sameOwner.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const CANDIDATES = 200;

export async function findSameOwner(supabase, npi, excludeNpis = []) {
  const id = String(npi || "").trim();
  if (!/^\d{6,12}$/.test(id)) throw httpError(400, "Send a valid NPI.");

  const mine = await supabase
    .from("npi_records")
    .select("npi, address_state, authorizedofficial_firstname, authorizedofficial_lastname, authorizedofficial_phone")
    .eq("npi", id)
    .maybeSingle();
  if (mine.error) throw httpError(500, "Failed to look up the owner: " + mine.error.message);
  const me = mine.data;
  const name = me && ownerName(me.authorizedofficial_firstname, me.authorizedofficial_lastname);
  if (!name) return { total: 0, ambiguous: false, matches: [] };

  const found = await supabase
    .from("npi_records")
    .select("npi, name, phone, status, taxonomy_description, address_city, address_state, authorizedofficial_phone")
    .eq("authorizedofficial_lastname", me.authorizedofficial_lastname)
    .eq("authorizedofficial_firstname", me.authorizedofficial_firstname)
    .limit(CANDIDATES);
  if (found.error) throw httpError(500, "Failed to look up the owner's other businesses: " + found.error.message);

  const base = { npi: id, state: me.address_state, officialPhone: me.authorizedofficial_phone };
  const first = buildSameOwner(base, found.data || [], new Map(), excludeNpis);
  if (!first.matches.length) return first;

  // Mark the ones a teammate already holds.
  const leads = await supabase.from("leads").select("npi, claimed_by").in("npi", first.matches.map((m) => m.npi)).not("claimed_by", "is", null);
  if (leads.error || !(leads.data || []).length) return first;
  const users = await supabase.from("app_users").select("id, display_name").in("id", [...new Set(leads.data.map((l) => l.claimed_by))]);
  const names = new Map((users.data || []).map((u) => [u.id, u.display_name]));
  const claims = new Map(leads.data.map((l) => [String(l.npi), { by: names.get(l.claimed_by) || "" }]));
  return buildSameOwner(base, found.data || [], claims, excludeNpis);
}
