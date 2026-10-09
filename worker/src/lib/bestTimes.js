// When do calls get answered? From the call logs the team already writes, count how often a logged call reached a
// person, by weekday and hour in Cairo time (the team's clock), counting only calls made inside the lead's own business hours. Pure, so it is tested without a database.
//
// A call-log line looks like "2026-10-07 19:40 — Ana: voicemail — left a message" (the time is UTC). The first
// part of the text, before the dash, is the result the rep picked. "Answered" means a person picked up: any result
// except voicemail and no answer. Results that say nothing about it ("called", plain notes) are left out.
import { cleanStatus, normalizeStatus } from "./statuses.js";
import { noteKind, parseNoteLines } from "./teamActivity.js";

const ZONES = {
  "America/New_York": "CT DE DC FL GA IN KY MA MD ME MI NC NH NJ NY OH PA RI SC VA VT WV",
  "America/Chicago": "AL AR IA IL KS LA MN MO MS ND NE OK SD TN TX WI",
  "America/Denver": "CO ID MT NM UT WY",
  "America/Phoenix": "AZ",
  "America/Los_Angeles": "CA NV OR WA",
  "America/Anchorage": "AK",
  "Pacific/Honolulu": "HI",
  "America/Puerto_Rico": "PR VI",
  "Pacific/Guam": "GU",
};
export const STATE_TO_TZ = {};
Object.entries(ZONES).forEach(([zone, list]) => list.split(" ").forEach((s) => { STATE_TO_TZ[s] = zone; }));

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
export const CAIRO = "Africa/Cairo";
export const LEAD_FIRST_HOUR = 8; // calls count when it is 8 AM to 5 PM where the lead is
export const LEAD_LAST_HOUR = 16;
export const FIRST_HOUR = 14; // the grid's hours are Cairo time: 2 PM ...
export const LAST_HOUR = 23; // ... to the 11 PM hour (the team's shift is 3:30 PM to 11:30 PM)
export const HOURS = Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => FIRST_HOUR + i);
export const MIN_CELL = 4; // fewer logged calls than this in one slot is too few to call "best"

const NO_CONTACT = new Set(["voicemail", "no answer"]);
const SAYS_NOTHING = new Set(["called", "new", ""]);

// "answered" | "missed" | null (the line says nothing about whether anyone picked up)
export function classifyResult(text) {
  const first = String(text || "").split(/\s+[—–-]\s+/)[0];
  const status = cleanStatus(normalizeStatus(first)); // "VM" and "voice mail" are voicemail
  if (SAYS_NOTHING.has(status)) return null;
  if (NO_CONTACT.has(status)) return "missed";
  // A free-text note ("Spoke to the owner, send info") is not a result chip; only count known results.
  return KNOWN_ANSWERED.has(status) ? "answered" : null;
}

const KNOWN_ANSWERED = new Set([
  "gatekeeper", "callback", "interested", "follow up", "not interested", "do not call",
  "meeting booked", "meeting held", "contract sent", "invoice sent", "onboarded",
]);

const formatters = new Map();
function localParts(timeZone, ms) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", hourCycle: "h23" }));
  }
  const out = {};
  formatters.get(timeZone).formatToParts(new Date(ms)).forEach((p) => { out[p.type] = p.value; });
  return { weekday: out.weekday, hour: Number(out.hour) };
}

const emptyGrid = () => DAYS.map(() => HOURS.map(() => [0, 0]));

// entries: [{ state, notes }] (one per lead). Returns { sample, team, byName } where each grid is
// grid[day][hour] = [calls, answered], with the weekday and hour in Cairo time.
export function buildBestTimes(entries) {
  const team = emptyGrid();
  const byName = new Map();
  let sample = 0;
  for (const { state, notes } of entries || []) {
    const tz = STATE_TO_TZ[String(state || "").trim().toUpperCase()];
    if (!tz || !notes) continue;
    for (const line of parseNoteLines(notes)) {
      if (noteKind(line.text) !== "call") continue;
      const verdict = classifyResult(line.text);
      if (!verdict) continue;
      const ms = Date.parse(`${line.date}T${line.time}:00Z`);
      const lead = localParts(tz, ms).hour;
      if (lead < LEAD_FIRST_HOUR || lead > LEAD_LAST_HOUR) continue;
      const { weekday, hour } = localParts(CAIRO, ms);
      const d = DAYS.indexOf(weekday);
      const h = hour - FIRST_HOUR;
      if (d < 0 || h < 0 || h >= HOURS.length) continue;
      const cells = [team];
      if (line.by) {
        if (!byName.has(line.by)) byName.set(line.by, emptyGrid());
        cells.push(byName.get(line.by));
      }
      for (const grid of cells) {
        grid[d][h][0] += 1;
        if (verdict === "answered") grid[d][h][1] += 1;
      }
      sample += 1;
    }
  }
  return { sample, team, byName };
}

// A smoothed answer rate, so one lucky call in a slot is not read as 100%.
export const smoothed = (calls, answered) => (answered + 1) / (calls + 2);

// What to show for one grid: the cells, the best three slots, and each day's and hour's overall rate.
export function summarize(grid) {
  const cells = [];
  let calls = 0;
  let answered = 0;
  grid.forEach((row, d) => row.forEach(([n, a], h) => {
    calls += n; answered += a;
    if (n >= MIN_CELL) cells.push({ day: DAYS[d], hour: HOURS[h], calls: n, answered: a, rate: smoothed(n, a) });
  }));
  cells.sort((x, y) => y.rate - x.rate || y.calls - x.calls);
  const sum = (items) => items.reduce((t, [n, a]) => [t[0] + n, t[1] + a], [0, 0]);
  const byDay = grid.map((row, d) => { const [n, a] = sum(row); return { day: DAYS[d], calls: n, answered: a, rate: n ? a / n : null }; });
  const byHour = HOURS.map((hour, h) => { const [n, a] = sum(grid.map((row) => row[h])); return { hour, calls: n, answered: a, rate: n ? a / n : null }; });
  return { cells: grid, calls, answered, rate: calls ? answered / calls : null, best: cells.slice(0, 3), byDay, byHour };
}
