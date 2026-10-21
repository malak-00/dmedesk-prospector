// Call intel on any lead, claimed or not (sql/050). Shared by the whole team; the latest value wins.
import { cleanIntel, shapeIntel } from "../lib/intel.js";
import { cleanNpi, isTableMissing } from "../lib/annotations.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const NOT_INSTALLED = "Call intel isn't installed yet. Run sql/050_lead_intel.sql in Supabase, then try again.";

async function nameOf(supabase, id) {
  if (!id) return "";
  const res = await supabase.from("app_users").select("display_name, username").eq("id", id).maybeSingle();
  return (res.data && (res.data.display_name || res.data.username)) || "";
}

export async function getIntel(supabase, npiInput) {
  const npi = cleanNpi(npiInput);
  if (!npi) throw httpError(400, "Send a valid NPI.");
  const res = await supabase.from("lead_intel").select("*").eq("npi", npi).maybeSingle();
  if (res.error) {
    if (isTableMissing(res.error)) return { installed: false, ...shapeIntel(null) };
    throw httpError(500, "Failed to read call intel: " + res.error.message);
  }
  return { installed: true, ...shapeIntel(res.data, await nameOf(supabase, res.data && res.data.updated_by)) };
}

export async function saveIntel(supabase, npiInput, fields, session, now = new Date()) {
  const npi = cleanNpi(npiInput);
  if (!npi) throw httpError(400, "Send a valid NPI.");
  const cleaned = cleanIntel(fields);
  if (cleaned.error) throw httpError(400, cleaned.error);
  const row = { npi, ...cleaned.patch, updated_by: session.id, updated_at: now.toISOString() };
  // The follow-up belongs to the person who set it (sql/051).
  if ("follow_up_at" in cleaned.patch) row.follow_up_by = cleaned.patch.follow_up_at ? session.id : null;
  const res = await supabase.from("lead_intel").upsert(row, { onConflict: "npi" }).select("*").single();
  if (res.error) {
    if (isTableMissing(res.error)) throw httpError(503, NOT_INSTALLED);
    if (res.error.code === "PGRST204" || res.error.code === "42703" || /follow_up/.test(res.error.message || "")) throw httpError(503, "Follow-up dates aren't installed yet. Run sql/051_followups_and_goals.sql in Supabase, then try again.");
    throw httpError(500, "Failed to save call intel: " + res.error.message);
  }
  return { installed: true, ...shapeIntel(res.data, session.displayName || session.username || "") };
}
