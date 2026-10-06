// Username/password sign-in against the `app_users` table (bcrypt-hashed
// passwords, unlike the old Sheets-backed AuthService which stored
// plaintext), with sessions as signed, stateless JWTs instead of
// CacheService entries -- no server-side session store needed, and no more
// 6h CacheService ceiling forcing everyone's session to expire on a timer
// even mid-workday (the JWT `exp` claim is still set to 6h for parity, but
// nothing stops raising it now that it's just a claim, not a hard platform cap).
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { getSupabase } from "./supabase.js";
import { findUserByUsernameExact } from "./users.js";
import { afterFailedLogin, lockedMessage, lockMinutesLeft, LOCK_MINUTES } from "./loginGuard.js";
import { clearUserGate } from "./userGate.js";
import { validatePassword } from "../repos/userAdminRepo.js";

const SESSION_TTL_SECONDS = 6 * 60 * 60; // 6h, same as the old CacheService TTL
const MAX_EXCLUDE_KEYWORDS_LENGTH = 500;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function secretKey(config) {
  const secret = config.jwtSecret();
  if (!secret) throw httpError(503, "Sign-in is not configured (missing JWT_SECRET)");
  return new TextEncoder().encode(secret);
}

function findUserByUsername(supabase, username) {
  return findUserByUsernameExact(supabase, username, "id, username, password_hash, display_name, exclude_keywords, is_admin");
}

export function login(config, username, password) {
  return loginWith(getSupabase(config), config, username, password);
}

// The security columns (removed: sql/026; lockout and must-change: sql/027) are read
// on their own, newest set first, so sign-in keeps working before they exist.
async function readSecurity(supabase, userId) {
  for (const columns of ["disabled_at, failed_logins, locked_until, must_change_password", "disabled_at"]) {
    const res = await supabase.from("app_users").select(columns).eq("id", userId).maybeSingle();
    if (!res.error) return res.data || null;
  }
  return null;
}

export async function loginWith(supabase, config, username, password, { now = Date.now, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  if (!username || !password) throw httpError(400, "Username and password are required");

  const user = await findUserByUsername(supabase, username);
  const security = user ? await readSecurity(supabase, user.id) : null;

  // Locked after repeated wrong passwords: refused even with the right one.
  const minutes = lockMinutesLeft(security, now());
  if (minutes) throw httpError(429, lockedMessage(minutes));

  if (!user || !(await bcrypt.compare(String(password), user.password_hash))) {
    await wait(400); // slow down brute-force attempts a little
    if (user && security && "failed_logins" in security) {
      const next = afterFailedLogin(security, now());
      await supabase.from("app_users").update({ failed_logins: next.failed_logins, locked_until: next.locked_until }).eq("id", user.id);
      if (next.locked) throw httpError(429, lockedMessage(LOCK_MINUTES));
    }
    throw httpError(401, "Wrong username or password");
  }

  // A removed user (sql/026) can't sign in.
  if (security && security.disabled_at) {
    throw httpError(401, "This account has been removed. Ask an admin if that's a mistake.");
  }
  if (security && (Number(security.failed_logins) > 0 || security.locked_until)) {
    await supabase.from("app_users").update({ failed_logins: 0, locked_until: null }).eq("id", user.id);
  }

  const token = await new SignJWT({
    username: user.username,
    displayName: user.display_name,
    excludeKeywords: user.exclude_keywords || "",
    isAdmin: Boolean(user.is_admin),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS)
    .sign(secretKey(config));

  return {
    token,
    username: user.username,
    displayName: user.display_name,
    excludeKeywords: user.exclude_keywords || "",
    isAdmin: Boolean(user.is_admin),
    mustChangePassword: Boolean(security && security.must_change_password),
  };
}

// A signed-in person choosing their own password. Wrong current password is a 400,
// not a 401, because the app treats a 401 as "your session ended" and signs out.
export async function changePassword(supabase, session, currentPassword, newPassword, { hash = (pw) => bcrypt.hash(pw, 10), wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const { data: user, error } = await supabase.from("app_users").select("id, password_hash").eq("id", session.id).maybeSingle();
  if (error || !user) throw httpError(404, "Account not found");
  if (!(await bcrypt.compare(String(currentPassword ?? ""), user.password_hash))) {
    await wait(400);
    throw httpError(400, "Your current password isn't right");
  }
  validatePassword(newPassword);
  if (String(newPassword) === String(currentPassword)) throw httpError(400, "Choose a password you haven't used just now");

  const password_hash = await hash(String(newPassword));
  let res = await supabase.from("app_users").update({ password_hash, must_change_password: false }).eq("id", session.id);
  if (res.error) res = await supabase.from("app_users").update({ password_hash }).eq("id", session.id); // before sql/027
  if (res.error) throw httpError(500, "Failed to save the new password: " + res.error.message);
  clearUserGate();
  return { changed: true };
}

// Returns { id, username, displayName, excludeKeywords } or null. Never
// throws -- a bad/expired/missing token is just "not signed in", same as
// AuthService.getSession returning null on a cache miss.
export async function getSession(config, token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(config));
    return {
      id: payload.sub,
      username: payload.username,
      displayName: payload.displayName,
      excludeKeywords: payload.excludeKeywords || "",
      isAdmin: Boolean(payload.isAdmin),
    };
  } catch {
    return null;
  }
}

// Logout is client-side only now (discard the token) -- there is no
// server-side session store to remove an entry from, unlike the old
// CacheService-backed token. This is a deliberate simplification of the
// stateless-JWT tradeoff: a token can't be individually revoked before it
// expires. If that ever matters, add a `revoked_tokens` table keyed by JTI
// and check it here.
export function logout() {
  return { signedOut: true };
}

export async function setExcludeKeywords(config, session, text) {
  const trimmed = String(text || "").trim();
  if (trimmed.length > MAX_EXCLUDE_KEYWORDS_LENGTH) {
    throw httpError(400, `Exclude keywords must be ${MAX_EXCLUDE_KEYWORDS_LENGTH} characters or fewer`);
  }

  const supabase = getSupabase(config);
  const { error } = await supabase.from("app_users").update({ exclude_keywords: trimmed }).eq("id", session.id);
  if (error) throw httpError(500, "Failed to save exclude keywords: " + error.message);

  // Mint a fresh token carrying the updated value -- the client swaps its
  // stored token for this one, so getSession() reflects the change
  // immediately without a fresh login (same intent as AuthService's
  // in-place CacheService rewrite, just via a new signed token instead).
  const token = await new SignJWT({
    username: session.username,
    displayName: session.displayName,
    excludeKeywords: trimmed,
    isAdmin: Boolean(session.isAdmin),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.id)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS)
    .sign(secretKey(config));

  return { excludeKeywords: trimmed, token };
}

export function hashPassword(password) {
  return bcrypt.hash(password, 10);
}
