// The avatar's notes: what an admin may write, and which notes a person is shown.
// Pure, so it is tested without a database (repos/buddyRepo.js does the reading and writing).

export const MAX_NOTE_LENGTH = 500;
export const MAX_REPLY_LENGTH = 200;
export const DEFAULT_NOTE_DAYS = 7;
export const DEFAULT_REPEAT_DAYS = 180;
export const REACTIONS = ["like", "love", "cheer"];
const DAY_MS = 86_400_000;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// An admin's input -> the row to store. toUserId "" or missing means everyone.
// showFrom (optional ISO time) lets a note be written now and appear later.
// repeatWeekday (0 = Sunday .. 6) makes it show every week on that day until it expires.
export function cleanNoteInput(input = {}, now = new Date()) {
  const body = String(input.body ?? "").replace(/\s+\n/g, "\n").trim();
  if (!body) throw httpError(400, "Write the note first");
  if (body.length > MAX_NOTE_LENGTH) throw httpError(400, `Notes can be up to ${MAX_NOTE_LENGTH} characters`);

  const toUserId = String(input.toUserId ?? "").trim() || null;

  let repeatWeekday = null;
  if (input.repeatWeekday !== undefined && input.repeatWeekday !== null && input.repeatWeekday !== "") {
    repeatWeekday = Number(input.repeatWeekday);
    if (!Number.isInteger(repeatWeekday) || repeatWeekday < 0 || repeatWeekday > 6) throw httpError(400, "Choose a day of the week");
  }

  let showFrom = now;
  if (input.showFrom) {
    showFrom = new Date(input.showFrom);
    if (Number.isNaN(showFrom.getTime())) throw httpError(400, "That start time isn't valid");
  }

  const fallback = repeatWeekday === null ? DEFAULT_NOTE_DAYS : DEFAULT_REPEAT_DAYS;
  const days = input.expiresDays === undefined || input.expiresDays === "" ? fallback : Number(input.expiresDays);
  if (!Number.isFinite(days) || days < 1 || days > 365) throw httpError(400, "Choose 1 to 365 days");
  const expiresAt = new Date(Math.max(showFrom.getTime(), now.getTime()) + Math.round(days) * DAY_MS);

  return { body, toUserId, repeatWeekday, showFrom: showFrom.toISOString(), expiresAt: expiresAt.toISOString() };
}

// The notes this person can see right now, newest first, each marked seen or not.
// rows: buddy_notes rows; seenIds: ids this person has already been shown;
// reactions: Map(note id -> { reaction, reply }) for this person.
export function notesFor(rows, seenIds, userId, now = new Date(), nameOf = () => "", reactions = new Map()) {
  const seen = new Set((seenIds || []).map(String));
  const t = now.getTime();
  return (rows || [])
    .filter((n) => !n.retired_at)
    .filter((n) => Date.parse(n.show_from) <= t)
    .filter((n) => !n.expires_at || Date.parse(n.expires_at) > t)
    .filter((n) => !n.to_user_id || n.to_user_id === userId)
    .sort((a, b) => Date.parse(b.show_from) - Date.parse(a.show_from) || Number(b.id) - Number(a.id))
    .map((n) => {
      const mine = reactions.get(String(n.id)) || reactions.get(n.id) || {};
      return {
        id: String(n.id),
        body: n.body,
        kind: n.kind || "note",
        personal: Boolean(n.to_user_id),
        repeatWeekday: n.repeat_weekday ?? null,
        from: nameOf(n.created_by) || "",
        at: n.show_from,
        seen: seen.has(String(n.id)),
        reaction: mine.reaction || "",
        reply: mine.reply || "",
      };
    });
}

// A person's reaction and reply, cleaned. Either may be omitted to leave it as it was.
export function cleanReaction(input = {}) {
  const out = {};
  if (input.reaction !== undefined) {
    const r = String(input.reaction || "");
    if (r && !REACTIONS.includes(r)) throw httpError(400, "That reaction isn't available");
    out.reaction = r || null;
  }
  if (input.reply !== undefined) {
    const reply = String(input.reply || "").replace(/\s+/g, " ").trim();
    if (reply.length > MAX_REPLY_LENGTH) throw httpError(400, `Replies can be up to ${MAX_REPLY_LENGTH} characters`);
    out.reply = reply || null;
  }
  return out;
}

