// Username lookups that match exactly (case-insensitively). PostgREST's
// `ilike` is the only case-insensitive filter it offers, but it treats `%`,
// `_` (and `*`, which PostgREST turns into `%`) as wildcards -- a bare
// .ilike("username", input) would let "ben_admin" match "benXadmin", or
// "%" match everyone. So ilike only narrows the candidates here; the exact
// comparison happens in JS.
const MAX_CANDIDATES = 50;

export async function findUserByUsernameExact(supabase, username, columns) {
  const wanted = String(username ?? "").trim();
  if (!wanted) return null;

  const { data, error } = await supabase
    .from("app_users")
    .select(columns.includes("username") ? columns : `${columns}, username`)
    .ilike("username", wanted)
    .limit(MAX_CANDIDATES);
  if (error) {
    const err = new Error("Failed to look up user: " + error.message);
    err.status = 500;
    throw err;
  }

  const lower = wanted.toLowerCase();
  return (data || []).find((row) => String(row.username || "").toLowerCase() === lower) || null;
}
