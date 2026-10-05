// Validation for a lead's booked meeting (see sql/020_lead_meetings.sql).
// Kept free of Supabase/Hono so it can be unit-tested on its own.

export const MEETING_DURATIONS = [15, 30, 45, 60, 90, 120];
// Minutes before the meeting to be reminded. 0 / empty means no reminder.
export const REMIND_BEFORE_OPTIONS = [0, 15, 30, 60, 120, 1440, 2880];
export const MAX_OPENER_NOTES_LENGTH = 2000;
export const MAX_EMAIL_LENGTH = 254;
const MAX_LABEL_LENGTH = 120;
const PAST_GRACE_MS = 5 * 60_000; // a meeting "starting now" shouldn't be refused for clock drift

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

export function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "")) && String(value).length <= MAX_EMAIL_LENGTH;
}

// Returns { clear: true } when meetingAt is blank (cancel), otherwise the
// cleaned values ready to store. Throws a 400-status Error for bad input.
export function normalizeMeetingInput(input = {}, now = Date.now()) {
  const meetingAtRaw = String(input.meetingAt ?? "").trim();
  const label = String(input.noteLabel ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_LABEL_LENGTH);
  if (!meetingAtRaw) return { clear: true, label };

  const start = new Date(meetingAtRaw);
  if (Number.isNaN(start.getTime())) throw badRequest("meetingAt must be a valid date and time");
  if (start.getTime() < now - PAST_GRACE_MS) throw badRequest("Meeting time must be in the future");

  const duration = input.durationMinutes === undefined || input.durationMinutes === "" ? 30 : Number(input.durationMinutes);
  if (!MEETING_DURATIONS.includes(duration)) {
    throw badRequest(`durationMinutes must be one of ${MEETING_DURATIONS.join(", ")}`);
  }

  const remindRaw = input.remindBeforeMinutes === undefined || input.remindBeforeMinutes === null || input.remindBeforeMinutes === ""
    ? 0
    : Number(input.remindBeforeMinutes);
  if (!REMIND_BEFORE_OPTIONS.includes(remindRaw)) {
    throw badRequest(`remindBeforeMinutes must be one of ${REMIND_BEFORE_OPTIONS.join(", ")}`);
  }

  const email = String(input.email ?? "").trim();
  if (email && !validEmail(email)) throw badRequest("That email address doesn't look valid");

  const openerNotes = String(input.openerNotes ?? "").trim();
  if (openerNotes.length > MAX_OPENER_NOTES_LENGTH) {
    throw badRequest(`Opener notes must be ${MAX_OPENER_NOTES_LENGTH} characters or fewer`);
  }

  return {
    clear: false,
    label,
    meetingAt: start.toISOString(),
    durationMin: duration,
    remindBeforeMin: remindRaw === 0 ? null : remindRaw,
    email: email ? email.toLowerCase() : null,
    openerNotes: openerNotes || null,
  };
}
