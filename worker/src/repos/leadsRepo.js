// Replaces appscript/services/SheetsStore.js's lead-tracking half (the
// "Claimed - <Name>" / "Disconnected" tabs) with real queries against the
// `leads` table. One table, `claimed_by` + `is_disconnected` replacing the
// old per-teammate-tab-plus-shared-Disconnected-tab layout entirely -- see
// MIGRATION_TO_VERCEL_SUPABASE.md's schema notes for why.
import { createCompany } from "../lib/companyModel.js";
import { classifyRole } from "../lib/roleClassifier.js";
import { findUserByUsernameExact } from "../lib/users.js";

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

// Which of these specific NPIs are already handled by ANYONE (claimed or
// disconnected) -- used to filter fresh NPPES search results, same as
// SheetsStore.getClaimedNpis. Targeted at a candidate list (one NPPES page
// at a time, <=200 NPIs) instead of scanning the whole `leads` table, which
// used to be reloaded in full on every single search request.
export async function getClaimedNpisAmong(supabase, npis) {
  const candidates = [...new Set((npis || []).map(String).filter(Boolean))];
  if (candidates.length === 0) return new Set();
  const { data, error } = await supabase.from("leads").select("npi").in("npi", candidates);
  if (error) throw httpError(500, "Failed to load claimed NPIs: " + error.message);
  return new Set((data || []).map((row) => String(row.npi)));
}

