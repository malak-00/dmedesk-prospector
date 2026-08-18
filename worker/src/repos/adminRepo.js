// Admin dashboard queries -- every export here assumes the caller has
// already checked session.isAdmin (see index.js's /admin routes); nothing
// in this file re-checks it, same trust boundary as leadsRepo's
// listClaimedLeadsForUser.
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Per-user counts, tallied in JS from one query per table (leads,
// suggestions, search_progress) instead of one query per user per table --
// cheap enough at this table size and avoids an N+1 fan-out as the team
// grows. "distinctSearches" counts rows in search_progress, i.e. distinct
// state/specialty/etc filter combinations a user has searched -- the
// closest available proxy for search activity, since individual search
// requests themselves aren't logged anywhere.
export async function getUserActivitySummary(supabase) {
  const [usersRes, leadsRes, suggestionsRes, searchesRes] = await Promise.all([
    supabase.from("app_users").select("id, username, display_name, is_admin").order("display_name"),
    supabase.from("leads").select("claimed_by, is_disconnected"),
    supabase.from("suggestions").select("submitted_by"),
    supabase.from("search_progress").select("user_id"),
  ]);
  if (usersRes.error) throw httpError(500, "Failed to load users: " + usersRes.error.message);
  if (leadsRes.error) throw httpError(500, "Failed to load leads: " + leadsRes.error.message);
  if (suggestionsRes.error) throw httpError(500, "Failed to load suggestions: " + suggestionsRes.error.message);
  if (searchesRes.error) throw httpError(500, "Failed to load search activity: " + searchesRes.error.message);

  const claimedCounts = {};
  const disconnectedCounts = {};
  (leadsRes.data || []).forEach((row) => {
    if (!row.claimed_by) return;
    const bucket = row.is_disconnected ? disconnectedCounts : claimedCounts;
    bucket[row.claimed_by] = (bucket[row.claimed_by] || 0) + 1;
  });

  const suggestionCounts = {};
  (suggestionsRes.data || []).forEach((row) => {
    if (!row.submitted_by) return;
    suggestionCounts[row.submitted_by] = (suggestionCounts[row.submitted_by] || 0) + 1;
  });

  const searchCounts = {};
  (searchesRes.data || []).forEach((row) => {
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
