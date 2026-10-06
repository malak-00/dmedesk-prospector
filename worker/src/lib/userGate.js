// Who may use the app right now, and who is an admin, read fresh from the
// database instead of trusted from a sign-in token that can be six hours old.
// That is what makes "remove this user" and "take away admin" take effect within
// a few seconds instead of at the token's expiry. One small query per isolate per
// 30 seconds (the team is a few dozen rows).
//
// Fails open on purpose: if the lookup itself fails, requests carry on with what
// the token says rather than locking everyone out of the app.

const TTL_MS = 30_000;
let cache = null;

export function clearUserGate() {
  cache = null;
}

export async function loadUserFlags(supabase, now = Date.now, { fresh = false } = {}) {
  if (!fresh && cache && now() - cache.at < TTL_MS) return cache.flags;

  // Newest column set first: before sql/027 / sql/026 the columns don't exist and the
  // older set is used (everyone counts as active, nobody must change a password).
  let res = null;
  for (const columns of ["id, is_admin, disabled_at, must_change_password", "id, is_admin, disabled_at", "id, is_admin"]) {
    res = await supabase.from("app_users").select(columns);
    if (!res.error) break;
  }
  if (res.error) return null;

  const flags = new Map();
  for (const user of res.data || []) {
    flags.set(user.id, { isAdmin: Boolean(user.is_admin), disabled: Boolean(user.disabled_at), mustChange: Boolean(user.must_change_password) });
  }
  cache = { at: now(), flags };
  return flags;
}

// -> { ok: true, session } with the admin flag as the database has it, or
// { ok: false, reason } when the account is removed or no longer exists.
export function applyUserFlags(session, flags) {
  if (!flags || flags.size === 0) return { ok: true, session };
  const entry = flags.get(session.id);
  if (!entry) return { ok: false, reason: "This account no longer exists" };
  if (entry.disabled) return { ok: false, reason: "This account has been removed" };
  return { ok: true, session: { ...session, isAdmin: entry.isAdmin, mustChangePassword: entry.mustChange } };
}
