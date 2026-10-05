// Turns what the database already records into a per-rep activity summary for
// the Admin "Team activity" view. No I/O here, so it is unit tested on its own.
//
// Sources:
//   * claims         lead_ownership_events rows with event_type = 'claimed'
//   * calls / notes  the dated lines of each lead's call log (leads.notes), which
//                    leadsRepo.addLeadNote writes as
//                    "YYYY-MM-DD HH:mm — <display name>: <text>"
//   * meetings       call-log lines the app writes itself ("Meeting booked ...",
//                    "Meeting held ...", "Meeting no-show", "Meeting cancelled")
//   * right now      each rep's open leads, overdue callbacks and upcoming meetings
//
// Call-log lines are the only record of a logged call, so a rep who deletes or
// rewrites a note changes their own history; that is acceptable for a
// leaderboard, and the view says what it counts.

const LINE = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?: — (.+?))?: (.*)$/;

export function parseNoteLines(notes) {
  return String(notes || "")
    .split("\n")
    .map((line) => LINE.exec(line.trim()))
    .filter(Boolean)
    .map((m) => ({ date: m[1], time: m[2], by: m[3] || "", text: m[4] || "" }));
}

// What kind of call-log line is this?
export function noteKind(text) {
  const t = String(text || "").trim();
  if (/^Meeting booked/i.test(t)) return "booked";
  if (/^Meeting held/i.test(t)) return "held";
  if (/^Meeting no-show/i.test(t)) return "noShow";
  if (/^Meeting cancelled/i.test(t)) return "cancelled";
  return "call";
}

const DAY_MS = 86_400_000;

// Monday (UTC) of the week containing `date`, as YYYY-MM-DD.
export function weekStartOf(date) {
  const d = new Date(typeof date === "string" ? `${date}T00:00:00Z` : date.getTime());
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - sinceMonday)).toISOString().slice(0, 10);
}

export function weekStartsEndingAt(now, weeks) {
  const current = new Date(`${weekStartOf(now)}T00:00:00Z`).getTime();
  return Array.from({ length: weeks }, (_, i) => new Date(current - (weeks - 1 - i) * 7 * DAY_MS).toISOString().slice(0, 10));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const labelOf = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;

const zeros = (n) => Array.from({ length: n }, () => 0);

export function buildTeamActivity({ users = [], events = [], leads = [], weeks = 8, now = new Date() } = {}) {
  const starts = weekStartsEndingAt(now, weeks);
  const indexOfWeek = new Map(starts.map((s, i) => [s, i]));
  const nowMs = now.getTime();

  const reps = new Map();
  const byName = new Map();
  const blank = (id, name, isAdmin) => ({
    id, name, isAdmin: Boolean(isAdmin),
    claims: zeros(weeks), calls: zeros(weeks), meetingsBooked: zeros(weeks), meetingsHeld: zeros(weeks), noShows: zeros(weeks),
    openLeads: 0, overdue: 0, upcomingMeetings: 0,
  });
  for (const u of users) {
    const rep = blank(u.id, u.display_name || u.username || "Unknown", u.is_admin);
    reps.set(u.id, rep);
    if (u.display_name) byName.set(String(u.display_name).trim().toLowerCase(), rep);
  }
  const other = blank("other", "Other / removed users", false);

  const bump = (rep, field, dateStr) => {
    const w = indexOfWeek.get(weekStartOf(dateStr));
    if (w !== undefined) rep[field][w] += 1;
  };

  for (const e of events) {
    if (e.event_type && e.event_type !== "claimed") continue;
    if (!e.to_user_id || !e.created_at) continue;
    bump(reps.get(e.to_user_id) || other, "claims", String(e.created_at).slice(0, 10));
  }

  for (const lead of leads) {
    if (lead.claimed_by && !lead.is_disconnected) {
      const owner = reps.get(lead.claimed_by);
      if (owner) {
        owner.openLeads += 1;
        if (lead.reminder_at && Date.parse(lead.reminder_at) < nowMs) owner.overdue += 1;
        if (lead.meeting_at && Date.parse(lead.meeting_at) >= nowMs) owner.upcomingMeetings += 1;
      }
    }
    for (const line of parseNoteLines(lead.notes)) {
      const rep = byName.get(line.by.trim().toLowerCase()) || other;
      const kind = noteKind(line.text);
      if (kind === "call") bump(rep, "calls", line.date);
      else if (kind === "booked") bump(rep, "meetingsBooked", line.date);
      else if (kind === "held") bump(rep, "meetingsHeld", line.date);
      else if (kind === "noShow") bump(rep, "noShows", line.date);
    }
  }

  const sum = (list) => list.reduce((a, b) => a + b, 0);
  const activity = (r) => sum(r.claims) + sum(r.calls) + sum(r.meetingsBooked) + sum(r.meetingsHeld);
  const people = [...reps.values(), other].filter((r) => r.id !== "other" || activity(r) > 0);
  people.sort((a, b) => activity(b) - activity(a) || b.openLeads - a.openLeads || a.name.localeCompare(b.name));

  const column = (field) => starts.map((_, i) => people.reduce((total, r) => total + r[field][i], 0));
  return {
    weeks: starts.map((start) => ({ start, label: labelOf(start) })),
    reps: people,
    totals: { claims: column("claims"), calls: column("calls"), meetingsBooked: column("meetingsBooked"), meetingsHeld: column("meetingsHeld") },
    generatedAt: new Date(nowMs).toISOString(),
  };
}
