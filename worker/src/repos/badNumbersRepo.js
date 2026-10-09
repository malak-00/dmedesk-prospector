// Wrong phone numbers, shared by the team (sql/038). Before that file is run there is no table: lists come back
// empty and flagging says which file to run.
import { cleanFlag, cleanNpiList } from "../lib/badNumbers.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const missingTable = (error) => Boolean(error) && (error.code === "42P01" || error.code === "PGRST205" || /bad_numbers/.test(error.message || ""));
const NEEDS_038 = "Run sql/038_bad_numbers.sql in Supabase first, then try again";

// Flags for these leads (npis is a comma-separated list), with who flagged each.
export async function listForNpis(supabase, rawNpis) {
  const npis = cleanNpiList(rawNpis);
  if (!npis.length) return { flags: [] };
  const { data, error } = await supabase.from("bad_numbers").select("npi, number, reason, flagged_by, flagged_at").in("npi", npis).is("cleared_at", null).limit(2000);
  if (error) {
    if (missingTable(error)) return { flags: [], unavailable: true };
    throw httpError(500, "Failed to load flagged numbers: " + error.message);
  }
  const ids = [...new Set((data || []).map((r) => r.flagged_by).filter(Boolean))];
  const names = new Map();
  if (ids.length) {
    const users = await supabase.from("app_users").select("id, display_name").in("id", ids);
    (users.data || []).forEach((u) => names.set(u.id, u.display_name));
  }
  return { flags: (data || []).map((r) => ({ npi: r.npi, number: r.number, reason: r.reason, by: names.get(r.flagged_by) || "", at: r.flagged_at })) };
}

// Flag (or re-flag) a number on a lead. Anyone signed in may; it helps the whole team.
export async function flagNumber(supabase, session, input, now = new Date()) {
  const flag = cleanFlag(input);
  const { error } = await supabase.from("bad_numbers").upsert(
    { npi: flag.npi, number: flag.number, reason: flag.reason, flagged_by: session.id, flagged_at: now.toISOString(), cleared_at: null },
    { onConflict: "npi,number" },
  );
  if (error) throw httpError(missingTable(error) ? 503 : 500, missingTable(error) ? NEEDS_038 : "Failed to flag the number: " + error.message);
  return flag;
}

// Take a flag back (a misclick). The row stays; it just stops counting.
export async function clearFlag(supabase, session, input, now = new Date()) {
  const flag = cleanFlag(input);
  const { error } = await supabase.from("bad_numbers").update({ cleared_at: now.toISOString() }).eq("npi", flag.npi).eq("number", flag.number).is("cleared_at", null);
  if (error) throw httpError(missingTable(error) ? 503 : 500, missingTable(error) ? NEEDS_038 : "Failed to clear the flag: " + error.message);
  return { npi: flag.npi, number: flag.number, cleared: true };
}
