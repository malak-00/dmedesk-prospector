// Supabase-backed replacement for the lead-tracking half of
// appscript/services/SheetsStore.js (exportCompaniesToSheet,
// moveClaimedLeadsToDisconnected, returnClaimedLeadsToProspect,
// getClaimedNpis, listClaimedLeads, updateLeadStatus, addLeadNote,
// replaceLeadNotes, setLeadReminder, getKnownStatuses). See
// ARCHITECTURE.md's "data model" section and MIGRATION_TO_VERCEL_SUPABASE.md
// for how this maps onto the old per-teammate-tab Sheets model.
//
// Row-Level Security (see supabase/migrations/0001_init.sql) enforces "you
// can only see/change your own claimed leads" at the database layer for
// anything queried through a user-scoped client (req.supabase from
// lib/http.js). Two operations are deliberately cross-user by nature --
// dedup (a lead claimed by ANYONE shouldn't resurface for anyone else) and
// the team-wide status list -- and take an explicit service-role client
// instead, the same way SheetsStore.getClaimedNpis() read across every
// teammate's tab, not just the caller's own.

const DEFAULT_STATUSES = ["new", "called", "voicemail", "interested", "not interested", "do not call"];
const MAX_STATUS_LENGTH = 40;

// flattenCompany()'s keys (see csvExport.js) -> `leads` table columns.
// Numeric columns are coerced with Number(); everything else stored as-is
// (empty string from flattenCompany becomes null, matching a blank Sheets
// cell's "nothing there" meaning).
const NUMERIC_KEYS = new Set(["rating", "scoreValue", "scorePercentage", "medicareClaims", "medicareBeneficiaries", "medicarePayment"]);
const KEY_TO_COLUMN = {
  name: "company_name",
  npi: "npi",
  phone: "phone",
  website: "website",
  email: "email",
  addressLine1: "address_line1",
  city: "city",
  state: "state",
  postalCode: "postal_code",
  taxonomy: "specialty",
  contactName: "contact_name",
  contactTitle: "contact_title",
  contactRole: "contact_role",
  contactSource: "contact_source",
  contactPhone: "contact_phone",
  additionalContacts: "additional_contacts_found",
  rating: "rating",
  scoreValue: "score_value",
  scorePercentage: "score_percentage",
  sources: "data_sources",
  medicareClaims: "medicare_claims",
  medicareBeneficiaries: "medicare_beneficiaries",
  medicarePayment: "medicare_payment",
  nppesLastUpdated: "nppes_last_updated",
};

function flatToRow(flat) {
  const row = {};
  for (const [key, column] of Object.entries(KEY_TO_COLUMN)) {
    const value = flat[key];
    if (value === "" || value === undefined) {
      row[column] = null;
    } else if (NUMERIC_KEYS.has(key)) {
      const n = Number(value);
      row[column] = Number.isFinite(n) ? n : null;
    } else {
      row[column] = String(value);
    }
  }
  return row;
}

function requireArray(value, message) {
  const arr = (value || []).map(String).filter(Boolean);
  if (arr.length === 0) {
    const error = new Error(message);
    error.status = 400;
    throw error;
  }
  return arr;
}

// Appends fresh rows for companies a user is claiming from Prospect --
// replaces SheetsStore.exportCompaniesToSheet.
export async function claimCompanies(userSupabase, userId, companies, flattenCompany) {
  companies = companies || [];
  if (!Array.isArray(companies) || companies.length === 0) {
    const error = new Error("At least one company is required to export");
    error.status = 400;
    throw error;
  }

  const rows = companies.map((company) => ({
    ...flatToRow(flattenCompany(company)),
    claimed_by: userId,
    claimed_at: new Date().toISOString(),
    status: "new",
  }));

  const { data, error } = await userSupabase.from("leads").insert(rows).select("id");
  if (error) throw error;
  return { rowsAdded: data.length, claimedBy: userId };
}