// Which of these search candidates belong to an identity group that someone
// other than userId actively claims (sql/010's owned_group_npis). candidates:
// [{ npi, name, state, phone, officialFirstName, officialLastName, officialPhone }].
export async function getOwnedGroupNpisAmong(supabase, userId, candidates) {
  const list = (candidates || []).filter((c) => c && c.npi);
  if (!userId || list.length === 0) return new Set();
  const { data, error } = await supabase.rpc("owned_group_npis", { p_user_id: userId, p_candidates: list });
  if (error) throw httpError(500, "Failed to check group ownership: " + error.message);
  return new Set((data || []).map(String));
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

// A plain unbounded .select("*") silently gets capped by PostgREST's own
// row limit (the project's db-max-rows setting) -- for someone with
// thousands of claimed leads that meant only the first page ever reached
// the browser, with no error, no indication anything was cut off, and no
// way for the client-side search box to find anything past it. .range()
// keeps paging until a page comes back with fewer rows than requested;
// requestSize is deliberately NOT assumed to be what actually comes back
// each page, since PostgREST enforces its own cap regardless of what a
// wider range asks for -- offset always advances by the real batch
// length, and only a genuinely empty batch ends the loop. The extra
// .order("id") is a stable tiebreaker: status_updated_at/claimed_at alone
// can tie or both be null, and without a unique final sort key, rows can
// be skipped or repeated across pages.
const CLAIMED_LEADS_PAGE_SIZE = 1000;
const MAX_CLAIMED_LEADS_PAGES = 200; // 200k+ rows even at a pessimistic 1k/page cap -- a real safety net, not an expected ceiling

async function fetchAllClaimedRows(supabase, matchColumn, matchValue) {
  const rows = [];
  let offset = 0;
  for (let page = 0; page < MAX_CLAIMED_LEADS_PAGES; page++) {
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .eq(matchColumn, matchValue)
      .eq("is_disconnected", false)
      .order("status_updated_at", { ascending: false, nullsFirst: false })
      .order("claimed_at", { ascending: false })
      .order("id")
      .range(offset, offset + CLAIMED_LEADS_PAGE_SIZE - 1);
    if (error) throw httpError(500, "Failed to load claimed leads: " + error.message);
    const batch = data || [];
    rows.push(...batch);
    if (batch.length === 0) break;
    offset += batch.length;
  }
  return rows;
}

// Always scoped to the caller's own leads -- same privacy boundary
// Code.js's leads/list enforced (session.displayName, never a raw param).
export async function listClaimedLeads(supabase, session) {
  const rows = await fetchAllClaimedRows(supabase, "claimed_by", session.id);
  return rows.map((row) => toLeadDTO(row, session.displayName));
}

// Admin-only escape hatch from listClaimedLeads' own-session scoping --
// callers MUST check session.isAdmin themselves before calling this (see
// index.js's /admin routes). displayName is passed in separately since,
// unlike listClaimedLeads, there's no session to pull it from.
export async function listClaimedLeadsForUser(supabase, userId, displayName) {
  const rows = await fetchAllClaimedRows(supabase, "claimed_by", userId);
  return rows.map((row) => toLeadDTO(row, displayName));
}

// Same shape/scoping as listClaimedLeads, just narrowed to a checked
// subset -- used by the Claimed leads view's own "Export to Sheet" button.
export async function getClaimedLeadsByNpis(supabase, npis, session) {
  const wanted = [...new Set((npis || []).map(String).filter(Boolean))];
  if (wanted.length === 0) return [];
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("claimed_by", session.id)
    .eq("is_disconnected", false)
    .in("npi", wanted);
  if (error) throw httpError(500, "Failed to load claimed leads: " + error.message);
  return (data || []).map((row) => toLeadDTO(row, session.displayName));
}

// The identity signals claim_leads() groups a lead by (sql/010). Only the
// NPPES authorized official counts as the official -- a contact scraped from
// a website is someone else. npi_records wins over these when the NPI is
// there, so this only decides identity for NPIs missing from it.
function identityFromCompany(company, flat) {
  const official = (company.decisionMakers || []).find((d) => d && d.source === "nppes" && d.name);
  return {
    name: flat.name || null,
    state: flat.state || null,
    phone: flat.phone || null,
    officialName: official ? official.name : null,
    officialPhone: official && official.phone ? official.phone : null,
  };
}

// Claiming is one database function (sql/010_group_aware_claim.sql), not a
// read-then-insert here: it locks each lead's identity group, refuses NPIs
// whose group someone else owns, holds Tier 2/3 near-matches of someone
// else's lead for admin review, and inserts + audits the rest -- atomically,
// so two simultaneous claims on one company can't both get through. A batch
// is partial on purpose: allowed leads are claimed, the others are returned.
// options.actorId: set when someone other than `session` performs the claim
// (claimForUser below); recorded on the claimed event by sql/011.
export async function exportCompaniesToLeads(supabase, companies, session, flattenCompany, options = {}) {
  companies = companies || [];
  if (!Array.isArray(companies) || companies.length === 0) throw httpError(400, "At least one company is required to export");

  const items = companies
    .filter((c) => c && c.npi)
    .map((c) => {
      const flat = flattenCompany(c);
      return {
        npi: String(c.npi),
        identity: identityFromCompany(c, flat),
        lead: companyToLeadRow(flat, session, { status: "new", isDisconnected: false }),
      };
    });
  if (items.length === 0) throw httpError(400, "At least one company with an NPI is required to claim");

  const args = { p_user_id: session.id, p_leads: items };
  if (options.actorId) args.p_actor_id = options.actorId;
  const { data, error } = await supabase.rpc("claim_leads", args);
  if (error) {
    if (error.code === "PGRST202" || /Could not find the function/i.test(error.message || "")) {
      throw httpError(
        503,
        options.actorId
          ? "Claiming on behalf of another user isn't installed yet. Run sql/011_claim_for_user.sql in Supabase, then try again."
          : "Group-aware claiming isn't installed yet. Run sql/010_group_aware_claim.sql and sql/011_claim_for_user.sql in Supabase, then try again."
      );
    }
    if (/not allowed to claim on behalf/i.test(error.message || "")) {
      throw httpError(403, "This account isn't allowed to claim leads for other users.");
    }
    throw httpError(500, "Failed to claim leads: " + error.message);
  }

  const result = data || {};
  const claimed = result.claimed || [];
  const skipped = result.skipped || [];
  return {
    rowsAdded: claimed.length,
    claimedBy: session.displayName,
    claimedNpis: claimed.map((c) => String(c.npi)),
    alreadyClaimedNpis: skipped.filter((s) => s.reason === "already_claimed_by_you").map((s) => String(s.npi)),
    blocked: (result.blocked || []).map((b) => ({
      npi: String(b.npi),
      companyName: b.companyName || "",
      groupName: b.groupName || "",
      owners: (b.owners || []).map((o) => o.displayName || "(unknown user)"),
    })),
    heldForReview: (result.held || []).map((h) => ({
      npi: String(h.npi),
      companyName: h.companyName || "",
      matches: (h.matches || []).map((m) => ({
        npi: String(m.npi),
        companyName: m.companyName || "",
        tier: m.tier,
        matchedKeys: String(m.matchedKeys || "").split("+").filter(Boolean),
        ownerName: m.ownerDisplayName || "(unknown user)",
      })),
    })),
    invalid: skipped.filter((s) => s.reason !== "already_claimed_by_you").map((s) => ({ npi: String(s.npi || ""), reason: s.reason })),
  };
}

// ---- claim on behalf of another user ----------------------------------------

// For integrations such as BD MEETINGS: the integration signs in as its own
// account (with app_users.can_claim_for_others, or an admin) and names the
// teammate the leads belong to. No teammate password is involved, and there
// is no impersonated session: the lead is owned by the named user while the
// claimed event records the caller as the actor (sql/011). Every group-aware
// rule (blocked / held for review) applies exactly as for a normal claim.
const MAX_CLAIM_FOR_USER_COMPANIES = 200;

// Accepts either the search-result company shape the app already sends, or a
// flat row: { npi, name, state, city, addressLine1, postalCode, phone,
// website, email, taxonomy, authorizedOfficial, authorizedOfficialTitle,
// authorizedOfficialPhone }. `authorizedOfficial` must be the NPPES
// authorized official (it takes part in business grouping), not just any
// contact person.
function toCompany(input) {
  if (!input || typeof input !== "object") return input;
  if (input.address || input.decisionMakers) return input;
  const official = input.authorizedOfficial ? String(input.authorizedOfficial).trim() : "";
  return createCompany({
    npi: input.npi != null ? String(input.npi).trim() : null,
    name: input.name || null,
    phone: input.phone || null,
    website: input.website || null,
    email: input.email || null,
    address: { line1: input.addressLine1 || null, city: input.city || null, state: input.state || null, postalCode: input.postalCode || null },
    taxonomy: { code: input.taxonomyCode || null, description: input.taxonomy || null },
    decisionMakers: official
      ? [{
          name: official,
          title: input.authorizedOfficialTitle || null,
          roleCategory: classifyRole(input.authorizedOfficialTitle || "authorized official"),
          phone: input.authorizedOfficialPhone || null,
          source: "nppes",
          sourceUrl: null,
        }]
      : [],
    sources: { nppes: true },
  });
}

export async function claimForUser(supabase, callerSession, { username, companies }, flattenCompany) {
  if (!username || !String(username).trim()) throw httpError(400, "username is required");
  if (!Array.isArray(companies) || companies.length === 0) throw httpError(400, "At least one company is required to claim");
  if (companies.length > MAX_CLAIM_FOR_USER_COMPANIES) {
    throw httpError(400, `At most ${MAX_CLAIM_FOR_USER_COMPANIES} companies per request -- split the batch`);
  }

  // Read the permission fresh from the database rather than trusting the
  // token, so revoking can_claim_for_others takes effect immediately.
  const { data: caller, error: callerErr } = await supabase
    .from("app_users")
    .select("id, is_admin, can_claim_for_others")
    .eq("id", callerSession.id)
    .maybeSingle();
  if (callerErr) {
    if (/can_claim_for_others/.test(callerErr.message || "") && /does not exist|42703|schema cache/.test(callerErr.message || "")) {
      throw httpError(503, "Claiming on behalf of another user isn't installed yet. Run sql/011_claim_for_user.sql in Supabase, then try again.");
    }
    throw httpError(500, "Failed to check permissions: " + callerErr.message);
  }
  if (!caller || !(caller.is_admin || caller.can_claim_for_others)) {
    throw httpError(403, "This account isn't allowed to claim leads for other users.");
  }

  const target = await findUserByUsernameExact(supabase, username, "id, username, display_name");
  if (!target) throw httpError(404, `No user with username "${String(username).trim()}"`);

  const result = await exportCompaniesToLeads(
    supabase,
    companies.map(toCompany),
    { id: target.id, displayName: target.display_name },
    flattenCompany,
    { actorId: callerSession.id }
  );
  return {
    ...result,
    claimedFor: { username: target.username, displayName: target.display_name },
    claimedVia: callerSession.username,
  };
}

export async function exportCompaniesToDisconnected(supabase, companies, session, flattenCompany) {
  companies = companies || [];
  if (!Array.isArray(companies) || companies.length === 0) throw httpError(400, "At least one company is required to send to Disconnected");

  const rows = companies.map((c) => companyToLeadRow(flattenCompany(c), session, { status: "disconnected", isDisconnected: true }));
  const { error } = await supabase.from("leads").insert(rows);
  if (error) throw httpError(500, "Failed to save disconnected leads: " + error.message);

  // Disconnected rows aren't claims, so there's no ownership check -- but they
  // still get an identity group so they line up with the rest of the business.
  // Best-effort: a missing sql/010 must not fail the disconnect itself.
  const { error: groupErr } = await supabase.rpc("assign_lead_groups", { p_npis: rows.map((r) => r.npi) });
  if (groupErr) console.log("[leadsRepo] assign_lead_groups failed: " + groupErr.message);

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
