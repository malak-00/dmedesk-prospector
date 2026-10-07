// The avatar's notes (sql/031) and extras (sql/032): a message of the day, a note for one person, team wins,
// repeating notes, reactions and replies, birthdays and anniversaries.
// Before those files are run the tables (or the newer columns) don't exist; every read then returns what it can
// rather than failing, and writing says plainly which file hasn't been run.
import { cleanNoteInput, cleanPeopleInput, cleanReaction, notesFor, occasionsOn, winText } from "../lib/buddy.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const missingTable = (error) =>
  Boolean(error) && (error.code === "42P01" || error.code === "PGRST205" || /buddy_(notes|seen|reactions|people|settings)/.test(error.message || ""));
const missingColumn = (error) => Boolean(error) && (error.code === "42703" || /column .*(kind|repeat_weekday)|schema cache/.test(error.message || ""));

const BASE_COLUMNS = "id, to_user_id, body, created_by, show_from, expires_at, retired_at, created_at";
const FULL_COLUMNS = `${BASE_COLUMNS}, kind, repeat_weekday`;

// Newer columns first; before sql/032 only the original ones exist.
async function selectNotes(supabase, build) {
  const full = await build(supabase.from("buddy_notes").select(FULL_COLUMNS));
  if (full.error && missingColumn(full.error) && !missingTable(full.error)) return build(supabase.from("buddy_notes").select(BASE_COLUMNS));
  return full;
}

async function namesById(supabase, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return () => "";
  const { data } = await supabase.from("app_users").select("id, display_name").in("id", unique);
  const map = new Map((data || []).map((u) => [u.id, u.display_name]));
  return (id) => map.get(id) || "";
}

const localDay = (value, now) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : now.toISOString().slice(0, 10));

// What this person can see now, newest first, each with whether they have been shown it yet,
// plus any birthdays or anniversaries today (day is the viewer's own date).
export async function listForUser(supabase, session, { now = new Date(), day } = {}) {
  const notes = await selectNotes(supabase, (q) => q.is("retired_at", null).order("show_from", { ascending: false }).limit(60));
  if (notes.error) {
    if (missingTable(notes.error)) return { notes: [], occasions: [], unavailable: true };
    throw httpError(500, "Failed to load notes: " + notes.error.message);
  }
  const [seen, mine, people] = await Promise.all([
    supabase.from("buddy_seen").select("note_id").eq("user_id", session.id).limit(1000),
    supabase.from("buddy_reactions").select("note_id, reaction, reply").eq("user_id", session.id).limit(1000),
    supabase.from("buddy_people").select("user_id, birthday_md, started_on").limit(500),
  ]);
  const seenIds = seen.error ? [] : (seen.data || []).map((r) => r.note_id);
  const reactions = new Map(mine.error ? [] : (mine.data || []).map((r) => [String(r.note_id), r]));
  const peopleRows = people.error ? [] : people.data || [];
  const nameOf = await namesById(supabase, [...(notes.data || []).map((n) => n.created_by), ...peopleRows.map((p) => p.user_id)]);
  return {
    notes: notesFor(notes.data || [], seenIds, session.id, now, nameOf, reactions).slice(0, 12),
    occasions: occasionsOn(peopleRows, localDay(day, now), session.id, nameOf),
  };
}

// "Got it": this person has been shown the note. Safe to repeat.
export async function markSeen(supabase, session, noteId) {
  const id = Number(noteId);
  if (!Number.isInteger(id) || id < 1) throw httpError(400, "A note id is required");
  const { error } = await supabase.from("buddy_seen").upsert({ note_id: id, user_id: session.id }, { onConflict: "note_id,user_id", ignoreDuplicates: true });
  if (error && !missingTable(error)) throw httpError(500, "Failed to record that: " + error.message);
  return { id: String(id), seen: true };
}

