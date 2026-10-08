// Admin dashboard queries -- every export here assumes the caller has
// already checked session.isAdmin (see index.js's /admin routes); nothing
// in this file re-checks it, same trust boundary as leadsRepo's
// listClaimedLeadsForUser.
import { buildTeamActivity } from "../lib/teamActivity.js";
import { buildFunnel } from "../lib/funnel.js";
import { cleanStatus, isJunkStatus, normalizeStatus, statusCleanupRows, CANONICAL_STATUSES } from "../lib/statuses.js";
import { toLeadDTO } from "./leadsRepo.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// A plain unbounded .select() silently gets capped by PostgREST's own row
// limit (the project's db-max-rows setting) -- with thousands of rows in
// `leads`, that would silently undercount every per-user tally below
// instead of erroring. `queryFactory` must return a FRESH query builder
// each call (a builder can't be re-range()'d after it's already run), and
// pagination continues until a page comes back with zero rows -- not
// merely fewer than requested, since PostgREST enforces its own cap
// regardless of what a wider range asks for.
const FETCH_ALL_PAGE_SIZE = 1000;
const FETCH_ALL_MAX_PAGES = 200; // safety net (200k+ rows even at a pessimistic 1k/page cap), not an expected ceiling

async function fetchAllRows(queryFactory, errorContext) {
  const rows = [];
  let offset = 0;
  for (let page = 0; page < FETCH_ALL_MAX_PAGES; page++) {
    const { data, error } = await queryFactory().range(offset, offset + FETCH_ALL_PAGE_SIZE - 1);
    if (error) throw httpError(500, `Failed to load ${errorContext}: ` + error.message);
    const batch = data || [];
    rows.push(...batch);
    if (batch.length === 0) break;
    offset += batch.length;
  }
  return rows;
}

// Per-user counts, tallied in JS from one query per table (leads,
// suggestions, search_progress) instead of one query per user per table --
// cheap enough at this table size and avoids an N+1 fan-out as the team
// grows. "distinctSearches" counts rows in search_progress, i.e. distinct
// state/specialty/etc filter combinations a user has searched -- the
// closest available proxy for search activity, since individual search
// requests themselves aren't logged anywhere.
export async function getUserActivitySummary(supabase) {
  const usersRes = await supabase.from("app_users").select("id, username, display_name, is_admin").order("display_name");
  if (usersRes.error) throw httpError(500, "Failed to load users: " + usersRes.error.message);

  const [leadsRows, suggestionsRows, searchesRows] = await Promise.all([
    fetchAllRows(() => supabase.from("leads").select("claimed_by, is_disconnected"), "leads"),
    fetchAllRows(() => supabase.from("suggestions").select("submitted_by"), "suggestions"),
    fetchAllRows(() => supabase.from("search_progress").select("user_id"), "search activity"),
  ]);

  const claimedCounts = {};
  const disconnectedCounts = {};
  leadsRows.forEach((row) => {
    if (!row.claimed_by) return;
    const bucket = row.is_disconnected ? disconnectedCounts : claimedCounts;
    bucket[row.claimed_by] = (bucket[row.claimed_by] || 0) + 1;
  });

  const suggestionCounts = {};
  suggestionsRows.forEach((row) => {
    if (!row.submitted_by) return;
    suggestionCounts[row.submitted_by] = (suggestionCounts[row.submitted_by] || 0) + 1;
  });

  const searchCounts = {};
  searchesRows.forEach((row) => {
    if (!row.user_id) return;
    searchCounts[row.user_id] = (searchCounts[row.user_id] || 0) + 1;
  });

  return (usersRes.data || []).map((u) => ({
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    isAdmin: Boolean(u.is_admin),
    claimedCount: claimedCounts[u.id] || 0,
    disconnectedCount: disconnectedCounts[u.id] || 0,
    suggestionsCount: suggestionCounts[u.id] || 0,
    distinctSearches: searchCounts[u.id] || 0,
  }));
}

// Team-wide totals -- exact counts via head:true (no rows fetched).
export async function getAggregateStats(supabase) {
  const [usersRes, activeLeadsRes, disconnectedLeadsRes, suggestionsRes] = await Promise.all([
    supabase.from("app_users").select("id", { count: "exact", head: true }),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("is_disconnected", false),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("is_disconnected", true),
    supabase.from("suggestions").select("id", { count: "exact", head: true }),
  ]);
  if (usersRes.error) throw httpError(500, "Failed to load user count: " + usersRes.error.message);
  if (activeLeadsRes.error) throw httpError(500, "Failed to load claimed lead count: " + activeLeadsRes.error.message);
  if (disconnectedLeadsRes.error) throw httpError(500, "Failed to load disconnected lead count: " + disconnectedLeadsRes.error.message);
  if (suggestionsRes.error) throw httpError(500, "Failed to load suggestion count: " + suggestionsRes.error.message);

  return {
    totalUsers: usersRes.count || 0,
    totalClaimedLeads: activeLeadsRes.count || 0,
    totalDisconnectedLeads: disconnectedLeadsRes.count || 0,
    totalSuggestions: suggestionsRes.count || 0,
  };
}

// ---- group-level ownership conflicts --------------------------------------

