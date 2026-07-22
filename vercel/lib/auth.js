// Replaces appscript/services/AuthService.js. Sign-in goes through Supabase
// Auth's Google OAuth provider (configured in the Supabase dashboard --
// Authentication -> Providers -> Google -- MCP/API tooling doesn't expose
// that setting) instead of a plaintext Users tab + CacheService.
//
// `app_users` (see supabase/migrations, `enable_rls_and_google_oauth_bridge`)
// holds the app-specific fields Supabase Auth itself doesn't (display name,
// each user's saved "exclude keywords" search default), keyed 1:1 to
// `auth.users` via a foreign key on `id` -- a Google login's `auth.users.id`
// IS the `app_users.id`, created on first sign-in.
//
// Flow (see api/auth/google.js + api/auth/session.js):
//   1. Frontend calls GET /api/auth/google?redirectTo=<callback url> to get
//      a Google sign-in URL, and navigates the browser to it.
//   2. Google -> Supabase -> redirects back to that callback URL with the
//      session in the URL fragment (#access_token=...).
//   3. Frontend reads the fragment and POSTs the access_token to
//      /api/auth/session, which verifies it, upserts the app_users row, and
//      returns the same shape the old password login did.

import { createAnonClient, createServiceClient } from "./supabaseClient.js";

// Ensures an `app_users` row exists for this auth.users id (first sign-in) --
// uses the service-role client since there's no RLS-eligible session to
// attach a token to yet the very first time.
async function ensureAppUser(userId, email, fallbackDisplayName) {
  const serviceClient = createServiceClient();
  const { data: existing } = await serviceClient.from("app_users").select("*").eq("id", userId).maybeSingle();
  if (existing) return existing;

  const { data: created, error } = await serviceClient
    .from("app_users")
    .insert({ id: userId, username: email, display_name: fallbackDisplayName, exclude_keywords: "" })
    .select("*")
    .single();
  if (error) throw error;
  return created;
}

// Returns { url } -- a Google sign-in URL the frontend should navigate the
// browser to. `redirectTo` must be a URL already allow-listed in Supabase's
// Authentication -> URL Configuration -> Redirect URLs.
export async function getGoogleSignInUrl(redirectTo) {
  if (!redirectTo) {
    const err = new Error("redirectTo is required");
    err.status = 400;
    throw err;
  }

  const anon = createAnonClient();
  const { data, error } = await anon.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error || !data?.url) {
    const err = new Error(error?.message || "Could not start Google sign-in");
    err.status = 500;
    throw err;
  }
  return { url: data.url };
}

// Verifies a Supabase Auth access token (obtained from the URL fragment
// after the Google redirect completes) and returns { token, displayName,
// excludeKeywords } -- the same shape the old password login returned, so
// the frontend's session-storage handling doesn't need to change.
export async function exchangeSession(accessToken) {
  if (!accessToken) {
    const err = new Error("access_token is required");
    err.status = 400;
    throw err;
  }

  const serviceClient = createServiceClient();
  const { data: userData, error: userError } = await serviceClient.auth.getUser(accessToken);
  if (userError || !userData?.user) {
    const err = new Error("Invalid or expired session");
    err.status = 401;
    throw err;
  }

  const fallbackDisplayName = userData.user.user_metadata?.full_name || userData.user.email.split("@")[0];
  const appUser = await ensureAppUser(userData.user.id, userData.user.email, fallbackDisplayName);

  return {
    token: accessToken,
    email: userData.user.email,
    displayName: appUser.display_name,
    excludeKeywords: appUser.exclude_keywords,
  };
}

export async function logout(token) {
  if (!token) return { signedOut: true };
  const anon = createAnonClient();
  await anon.auth.admin?.signOut?.(token).catch(() => {}); // best-effort; a client-side token discard is what actually matters
  return { signedOut: true };
}

export default { getGoogleSignInUrl, exchangeSession, logout };
