// Follow-ups a rep set on leads (call intel, sql/051): "come back to this lead on this day". They work on any lead,
// claimed or not, and show on the Today screen of whoever set them from that day on. Returned with a card-shaped
// company, so call mode can dial them even when the lead is not claimed.
import { createCompany } from "../lib/companyModel.js";
import { classifyRole } from "../lib/roleClassifier.js";
import { isTableMissing } from "../lib/annotations.js";

const LIMIT = 100;
const COLUMNS = "npi, name, phone, address_line1, address_city, address_state, address_postalcode, taxonomy_code, taxonomy_description, authorizedofficial_firstname, authorizedofficial_lastname, authorizedofficial_title, authorizedofficial_phone, enumeration_date, isorganization";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function toCompany(row) {
  const official = row.authorizedofficial_lastname || row.authorizedofficial_firstname
    ? [{
        name: [row.authorizedofficial_firstname, row.authorizedofficial_lastname].filter(Boolean).join(" "),
        title: row.authorizedofficial_title || null,
        roleCategory: classifyRole(row.authorizedofficial_title || "authorized official"),
        phone: row.authorizedofficial_phone || null,
        source: "nppes",
        sourceUrl: null,
      }]
    : [];
  return createCompany({
    npi: String(row.npi),
    name: row.name,
    address: { line1: row.address_line1, city: row.address_city, state: row.address_state, postalCode: row.address_postalcode },
    phone: row.phone,
    taxonomy: { code: row.taxonomy_code, description: row.taxonomy_description },
    decisionMakers: official,
    enumerationDate: row.enumeration_date ? String(row.enumeration_date).slice(0, 10) : null,
    isOrganization: row.isorganization,
    sources: { nppes: true },
  });
}

// today: "YYYY-MM-DD" in the rep's own day (the browser sends it). Due = on or before today.
export async function listFollowUps(supabase, session, today) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(today || "")) ? String(today) : new Date().toISOString().slice(0, 10);
  const res = await supabase
    .from("lead_intel")
    .select("npi, follow_up_at, objection, current_biller")
    .eq("follow_up_by", session.id)
    .not("follow_up_at", "is", null)
    .lte("follow_up_at", day)
    .order("follow_up_at", { ascending: true })
    .limit(LIMIT);
  if (res.error) {
    if (isTableMissing(res.error) || res.error.code === "42703" || res.error.code === "PGRST204" || /follow_up/.test(res.error.message || "")) return { installed: false, items: [] };
    throw httpError(500, "Failed to load follow-ups: " + res.error.message);
  }
  const rows = res.data || [];
  if (!rows.length) return { installed: true, items: [] };
  const found = await supabase.from("npi_records").select(COLUMNS).in("npi", rows.map((r) => r.npi));
  if (found.error) throw httpError(500, "Failed to look up the follow-up leads: " + found.error.message);
  const byNpi = new Map((found.data || []).map((r) => [String(r.npi), r]));
  const items = rows.filter((r) => byNpi.has(String(r.npi))).map((r) => ({
    npi: String(r.npi),
    followUpAt: String(r.follow_up_at).slice(0, 10),
    objection: r.objection || "",
    currentBiller: r.current_biller || "",
    company: toCompany(byNpi.get(String(r.npi))),
  }));
  return { installed: true, items };
}