// A reaction (an emoji) and/or a one-line reply to a note. Whatever isn't sent stays as it was.
export async function react(supabase, session, input) {
  const id = Number(input?.id);
  if (!Number.isInteger(id) || id < 1) throw httpError(400, "A note id is required");
  const patch = cleanReaction(input);
  if (!("reaction" in patch) && !("reply" in patch)) throw httpError(400, "Choose a reaction or write a reply");
  const note = await supabase.from("buddy_notes").select("id, to_user_id").eq("id", id).maybeSingle();
  if (note.error && !missingTable(note.error)) throw httpError(500, "Failed to look up the note: " + note.error.message);
  if (note.error || !note.data || (note.data.to_user_id && note.data.to_user_id !== session.id)) throw httpError(404, "That note wasn't found");
  const existing = await supabase.from("buddy_reactions").select("reaction, reply").eq("note_id", id).eq("user_id", session.id).maybeSingle();
  if (existing.error && missingTable(existing.error)) throw httpError(503, "Run sql/032_avatar_extras.sql in Supabase first");
  const row = { note_id: id, user_id: session.id, reaction: null, reply: null, ...(existing.data || {}), ...patch, updated_at: new Date().toISOString() };
  const { error } = await supabase.from("buddy_reactions").upsert(row, { onConflict: "note_id,user_id" });
  if (error) throw httpError(missingTable(error) ? 503 : 500, missingTable(error) ? "Run sql/032_avatar_extras.sql in Supabase first" : "Failed to save that: " + error.message);
  return { id: String(id), reaction: row.reaction || "", reply: row.reply || "" };
}

async function readSettings(supabase) {
  const { data, error } = await supabase.from("buddy_settings").select("key, value");
  const map = new Map(error ? [] : (data || []).map((r) => [r.key, r.value]));
  return { teamWins: map.get("team_wins") === "on" };
}

export async function setTeamWins(supabase, on) {
  const { error } = await supabase.from("buddy_settings").upsert({ key: "team_wins", value: on ? "on" : "off" }, { onConflict: "key" });
  if (error) throw httpError(missingTable(error) ? 503 : 500, missingTable(error) ? "Run sql/032_avatar_extras.sql in Supabase first" : "Failed to save: " + error.message);
  return { teamWins: Boolean(on) };
}

// A lead was just onboarded: tell the team, if an admin has switched that on. Never throws (the status
// change has already succeeded and must not fail because of a greeting), and the person who did it
// isn't shown their own announcement.
export async function announceWin(supabase, session, company, now = new Date()) {
  try {
    if (!(await readSettings(supabase)).teamWins) return { announced: false };
    const expires = new Date(now.getTime() + 86_400_000).toISOString();
    const made = await supabase
      .from("buddy_notes")
      .insert({ to_user_id: null, body: winText(session.displayName || "Someone", company), created_by: session.id, show_from: now.toISOString(), expires_at: expires, kind: "win" })
      .select("id")
      .single();
    if (made.error || !made.data) return { announced: false };
    await supabase.from("buddy_seen").upsert({ note_id: made.data.id, user_id: session.id }, { onConflict: "note_id,user_id", ignoreDuplicates: true });
    return { announced: true };
  } catch {
    return { announced: false };
  }
}

