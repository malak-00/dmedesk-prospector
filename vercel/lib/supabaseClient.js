// Two different Supabase clients, deliberately for two different purposes:
//
// - createServiceClient(): the service-role key, bypasses Row-Level
//   Security entirely. Used ONLY where that's actually necessary (looking
//   up/creating a `profiles` row during login, before we have a user
//   session to attach a token to). Never expose this client or its key to
//   the browser.
// - createUserClient(accessToken): the anon key + the signed-in user's own
//   access token attached as the Authorization header. Every query made
//   with this client runs "as" that user for RLS purposes -- auth.uid()
//   inside a policy (see supabase/migrations/0001_init.sql) resolves to
//   them, so "select own leads only" etc. is enforced by Postgres itself,
//   not just by the application code remembering to add a WHERE clause.
//   This is what every authenticated API route should use for actual data
//   access.

import { createClient } from "@supabase/supabase-js";
import config from "./config.js";

export function createServiceClient() {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    const err = new Error("Supabase is not configured (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)");
    err.status = 503;
    throw err;
  }
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// The anon key, no user token attached -- for auth operations that happen
// BEFORE a session exists (signing in itself). Never used for data access.
export function createAnonClient() {
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    const err = new Error("Supabase is not configured (missing SUPABASE_URL or SUPABASE_ANON_KEY)");
    err.status = 503;
    throw err;
  }
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function createUserClient(accessToken) {
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    const err = new Error("Supabase is not configured (missing SUPABASE_URL or SUPABASE_ANON_KEY)");
    err.status = 503;
    throw err;
  }
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
