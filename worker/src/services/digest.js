// The Monday digest, run by the Worker's cron trigger (wrangler.toml). One avatar note per super admin, at most one a week.
import { makeConfig } from "../lib/config.js";
import { getSupabase } from "../lib/supabase.js";
import { buildDigest } from "../lib/digest.js";
import * as adminRepo from "../repos/adminRepo.js";
import { createNote } from "../repos/buddyRepo.js";

const PREFIX = "Weekly digest:";

export async function runWeeklyDigest(env, now = new Date()) {
  const supabase = getSupabase(makeConfig(env));
  const people = await supabase.from("app_users").select("id").eq("is_super_admin", true).is("disabled_at", null);
  if (people.error || !(people.data || []).length) return { sent: 0, reason: people.error ? people.error.message : "no super admin" };

  const insights = await adminRepo.getInsights(supabase, null, { days: 14 });
  const body = buildDigest(insights);
  let sent = 0;
  for (const person of people.data) {
    // A retried or doubled cron must not send a second one in the same week.
    const recent = await supabase.from("buddy_notes").select("id").eq("to_user_id", person.id).ilike("body", `${PREFIX}%`)
      .gte("created_at", new Date(now.getTime() - 6 * 86_400_000).toISOString()).limit(1);
    if (!recent.error && (recent.data || []).length) continue;
    await createNote(supabase, { id: person.id }, { toUserId: person.id, body, expiresDays: 7 }, now);
    sent += 1;
  }
  return { sent };
}

// The "Send me the digest now" button on Home: the same note, to the person who asked, without the once-a-week guard.
export async function sendDigestNow(supabase, session, now = new Date()) {
  const insights = await adminRepo.getInsights(supabase, null, { days: 14 });
  const body = buildDigest(insights);
  await createNote(supabase, { id: session.id }, { toUserId: session.id, body, expiresDays: 7 }, now);
  return { body };
}
