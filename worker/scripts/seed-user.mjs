#!/usr/bin/env node
// One-off local script to create/update a teammate's account in `app_users`
// with a bcrypt-hashed password -- the equivalent of the old "owner edits a
// spreadsheet cell to add/reset an account" workflow, except the password
// never touches disk in plaintext (not in this repo, not in Supabase).
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/seed-user.mjs --username caro --password "..." --displayName "Caroline Richards"
//
// Run this locally (never commit real passwords anywhere). Re-running with
// the same --username updates that person's password/display name in place.
//
// Integration accounts (e.g. BD MEETINGS) that claim leads for other users:
//     node scripts/seed-user.mjs --username bd-meetings-bot --password "..." \
//       --displayName "BD Meetings (integration)" --can-claim-for-others
// which sets app_users.can_claim_for_others (needs sql/011). Never give that
// flag to a person's own account.
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import { findUserByUsernameExact } from "../src/lib/users.js";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const username = arg("username");
const password = arg("password");
const displayName = arg("displayName") || username;
const canClaimForOthers = process.argv.includes("--can-claim-for-others");

if (!username || !password) {
  console.error("Usage: node scripts/seed-user.mjs --username <u> --password <p> --displayName \"<Name>\"");
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment first.");
  process.exit(1);
}

const supabase = createClient(url, key);
const passwordHash = await bcrypt.hash(password, 10);

// Exact match only -- a wildcard lookup could overwrite a different user's password.
const existing = await findUserByUsernameExact(supabase, username, "id");

// The flag is only ever written when asked for, so re-seeding a normal user
// never touches it (and works on a database without sql/011).
const permission = canClaimForOthers ? { can_claim_for_others: true } : {};

if (existing) {
  const { error } = await supabase.from("app_users").update({ password_hash: passwordHash, display_name: displayName, ...permission }).eq("id", existing.id);
  if (error) throw error;
  console.log(`Updated ${username} (${displayName})${canClaimForOthers ? " -- can claim for others" : ""}.`);
} else {
  const { error } = await supabase.from("app_users").insert({ username, password_hash: passwordHash, display_name: displayName, exclude_keywords: "", ...permission });
  if (error) throw error;
  console.log(`Created ${username} (${displayName})${canClaimForOthers ? " -- can claim for others" : ""}.`);
}
