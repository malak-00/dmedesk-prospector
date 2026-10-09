// The team's earlier calling sheet records, for each lead, when it was last called ("Last Called", a date and time in the
// sheet's own time zone, Cairo) and what happened ("Comments", one result per line, usually "VM 4/28" or "Pharmacy 7/6").
// This turns those into the same counts the Best times card uses: calls by the lead's own weekday and hour, and how many
// reached a person. Only totals leave this file, never a lead's name, number or comment. Pure and tested.
import { DAYS, FIRST_HOUR, HOURS, STATE_TO_TZ } from "./bestTimes.js";

export const SHEET_TIME_ZONE = "Africa/Cairo";

// "3/9/2026 21:14:06" (month/day/year, 24-hour) -> { y, m, d, h, mi, s }, or null if it is not that.
export function parseSheetTime(text) {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/.exec(String(text || "").split("\n")[0]);
  if (!m) return null;
  const [mo, d, y, h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0)];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  return { y, m: mo, d, h, mi, s };
}

const offsetFormatters = new Map();
// What the clock in `timeZone` reads at a given instant, as minutes after UTC.
function zoneOffsetMinutes(timeZone, ms) {
  if (!offsetFormatters.has(timeZone)) {
    offsetFormatters.set(timeZone, new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }));
  }
  const p = {};
  offsetFormatters.get(timeZone).formatToParts(new Date(ms)).forEach((x) => { p[x.type] = Number(x.value); });
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000) / 60000;
}

// The instant (ms since 1970) at which a wall-clock time was read in `timeZone`, daylight saving included.
export function wallClockToMs(t, timeZone = SHEET_TIME_ZONE) {
  const asUtc = Date.UTC(t.y, t.m - 1, t.d, t.h, t.mi, t.s);
  let guess = asUtc - zoneOffsetMinutes(timeZone, asUtc) * 60000;
  guess = asUtc - zoneOffsetMinutes(timeZone, guess) * 60000; // once more, in case the first guess was across a clock change
  return guess;
}

// What the last line of a comment says about whether anyone picked up:
// "answered" (a person, a receptionist, a hang-up), "missed" (voicemail, no answer, busy), or null (a bad number, a business that
// has shut, a note, or something that does not say).
export function classifySheetResult(comment) {
  const lines = String(comment || "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const text = lines[lines.length - 1].toLowerCase().replace(/[^a-z0-9.,/& -]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text || /^[\d.\-/ ]+$/.test(text)) return null; // "-", a date, a phone number, a spreadsheet serial
  if (/\b(disconnected|invalid number|wrong number|out of service|not in service|shut down|company closed|closed down|sent an email|email)\b/.test(text) || /^closed\b/.test(text)) return null;
  // Nobody spoke: voicemail in all its spellings, no answer, a busy line, a full mailbox.
  if (/\b(vm|ftvm|vmleft|vmfull|vmail|mbox|voice ?mail|no answer|no ans|busy|not answering|no pick ?up|rang out|left (a |av? )?(message|msg)|lm)\b/.test(text)
    || /\bv[ .,]*m\b/.test(text) || /^(na|n\/a)\b/.test(text) || /\blefta\b/.test(text) || /\bleft av\b/.test(text)) {
    return "missed";
  }
  // Someone picked up and talked, or hung up. Words that only say what kind of business it is ("Pharmacy", "Clinic", "Doctor Office",
  // "Not Qualified") are left out on purpose: they can be written from a website or a list without anyone answering, so they say
  // nothing about whether a call was picked up. They made the sheet look as if 53% of calls were answered; the real figure is
  // nearer a quarter.
  if (/\b(interested|ni|hung ?up|hanged up|hungup|gk|gatekeeper|cb|call ?back|ort|cgm|dme|medicare|part d|dropship|spoke|owner|manager|receptionist|operator|dnc|english|spanish|rude|not here|sounds)\b/.test(text)) return "answered";
  return null; // "dir", "directory", and anything else that does not say whether someone picked up
}

const formatters = new Map();
function localHourAndDay(timeZone, ms) {
  if (!formatters.has(timeZone)) formatters.set(timeZone, new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", hourCycle: "h23" }));
  const p = {};
  formatters.get(timeZone).formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; });
  return { weekday: p.weekday, hour: Number(p.hour) };
}

// rows: [{ state, lastCalled, comments, owner }]. Returns { rows, counted, ignored, outsideHours, grid, byOwner } where grid[day][hour] = [calls, answered],
// the weekday and hour being the lead's own local time (the same shape the live call logs are counted into).
export function buildSheetBaseline(rows) {
  const blank = () => DAYS.map(() => HOURS.map(() => [0, 0]));
  const grid = blank();
  const byOwner = {};
  let counted = 0;
  let ignored = 0;
  let outsideHours = 0;
  for (const r of rows || []) {
    const verdict = classifySheetResult(r.comments);
    const tz = STATE_TO_TZ[String(r.state || "").trim().toUpperCase()];
    const t = parseSheetTime(r.lastCalled);
    if (!verdict || !tz || !t) { ignored += 1; continue; }
    const { weekday, hour } = localHourAndDay(tz, wallClockToMs(t));
    const d = DAYS.indexOf(weekday);
    const h = hour - FIRST_HOUR;
    if (d < 0 || h < 0 || h >= HOURS.length) { outsideHours += 1; continue; }
    const owner = String(r.owner || "").trim().toLowerCase().split(/\s+/)[0];
    const grids = [grid];
    if (owner) { byOwner[owner] = byOwner[owner] || blank(); grids.push(byOwner[owner]); }
    for (const g of grids) {
      g[d][h][0] += 1;
      if (verdict === "answered") g[d][h][1] += 1;
    }
    counted += 1;
  }
  return { rows: (rows || []).length, counted, ignored, outsideHours, grid, byOwner };
}