// Admin: every note that hasn't been retired (including ones not yet showing or already expired),
// with who it is for, how many people have been shown it, and their reactions and replies; plus the
// birthday and start date entered for each person, and the team-wins switch.
export async function listForAdmin(supabase, now = new Date()) {
  const notes = await selectNotes(supabase, (q) => q.is("retired_at", null).order("created_at", { ascending: false }).limit(50));
  if (notes.error) {
    if (missingTable(notes.error)) return { notes: [], people: [], settings: { teamWins: false }, unavailable: true };
    throw httpError(500, "Failed to load notes: " + notes.error.message);
  }
  const rows = notes.data || [];
  const nameOf = await namesById(supabase, rows.flatMap((n) => [n.created_by, n.to_user_id]));
  const ids = rows.map((n) => n.id);
  const [seen, reacts, people, settings] = await Promise.all([
    ids.length ? supabase.from("buddy_seen").select("note_id").in("note_id", ids).limit(5000) : { data: [] },
    ids.length ? supabase.from("buddy_reactions").select("note_id, user_id, reaction, reply").in("note_id", ids).limit(2000) : { data: [] },
    supabase.from("buddy_people").select("user_id, birthday_md, started_on").limit(500),
    readSettings(supabase),
  ]);
  const counts = new Map();
  for (const r of seen.data || []) counts.set(r.note_id, (counts.get(r.note_id) || 0) + 1);
  const reactionRows = reacts.error ? [] : reacts.data || [];
  const reactNames = await namesById(supabase, reactionRows.map((r) => r.user_id));
  const t = now.getTime();
  return {
    notes: rows.map((n) => ({
      id: String(n.id),
      body: n.body,
      kind: n.kind || "note",
      repeatWeekday: n.repeat_weekday ?? null,
      toUserId: n.to_user_id || "",
      to: n.to_user_id ? nameOf(n.to_user_id) || "A removed user" : "Everyone",
      from: nameOf(n.created_by),
      showFrom: n.show_from,
      expiresAt: n.expires_at,
      state: Date.parse(n.show_from) > t ? "scheduled" : n.expires_at && Date.parse(n.expires_at) <= t ? "expired" : "showing",
      seenBy: counts.get(n.id) || 0,
      reactions: reactionRows
        .filter((r) => r.note_id === n.id && (r.reaction || r.reply))
        .map((r) => ({ name: reactNames(r.user_id), reaction: r.reaction || "", reply: r.reply || "" })),
    })),
    people: people.error ? [] : (people.data || []).map((p) => ({ userId: p.user_id, birthday: p.birthday_md || "", startedOn: p.started_on || "" })),
    settings,
  };
}

export async function createNote(supabase, session, input, now = new Date()) {
  const note = cleanNoteInput(input, now);
  if (note.toUserId) {
    const { data, error } = await supabase.from("app_users").select("id").eq("id", note.toUserId).maybeSingle();
    if (error || !data) throw httpError(400, "That person wasn't found");
  }
  const row = { to_user_id: note.toUserId, body: note.body, created_by: session.id, show_from: note.showFrom, expires_at: note.expiresAt };
  let made = await supabase.from("buddy_notes").insert(note.repeatWeekday === null ? row : { ...row, repeat_weekday: note.repeatWeekday }).select("id").single();
  if (made.error && note.repeatWeekday !== null && missingColumn(made.error)) throw httpError(503, "Repeating notes need sql/032_avatar_extras.sql. Run it in Supabase first");
  if (made.error) {
    if (missingTable(made.error)) throw httpError(503, "Run sql/031_avatar_notes.sql in Supabase first, then try again");
    throw httpError(500, "Failed to save the note: " + made.error.message);
  }
  return { id: String(made.data.id) };
}

// Notes are retired, never deleted: the row stays, it just stops showing.
export async function retireNote(supabase, noteId, now = new Date()) {
  const id = Number(noteId);
  if (!Number.isInteger(id) || id < 1) throw httpError(400, "A note id is required");
  const { error } = await supabase.from("buddy_notes").update({ retired_at: now.toISOString() }).eq("id", id).is("retired_at", null);
  if (error) {
    if (missingTable(error)) throw httpError(503, "Run sql/031_avatar_notes.sql in Supabase first");
    throw httpError(500, "Failed to retire the note: " + error.message);
  }
  return { id: String(id), retired: true };
}

// Admin: a person's birthday (month and day only) and start date, for the avatar's greetings.
export async function setPerson(supabase, input) {
  const p = cleanPeopleInput(input);
  const person = await supabase.from("app_users").select("id").eq("id", p.userId).maybeSingle();
  if (person.error || !person.data) throw httpError(400, "That person wasn't found");
  const { error } = await supabase.from("buddy_people").upsert({ user_id: p.userId, birthday_md: p.birthday, started_on: p.startedOn }, { onConflict: "user_id" });
  if (error) throw httpError(missingTable(error) ? 503 : 500, missingTable(error) ? "Run sql/032_avatar_extras.sql in Supabase first" : "Failed to save: " + error.message);
  return { userId: p.userId, birthday: p.birthday || "", startedOn: p.startedOn || "" };
}