// Sends leads STRAIGHT to disconnected without ever being "claimed" --
// replaces SheetsStore.exportCompaniesToDisconnected (used from the
// Prospect view, for leads that were never claimed in the first place).
export async function disconnectNewCompanies(userSupabase, userId, companies, flattenCompany) {
  companies = companies || [];
  if (!Array.isArray(companies) || companies.length === 0) {
    const error = new Error("At least one company is required to send to Disconnected");
    error.status = 400;
    throw error;
  }

  const now = new Date().toISOString();
  const rows = companies.map((company) => ({
    ...flatToRow(flattenCompany(company)),
    claimed_by: userId,
    claimed_at: now,
    status: "disconnected",
    status_updated_by: userId,
    status_updated_at: now,
    is_disconnected: true,
  }));

  const { data, error } = await userSupabase.from("leads").insert(rows).select("id");
  if (error) throw error;
  return { rowsAdded: data.length };
}

// Moves a user's OWN already-claimed leads to disconnected -- replaces
// SheetsStore.moveClaimedLeadsToDisconnected. The old Sheets version had to
// scan every teammate's tab to find each NPI (the root cause of the
// "Return to Prospect" 2026-07-21 timeout bug); here it's one indexed
// UPDATE, scoped to this user's own rows both by the WHERE clause and by
// RLS underneath it.
export async function moveClaimedLeadsToDisconnected(userSupabase, userId, npis) {
  npis = requireArray(npis, "At least one NPI is required");
  const now = new Date().toISOString();

  const { data, error } = await userSupabase
    .from("leads")
    .update({ is_disconnected: true, status: "disconnected", status_updated_by: userId, status_updated_at: now })
    .eq("claimed_by", userId)
    .eq("is_disconnected", false)
    .in("npi", npis)
    .select("npi");
  if (error) throw error;
  // A missing RLS policy filters the target rows to nothing rather than
  // erroring -- surface that as a real error instead of a silent no-op
  // (see the 0003 migration's comment for exactly this happening once).
  if (data.length === 0) {
    const err = new Error(`No matching claimed lead(s) found for: ${npis.join(", ")}`);
    err.status = 404;
    throw err;
  }

  const foundNpis = new Set(data.map((r) => r.npi));
  const notFound = npis.filter((npi) => !foundNpis.has(npi));
  return { movedCount: data.length, notFound };
}

// Un-claims a user's OWN active leads -- replaces
// SheetsStore.returnClaimedLeadsToProspect. "Prospect" isn't a stored table
// at all (same as before): deleting the row is the whole feature, since a
// fresh search's dedup (getClaimedNpis below) simply won't see it anymore.
export async function returnClaimedLeadsToProspect(userSupabase, userId, npis) {
  npis = requireArray(npis, "At least one NPI is required");

  const { data, error } = await userSupabase
    .from("leads")
    .delete()
    .eq("claimed_by", userId)
    .eq("is_disconnected", false)
    .in("npi", npis)
    .select("npi");
  if (error) throw error;
  // Same defensive check as moveClaimedLeadsToDisconnected above -- a
  // missing RLS policy filters the target rows to nothing rather than
  // erroring.
  if (data.length === 0) {
    const err = new Error(`No matching claimed lead(s) found for: ${npis.join(", ")}`);
    err.status = 404;
    throw err;
  }

  const foundNpis = new Set(data.map((r) => r.npi));
  const notFound = npis.filter((npi) => !foundNpis.has(npi));
  return { returnedCount: data.length, notFound };
}

// Cross-user by design -- replaces SheetsStore.getClaimedNpis(), which read
// across every teammate's tab. `serviceSupabase` must be a service-role
// client (see lib/supabaseClient.js); RLS would otherwise hide every other
// user's rows, defeating the entire point of this dedup check.
export async function getClaimedNpis(serviceSupabase) {
  const { data, error } = await serviceSupabase.from("leads").select("npi");
  if (error) throw error;
  return new Set(data.map((r) => r.npi));
}

