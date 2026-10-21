// The team's weekly goals (sql/051). Anyone who can see Home may read them; only an admin changes them.
import { cleanGoals, shapeGoals } from "../lib/goals.js";
import { isTableMissing } from "../lib/annotations.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export async function getGoals(supabase) {
  const res = await supabase.from("team_goals").select("key, value");
  if (res.error) {
    if (isTableMissing(res.error)) return { installed: false, ...shapeGoals([]) };
    throw httpError(500, "Failed to read the goals: " + res.error.message);
  }
  return { installed: true, ...shapeGoals(res.data) };
}

export async function saveGoals(supabase, session, input, now = new Date()) {
  const cleaned = cleanGoals(input);
  if (cleaned.error) throw httpError(400, cleaned.error);
  for (const row of cleaned.rows) {
    const res = row.value === null
      ? await supabase.from("team_goals").delete().eq("key", row.key)
      : await supabase.from("team_goals").upsert({ key: row.key, value: row.value, updated_by: session.id, updated_at: now.toISOString() }, { onConflict: "key" });
    if (res.error) {
      if (isTableMissing(res.error)) throw httpError(503, "Weekly goals aren't installed yet. Run sql/051_followups_and_goals.sql in Supabase, then try again.");
      throw httpError(500, "Failed to save the goals: " + res.error.message);
    }
  }
  return getGoals(supabase);
}
