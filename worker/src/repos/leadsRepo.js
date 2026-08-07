// Replaces appscript/services/SheetsStore.js's lead-tracking half (the
// "Claimed - <Name>" / "Disconnected" tabs) with real queries against the
// `leads` table. One table, `claimed_by` + `is_disconnected` replacing the
// old per-teammate-tab-plus-shared-Disconnected-tab layout entirely -- see
// MIGRATION_TO_VERCEL_SUPABASE.md's schema notes for why.
const DEFAULT_STATUSES = ["new", "called", "voicemail", "interested", "not interested", "do not call"];
const MAX_STATUS_LENGTH = 40;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// DB row -> the shape the frontend already expects (same field names
// listClaimedLeads used to return from the Sheets version).
function toLeadDTO(row, claimedByDisplayName) {
  const statusUpdatedAt = row.status_updated_at || "";
  const claimedAt = row.claimed_at || "";
  return {
    npi: row.npi,
    name: row.company_name,
    addressLine1: row.address_line1,
    city: row.city,
    state: row.state,
    postalCode: row.postal_code,
    taxonomy: row.specialty,
    website: row.website,
    email: row.email,
    contactName: row.contact_name,
    contactTitle: row.contact_title,
    contactRole: row.contact_role,
    contactSource: row.contact_source,
    additionalContacts: row.additional_contacts_found,
    contactPhone: row.contact_phone,
    companyPhone: row.phone,
    rating: row.rating,
    scoreValue: row.score_value,
    scorePercentage: row.score_percentage,
    sources: row.data_sources,
    medicareClaims: row.medicare_claims,
    medicareBeneficiaries: row.medicare_beneficiaries,
    medicarePayment: row.medicare_payment,
    nppesLastUpdated: row.nppes_last_updated,
    claimedBy: claimedByDisplayName,
    claimedAt,
    status: row.status || "new",
    statusUpdatedAt,
    lastUpdated: statusUpdatedAt || claimedAt,
    notes: row.notes || "",
    reminderAt: row.reminder_at || "",
  };
}

// Company (search-result shape, see companyModel.js) -> a fresh `leads` row.
function companyToLeadRow(company, session, { status, isDisconnected }) {
  const flat = company; // already flattened by the caller (csvExport.flattenCompany)
  const now = new Date().toISOString();
  return {
    npi: String(company.npi),
    claimed_by: session.id,
    claimed_at: now,
    company_name: flat.name,
    phone: flat.phone,
    website: flat.website,
    email: flat.email,
    address_line1: flat.addressLine1,
    city: flat.city,
    state: flat.state,
    postal_code: flat.postalCode,
    specialty: flat.taxonomy,
    contact_name: flat.contactName,
    contact_title: flat.contactTitle,
    contact_role: flat.contactRole,
    contact_source: flat.contactSource,
    additional_contacts_found: String(flat.additionalContacts ?? ""),
    rating: flat.rating === "" ? null : flat.rating,
    score_value: flat.scoreValue === "" ? null : flat.scoreValue,
    score_percentage: flat.scorePercentage === "" ? null : flat.scorePercentage,
    data_sources: flat.sources,
    medicare_claims: flat.medicareClaims === "" ? null : flat.medicareClaims,
    medicare_beneficiaries: flat.medicareBeneficiaries === "" ? null : flat.medicareBeneficiaries,
    medicare_payment: flat.medicarePayment === "" ? null : flat.medicarePayment,
    contact_phone: flat.contactPhone,
    nppes_last_updated: flat.nppesLastUpdated || null,
    status,
    status_updated_by: isDisconnected ? session.id : null,
    status_updated_at: isDisconnected ? now : null,
    notes: null,
    reminder_at: null,
    is_disconnected: isDisconnected,
  };
}