// Converts a raw `leads` row (Postgres snake_case columns) into the flat
// camelCase shape the claimed-leads UI expects -- the same naming
// convention flattenCompany() uses for Prospect search results, since the
// frontend's claimed-leads rendering code was written against that shape
// originally. `claimedBy` is always the CURRENT user's own display name --
// this route is always scoped to one user's own leads (see
// listClaimedLeads below), so there's never a need to look up anyone else's.
function rowToClaimedLead(row, displayName) {
  return {
    npi: row.npi,
    name: row.company_name,
    companyPhone: row.phone,
    website: row.website,
    email: row.email,
    addressLine1: row.address_line1,
    city: row.city,
    state: row.state,
    postalCode: row.postal_code,
    taxonomy: row.specialty,
    contactName: row.contact_name,
    contactTitle: row.contact_title,
    contactRole: row.contact_role,
    contactPhone: row.contact_phone,
    additionalContacts: row.additional_contacts_found,
    rating: row.rating,
    scoreValue: row.score_value,
    scorePercentage: row.score_percentage,
    sources: row.data_sources,
    medicareClaims: row.medicare_claims,
    medicareBeneficiaries: row.medicare_beneficiaries,
    medicarePayment: row.medicare_payment,
    nppesLastUpdated: row.nppes_last_updated,
    status: row.status,
    claimedBy: displayName,
    lastUpdated: row.status_updated_at || row.claimed_at,
    notes: row.notes,
    reminderAt: row.reminder_at,
  };
}

// Replaces SheetsStore.listClaimedLeads -- always scoped to one user's own
// leads (the Claimed Leads view has no team-wide mode -- see
// ARCHITECTURE.md's Auth section on why that's an intentional privacy
// boundary, not just a UI default).
export async function listClaimedLeads(userSupabase, userId, displayName) {
  const { data, error } = await userSupabase
    .from("leads")
    .select("*")
    .eq("claimed_by", userId)
    .eq("is_disconnected", false)
    .order("status_updated_at", { ascending: false, nullsFirst: false })
    .order("claimed_at", { ascending: false });
  if (error) throw error;
  return data.map((row) => rowToClaimedLead(row, displayName));
}

// Cross-user by design (a custom status one teammate introduces should
// appear as a real option for everyone) -- replaces
// SheetsStore.getKnownStatusesAcrossSheets_. `serviceSupabase` must be a
// service-role client, same reasoning as getClaimedNpis above.
export async function getKnownStatuses(serviceSupabase) {
  const { data, error } = await serviceSupabase.from("leads").select("status");
  if (error) throw error;

  const seen = new Set(DEFAULT_STATUSES);
  const known = [...DEFAULT_STATUSES];
  for (const row of data) {
    const s = String(row.status || "").trim();
    if (s && !seen.has(s)) {
      seen.add(s);
      known.push(s);
    }
  }
  return known;
}

export async function updateLeadStatus(userSupabase, userId, npi, status) {
  if (!npi) {
    const err = new Error("npi is required");
    err.status = 400;
    throw err;
  }
  const trimmedStatus = String(status || "").trim();
  if (!trimmedStatus) {
    const err = new Error("status is required");
    err.status = 400;
    throw err;
  }
  if (trimmedStatus.length > MAX_STATUS_LENGTH) {
    const err = new Error(`status must be ${MAX_STATUS_LENGTH} characters or fewer`);
    err.status = 400;
    throw err;
  }

  const now = new Date().toISOString();
  const { data, error } = await userSupabase
    .from("leads")
    .update({ status: trimmedStatus, status_updated_by: userId, status_updated_at: now })
    .eq("claimed_by", userId)
    .eq("npi", String(npi))
    .select("id");
  if (error) throw error;
  if (data.length === 0) {
    const err = new Error(`No lead with NPI ${npi} found`);
    err.status = 404;
    throw err;
  }

  return { npi: String(npi), status: trimmedStatus, rowsUpdated: data.length };
}

