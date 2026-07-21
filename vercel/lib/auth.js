// Replaces appscript/services/AuthService.js. Sign-in now goes through
// Supabase Auth (real password hashing, real session/JWT management)
// instead of a plaintext Users tab + CacheService -- see
// MIGRATION_TO_VERCEL_SUPABASE.md's auth section for the tradeoff this
// implies: accounts are created via Supabase Auth (email + password, e.g.
// through the Supabase dashboard, an invite flow, or your own signup
// endpoint you add later) rather than an admin adding a row to a
// spreadsheet. `email` is used where the old app used `username` --
// Supabase Auth is email-based.
//
// `profiles` (see supabase/migrations/0001_init.sql) holds the
// app-specific fields Supabase Auth itself doesn't: display name, and each
// user's saved "exclude keywords" search default (was a column on the
// Users tab, auto-created on first save -- here it's just a column that
// always exists).

import { createAnonClient, createServiceClient } from "./supabaseClient.js";

// Ensures a `profiles` row exists for this user (first sign-in after their
// Supabase Auth account was created) -- uses the service-role client since
// there's no session yet to attach a user-scoped token to, and profiles'
// RLS only allows a user to touch their OWN row (which doesn't exist yet
// the very first time).
async function ensureProfile(userId, fallbackDisplayName) {
  const serviceClient = createServiceClient();
  const { data: existing } = await serviceClient.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (existing) return existing;

  const { data: created, error } = await serviceClient
    .from("profiles")
    .insert({ id: userId, display_name: fallbackDisplayName, exclude_keywords: "" })
    .select("*")
    .single();
  if (error) throw error;
  return created;
}

// Returns { token, displayName, excludeKeywords } -- `token` is a Supabase
// Auth access token, sent as `Authorization: Bearer <token>` on every
// subsequent request (see lib/http.js's withAuth).
export async function login(email, password) {
  if (!email || !password) {
    const err = new Error("Email and password are required");
    err.status = 400;
    throw err;
  }

  const anon = createAnonClient();
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    const err = new Error("Wrong email or password");
    err.status = 401;
    throw err;
  }

  const fallbackDisplayName = data.user.user_metadata?.display_name || email.split("@")[0];
  const profile = await ensureProfile(data.user.id, fallbackDisplayName);

  return {
    token: data.session.access_token,
    email: data.user.email,
    displayName: profile.display_name,
    excludeKeywords: profile.exclude_keywords,
  };
}

export async function logout(token) {
  if (!token) return { signedOut: true };
  const anon = createAnonClient();
  await anon.auth.admin?.signOut?.(token).catch(() => {}); // best-effort; a client-side token discard is what actually matters
  return { signedOut: true };
}

export default { login, logout };
