// The avatar's notes: what an admin may write, and which notes a person is shown.
// Pure, so it is tested without a database (repos/buddyRepo.js does the reading and writing).

export const MAX_NOTE_LENGTH = 500;
export const DEFAULT_NOTE_DAYS = 7;
const DAY_MS = 86_400_000;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// An admin's input -> the row to store. toUserId "" or missing means everyone.
// showFrom (optional ISO time) lets a note be written now and appear later.
export function cleanNoteInput(input = {}, now = new Date()) {
  const body = String(input.body ?? "").replace(/\s+\n/g, "\n").trim();
  if (!body) throw httpError(400, "Write the note first");
  if (body.length > MAX_NOTE_LENGTH) throw httpError(400, `Notes can be up to ${MAX_NOTE_LENGTH} characters`);

  const toUserId = String(input.toUserId ?? "").trim() || null;

  let showFrom = now;
  if (input.showFrom) {
    showFrom = new Date(input.showFrom);
    if (Number.isNaN(showFrom.getTime())) throw httpError(400, "That start time isn't valid");
  }

  const days = input.expiresDays === undefined || input.expiresDays === "" ? DEFAULT_NOTE_DAYS : Number(input.expiresDays);
  if (!Number.isFinite(days) || days < 1 || days > 365) throw httpError(400, "Choose 1 to 365 days");
  const expiresAt = new Date(Math.max(showFrom.getTime(), now.getTime()) + Math.round(days) * DAY_MS);

  return { body, toUserId, showFrom: showFrom.toISOString(), expiresAt: expiresAt.toISOString() };
}

// The notes this person can see right now, newest first, each marked seen or not.
// rows: buddy_notes rows; seenIds: ids this person has already been shown.
export function notesFor(rows, seenIds, userId, now = new Date(), nameOf = () => "") {
  const seen = new Set((seenIds || []).map(String));
  const t = now.getTime();
  return (rows || [])
    .filter((n) => !n.retired_at)
    .filter((n) => Date.parse(n.show_from) <= t)
    .filter((n) => !n.expires_at || Date.parse(n.expires_at) > t)
    .filter((n) => !n.to_user_id || n.to_user_id === userId)
    .sort((a, b) => Date.parse(b.show_from) - Date.parse(a.show_from) || Number(b.id) - Number(a.id))
    .map((n) => ({
      id: String(n.id),
      body: n.body,
      personal: Boolean(n.to_user_id),
      from: nameOf(n.created_by) || "",
      at: n.show_from,
      seen: seen.has(String(n.id)),
    }));
}
