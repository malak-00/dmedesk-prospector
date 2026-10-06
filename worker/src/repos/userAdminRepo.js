// Admin "Controls": list, add and change users. Removing a user is a soft
// removal (app_users.disabled_at, sql/026): claimed leads and the append-only
// ownership history point at the user's row, so the row stays and the person
// simply cannot sign in any more.
import bcrypt from "bcryptjs";
import { findUserByUsernameExact } from "../lib/users.js";
import { clearUserGate } from "../lib/userGate.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 72; // bcrypt ignores everything past 72 bytes

const missingColumn = (error, column) =>
  Boolean(error) && new RegExp(column).test(error.message || "") && /does not exist|42703|schema cache/.test(`${error.code || ""} ${error.message || ""}`);

// The call log writes "<time> — <display name>: <text>", and the team view reads the
// name back out of it, so a display name must not contain the characters that
// delimit it, and two people must not share one.
export function validateNewUser(input = {}) {
  const username = String(input.username ?? "").trim();
  const displayName = String(input.displayName ?? "").trim().replace(/\s+/g, " ");
  const password = String(input.password ?? "");
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) {
    throw httpError(400, "Username must be 3 to 40 letters, numbers, dots, dashes or underscores");
  }
  if (displayName.length < 2 || displayName.length > 60) throw httpError(400, "Name must be 2 to 60 characters");
  if (/[:—\n\r]/.test(displayName)) throw httpError(400, "Name can't contain a colon or a long dash");
  validatePassword(password);
  return { username, displayName, password, isAdmin: input.isAdmin === true, canClaimForOthers: input.canClaimForOthers === true };
}

export function validatePassword(password) {
  const value = String(password ?? "");
  if (value.length < MIN_PASSWORD_LENGTH) throw httpError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  if (new TextEncoder().encode(value).length > MAX_PASSWORD_LENGTH) throw httpError(400, "Password is too long");
}

const COLUMN_SETS = [
  "id, username, display_name, is_admin, can_claim_for_others, disabled_at, created_at",
  "id, username, display_name, is_admin, can_claim_for_others, created_at",
  "id, username, display_name, is_admin, created_at",
  "id, username, display_name, is_admin",
];

async function loadUsers(supabase) {
  let last = null;
  for (const columns of COLUMN_SETS) {
    const res = await supabase.from("app_users").select(columns).order("display_name");
    if (!res.error) {
      return { rows: res.data || [], hasDisable: columns.includes("disabled_at"), hasClaimForOthers: columns.includes("can_claim_for_others") };
    }
    last = res.error;
  }
  throw httpError(500, "Failed to load users: " + last.message);
}

function toDTO(row, claimedCounts = {}) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    isAdmin: Boolean(row.is_admin),
    canClaimForOthers: Boolean(row.can_claim_for_others),
    disabled: Boolean(row.disabled_at),
    disabledAt: row.disabled_at || null,
    createdAt: row.created_at || null,
    claimedCount: claimedCounts[row.id] || 0,
  };
}

async function claimedCountsByUser(supabase) {
  const counts = {};
  for (let offset = 0, page = 0; page < 200; page++) {
    const { data, error } = await supabase.from("leads").select("claimed_by").eq("is_disconnected", false).not("claimed_by", "is", null).range(offset, offset + 999);
    if (error) throw httpError(500, "Failed to count claimed leads: " + error.message);
    if (!data || data.length === 0) break;
    data.forEach((row) => { counts[row.claimed_by] = (counts[row.claimed_by] || 0) + 1; });
    offset += data.length;
  }
  return counts;
}

export async function listUsers(supabase) {
  const [{ rows, hasDisable, hasClaimForOthers }, counts] = await Promise.all([loadUsers(supabase), claimedCountsByUser(supabase)]);
  return { users: rows.map((row) => toDTO(row, counts)), features: { remove: hasDisable, claimForOthers: hasClaimForOthers } };
}

export async function createUser(supabase, input, { hash = (pw) => bcrypt.hash(pw, 10) } = {}) {
  const user = validateNewUser(input);

  if (await findUserByUsernameExact(supabase, user.username, "id")) throw httpError(409, "That username is already taken");
  const { rows } = await loadUsers(supabase);
  if (rows.some((r) => String(r.display_name || "").trim().toLowerCase() === user.displayName.toLowerCase())) {
    throw httpError(409, "Someone already has that name. Add a last initial or a middle name so call logs stay unambiguous");
  }

  const row = {
    username: user.username,
    display_name: user.displayName,
    password_hash: await hash(user.password),
    is_admin: user.isAdmin,
    exclude_keywords: "",
  };
  if (user.canClaimForOthers) row.can_claim_for_others = true;

  const { data, error } = await supabase.from("app_users").insert(row).select("id").single();
  if (error) {
    if (missingColumn(error, "can_claim_for_others")) throw httpError(503, "Claiming for other people isn't installed yet. Run sql/011_claim_for_user.sql in Supabase, then try again.");
    if (error.code === "23505") throw httpError(409, "That username is already taken");
    throw httpError(500, "Failed to add the user: " + error.message);
  }
  clearUserGate();
  return { id: data.id, username: user.username, displayName: user.displayName, isAdmin: user.isAdmin, canClaimForOthers: user.canClaimForOthers };
}

// input: { id, isAdmin?, canClaimForOthers?, disabled?, password? }
export async function updateUser(supabase, actor, input, { hash = (pw) => bcrypt.hash(pw, 10) } = {}) {
  const id = String(input.id ?? "");
  if (!id) throw httpError(400, "id is required");

  const { rows, hasDisable } = await loadUsers(supabase);
  const target = rows.find((r) => r.id === id);
  if (!target) throw httpError(404, "User not found");

  const makingNonAdmin = input.isAdmin === false;
  const removing = input.disabled === true;
  if (id === actor.id && (makingNonAdmin || removing)) {
    throw httpError(400, "You can't remove your own admin access or your own account");
  }
  if ((makingNonAdmin || removing) && target.is_admin && !target.disabled_at) {
    const otherActiveAdmins = rows.filter((r) => r.id !== id && r.is_admin && !r.disabled_at).length;
    if (otherActiveAdmins === 0) throw httpError(400, "There has to be at least one active admin");
  }

  const patch = {};
  if (typeof input.isAdmin === "boolean") patch.is_admin = input.isAdmin;
  if (typeof input.canClaimForOthers === "boolean") patch.can_claim_for_others = input.canClaimForOthers;
  if (typeof input.disabled === "boolean") {
    if (!hasDisable) throw httpError(503, "Removing users isn't installed yet. Run sql/026_user_controls.sql in Supabase, then try again.");
    patch.disabled_at = input.disabled ? new Date().toISOString() : null;
  }
  if (input.password !== undefined && input.password !== "") {
    validatePassword(input.password);
    patch.password_hash = await hash(String(input.password));
  }
  if (Object.keys(patch).length === 0) throw httpError(400, "Nothing to change");

  const { error } = await supabase.from("app_users").update(patch).eq("id", id);
  if (error) {
    if (missingColumn(error, "can_claim_for_others")) throw httpError(503, "Claiming for other people isn't installed yet. Run sql/011_claim_for_user.sql in Supabase, then try again.");
    throw httpError(500, "Failed to update the user: " + error.message);
  }
  clearUserGate();
  return { id, changed: Object.keys(patch).filter((k) => k !== "password_hash"), passwordReset: "password_hash" in patch };
}
