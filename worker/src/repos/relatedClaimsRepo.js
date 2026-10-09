// "Does this lead look like one that is already claimed?" — answered from the claimed leads (see lib/relatedClaims.js).
// The claimed leads are kept for a minute, so claiming a page of leads reads them once, not once per lead.
import { findRelatedClaims } from "../lib/relatedClaims.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const CACHE_MS = 60 * 1000;
const PAGE = 1000;
const MAX_PAGES = 60;
const MAX_INPUTS = 200;
let cache = null; // { at, rows }

async function loadClaimed(supabase) {
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await supabase
      .from("leads")
      .select("npi, company_name, city, state, phone, contact_phone, contact_name, claimed_by, status")
      .eq("is_disconnected", false)
      .not("claimed_by", "is", null)
      .order("npi", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw httpError(500, "Failed to read claimed leads: " + error.message);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  const ids = [...new Set(rows.map((r) => r.claimed_by))];
  const names = new Map();
  if (ids.length) {
    const users = await supabase.from("app_users").select("id, display_name").in("id", ids);
    (users.data || []).forEach((u) => names.set(u.id, u.display_name));
  }
  return rows.map((r) => ({
    npi: String(r.npi), name: r.company_name, city: r.city, state: r.state, status: r.status,
    phones: [r.phone, r.contact_phone], owner: r.contact_name,
    claimedBy: names.get(r.claimed_by) || "a teammate", claimedById: r.claimed_by,
  }));
}

// companies: [{ npi, phones: [], owner, state }] -> { related: { npi: [ { name, claimedBy, mine, why, ... } ] } }
export async function checkRelated(supabase, session, companies, now = Date.now()) {
  const inputs = (Array.isArray(companies) ? companies : []).slice(0, MAX_INPUTS)
    .filter((c) => c && /^\d{10}$/.test(String(c.npi || "")))
    .map((c) => ({ npi: String(c.npi), phones: Array.isArray(c.phones) ? c.phones.slice(0, 12).map(String) : [], owner: String(c.owner || ""), state: String(c.state || "") }));
  if (!inputs.length) return { related: {} };
  if (!cache || now - cache.at > CACHE_MS) cache = { at: now, rows: await loadClaimed(supabase) };
  return { related: Object.fromEntries(findRelatedClaims(inputs, cache.rows, session.id)) };
}

export function clearRelatedCache() { cache = null; }
