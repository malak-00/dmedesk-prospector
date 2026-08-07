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

async function findUserByUsername(supabase, username) {
  const { data, error } = await supabase
    .from("app_users")
    .select("id, username, password_hash, display_name, exclude_keywords")
    .ilike("username", String(username).trim())
    .maybeSingle();
  if (error) throw httpError(500, "Failed to look up user: " + error.message);
  return data;
}

export async function login(config, username, password) {
  if (!username || !password) throw httpError(400, "Username and password are required");

  const supabase = getSupabase(config);
  const user = await findUserByUsername(supabase, username);

  if (!user || !(await bcrypt.compare(String(password), user.password_hash))) {
    await new Promise((resolve) => setTimeout(resolve, 400)); // slow down brute-force attempts a little
    throw httpError(401, "Wrong username or password");
  }

  const token = await new SignJWT({
    username: user.username,
    displayName: user.display_name,
    excludeKeywords: user.exclude_keywords || "",
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
  };
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
