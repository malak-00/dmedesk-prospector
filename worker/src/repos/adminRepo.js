// Admin dashboard queries -- every export here assumes the caller has
// already checked session.isAdmin (see index.js's /admin routes); nothing
// in this file re-checks it, same trust boundary as leadsRepo's
// listClaimedLeadsForUser.
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
    supabase.from("lead_groups").select("id, canonical_name, state, identity_key").in("id", groupIds),
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
    return {
      groupId,
      groupName: (group && group.canonical_name) || rows[0].company_name || "(unnamed group)",
      groupState: (group && group.state) || rows[0].state || "",
      identityKey: (group && group.identity_key) || "",
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
