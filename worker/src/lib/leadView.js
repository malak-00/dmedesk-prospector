// What the Claimed table and the Today screen ask the server for, instead of loading every
// claimed lead into the browser. Pure (no database), so it is tested on its own.
//
//   parseListParams   the query string of GET /leads/page -> a safe, clamped description
//   buildTodayView    the lists, numbers and nudges of the Today screen from a rep's leads
import { noteKind, parseNoteLines } from "./teamActivity.js";

const DAY = 86_400_000;

/* ---------------- paging and filtering ---------------- */

export const PAGE_SIZES = { min: 10, max: 200, default: 50 };

// Column(s) each sort key orders by, and which way it goes first. `updated` is "last touched": the
// status stamp, falling back to when it was claimed.
export const SORTS = {
  company: { columns: ["company_name"], firstDir: "asc" },
  location: { columns: ["state", "city"], firstDir: "asc" },
  status: { columns: ["status"], firstDir: "asc" },
  reminder: { columns: ["reminder_at"], firstDir: "asc", nullsLast: true },
  updated: { columns: ["status_updated_at", "claimed_at"], firstDir: "desc", nullsLast: true },
};

const clampInt = (value, min, max, fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
};

// Wildcards and the characters that carry meaning inside a PostgREST `or(...)` filter must not
// come from the search box.
export function cleanSearchTerm(raw) {
  return String(raw ?? "").replace(/[%_,()*\\"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

export function parseListParams(query = {}, nowMs = Date.now()) {
  const sortKey = Object.prototype.hasOwnProperty.call(SORTS, query.sort) ? query.sort : "";
  const dir = String(query.dir || "").toLowerCase() === "desc" ? "desc" : String(query.dir || "").toLowerCase() === "asc" ? "asc" : "";
  const endOfDay = Date.parse(query.endOfDay);
  return {
    page: clampInt(query.page, 1, 100000, 1),
    pageSize: clampInt(query.pageSize, PAGE_SIZES.min, PAGE_SIZES.max, PAGE_SIZES.default),
    status: String(query.status ?? "").trim().slice(0, 60),
    term: cleanSearchTerm(query.q),
    overdueOnly: query.overdue === "1" || query.overdue === "true",
    states: String(query.states ?? "").split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s)).slice(0, 60),
    sortKey,
    dir: sortKey ? (dir || SORTS[sortKey].firstDir) : "",
    // "Due by the end of today" is the rep's day, not the server's.
    endOfDayMs: Number.isFinite(endOfDay) ? endOfDay : nowMs + DAY,
    nowMs,
  };
}

/* ---------------- the Today screen ---------------- */

const TERMINAL = /not interested|do not call|disconnected|onboard|closed|lost|\bwon\b|signed|customer/i;
const isNew = (l) => !l.status || String(l.status).toLowerCase() === "new";
const t = (iso) => Date.parse(iso) || 0;
const meetingEnd = (l) => t(l.meetingAt) + (Number(l.meetingDurationMin) || 30) * 60000;

// The most recent thing that happened on a lead: its status stamp, claim, or newest call-log line.
export function lastActivityMs(lead) {
  let latest = Math.max(t(lead.lastUpdated), t(lead.claimedAt));
  for (const line of parseNoteLines(lead.notes)) {
    const at = Date.parse(`${line.date}T${line.time}:00Z`);
    if (at > latest) latest = at;
  }
  return latest;
}

// Quiet for `staleDays`, nothing coming up, and not already won, lost or refused.
export function isStale(lead, nowMs, staleDays) {
  if (TERMINAL.test(String(lead.status || ""))) return false;
  if (lead.meetingAt && meetingEnd(lead) >= nowMs) return false;
  if (lead.reminderAt && t(lead.reminderAt) > nowMs) return false;
  const last = lastActivityMs(lead);
  return last > 0 && nowMs - last >= staleDays * DAY;
}

function streakOf(days, todayIdx) {
  let day = days.has(todayIdx) ? todayIdx : todayIdx - 1; // not lost before the first call of the day
  let n = 0;
  while (days.has(day)) { n += 1; day -= 1; }
  return n;
}

const CAPS = { review: 50, meetingsToday: 50, callbacks: 100, firstCalls: 100, stale: 50, upNext: 6 };

// leads: the rep's active claimed leads as the app shows them (see leadsRepo.toLeadDTO).
// opts: nowMs, startOfDayMs, endOfDayMs, startOfWeekMs (the rep's own day and week),
//       tzOffsetMin (Date.getTimezoneOffset() of the rep's browser), staleDays, me (display name).
export function buildTodayView(leads, opts) {
  const { nowMs, endOfDayMs, startOfDayMs, startOfWeekMs, tzOffsetMin = 0, staleDays = 14, me = "" } = opts;
  const meLower = String(me).trim().toLowerCase();
  const pastMeeting = (l) => l.meetingAt && meetingEnd(l) < nowMs;

  const review = leads.filter(pastMeeting).sort((a, b) => t(a.meetingAt) - t(b.meetingAt));
  const reviewing = new Set(review.map((l) => l.npi));
  const meetingsToday = leads.filter((l) => l.meetingAt && !pastMeeting(l) && t(l.meetingAt) <= endOfDayMs).sort((a, b) => t(a.meetingAt) - t(b.meetingAt));
  const callbacks = leads.filter((l) => l.reminderAt && t(l.reminderAt) <= endOfDayMs && !reviewing.has(l.npi)).sort((a, b) => t(a.reminderAt) - t(b.reminderAt));
  const queued = new Set(callbacks.map((l) => l.npi));
  const firstCalls = leads.filter((l) => isNew(l) && !String(l.notes || "").trim() && !l.meetingAt && !queued.has(l.npi));
  const stale = leads
    .filter((l) => isStale(l, nowMs, staleDays) && !queued.has(l.npi) && !reviewing.has(l.npi))
    .map((l) => ({ lead: l, last: lastActivityMs(l) }))
    .sort((a, b) => a.last - b.last);
  const nextMeeting = leads.filter((l) => l.meetingAt && !pastMeeting(l) && t(l.meetingAt) > endOfDayMs).sort((a, b) => t(a.meetingAt) - t(b.meetingAt))[0] || null;

  // The rep's own call-log lines (lines with no name are older ones and count as theirs).
  const lines = [];
  for (const lead of leads) {
    for (const line of parseNoteLines(lead.notes)) {
      if (line.by && meLower && line.by.trim().toLowerCase() !== meLower) continue;
      lines.push({ at: Date.parse(`${line.date}T${line.time}:00Z`), text: line.text, kind: noteKind(line.text), npi: lead.npi, name: lead.name });
    }
  }
  lines.sort((a, b) => b.at - a.at);
  const calls = lines.filter((l) => l.kind === "call");
  const localDay = (ms) => Math.floor((ms - tzOffsetMin * 60000) / DAY);
  const days = new Set(calls.map((l) => localDay(l.at)));

  const tally = new Map();
  leads.forEach((l) => { const k = isNew(l) ? "new" : String(l.status).toLowerCase(); tally.set(k, (tally.get(k) || 0) + 1); });

  const ahead = [];
  for (const l of leads) {
    if (l.meetingAt && !pastMeeting(l) && t(l.meetingAt) > endOfDayMs && t(l.meetingAt) <= endOfDayMs + 7 * DAY) ahead.push({ npi: l.npi, name: l.name, at: l.meetingAt, kind: "Meeting" });
    if (l.reminderAt && t(l.reminderAt) > endOfDayMs && t(l.reminderAt) <= endOfDayMs + 7 * DAY) ahead.push({ npi: l.npi, name: l.name, at: l.reminderAt, kind: "Callback" });
  }
  ahead.sort((a, b) => t(a.at) - t(b.at));

  const cap = (list, n) => list.slice(0, n);
  return {
    totals: { claimed: leads.length, touched: leads.filter((l) => !isNew(l) || String(l.notes || "").trim()).length },
    review: cap(review, CAPS.review),
    meetingsToday: cap(meetingsToday, CAPS.meetingsToday),
    callbacks: cap(callbacks, CAPS.callbacks),
    callbacksTotal: callbacks.length,
    firstCalls: { total: firstCalls.length, items: cap(firstCalls, CAPS.firstCalls) },
    stale: { total: stale.length, days: staleDays, items: cap(stale.map((s) => ({ ...s.lead, quietDays: Math.floor((nowMs - s.last) / DAY) })), CAPS.stale) },
    nextMeeting,
    stats: {
      callsToday: calls.filter((l) => l.at >= startOfDayMs).length,
      callsWeek: calls.filter((l) => l.at >= startOfWeekMs).length,
      heldWeek: lines.filter((l) => l.kind === "held" && l.at >= startOfWeekMs).length,
      streak: streakOf(days, localDay(nowMs)),
    },
    pipeline: [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([status, count]) => ({ status, count })),
    comingUp: cap(ahead, CAPS.upNext),
    recent: cap(lines, CAPS.upNext).map((l) => ({ at: new Date(l.at).toISOString(), text: l.text, npi: l.npi, name: l.name })),
    generatedAt: new Date(nowMs).toISOString(),
  };
}