// Why a group's NPIs were put together, from the tier recorded on the group
// (see sql/008_identity_match_tiers.sql). Groups keyed before 008 keep their
// original 'strict:' keys until it runs, so they're labelled separately.
function describeGroupMatch(group) {
  const tier = group && group.grouping_tier;
  const key = (group && group.identity_key) || "";
  if (tier === "singleton") return { matchTier: null, matchReason: "Same NPI" };
  if (key.startsWith("group:") && tier === "strict") {
    return { matchTier: 1, matchReason: "Same name, state, authorized official and phone" };
  }
  if (key.startsWith("group:") && tier === "cross_state") {
    return { matchTier: 2, matchReason: "Same name, authorized official and phone in different states" };
  }
  if (tier === "strict") return { matchTier: 1, matchReason: "Same name, state, authorized official and phone (pre-tier grouping)" };
  if (tier === "review") return { matchTier: null, matchReason: "Grouped by manual review" };
  return { matchTier: null, matchReason: "" };
}

// An identity group whose active claims are split across more than one
// person. The authoritative definition lives in SQL as
// public.ownership_conflicts (sql/005_ownership_conflict_resolution.sql);
// this aggregates the same thing in JS from tables that already exist, so
// the admin review queue works as soon as the Worker deploys, whether or
// not that file has been installed yet.
//
// Returns { available, conflicts, reason } rather than throwing when the
// identity schema is missing: an environment without `leads.group_id` has
// no conflicts to show, and that shouldn't take down the admin page.
export async function getOwnershipConflicts(supabase) {
  let leadRows;
  try {
    leadRows = await fetchAllRows(
      () =>
        supabase
          .from("leads")
          .select("id, npi, company_name, city, state, claimed_by, claimed_at, group_id")
          .eq("is_disconnected", false)
          .not("claimed_by", "is", null)
          .not("group_id", "is", null),
      "claimed leads"
    );
  } catch (err) {
    // Only the "identity schema isn't installed" case degrades to a
    // message; a transient failure has to keep surfacing as an error, or
    // the panel would quietly claim the feature is missing whenever
    // Supabase hiccups.
    if (/group_id/.test(err.message || "") && /does not exist|schema cache|42703/.test(err.message || "")) {
      return {
        available: false,
        conflicts: [],
        reason: "Identity grouping isn't installed yet (leads.group_id is missing). Run sql/001 and sql/002 first.",
      };
    }
    throw err;
  }

  const byGroup = new Map();
  for (const row of leadRows) {
    if (!byGroup.has(row.group_id)) byGroup.set(row.group_id, []);
    byGroup.get(row.group_id).push(row);
  }

  const conflicted = [...byGroup.entries()].filter(
    ([, rows]) => new Set(rows.map((r) => r.claimed_by)).size > 1
  );
  if (conflicted.length === 0) return { available: true, conflicts: [] };

  const groupIds = conflicted.map(([groupId]) => groupId);
  const [groupsRes, usersRes] = await Promise.all([
    supabase.from("lead_groups").select("id, canonical_name, state, identity_key, grouping_tier").in("id", groupIds),
    supabase.from("app_users").select("id, display_name"),
  ]);
  if (usersRes.error) throw httpError(500, "Failed to load users: " + usersRes.error.message);
  // A missing lead_groups table is survivable -- the conflict is still real
  // and still actionable, it just shows without a friendly group name.
  const groupById = new Map((groupsRes.error ? [] : groupsRes.data || []).map((g) => [g.id, g]));
  const userNameById = new Map((usersRes.data || []).map((u) => [u.id, u.display_name]));

  const conflicts = conflicted.map(([groupId, rows]) => {
    const ownerCounts = new Map();
    rows.forEach((row) => ownerCounts.set(row.claimed_by, (ownerCounts.get(row.claimed_by) || 0) + 1));
    const group = groupById.get(groupId);
    const states = [...new Set(rows.map((row) => row.state).filter(Boolean))].sort();
    return {
      groupId,
      groupName: (group && group.canonical_name) || rows[0].company_name || "(unnamed group)",
      groupState: (group && group.state) || states.join(", "),
      identityKey: (group && group.identity_key) || "",
      ...describeGroupMatch(group),
      owners: [...ownerCounts.entries()]
        .map(([userId, leadCount]) => ({
          userId,
          displayName: userNameById.get(userId) || "(unknown user)",
          leadCount,
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
      leads: rows
        .map((row) => ({
          leadId: row.id,
          npi: row.npi,
          companyName: row.company_name || "",
          city: row.city || "",
          state: row.state || "",
          claimedBy: row.claimed_by,
          claimedByName: userNameById.get(row.claimed_by) || "(unknown user)",
          claimedAt: row.claimed_at || "",
        }))
        .sort((a, b) => String(a.npi).localeCompare(String(b.npi))),
    };
  });

  conflicts.sort((a, b) => a.groupName.localeCompare(b.groupName));
  return { available: true, conflicts };
}

// ---- identity review flags (Tier 2 / Tier 3) ---------------------------------

// Pairs of NPIs that matched a review-only tier rule and haven't been merged
// or dismissed yet. The pairs come from public.identity_review_queue
// (sql/008 + sql/009); this adds what an admin needs to decide -- both
// records side by side, group sizes, and who currently holds each claim.
const IN_CHUNK_SIZE = 200; // keeps .in() filters well under URL length limits

const MATCH_KEY_ORDER = ["name", "state", "official", "phone"];

function isMissingRelation(error, name) {
  const message = (error && error.message) || "";
  return (
    (error && (error.code === "42P01" || error.code === "PGRST205")) ||
    (message.includes(name) && /does not exist|Could not find the table|schema cache/i.test(message))
  );
}

async function fetchInChunks(values, queryForChunk, errorContext) {
  const rows = [];
  for (let i = 0; i < values.length; i += IN_CHUNK_SIZE) {
    const chunk = values.slice(i, i + IN_CHUNK_SIZE);
    rows.push(...(await fetchAllRows(() => queryForChunk(chunk), errorContext)));
  }
  return rows;
}

// What a monthly NPPES refresh changed about a lead someone owns
// (sql/015). Each row is one claimed lead in one refresh run, with every
// escalating field that moved. Reps see their own as a badge in Claimed
// leads; an admin works through all of them here.
const PROVIDER_CHANGE_COLUMNS =
  "event_id, npi, created_at, reason, changes, group_review, lead_id, company_name, city, state, " +
  "lead_status, owner_user_id, owner_display_name, refresh_run_id";

export async function getProviderChanges(supabase, { ownerUserId } = {}) {
  let rows;
  try {
    rows = await fetchAllRows(
      () => {
        const query = supabase.from("provider_change_queue").select(PROVIDER_CHANGE_COLUMNS).order("created_at", { ascending: false });
        return ownerUserId ? query.eq("owner_user_id", ownerUserId) : query;
      },
      "provider changes"
    );
  } catch (err) {
    if (isMissingRelation({ message: err.message }, "provider_change_queue")) {
      return {
        available: false,
        changes: [],
        reason: "Provider change alerts aren't installed yet. Run sql/015_provider_change_alerts.sql first.",
      };
    }
    throw err;
  }

  return {
    available: true,
    changes: rows.map((row) => ({
      eventId: row.event_id,
      npi: String(row.npi),
      companyName: row.company_name || "",
      city: row.city || "",
      state: row.state || "",
      leadStatus: row.lead_status || "",
      ownerUserId: row.owner_user_id || null,
      ownerName: row.owner_display_name || "(unclaimed)",
      groupReview: row.group_review === true,
      refreshRunId: row.refresh_run_id || "",
      changedAt: row.created_at || "",
      changes: (row.changes || []).map((change) => ({
        field: change.field,
        oldValue: change.oldValue === null || change.oldValue === undefined ? "" : String(change.oldValue),
        newValue: change.newValue === null || change.newValue === undefined ? "" : String(change.newValue),
      })),
    })),
  };
}

export async function resolveProviderChange(supabase, { eventId, decision, reviewerId, note }) {
  if (!eventId) throw httpError(400, "eventId is required");
  if (decision !== "approved" && decision !== "dismissed") {
    throw httpError(400, "decision must be approved or dismissed");
  }

  const { data, error } = await supabase.rpc("resolve_provider_change", {
    p_event_id: eventId,
    p_reviewer_id: reviewerId,
    p_decision: decision,
    p_note: note || null,
  });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883" || /Could not find the function/i.test(error.message || "")) {
      throw httpError(503, "Provider change alerts aren't installed yet. Run sql/015_provider_change_alerts.sql, then try again.");
    }
    if (/is not an admin/i.test(error.message || "")) throw httpError(403, "Only an admin can resolve a provider change.");
    if (/does not exist/i.test(error.message || "")) throw httpError(404, "That provider change alert no longer exists.");
    throw httpError(500, "Failed to resolve the provider change: " + error.message);
  }
  const result = data || {};
  return {
    eventId: result.eventId || eventId,
    decision: result.decision || decision,
    alreadyDecided: result.alreadyDecided === true,
  };
}

function formatPhone(value) {
  const digits = String(value || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : String(value || "");
}

const QUEUE_COLUMNS = "tier, matched_keys, left_npi, left_name, left_group_id, right_npi, right_name, right_group_id";
// Added by sql/010 (claims held for review). Read separately so the queue
// still works on a database that has 009 but not 010 yet.
const QUEUE_REQUEST_COLUMNS = ", source, requested_by, requested_npi, request_snapshot";

async function fetchQueuePairs(supabase, columns) {
  return fetchAllRows(
    () => supabase.from("identity_review_queue").select(columns).order("tier").order("left_npi").order("right_npi"),
    "review flags"
  );
}

// sql/030: pairs found across every organization NPI in npi_records, not just
// leads. Far too many to load at once, so this scope is read one page at a time.
const REGISTRY_QUEUE_COLUMNS = QUEUE_COLUMNS + ", source, left_is_lead, right_is_lead, first_seen_at";
export const REGISTRY_PAGE_DEFAULT = 25;
export const REGISTRY_PAGE_MAX = 100;

async function getRegistryMatchReviews(supabase, { tier, offset, limit }) {
  const pageSize = Math.min(Math.max(Number.parseInt(limit, 10) || REGISTRY_PAGE_DEFAULT, 1), REGISTRY_PAGE_MAX);
  const start = Math.max(Number.parseInt(offset, 10) || 0, 0);
  const tierNumber = Number.parseInt(tier, 10);

  // Ordered by the primary key so Postgres can stop after one page. Ordering
  // by tier would force it to evaluate the whole queue for every page.
  let query = supabase
    .from("registry_review_queue")
    .select(REGISTRY_QUEUE_COLUMNS)
    .order("left_npi")
    .order("right_npi")
    .range(start, start + pageSize); // one extra row tells us whether there is a next page
  if (tierNumber === 2 || tierNumber === 3) query = query.eq("tier", tierNumber);

  const { data, error } = await query;
  if (error) {
    if (isMissingRelation(error, "registry_review_queue")) {
      return {
        available: false,
        scope: "registry",
        reviews: [],
        reason: "Registry-wide matching isn't installed yet. Run sql/030_registry_identity_matching.sql, then python -m nppes_ingest --match-registry.",
      };
    }
    throw httpError(500, "Failed to load registry matches: " + error.message);
  }

  const rows = data || [];
  const hasMore = rows.length > pageSize;
  const reviews = await buildMatchReviews(supabase, rows.slice(0, pageSize));
  return { available: true, scope: "registry", reviews, offset: start, limit: pageSize, hasMore };
}

export async function getMatchReviews(supabase, { scope = "leads", tier = null, offset = 0, limit = null } = {}) {
  if (scope === "registry") return getRegistryMatchReviews(supabase, { tier, offset, limit });

  let pairs;
  try {
    try {
      pairs = await fetchQueuePairs(supabase, QUEUE_COLUMNS + QUEUE_REQUEST_COLUMNS);
    } catch (err) {
      if (!/requested_by|requested_npi|request_snapshot|source/.test(err.message || "") || !/does not exist|42703|schema cache/.test(err.message || "")) throw err;
      pairs = await fetchQueuePairs(supabase, QUEUE_COLUMNS);
    }
  } catch (err) {
    if (isMissingRelation({ message: err.message }, "identity_review_queue")) {
      return {
        available: false,
        reviews: [],
        reason: "The review queue isn't installed yet. Run sql/008_identity_match_tiers.sql and sql/009_identity_match_review.sql first.",
      };
    }
    throw err;
  }
  return { available: true, scope: "leads", reviews: await buildMatchReviews(supabase, pairs) };
}

// Turns queue rows into the side-by-side records an admin decides on.
async function buildMatchReviews(supabase, pairs) {
  if (pairs.length === 0) return [];

  const npis = [...new Set(pairs.flatMap((p) => [p.left_npi, p.right_npi]))];
  const groupIds = [...new Set(pairs.flatMap((p) => [p.left_group_id, p.right_group_id]).filter(Boolean))];

  const [records, leads, members, usersRes] = await Promise.all([
    fetchInChunks(
      npis,
      (chunk) =>
        supabase
          .from("npi_records")
          .select("npi, name, address_state, authorizedofficial_firstname, authorizedofficial_lastname, phone, authorizedofficial_phone")
          .in("npi", chunk),
      "provider records"
    ),
    fetchInChunks(
      npis,
      (chunk) => supabase.from("leads").select("npi, company_name, city, state, claimed_by, is_disconnected").in("npi", chunk),
      "leads"
    ),
    fetchInChunks(groupIds, (chunk) => supabase.from("lead_group_members").select("group_id").in("group_id", chunk), "group members"),
    supabase.from("app_users").select("id, display_name"),
  ]);
  if (usersRes.error) throw httpError(500, "Failed to load users: " + usersRes.error.message);

  const recordByNpi = new Map(records.map((r) => [r.npi, r]));
  const userNameById = new Map((usersRes.data || []).map((u) => [u.id, u.display_name]));
  const groupSize = new Map();
  members.forEach((m) => groupSize.set(m.group_id, (groupSize.get(m.group_id) || 0) + 1));
  const leadsByNpi = new Map();
  leads.forEach((row) => {
    if (!leadsByNpi.has(row.npi)) leadsByNpi.set(row.npi, []);
    leadsByNpi.get(row.npi).push(row);
  });

  // snapshot: the search-result identity a held claim was made with, used
  // when the requested NPI has no npi_records row to show.
  const side = (npi, fallbackName, groupId, snapshot) => {
    const record = recordByNpi.get(npi) || {};
    const snap = (!record.npi && snapshot) || {};
    const rows = leadsByNpi.get(npi) || [];
    const lead = rows.find((row) => !row.is_disconnected) || rows[0] || {};
    const owners = [...new Set(rows.filter((row) => !row.is_disconnected && row.claimed_by).map((row) => row.claimed_by))];
    const phone = record.phone || snap.phone;
    const officialPhone = record.authorizedofficial_phone || snap.officialPhone;
    return {
      npi,
      name: record.name || fallbackName || lead.company_name || snap.name || "",
      city: lead.city || "",
      state: record.address_state || lead.state || snap.state || "",
      official: [record.authorizedofficial_firstname, record.authorizedofficial_lastname].filter(Boolean).join(" ") || snap.officialName || "",
      phone: formatPhone(phone || officialPhone),
      phoneSource: phone ? "location" : officialPhone ? "authorized official" : "",
      // Registry matching (sql/030) matches on either number, so the official's
      // phone is shown on its own whenever the card already shows the location phone.
      officialPhone: phone && officialPhone ? formatPhone(officialPhone) : "",
      isLead: rows.some((row) => !row.is_disconnected),
      groupId: groupId || null,
      groupSize: groupId ? groupSize.get(groupId) || 1 : 1,
      owners: owners.map((id) => ({ userId: id, displayName: userNameById.get(id) || "(unknown user)" })),
    };
  };

  const reviews = pairs.map((p) => {
    const isRequest = p.source === "claim_request";
    const snapshot = isRequest ? p.request_snapshot || {} : null;
    return {
      leftNpi: p.left_npi,
      rightNpi: p.right_npi,
      tier: p.tier,
      matchedKeys: String(p.matched_keys || "")
        .split("+")
        .filter(Boolean)
        .sort((a, b) => MATCH_KEY_ORDER.indexOf(a) - MATCH_KEY_ORDER.indexOf(b)),
      source: isRequest ? "claim_request" : p.source === "registry" ? "registry" : "leads",
      firstSeenAt: p.first_seen_at || null,
      // A held claim: requestedNpi is the NPI someone tried to claim.
      requestedNpi: isRequest ? p.requested_npi : null,
      requestedBy: isRequest && p.requested_by
        ? { userId: p.requested_by, displayName: userNameById.get(p.requested_by) || "(unknown user)" }
        : null,
      left: side(p.left_npi, p.left_name, p.left_group_id, isRequest && p.requested_npi === p.left_npi ? snapshot : null),
      right: side(p.right_npi, p.right_name, p.right_group_id, isRequest && p.requested_npi === p.right_npi ? snapshot : null),
    };
  });

  return reviews;
}

// Merge or dismiss one flagged pair. Like conflict resolution, the whole
// decision is one SQL function (sql/009_identity_match_review.sql) so a merge
// can't be left half-applied.
export async function resolveMatchReview(supabase, { leftNpi, rightNpi, decision, decidedBy, reason, tier, matchedKeys }) {
  if (!leftNpi || !rightNpi) throw httpError(400, "Both NPIs are required");
  if (decision !== "merged" && decision !== "dismissed") throw httpError(400, "decision must be merged or dismissed");
  if (!reason || !String(reason).trim()) {
    throw httpError(400, "A reason is required -- review decisions have to record why they were made");
  }

  const { data, error } = await supabase.rpc("resolve_identity_match", {
    p_left_npi: String(leftNpi),
    p_right_npi: String(rightNpi),
    p_decision: decision,
    p_decided_by: decidedBy,
    p_reason: String(reason).trim(),
    p_tier: Number.isInteger(tier) ? tier : null,
    p_matched_keys: Array.isArray(matchedKeys) ? matchedKeys.join("+") : null,
  });

  if (error) {
    if (error.code === "PGRST202" || /Could not find the function/i.test(error.message || "")) {
      throw httpError(503, "Review decisions aren't installed yet. Run sql/009_identity_match_review.sql in Supabase, then try again.");
    }
    if (/already been decided/i.test(error.message || "")) {
      throw httpError(409, "Someone already decided this pair. Refresh to see the current list.");
    }
    throw httpError(500, "Failed to save the decision: " + error.message);
  }

  return data || {};
}

function canonicalReviewPair(leftNpi, rightNpi) {
  const left = String(leftNpi || "").trim();
  const right = String(rightNpi || "").trim();
  return [left, right].sort((a, b) => a.localeCompare(b));
}

// Bulk merging is deliberately stricter than the manual merge action. A
// client-side checkbox is only a request; the Worker re-reads the pending
// queue and current owners before every decision.
export function getBulkMergeEligibility(review) {
  const leftOwners = Array.isArray(review?.left?.owners) ? review.left.owners : [];
  const rightOwners = Array.isArray(review?.right?.owners) ? review.right.owners : [];
  const ownerById = new Map();
  [...leftOwners, ...rightOwners].forEach((owner) => {
    if (owner?.userId) ownerById.set(String(owner.userId), owner.displayName || "(unknown agent)");
  });
  const ownerIds = [...ownerById.keys()];

  if (ownerIds.length > 1) {
    return { eligible: false, reason: "Different agents own these leads; review manually." };
  }

  if (ownerIds.length === 0) {
    // isLead is false only for registry matches (sql/030), where neither NPI has been claimed.
    if (review?.left?.isLead === false && review?.right?.isLead === false) {
      return { eligible: true, reason: "Bulk merge: neither NPI is a lead yet (registry match); no claims are affected." };
    }
    return { eligible: true, reason: "Bulk merge: both leads are unclaimed." };
  }

  const ownerName = ownerById.get(ownerIds[0]);
  const leftClaimed = leftOwners.length > 0;
  const rightClaimed = rightOwners.length > 0;
  if (leftClaimed && rightClaimed) {
    return { eligible: true, reason: `Bulk merge: both leads are owned by ${ownerName}; ownership is consistent.` };
  }
  return { eligible: true, reason: `Bulk merge: one lead is unclaimed and the other is owned by ${ownerName}.` };
}

const PAIR_LOOKUP_CHUNK = 100;

// Current queue entries for exactly these pairs. A pair is pending if it is in
// either queue; the lead queue wins when it is in both.
async function getPendingReviewsForPairs(supabase, requested) {
  const rowsByKey = new Map();
  for (const view of ["identity_review_queue", "registry_review_queue"]) {
    for (let i = 0; i < requested.length; i += PAIR_LOOKUP_CHUNK) {
      const chunk = requested.slice(i, i + PAIR_LOOKUP_CHUNK);
      const wanted = new Set(chunk.map((pair) => pair.key));
      const { data, error } = await supabase
        .from(view)
        .select(QUEUE_COLUMNS)
        .in("left_npi", [...new Set(chunk.map((pair) => pair.leftNpi))])
        .in("right_npi", [...new Set(chunk.map((pair) => pair.rightNpi))]);
      if (error) {
        if (isMissingRelation(error, view)) {
          if (view === "identity_review_queue") throw httpError(503, "The review queue isn't installed yet.");
          break; // registry matching (sql/030) just isn't installed
        }
        throw httpError(500, "Failed to read the review queue: " + error.message);
      }
      for (const row of data || []) {
        const [left, right] = canonicalReviewPair(row.left_npi, row.right_npi);
        const key = `${left}:${right}`;
        if (wanted.has(key) && !rowsByKey.has(key)) rowsByKey.set(key, row);
      }
    }
  }
  return buildMatchReviews(supabase, [...rowsByKey.values()]);
}

export async function bulkMergeEligibleMatchReviews(supabase, { pairs, decidedBy }) {
  if (!Array.isArray(pairs) || pairs.length === 0) throw httpError(400, "At least one pair is required");
  if (pairs.length > 500) throw httpError(400, "A maximum of 500 pairs can be merged at once");

  const requested = [];
  const seen = new Set();
  for (const pair of pairs) {
    const [leftNpi, rightNpi] = canonicalReviewPair(pair?.leftNpi, pair?.rightNpi);
    if (!leftNpi || !rightNpi || leftNpi === rightNpi) continue;
    const key = `${leftNpi}:${rightNpi}`;
    if (seen.has(key)) continue;
    seen.add(key);
    requested.push({ leftNpi, rightNpi, key });
  }
  if (requested.length === 0) throw httpError(400, "At least one valid pair is required");

  // Only the requested pairs are re-read (from the lead queue and the
  // registry queue), never a whole queue: the registry queue can be huge.
  const pendingReviews = await getPendingReviewsForPairs(supabase, requested);
  const reviewByKey = new Map(pendingReviews.map((review) => [
    `${canonicalReviewPair(review.leftNpi, review.rightNpi)[0]}:${canonicalReviewPair(review.leftNpi, review.rightNpi)[1]}`,
    review,
  ]));

  const merged = [];
  const skipped = [];
  const failed = [];
  // Stable ordering prevents two admins processing overlapping pairs from
  // acquiring group locks in different orders.
  requested.sort((a, b) => a.key.localeCompare(b.key));
  for (const pair of requested) {
    const review = reviewByKey.get(pair.key);
    if (!review) {
      skipped.push({ ...pair, reason: "This pair is no longer pending." });
      continue;
    }
    const eligibility = getBulkMergeEligibility(review);
    if (!eligibility.eligible) {
      skipped.push({ ...pair, reason: eligibility.reason });
      continue;
    }
    try {
      const result = await resolveMatchReview(supabase, {
        leftNpi: review.leftNpi,
        rightNpi: review.rightNpi,
        decision: "merged",
        decidedBy,
        reason: eligibility.reason,
        tier: review.tier,
        matchedKeys: review.matchedKeys,
      });
      merged.push({ ...pair, result });
    } catch (error) {
      failed.push({ ...pair, reason: error.message || "Failed to merge this pair." });
    }
  }

  return { requested: requested.length, merged, skipped, failed };
}

// ---- merge all eligible registry matches (sql/035) ------------------------------

// Tier 2 (three of name/state/official/phone) plus same official AND phone.
// Tier 3 name+phone and name+official alone are left for a person to decide.
export const AUTO_MERGE_KEYS = ["name+state+phone", "name+state+official", "state+official+phone", "official+phone"];
// One subrequest per merge plus one to read the batch, kept under the 50
// subrequests a Worker request is allowed on the free plan.
export const AUTO_MERGE_BATCH = 25;

function isMissingRpc(error) {
  return error && (error.code === "PGRST202" || error.code === "42883" || /Could not find the function/i.test(error.message || ""));
}

export async function getRegistryMergePreview(supabase) {
  const { data, error } = await supabase.rpc("registry_merge_preview", { p_keys: AUTO_MERGE_KEYS });
  if (error) {
    if (isMissingRpc(error)) throw httpError(503, "Merge all isn't installed yet. Run sql/035_registry_merge_all.sql in Supabase, then try again.");
    throw httpError(500, "Failed to count the matches: " + error.message);
  }
  const result = data || {};
  return {
    total: Number(result.total) || 0,
    blocked: Number(result.blocked) || 0,
    mergeable: Number(result.mergeable) || 0,
    rules: AUTO_MERGE_KEYS,
  };
}

// Merges one batch of pending registry pairs that match the rules, in NPI-pair
// order, starting after `after` ({ leftNpi, rightNpi }). A keyset cursor, not an
// offset: merged pairs leave the queue, so an offset would skip pairs. The
// caller repeats with `next` until `done`. Whether a pair is safe is decided in
// SQL, atomically with the merge (merge_identity_pair_if_safe).
export async function mergeEligibleRegistryReviews(supabase, { after, decidedBy }) {
  let afterLeft = null;
  let afterRight = null;
  if (after && (after.leftNpi || after.rightNpi)) {
    afterLeft = String(after.leftNpi || "");
    afterRight = String(after.rightNpi || "");
    if (!/^\d{10}$/.test(afterLeft) || !/^\d{10}$/.test(afterRight)) throw httpError(400, "Invalid cursor");
  }

  // sql/036: reads registry_match_candidates directly in key order. The
  // registry_review_queue view checks every pair it scans against all past
  // decisions, which timed out once thousands of pairs had been merged.
  const { data, error } = await supabase.rpc("registry_merge_next_batch", {
    p_keys: AUTO_MERGE_KEYS,
    p_after_left: afterLeft,
    p_after_right: afterRight,
    p_limit: AUTO_MERGE_BATCH,
  });
  if (error) {
    if (isMissingRpc(error)) {
      throw httpError(503, "Merge all needs the latest update. Run sql/036_registry_merge_batch.sql in Supabase, then try again.");
    }
    throw httpError(500, "Failed to read the registry matches: " + error.message);
  }

  const rows = data || [];
  const merged = [];
  const skipped = [];
  const failed = [];
  for (const row of rows) {
    const pair = { leftNpi: row.left_npi, rightNpi: row.right_npi };
    const { data: result, error: mergeError } = await supabase.rpc("merge_identity_pair_if_safe", {
      p_left_npi: row.left_npi,
      p_right_npi: row.right_npi,
      p_decided_by: decidedBy,
      p_reason: `Automatic merge of eligible registry match (${row.matched_keys}); no other agent owns anything in either group.`,
      p_tier: Number.isInteger(row.tier) ? row.tier : null,
      p_matched_keys: row.matched_keys,
    });
    if (mergeError) {
      if (isMissingRpc(mergeError)) throw httpError(503, "Merge all isn't installed yet. Run sql/035_registry_merge_all.sql in Supabase, then try again.");
      // Someone else decided this pair a moment ago: not a problem.
      if (/already been decided/i.test(mergeError.message || "")) skipped.push({ ...pair, reason: "Already decided." });
      else failed.push({ ...pair, reason: mergeError.message || "Failed to merge this pair." });
    } else if (result && result.skipped) {
      skipped.push({ ...pair, reason: result.reason || "Not eligible." });
    } else {
      merged.push(pair);
    }
  }

  const last = rows[rows.length - 1];
  return {
    merged,
    skipped,
    failed,
    next: last ? { leftNpi: last.left_npi, rightNpi: last.right_npi } : null,
    done: rows.length < AUTO_MERGE_BATCH,
  };
}

// Hands the whole decision to one SQL function. Deliberately NOT a
// read-then-write here: PostgREST gives the Worker no transaction, so a
// resolve built out of separate REST calls could interleave with a
// concurrent claim and leave the group half-moved with a partial audit
// trail. See sql/005_ownership_conflict_resolution.sql.
export async function resolveOwnershipConflict(supabase, { groupId, toUserId, approvedBy, reason }) {
  if (!groupId) throw httpError(400, "groupId is required");
  if (!toUserId) throw httpError(400, "toUserId is required");
  if (!reason || !String(reason).trim()) {
    throw httpError(400, "A reason is required -- ownership changes have to record why they were approved");
  }

  const { data, error } = await supabase.rpc("resolve_ownership_conflict", {
    p_group_id: groupId,
    p_to_user_id: toUserId,
    p_approved_by: approvedBy,
    p_reason: String(reason).trim(),
  });

  if (error) {
    // PGRST202 = no such function. That's the "SQL not installed yet" case,
    // which is a setup step, not a bug in the request.
    if (error.code === "PGRST202" || /Could not find the function/i.test(error.message || "")) {
      throw httpError(
        503,
        "Conflict resolution isn't installed yet. Run sql/005_ownership_conflict_resolution.sql in Supabase, then try again."
      );
    }
    throw httpError(500, "Failed to resolve the conflict: " + error.message);
  }

  return data || {};
}

// Who holds each of these NPIs in the app right now, for the sheet-conflicts panel that sits
// beside the sheet's own opener. Read-only; disconnected and released leads are not owned.
const MAX_SHEET_CONFLICT_NPIS = 200;
export async function getSheetConflictOwners(supabase, npis) {
  const wanted = [...new Set((Array.isArray(npis) ? npis : []).map((n) => String(n ?? "").replace(/\D/g, "")).filter((n) => n.length === 10))];
  if (wanted.length === 0) throw httpError(400, "At least one NPI is required");
  if (wanted.length > MAX_SHEET_CONFLICT_NPIS) throw httpError(400, `At most ${MAX_SHEET_CONFLICT_NPIS} NPIs per request`);

  const { data, error } = await supabase
    .from("leads")
    .select("npi, company_name, claimed_by, claimed_at, status, status_updated_at, group_id")
    .eq("is_disconnected", false)
    .not("claimed_by", "is", null)
    .in("npi", wanted);
  if (error) throw httpError(500, "Failed to look up leads: " + error.message);

  const ownerIds = [...new Set((data || []).map((r) => r.claimed_by))];
  let names = new Map();
  if (ownerIds.length) {
    const users = await supabase.from("app_users").select("id, display_name").in("id", ownerIds);
    if (users.error) throw httpError(500, "Failed to load users: " + users.error.message);
    names = new Map((users.data || []).map((u) => [u.id, u.display_name]));
  }
  return {
    leads: (data || []).map((r) => ({
      npi: String(r.npi),
      companyName: r.company_name || "",
      ownerId: r.claimed_by,
      ownerName: names.get(r.claimed_by) || "(unknown user)",
      status: r.status || "",
      statusUpdatedAt: r.status_updated_at || "",
      claimedAt: r.claimed_at || "",
      groupId: r.group_id || null,
    })),
  };
}

// Per-rep activity for the Admin "Team activity" view: claims from the
// ownership history, calls and meetings from the dated lines of each lead's
// call log, and each rep's open leads right now. See lib/teamActivity.js.
export async function getTeamActivity(supabase, { weeks = 8 } = {}) {
  const span = Math.min(Math.max(Math.round(Number(weeks)) || 8, 1), 26);
  const usersRes = await supabase.from("app_users").select("id, username, display_name, is_admin");
  if (usersRes.error) throw httpError(500, "Failed to load users: " + usersRes.error.message);

  const since = new Date(Date.now() - (span * 7 + 7) * 86_400_000).toISOString();
  const events = await fetchAllRows(
    () => supabase.from("lead_ownership_events").select("event_type, to_user_id, created_at").eq("event_type", "claimed").gte("created_at", since),
    "claim history");

  // meeting_at only exists once sql/020 has been run; the view still works without it.
  let leads;
  try {
    leads = await fetchAllRows(() => supabase.from("leads").select("npi, claimed_by, is_disconnected, notes, reminder_at, meeting_at"), "leads");
  } catch {
    leads = await fetchAllRows(() => supabase.from("leads").select("npi, claimed_by, is_disconnected, notes, reminder_at"), "leads");
  }
  // Taps on phone numbers (sql/029), claimed or not; none before it is installed.
  let taps = [];
  try {
    taps = await fetchAllRows(() => supabase.from("call_taps").select("user_id, npi, tapped_at").gte("tapped_at", since), "phone taps");
  } catch { /* the counts simply have no taps */ }
  const result = buildTeamActivity({ users: usersRes.data || [], events, leads, taps, weeks: span });
  // The per-person totals the Review queues tab calls "User activity", shown here too:
  // claimed, disconnected, suggestions sent and distinct searches run. Best effort.
  try {
    result.userActivity = await getUserActivitySummary(supabase);
  } catch (err) {
    console.log("[adminRepo] user activity unavailable: " + err.message);
    result.userActivity = [];
  }
  return result;
}

// How far claimed leads get: claimed, contacted, meeting booked, meeting held, onboarded.
// `days` limits it to leads claimed in the last N days (0 = all time). See lib/funnel.js.
export async function getFunnel(supabase, { days = 90 } = {}) {
  const span = Math.min(Math.max(Math.round(Number(days)) || 0, 0), 3650);
  const usersRes = await supabase.from("app_users").select("id, username, display_name");
  if (usersRes.error) throw httpError(500, "Failed to load users: " + usersRes.error.message);

  const columns = "claimed_by, claimed_at, status, notes, specialty, state";
  let leads;
  try {
    leads = await fetchAllRows(() => supabase.from("leads").select(columns + ", meeting_at").not("claimed_by", "is", null), "leads");
  } catch {
    leads = await fetchAllRows(() => supabase.from("leads").select(columns).not("claimed_by", "is", null), "leads"); // before sql/020
  }
  return buildFunnel({ leads, users: usersRes.data || [], sinceMs: span ? Date.now() - span * 86_400_000 : 0 });
}

// Every active claimed lead, optionally one rep's, in the same shape the Claimed view uses,
// for the admin "Export CSV". The browser builds the file.
export async function getLeadsForExport(supabase, { userId = "" } = {}) {
  const users = await supabase.from("app_users").select("id, display_name");
  if (users.error) throw httpError(500, "Failed to load users: " + users.error.message);
  const names = new Map((users.data || []).map((u) => [u.id, u.display_name]));
  const rows = await fetchAllRows(() => {
    let q = supabase.from("leads").select("*").eq("is_disconnected", false).not("claimed_by", "is", null).order("claimed_at", { ascending: false }).order("id");
    if (userId) q = q.eq("claimed_by", userId);
    return q;
  }, "leads");
  return rows.map((row) => toLeadDTO(row, names.get(row.claimed_by) || ""));
}

// ---- status cleanup ---------------------------------------------------------------------
// Every distinct spelling of a status in use, with how many leads carry it and what it should
// probably become (see lib/statuses.js). Read-only.
export async function getStatusCleanup(supabase) {
  const rows = await fetchAllRows(() => supabase.from("leads").select("status"), "statuses");
  const counts = new Map();
  rows.forEach((r) => { const s = String(r.status ?? "").trim(); if (s) counts.set(s, (counts.get(s) || 0) + 1); });
  return { statuses: statusCleanupRows(counts), canonical: CANONICAL_STATUSES, totalLeads: rows.length };
}

const MAX_MERGES = 100;
const MAX_UNDO_ROWS = 20000;

// merges: [{ from: "<status exactly as stored>", to: "<status it becomes>" }].
// Changes only the status text of the leads that carry `from` (not who owns them, not their
// last-updated time) and returns every lead changed with its old status, so it can be undone.
export async function applyStatusMerges(supabase, merges) {
  if (!Array.isArray(merges) || merges.length === 0) throw httpError(400, "Nothing to change");
  if (merges.length > MAX_MERGES) throw httpError(400, `At most ${MAX_MERGES} changes at a time`);

  const plan = merges.map((m) => {
    const from = String(m && m.from != null ? m.from : "");
    const to = normalizeStatus(m && m.to);
    if (!from.trim()) throw httpError(400, "A change is missing the status to change");
    if (cleanStatus(from) === "disconnected" || cleanStatus(to) === "disconnected") throw httpError(400, "Disconnected is a move, not a status: use Send to Disconnected");
    if (!to || isJunkStatus(to)) throw httpError(400, `"${m && m.to}" isn't a usable status to change "${from}" into`);
    return { from, to };
  });

  const changed = [];
  const summary = [];
  for (const { from, to } of plan) {
    if (from === to) continue;
    const affected = await fetchAllRows(() => supabase.from("leads").select("npi").eq("status", from), `leads with status "${from}"`);
    if (affected.length === 0) { summary.push({ from, to, leads: 0 }); continue; }
    const { error } = await supabase.from("leads").update({ status: to }).eq("status", from);
    if (error) throw httpError(500, `Failed to change "${from}" to "${to}": ` + error.message);
    summary.push({ from, to, leads: affected.length });
    affected.forEach((r) => { if (changed.length < MAX_UNDO_ROWS) changed.push({ npi: String(r.npi), from, to }); });
  }
  return { summary, changed, leadsChanged: summary.reduce((n, s) => n + s.leads, 0) };
}
