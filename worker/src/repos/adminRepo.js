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
