// The phone system's call log (sql/053): cleaning imported rows, deciding whether a call was answered, and
// summarising calls for the insights page and a lead's pickup history. Pure, so it is tested without a database.
import { nationalNumber } from "./badNumbers.js";

export const MAX_IMPORT_ROWS = 1000; // per request; the browser sends a big file in chunks
export const ANSWERED_SECONDS = 15; // a call this long reached a person, when the disposition does not say

const ANSWERED = /\b(answer(ed)?|connected|spoke|conversation|talk(ed)?|completed|human)\b/i;
const MISSED = /(voice ?mail|no.?answer|not.?answered|unanswered|busy|failed|abandon|cancel|rejected|missed)/i;

// 95, "95", "1:35" or "00:01:35" -> seconds; anything else -> null.
export function parseDuration(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text));
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(text);
  if (!m) return null;
  return (Number(m[1] || 0) * 3600) + (Number(m[2]) * 60) + Number(m[3]);
}

// A disposition that says how it ended wins; otherwise a call that lasted long enough reached someone.
export function isAnswered({ durationSec, disposition } = {}) {
  const d = String(disposition || "");
  if (MISSED.test(d)) return false;
  if (ANSWERED.test(d)) return true;
  return Number(durationSec) >= ANSWERED_SECONDS;
}

// "2026-10-07 19:40:12", "2026-10-07T19:40Z" or "10/7/2026 7:40 PM" -> milliseconds, or NaN. A time with no zone is
// read as UTC (the phone system's export), so the answer never depends on where the code runs.
export function parseWhen(value) {
  const text = String(value ?? "").trim();
  if (!text) return NaN;
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(text);
  if (m) {
    if (m[7]) return Date.parse(text.replace(" ", "T"));
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?)?$/i.exec(text);
  if (m) {
    let hour = Number(m[4] || 0);
    if (m[7]) hour = (hour % 12) + (m[7].toUpperCase() === "PM" ? 12 : 0);
    return Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), hour, Number(m[5] || 0), Number(m[6] || 0));
  }
  return Date.parse(text);
}

// One raw row from the browser -> { row } ready to store, or { skip: "why" }.
export function toCallRow(raw = {}, now = Date.now()) {
  const phone = nationalNumber(raw.phone);
  if (!phone) return { skip: "no valid phone number" };
  const at = parseWhen(raw.calledAt);
  if (!at || Number.isNaN(at)) return { skip: "no valid date" };
  if (at > now + 86_400_000 || at < Date.parse("2015-01-01")) return { skip: "date out of range" };
  const durationSec = parseDuration(raw.durationSec);
  return {
    row: {
      called_at: new Date(at).toISOString(),
      agent: String(raw.agent ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
      phone,
      duration_sec: durationSec !== null && durationSec >= 0 && durationSec <= 86400 ? durationSec : null,
      disposition: String(raw.disposition ?? "").replace(/\s+/g, " ").trim().slice(0, 40) || null,
    },
  };
}

// Many raw rows -> { rows (deduplicated), skipped: { reason: count }, duplicates }.
export function cleanCallRows(rawRows, now = Date.now()) {
  const rows = [];
  const seen = new Set();
  const skipped = {};
  let duplicates = 0;
  for (const raw of (rawRows || []).slice(0, MAX_IMPORT_ROWS)) {
    const out = toCallRow(raw, now);
    if (out.skip) { skipped[out.skip] = (skipped[out.skip] || 0) + 1; continue; }
    const key = `${out.row.agent}|${out.row.phone}|${out.row.called_at}`;
    if (seen.has(key)) { duplicates += 1; continue; }
    seen.add(key);
    rows.push(out.row);
  }
  return { rows, skipped, duplicates };
}

// Every 10-digit number a company can be reached on: its main line, its contacts and its branches.
export function phonesFor(company) {
  const list = [company && company.phone, ...((company && company.decisionMakers) || []).map((d) => d && d.phone), ...((company && company.locations) || []).map((l) => l && l.phone)];
  return [...new Set(list.map((p) => nationalNumber(p)).filter(Boolean))];
}

// calls: [{ phone, duration_sec, disposition }] -> Map phone -> { total, answered }
export function tallyByPhone(calls) {
  const out = new Map();
  for (const c of calls || []) {
    const entry = out.get(c.phone) || { total: 0, answered: 0 };
    entry.total += 1;
    if (isAnswered({ durationSec: c.duration_sec, disposition: c.disposition })) entry.answered += 1;
    out.set(c.phone, entry);
  }
  return out;
}

// Insights: the phone system's calls in the period. rows: [{ called_at, agent, duration_sec, disposition }]
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function summarizeCallRecords(rows) {
  const list = rows || [];
  if (!list.length) return null;
  const byAgent = new Map();
  const byDay = DAYS.map((day) => ({ day, calls: 0, answered: 0 }));
  let answeredTotal = 0;
  let talkSec = 0;
  for (const r of list) {
    const answered = isAnswered({ durationSec: r.duration_sec, disposition: r.disposition });
    if (answered) answeredTotal += 1;
    if (answered && Number(r.duration_sec) > 0) talkSec += Number(r.duration_sec);
    const agent = String(r.agent || "").trim() || "Unknown";
    const a = byAgent.get(agent) || { agent, calls: 0, answered: 0 };
    a.calls += 1;
    if (answered) a.answered += 1;
    byAgent.set(agent, a);
    const d = byDay[new Date(r.called_at).getUTCDay()];
    d.calls += 1;
    if (answered) d.answered += 1;
  }
  return {
    calls: list.length,
    answered: answeredTotal,
    rate: answeredTotal / list.length,
    talkMinutes: Math.round(talkSec / 60),
    agents: [...byAgent.values()].sort((a, b) => b.calls - a.calls || a.agent.localeCompare(b.agent)).slice(0, 8),
    weekdays: [1, 2, 3, 4, 5, 6, 0].map((i) => byDay[i]),
  };
}
