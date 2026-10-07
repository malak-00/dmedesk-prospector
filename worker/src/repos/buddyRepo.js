// The avatar's notes (sql/031): a message of the day, or a note for one person.
// Before that file is run the tables don't exist; every read then returns nothing rather than failing,
// and writing says plainly that the file hasn't been run.
import { cleanNoteInput, notesFor } from "../lib/buddy.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const missingTable = (error) =>
  Boolean(error) && (error.code === "42P01" || error.code === "PGRST205" || /buddy_(notes|seen)/.test(error.message || ""));

const NOTE_COLUMNS = "id, to_user_id, body, created_by, show_from, expires_at, retired_at, created_at";

async function namesById(supabase, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return () => "";
  const { data } = await supabase.from("app_users").select("id, display_name").in("id", unique);
  const map = new Map((data || []).map((u) => [u.id, u.display_name]));
  return (id) => map.get(id) || "";
}

// What this person can see now, newest first, each with whether they have been shown it yet.
export async function listForUser(supabase, session, now = new Date()) {
  const notes = await supabase.from("buddy_notes").select(NOTE_COLUMNS).is("retired_at", null).order("show_from", { ascending: false }).limit(60);
  if (notes.error) {
    if (missingTable(notes.error)) return { notes: [], unavailable: true };
    throw httpError(500, "Failed to load notes: " + notes.error.message);
  }
  const seen = await supabase.from("buddy_seen").select("note_id").eq("user_id", session.id).limit(1000);
  const seenIds = seen.error ? [] : (seen.data || []).map((r) => r.note_id);
  const nameOf = await namesById(supabase, (notes.data || []).map((n) => n.created_by));
  return { notes: notesFor(notes.data || [], seenIds, session.id, now, nameOf).slice(0, 12) };
}

// "Got it": this person has been shown the note. Safe to repeat.
export async function markSeen(supabase, session, noteId) {
  const id = Number(noteId);
  if (!Number.isInteger(id) || id < 1) throw httpError(400, "A note id is required");
  const { error } = await supabase.from("buddy_seen").upsert({ note_id: id, user_id: session.id }, { onConflict: "note_id,user_id", ignoreDuplicates: true });
  if (error && !missingTable(error)) throw httpError(500, "Failed to record that: " + error.message);
  return { id: String(id), seen: true };
}

// Admin: every note that hasn't been retired (including ones not yet showing or already expired),
// with who it is for and how many people have been shown it.
export async function listForAdmin(supabase, now = new Date()) {
  const notes = await supabase.from("buddy_notes").select(NOTE_COLUMNS).is("retired_at", null).order("created_at", { ascending: false }).limit(50);
  if (notes.error) {
    if (missingTable(notes.error)) return { notes: [], unavailable: true };
    throw httpError(500, "Failed to load notes: " + notes.error.message);
  }
  const rows = notes.data || [];
  const nameOf = await namesById(supabase, rows.flatMap((n) => [n.created_by, n.to_user_id]));
  const ids = rows.map((n) => n.id);
  const seen = ids.length ? await supabase.from("buddy_seen").select("note_id").in("note_id", ids).limit(5000) : { data: [] };
  const counts = new Map();
  for (const r of seen.data || []) counts.set(r.note_id, (counts.get(r.note_id) || 0) + 1);
  const t = now.getTime();
  return {
    notes: rows.map((n) => ({
      id: String(n.id),
      body: n.body,
      toUserId: n.to_user_id || "",
      to: n.to_user_id ? nameOf(n.to_user_id) || "A removed user" : "Everyone",
      from: nameOf(n.created_by),
      showFrom: n.show_from,
      expiresAt: n.expires_at,
      state: Date.parse(n.show_from) > t ? "scheduled" : n.expires_at && Date.parse(n.expires_at) <= t ? "expired" : "showing",
      seenBy: counts.get(n.id) || 0,
    })),
  };
}

export async function createNote(supabase, session, input, now = new Date()) {
  const note = cleanNoteInput(input, now);
  if (note.toUserId) {
    const { data, error } = await supabase.from("app_users").select("id").eq("id", note.toUserId).maybeSingle();
    if (error || !data) throw httpError(400, "That person wasn't found");
  }
  const { data, error } = await supabase
    .from("buddy_notes")
    .insert({ to_user_id: note.toUserId, body: note.body, created_by: session.id, show_from: note.showFrom, expires_at: note.expiresAt })
    .select("id")
    .single();
  if (error) {
    if (missingTable(error)) throw httpError(503, "Run sql/031_avatar_notes.sql in Supabase first, then try again");
    throw httpError(500, "Failed to save the note: " + error.message);
  }
  return { id: String(data.id) };
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
