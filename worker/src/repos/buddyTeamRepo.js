// The avatar's team features (sql/033): kudos, a daily mood tap, call scripts, and the weekly team goal.
// Before that file is run the tables don't exist: reads then return nothing, and writes say which file to run.
import { KUDOS_PER_DAY, cleanKudos, cleanMood, cleanScript, cleanTeamGoal, moodTrend, weekStartUtc } from "../lib/buddy.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const missingTable = (error) =>
  Boolean(error) && (error.code === "42P01" || error.code === "PGRST205" || /buddy_(kudos|mood|scripts|settings)|call_taps/.test(error.message || ""));
const NEEDS_033 = "Run sql/033_avatar_team.sql in Supabase first";

async function activeUsers(supabase) {
  let res = await supabase.from("app_users").select("id, display_name, disabled_at").order("display_name");
  if (res.error) res = await supabase.from("app_users").select("id, display_name").order("display_name"); // before sql/026
  if (res.error) throw httpError(500, "Failed to load teammates: " + res.error.message);
  return (res.data || []).filter((u) => !u.disabled_at);
}

async function nameLookup(supabase, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return () => "";
  const { data } = await supabase.from("app_users").select("id, display_name").in("id", unique);
  const map = new Map((data || []).map((u) => [u.id, u.display_name]));
  return (id) => map.get(id) || "";
}

async function readGoal(supabase) {
  const { data, error } = await supabase.from("buddy_settings").select("value").eq("key", "team_goal").maybeSingle();
  if (error || !data) return null;
  const n = Number(data.value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Teammates to thank, and the week's team call goal with how far the team is. Calls are the phone taps
// recorded this week (sql/029), which is what every Call button and tapped number already writes.
export async function teamInfo(supabase, session, now = new Date()) {
  const [users, target] = await Promise.all([activeUsers(supabase), readGoal(supabase)]);
  let calls = 0;
  if (target) {
    const { count, error } = await supabase.from("call_taps").select("id", { count: "exact", head: true }).gte("tapped_at", weekStartUtc(now));
    if (!error) calls = count || 0;
  }
  return {
    people: users.filter((u) => u.id !== session.id).map((u) => ({ id: u.id, name: u.display_name })),
    goal: { target, calls, weekStart: weekStartUtc(now).slice(0, 10) },
  };
}

// Thank-yous this person hasn't been shown yet.
export async function kudosForMe(supabase, session) {
  const { data, error } = await supabase.from("buddy_kudos").select("id, from_user, body, created_at").eq("to_user", session.id).is("seen_at", null).order("created_at", { ascending: true }).limit(10);
  if (error) {
    if (missingTable(error)) return [];
    throw httpError(500, "Failed to load kudos: " + error.message);
  }
  const nameOf = await nameLookup(supabase, (data || []).map((k) => k.from_user));
  return (data || []).map((k) => ({ id: String(k.id), from: nameOf(k.from_user) || "A teammate", body: k.body, at: k.created_at }));
}

export async function giveKudos(supabase, session, input, now = new Date()) {
  const kudos = cleanKudos(input, session.id);
  const target = await supabase.from("app_users").select("id").eq("id", kudos.toUser).maybeSingle();
  if (target.error || !target.data) throw httpError(400, "That person wasn't found");
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const today = await supabase.from("buddy_kudos").select("id").eq("from_user", session.id).gte("created_at", dayStart).limit(KUDOS_PER_DAY);
  if (today.error && missingTable(today.error)) throw httpError(503, NEEDS_033);
  if ((today.data || []).length >= KUDOS_PER_DAY) throw httpError(429, `That's ${KUDOS_PER_DAY} thank-yous today. Save some for tomorrow`);
  const { error } = await supabase.from("buddy_kudos").insert({ from_user: session.id, to_user: kudos.toUser, body: kudos.body });
  if (error) throw httpError(missingTable(error) ? 503 : 500, missingTable(error) ? NEEDS_033 : "Failed to send: " + error.message);
  return { sent: true };
}

export async function markKudosSeen(supabase, session, id, now = new Date()) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) throw httpError(400, "A kudos id is required");
  const { error } = await supabase.from("buddy_kudos").update({ seen_at: now.toISOString() }).eq("id", n).eq("to_user", session.id).is("seen_at", null);
  if (error && !missingTable(error)) throw httpError(500, "Failed to record that: " + error.message);
  return { id: String(n), seen: true };
}