// Every NPI already handled by ANYONE (claimed or disconnected) -- used to
// filter fresh NPPES search results, same as SheetsStore.getClaimedNpis.
export async function getClaimedNpis(supabase) {
  const claimed = new Set();
  let from = 0;
  const pageSize = 1000;
  for (;;) {
    const { data, error } = await supabase.from("leads").select("npi").range(from, from + pageSize - 1);
    if (error) throw httpError(500, "Failed to load claimed NPIs: " + error.message);
    (data || []).forEach((row) => claimed.add(String(row.npi)));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return claimed;
}

export async function getKnownStatuses(supabase) {
  const { data, error } = await supabase.from("leads").select("status").eq("is_disconnected", false);
  if (error) throw httpError(500, "Failed to load statuses: " + error.message);
  const seen = new Set(DEFAULT_STATUSES);
  const known = [...DEFAULT_STATUSES];
  (data || []).forEach((row) => {
    const s = String(row.status || "").trim();
    if (s && !seen.has(s)) {
      seen.add(s);
      known.push(s);
    }
  });
  return known;
}

// Always scoped to the caller's own leads -- same privacy boundary
// Code.js's leads/list enforced (session.displayName, never a raw param).
export async function listClaimedLeads(supabase, session) {
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("claimed_by", session.id)
    .eq("is_disconnected", false)
    .order("status_updated_at", { ascending: false, nullsFirst: false })
    .order("claimed_at", { ascending: false });
  if (error) throw httpError(500, "Failed to load claimed leads: " + error.message);
  return (data || []).map((row) => toLeadDTO(row, session.displayName));
}

export async function exportCompaniesToLeads(supabase, companies, session, flattenCompany) {
  companies = companies || [];
  if (!Array.isArray(companies) || companies.length === 0) throw httpError(400, "At least one company is required to export");

  const rows = companies.map((c) => companyToLeadRow(flattenCompany(c), session, { status: "new", isDisconnected: false }));
  const { error } = await supabase.from("leads").upsert(rows, { onConflict: "npi,claimed_by", ignoreDuplicates: true });
  if (error) throw httpError(500, "Failed to save claimed leads: " + error.message);

  return { rowsAdded: rows.length, claimedBy: session.displayName };
}

export async function exportCompaniesToDisconnected(supabase, companies, session, flattenCompany) {
  companies = companies || [];
  if (!Array.isArray(companies) || companies.length === 0) throw httpError(400, "At least one company is required to send to Disconnected");

  const rows = companies.map((c) => companyToLeadRow(flattenCompany(c), session, { status: "disconnected", isDisconnected: true }));
  const { error } = await supabase.from("leads").insert(rows);
  if (error) throw httpError(500, "Failed to save disconnected leads: " + error.message);

  return { rowsAdded: rows.length };
}

export async function moveClaimedLeadsToDisconnected(supabase, npis, session) {
  npis = (npis || []).map(String).filter(Boolean);
  if (npis.length === 0) throw httpError(400, "At least one NPI is required");

  const { data: existing, error: findErr } = await supabase
    .from("leads")
    .select("npi")
    .eq("claimed_by", session.id)
    .eq("is_disconnected", false)
    .in("npi", npis);
  if (findErr) throw httpError(500, "Failed to look up leads: " + findErr.message);
  const foundNpis = new Set((existing || []).map((r) => String(r.npi)));
  const notFound = npis.filter((npi) => !foundNpis.has(npi));

  const { error } = await supabase
    .from("leads")
    .update({ is_disconnected: true, status: "disconnected", status_updated_by: session.id, status_updated_at: new Date().toISOString() })
    .eq("claimed_by", session.id)
    .eq("is_disconnected", false)
    .in("npi", npis);
  if (error) throw httpError(500, "Failed to disconnect leads: " + error.message);

  return { movedCount: foundNpis.size, notFound };
}

export async function returnClaimedLeadsToProspect(supabase, npis, session) {
  npis = (npis || []).map(String).filter(Boolean);
  if (npis.length === 0) throw httpError(400, "At least one NPI is required");

  const { data: existing, error: findErr } = await supabase.from("leads").select("npi").eq("claimed_by", session.id).in("npi", npis);
  if (findErr) throw httpError(500, "Failed to look up leads: " + findErr.message);
  const foundNpis = new Set((existing || []).map((r) => String(r.npi)));
  const notFound = npis.filter((npi) => !foundNpis.has(npi));

  const { error } = await supabase.from("leads").delete().eq("claimed_by", session.id).in("npi", npis);
  if (error) throw httpError(500, "Failed to return leads to Prospect: " + error.message);

  return { returnedCount: foundNpis.size, notFound };
}

async function requireOwnLead(supabase, npi, session) {
  const { data, error } = await supabase.from("leads").select("npi, notes").eq("claimed_by", session.id).eq("npi", String(npi)).maybeSingle();
  if (error) throw httpError(500, "Failed to look up lead: " + error.message);
  if (!data) throw httpError(404, "No lead with NPI " + npi + " found in your claimed leads");
  return data;
}

export async function updateLeadStatus(supabase, npi, status, session) {
  if (!npi) throw httpError(400, "npi is required");
  const trimmedStatus = String(status || "").trim();
  if (!trimmedStatus) throw httpError(400, "status is required");
  if (trimmedStatus.length > MAX_STATUS_LENGTH) throw httpError(400, `status must be ${MAX_STATUS_LENGTH} characters or fewer`);

  await requireOwnLead(supabase, npi, session);

  const { error } = await supabase
    .from("leads")
    .update({ status: trimmedStatus, status_updated_by: session.id, status_updated_at: new Date().toISOString() })
    .eq("claimed_by", session.id)
    .eq("npi", String(npi));
  if (error) throw httpError(500, "Failed to update status: " + error.message);

  return { npi: String(npi), status: trimmedStatus, rowsUpdated: 1 };
}

export async function addLeadNote(supabase, npi, noteText, session) {
  if (!npi) throw httpError(400, "npi is required");
  const trimmedNote = String(noteText || "").trim();
  if (!trimmedNote) throw httpError(400, "note text is required");

  const existing = await requireOwnLead(supabase, npi, session);

  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const entry = stamp + (session.displayName ? " — " + session.displayName : "") + ": " + trimmedNote;
  const finalNotes = String(existing.notes || "").trim() ? entry + "\n" + existing.notes.trim() : entry;

  const { error } = await supabase.from("leads").update({ notes: finalNotes }).eq("claimed_by", session.id).eq("npi", String(npi));
  if (error) throw httpError(500, "Failed to save note: " + error.message);

  return { npi: String(npi), notes: finalNotes, rowsUpdated: 1 };
}

export async function replaceLeadNotes(supabase, npi, notesText, session) {
  if (!npi) throw httpError(400, "npi is required");
  await requireOwnLead(supabase, npi, session);

  const finalNotes = String(notesText || "");
  const { error } = await supabase.from("leads").update({ notes: finalNotes }).eq("claimed_by", session.id).eq("npi", String(npi));
  if (error) throw httpError(500, "Failed to save notes: " + error.message);

  return { npi: String(npi), notes: finalNotes, rowsUpdated: 1 };
}

export async function setLeadReminder(supabase, npi, reminderAt, session) {
  if (!npi) throw httpError(400, "npi is required");
  const trimmed = String(reminderAt || "").trim();
  if (trimmed && isNaN(Date.parse(trimmed))) throw httpError(400, "reminderAt must be a valid date/time, or empty to clear it");

  await requireOwnLead(supabase, npi, session);

  const { error } = await supabase
    .from("leads")
    .update({ reminder_at: trimmed || null })
    .eq("claimed_by", session.id)
    .eq("npi", String(npi));
  if (error) throw httpError(500, "Failed to set reminder: " + error.message);

  return { npi: String(npi), reminderAt: trimmed, rowsUpdated: 1 };
}

export { DEFAULT_STATUSES };
