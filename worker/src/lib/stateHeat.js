// Territory heat map: for each state, how much the team has claimed and called there, how often a
// person picks up, and how far leads get (meeting booked, onboarded). Counted from the claimed leads'
// status, meetings and call-log lines, the same sources as the funnel. Pure, so it is tested without a database.
import { classifyResult } from "./bestTimes.js";
import { leadStages } from "./funnel.js";
import { noteKind, parseNoteLines } from "./teamActivity.js";

export const MIN_CALLS_FOR_RATE = 5; // below this a pickup rate is noise, so the map leaves the state blank

const DAY_MS = 86_400_000;

const blank = (state) => ({ state, claimed: 0, contacted: 0, booked: 0, held: 0, won: 0, calls: 0, answered: 0 });

// leads: rows with claimed_by, status, notes, meeting_at, state, is_disconnected (already without super admins).
export function buildStateHeat({ leads = [], days = 28, now = new Date() } = {}) {
  const sinceMs = now.getTime() - days * DAY_MS;
  const byState = new Map();

  for (const lead of leads) {
    if (!lead.claimed_by) continue;
    if (lead.is_disconnected || String(lead.status || "").trim().toLowerCase() === "disconnected") continue;
    const state = String(lead.state || "").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(state)) continue;
    if (!byState.has(state)) byState.set(state, blank(state));
    const row = byState.get(state);

    const stages = leadStages(lead);
    row.claimed += 1;
    if (stages.contacted) row.contacted += 1;
    if (stages.booked) row.booked += 1;
    if (stages.held) row.held += 1;
    if (stages.won) row.won += 1;

    for (const line of parseNoteLines(lead.notes)) {
      if (noteKind(line.text) !== "call") continue;
      const at = Date.parse(`${line.date}T${line.time}:00Z`);
      if (!at || at < sinceMs) continue;
      const verdict = classifyResult(line.text);
      if (!verdict) continue;
      row.calls += 1;
      if (verdict === "answered") row.answered += 1;
    }
  }

  const rate = (part, whole) => (whole > 0 ? part / whole : null);
  const states = [...byState.values()].map((r) => ({
    ...r,
    pickup: r.calls >= MIN_CALLS_FOR_RATE ? rate(r.answered, r.calls) : null,
    meeting: rate(r.booked, r.claimed),
    win: rate(r.won, r.claimed),
  })).sort((a, b) => b.claimed - a.claimed || a.state.localeCompare(b.state));

  return { days, states };
}
