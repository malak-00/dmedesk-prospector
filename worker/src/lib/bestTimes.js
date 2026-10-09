// When do calls get answered? From the call logs the team already writes, count how often a logged call reached a
// person, by the lead's own local weekday and hour. Pure, so it is tested without a database.
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
export const FIRST_HOUR = 8; // 8 AM local to the lead
export const LAST_HOUR = 16; // the 4 PM hour is the last one before 5 PM
export const HOURS = Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => FIRST_HOUR + i);
export const MIN_CELL = 4; // fewer logged calls than this in one slot is too few to call "best"
export const RANK_MIN = 10; // a slot needs at least this many calls to be named one of the best

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
// grid[day][hour] = [calls, answered], with the weekday and hour local to the lead.
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
      const { weekday, hour } = localParts(tz, Date.parse(`${line.date}T${line.time}:00Z`));
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

// The lowest answer rate the data still supports (the lower end of a 95% Wilson interval). A slot with 80 calls at 60% beats
// one with 5 calls at 80%, which is how the best times are ranked.
export function wilsonLower(calls, answered, z = 1.96) {
  if (!calls) return 0;
  const p = answered / calls;
  const z2 = z * z;
  return (p + z2 / (2 * calls) - z * Math.sqrt((p * (1 - p) + z2 / (4 * calls)) / calls)) / (1 + z2 / calls);
}

// People log results differently: one rep writes "pharmacy" or "not qualified" whenever someone picks up, another writes only
// "voicemail" or "no answer". If those reps also call at different hours, raw percentages would show their styles, not the hours.
// This corrects for it: each hour is compared with what the reps who called then would be expected to get from their own
// overall rate, and that comparison is applied to the team's overall rate. repGrids: Map(rep -> grid). A rep with fewer than
// `minRepCalls` calls is treated as an average rep (nothing to correct). Cells are [calls, answered], answered may be fractional.
export function standardize(repGrids, minRepCalls = 40) {
  const grids = [...repGrids.values()];
  if (!grids.length) return null;
  const sum = (grid, k) => grid.flat().reduce((t, c) => t + c[k], 0);
  const calls = grids.reduce((t, g) => t + sum(g, 0), 0);
  const pooled = calls ? grids.reduce((t, g) => t + sum(g, 1), 0) / calls : 0;
  const rates = grids.map((g) => { const n = sum(g, 0); return n >= minRepCalls ? sum(g, 1) / n : pooled; });
  return grids[0].map((row, d) => row.map((_, h) => {
    let n = 0; let observed = 0; let expected = 0;
    grids.forEach((g, i) => { const [c, a] = g[d][h]; n += c; observed += a; expected += c * rates[i]; });
    if (!n) return [0, 0];
    const lift = expected > 0 ? observed / expected : 1;
    return [n, Math.min(1, pooled * lift) * n];
  }));
}

// Two grids added together (cells are [calls, answered]); either may be missing.
export function mergeGrids(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return a.map((row, d) => row.map(([n, x], h) => [n + (b[d]?.[h]?.[0] || 0), x + (b[d]?.[h]?.[1] || 0)]));
}

// What to show for one grid: the cells, the best three slots, and each day's and hour's overall rate.
export function summarize(grid) {
  const cells = [];
  let calls = 0;
  let answered = 0;
  grid.forEach((row, d) => row.forEach(([n, a], h) => {
    calls += n; answered += a;
    if (n >= RANK_MIN) cells.push({ day: DAYS[d], hour: HOURS[h], calls: n, answered: a, rate: a / n, sure: wilsonLower(n, a) });
  }));
  cells.sort((x, y) => y.sure - x.sure || y.calls - x.calls);
  const sum = (items) => items.reduce((t, [n, a]) => [t[0] + n, t[1] + a], [0, 0]);
  const byDay = grid.map((row, d) => { const [n, a] = sum(row); return { day: DAYS[d], calls: n, answered: a, rate: n ? a / n : null }; });
  const byHour = HOURS.map((hour, h) => { const [n, a] = sum(grid.map((row) => row[h])); return { hour, calls: n, answered: a, rate: n ? a / n : null }; });
  // The best whole hour and the best whole day, when there are enough calls to say (at least 30), by the same standard.
  const top = (list) => list.filter((x) => x.calls >= 30).sort((x, y) => wilsonLower(y.calls, y.answered) - wilsonLower(x.calls, x.answered))[0] || null;
  return { cells: grid, calls, answered, rate: calls ? answered / calls : null, best: cells.slice(0, 3), byDay, byHour, bestHour: top(byHour), bestDay: top(byDay) };
}