// A birthday ("MM-DD", or "" to clear) and a start date ("YYYY-MM-DD", or "").
export function cleanPeopleInput(input = {}) {
  const birthday = String(input.birthday ?? "").trim();
  if (birthday && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(birthday)) throw httpError(400, "A birthday is a month and day, like 04-23");
  const startedOn = String(input.startedOn ?? "").trim();
  if (startedOn && (!/^\d{4}-\d{2}-\d{2}$/.test(startedOn) || Number.isNaN(Date.parse(startedOn)))) throw httpError(400, "That start date isn't valid");
  const userId = String(input.userId ?? "").trim();
  if (!userId) throw httpError(400, "Choose a person");
  return { userId, birthday: birthday || null, startedOn: startedOn || null };
}

// Birthdays and work anniversaries on a given day (YYYY-MM-DD, the viewer's own date).
// people: [{ user_id, birthday_md, started_on }]; nameOf(user_id) -> display name.
// An anniversary needs at least one full year; the start day itself is not one.
export function occasionsOn(people, day, meId, nameOf = () => "") {
  const md = String(day).slice(5);
  const year = Number(String(day).slice(0, 4));
  const out = [];
  for (const p of people || []) {
    if (p.birthday_md && p.birthday_md === md) {
      out.push({ kind: "birthday", userId: p.user_id, name: nameOf(p.user_id), years: 0, mine: p.user_id === meId });
    }
    if (p.started_on && String(p.started_on).slice(5, 10) === md) {
      const years = year - Number(String(p.started_on).slice(0, 4));
      if (years >= 1) out.push({ kind: "anniversary", userId: p.user_id, name: nameOf(p.user_id), years, mine: p.user_id === meId });
    }
  }
  return out;
}

export const winText = (name, company) => `${name} just onboarded ${company || "a new customer"}!`;

/* ---------- team features (sql/033): kudos, mood, scripts, the team goal ---------- */

export const MAX_KUDOS_LENGTH = 140;
export const KUDOS_PER_DAY = 5;
export const MAX_SCRIPT_BODY = 800;

// A thank-you to a teammate: not to yourself, and short.
export function cleanKudos(input = {}, fromUserId) {
  const toUser = String(input.toUserId ?? "").trim();
  if (!toUser) throw httpError(400, "Choose who to thank");
  if (toUser === fromUserId) throw httpError(400, "Thank a teammate, not yourself");
  const body = String(input.body ?? "").replace(/\s+/g, " ").trim();
  if (!body) throw httpError(400, "Write a few words first");
  if (body.length > MAX_KUDOS_LENGTH) throw httpError(400, `Keep it to ${MAX_KUDOS_LENGTH} characters`);
  return { toUser, body };
}

export function cleanMood(input = {}) {
  const mood = Number(input.mood);
  if (!Number.isInteger(mood) || mood < 1 || mood > 3) throw httpError(400, "Choose how your day is going");
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(input.day || "")) ? String(input.day) : null;
  return { mood, day };
}

// A script for everyone (specialty blank) or one specialty.
export function cleanScript(input = {}) {
  const title = String(input.title ?? "").replace(/\s+/g, " ").trim();
  const body = String(input.body ?? "").replace(/[ \t]+\n/g, "\n").trim();
  const specialty = String(input.specialty ?? "").replace(/\s+/g, " ").trim();
  if (!title) throw httpError(400, "Give the script a title");
  if (title.length > 60) throw httpError(400, "The title can be up to 60 characters");
  if (!body) throw httpError(400, "Write the script first");
  if (body.length > MAX_SCRIPT_BODY) throw httpError(400, `Scripts can be up to ${MAX_SCRIPT_BODY} characters`);
  if (specialty.length > 80) throw httpError(400, "The specialty can be up to 80 characters");
  return { title, body, specialty: specialty || null };
}

// The weekly team call goal: a whole number, or "" to switch it off.
export function cleanTeamGoal(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 100000) throw httpError(400, "The team goal is a whole number of calls, like 500");
  return n;
}

// Monday 00:00 UTC of the week containing `now` (the team's shifts sit well inside one UTC day).
export function weekStartUtc(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString();
}

// Mood answers for a stretch of days -> one anonymous count per day (never who chose what).
export function moodTrend(rows, days = 14, now = new Date()) {
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    const mine = (rows || []).filter((r) => String(r.day) === day);
    out.push({ day, great: mine.filter((r) => r.mood === 3).length, okay: mine.filter((r) => r.mood === 2).length, rough: mine.filter((r) => r.mood === 1).length });
  }
  return out;
}