// One tap a day. Tapping again the same day changes the answer.
export async function setMood(supabase, session, input, now = new Date()) {
  const { mood, day } = cleanMood(input);
  const { error } = await supabase.from("buddy_mood").upsert({ user_id: session.id, day: day || now.toISOString().slice(0, 10), mood }, { onConflict: "user_id,day" });
  if (error) throw httpError(missingTable(error) ? 503 : 500, missingTable(error) ? NEEDS_033 : "Failed to save: " + error.message);
  return { saved: true };
}

export async function listScripts(supabase) {
  const { data, error } = await supabase.from("buddy_scripts").select("id, specialty, title, body").is("retired_at", null).order("id", { ascending: true }).limit(100);
  if (error) {
    if (missingTable(error)) return { scripts: [] };
    throw httpError(500, "Failed to load scripts: " + error.message);
  }
  return { scripts: (data || []).map((s) => ({ id: String(s.id), specialty: s.specialty || "", title: s.title, body: s.body })) };
}

export async function saveScript(supabase, session, input) {
  const script = cleanScript(input);
  const { data, error } = await supabase.from("buddy_scripts").insert({ specialty: script.specialty, title: script.title, body: script.body, created_by: session.id }).select("id").single();
  if (error) throw httpError(missingTable(error) ? 503 : 500, missingTable(error) ? NEEDS_033 : "Failed to save the script: " + error.message);
  return { id: String(data.id) };
}

export async function retireScript(supabase, id, now = new Date()) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) throw httpError(400, "A script id is required");
  const { error } = await supabase.from("buddy_scripts").update({ retired_at: now.toISOString() }).eq("id", n).is("retired_at", null);
  if (error) throw httpError(missingTable(error) ? 503 : 500, missingTable(error) ? NEEDS_033 : "Failed to retire the script: " + error.message);
  return { id: String(n), retired: true };
}

// The weekly team goal (blank switches it off). Stored as a setting (sql/032).
export async function setTeamGoal(supabase, value) {
  const goal = cleanTeamGoal(value);
  const { error } = await supabase.from("buddy_settings").upsert({ key: "team_goal", value: goal === null ? "" : String(goal) }, { onConflict: "key" });
  if (error) throw httpError(missingTable(error) ? 503 : 500, missingTable(error) ? "Run sql/032_avatar_extras.sql in Supabase first" : "Failed to save: " + error.message);
  return { teamGoal: goal };
}

// What the admin sees: the mood as anonymous daily totals, the latest thank-yous, the scripts and the goal.
export async function adminExtras(supabase, now = new Date()) {
  const since = new Date(now.getTime() - 14 * 86_400_000).toISOString().slice(0, 10);
  const [mood, kudos, scripts, goal] = await Promise.all([
    supabase.from("buddy_mood").select("day, mood").gte("day", since).limit(2000),
    supabase.from("buddy_kudos").select("id, from_user, to_user, body, created_at").order("created_at", { ascending: false }).limit(20),
    supabase.from("buddy_scripts").select("id, specialty, title, body").is("retired_at", null).order("id", { ascending: true }).limit(100),
    readGoal(supabase),
  ]);
  const nameOf = await nameLookup(supabase, (kudos.data || []).flatMap((k) => [k.from_user, k.to_user]));
  return {
    mood: mood.error ? [] : moodTrend(mood.data || [], 14, now),
    kudos: kudos.error ? [] : (kudos.data || []).map((k) => ({ id: String(k.id), from: nameOf(k.from_user), to: nameOf(k.to_user), body: k.body, at: k.created_at })),
    scripts: scripts.error ? [] : (scripts.data || []).map((s) => ({ id: String(s.id), specialty: s.specialty || "", title: s.title, body: s.body })),
    teamGoal: goal,
    teamUnavailable: Boolean(mood.error && missingTable(mood.error)),
  };
}