function formatTimestamp(date) {
  // "YYYY-MM-DD HH:mm" in UTC -- close enough to Utilities.formatDate's
  // script-timezone stamp for a human-readable call-log entry; exact
  // timezone display is a frontend concern, not a data-model one.
  return date.toISOString().slice(0, 16).replace("T", " ");
}

// Prepends a timestamped, attributed entry to Notes -- replaces
// SheetsStore.addLeadNote. Kept as one append-only text blob (not a
// separate notes table) so the frontend's existing notes UI needs no
// changes -- see the schema comment on leads.notes.
export async function addLeadNote(userSupabase, userId, displayName, npi, noteText) {
  if (!npi) {
    const err = new Error("npi is required");
    err.status = 400;
    throw err;
  }
  const trimmedNote = String(noteText || "").trim();
  if (!trimmedNote) {
    const err = new Error("note text is required");
    err.status = 400;
    throw err;
  }

  const { data: existing, error: selectError } = await userSupabase
    .from("leads")
    .select("id, notes")
    .eq("claimed_by", userId)
    .eq("npi", String(npi));
  if (selectError) throw selectError;
  if (existing.length === 0) {
    const err = new Error(`No lead with NPI ${npi} found`);
    err.status = 404;
    throw err;
  }

  const stamp = formatTimestamp(new Date());
  const entry = `${stamp}${displayName ? ` — ${displayName}` : ""}: ${trimmedNote}`;
  let finalNotes = entry;

  for (const row of existing) {
    finalNotes = row.notes ? `${entry}\n${row.notes}` : entry; // newest entry on top
    const { error: updateError } = await userSupabase.from("leads").update({ notes: finalNotes }).eq("id", row.id);
    if (updateError) throw updateError;
  }

  return { npi: String(npi), notes: finalNotes, rowsUpdated: existing.length };
}

// Overwrites the entire Notes value verbatim -- replaces
// SheetsStore.replaceLeadNotes (editing/deleting a single call-log entry
// reconstructs the full text client-side and sends exactly that).
export async function replaceLeadNotes(userSupabase, userId, npi, notesText) {
  if (!npi) {
    const err = new Error("npi is required");
    err.status = 400;
    throw err;
  }

  const finalNotes = String(notesText || "");
  const { data, error } = await userSupabase
    .from("leads")
    .update({ notes: finalNotes })
    .eq("claimed_by", userId)
    .eq("npi", String(npi))
    .select("id");
  if (error) throw error;
  if (data.length === 0) {
    const err = new Error(`No lead with NPI ${npi} found`);
    err.status = 404;
    throw err;
  }

  return { npi: String(npi), notes: finalNotes, rowsUpdated: data.length };
}

// Sets (or clears, if reminderAt is "") a callback-reminder timestamp --
// replaces SheetsStore.setLeadReminder.
export async function setLeadReminder(userSupabase, userId, npi, reminderAt) {
  if (!npi) {
    const err = new Error("npi is required");
    err.status = 400;
    throw err;
  }
  const trimmed = String(reminderAt || "").trim();
  if (trimmed && isNaN(Date.parse(trimmed))) {
    const err = new Error("reminderAt must be a valid date/time, or empty to clear it");
    err.status = 400;
    throw err;
  }

  const { data, error } = await userSupabase
    .from("leads")
    .update({ reminder_at: trimmed || null })
    .eq("claimed_by", userId)
    .eq("npi", String(npi))
    .select("id");
  if (error) throw error;
  if (data.length === 0) {
    const err = new Error(`No lead with NPI ${npi} found`);
    err.status = 404;
    throw err;
  }

  return { npi: String(npi), reminderAt: trimmed, rowsUpdated: data.length };
}

export default {
  claimCompanies,
  disconnectNewCompanies,
  moveClaimedLeadsToDisconnected,
  returnClaimedLeadsToProspect,
  getClaimedNpis,
  listClaimedLeads,
  getKnownStatuses,
  updateLeadStatus,
  addLeadNote,
  replaceLeadNotes,
  setLeadReminder,
  DEFAULT_STATUSES,
};
