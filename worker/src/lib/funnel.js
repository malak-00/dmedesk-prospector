// Where claimed leads get to: claimed -> contacted -> meeting booked -> meeting
// held -> onboarded. Counted from what is already recorded (the lead's status,
// its booked meeting and the dated lines of its call log), grouped by rep,
// specialty and state. Pure, so it is tested without a database.
//
// A lead counts at every stage it has reached or passed: an onboarded lead is
// also counted as having had a meeting and a call, even if nobody wrote that
// down, so each stage is never smaller than the next and the conversion rates
// can't go over 100%.
import { noteKind, parseNoteLines } from "./teamActivity.js";

const WON = /onboard|closed.?won|\bwon\b|signed|customer/i;
const HELD = /meeting held|contract|invoice|onboard|closed.?won|\bwon\b|signed/i; // later stages imply the meeting happened
const BOOKED = /meeting booked|booked/i;

export const STAGES = [
  { key: "claimed", label: "Claimed" },
  { key: "contacted", label: "Contacted" },
  { key: "booked", label: "Meeting booked" },
  { key: "held", label: "Meeting held" },
  { key: "won", label: "Onboarded" },
];

export function leadStages(lead) {
  const status = String(lead.status || "").trim();
  const lines = parseNoteLines(lead.notes);
  const kinds = lines.map((l) => noteKind(l.text));

  const won = WON.test(status);
  const held = won || HELD.test(status) || kinds.includes("held");
  const booked = held || Boolean(lead.meeting_at) || BOOKED.test(status) || kinds.some((k) => k === "booked" || k === "noShow");
  const contacted = booked || kinds.includes("call") || (status !== "" && status.toLowerCase() !== "new");
  return { claimed: true, contacted, booked, held, won };
}

const blank = () => ({ claimed: 0, contacted: 0, booked: 0, held: 0, won: 0 });
const add = (target, stages) => { STAGES.forEach(({ key }) => { if (stages[key]) target[key] += 1; }); };

function top(map, limit, minClaimed = 1) {
  return [...map.entries()]
    .map(([label, counts]) => ({ label, ...counts }))
    .filter((row) => row.claimed >= minClaimed)
    .sort((a, b) => b.claimed - a.claimed || a.label.localeCompare(b.label))
    .slice(0, limit);
}

// leads: rows with claimed_by, claimed_at, status, notes, meeting_at, specialty, state.
// sinceMs: only leads claimed on or after this time; 0 or null means all of them.
export function buildFunnel({ leads = [], users = [], sinceMs = 0 } = {}) {
  const names = new Map(users.map((u) => [u.id, u.display_name || u.username || "Unknown"]));
  const totals = blank();
  const byRep = new Map();
  const bySpecialty = new Map();
  const byState = new Map();

  for (const lead of leads) {
    if (!lead.claimed_by) continue; // released leads are not anyone's pipeline
    if (sinceMs && (Date.parse(lead.claimed_at) || 0) < sinceMs) continue;
    const stages = leadStages(lead);
    add(totals, stages);

    const rep = names.get(lead.claimed_by) || "Removed user";
    const specialty = String(lead.specialty || "").trim() || "Unknown specialty";
    const state = String(lead.state || "").trim().toUpperCase() || "Unknown";
    [[byRep, rep], [bySpecialty, specialty], [byState, state]].forEach(([map, key]) => {
      if (!map.has(key)) map.set(key, blank());
      add(map.get(key), stages);
    });
  }

  const stages = STAGES.map(({ key, label }, i) => ({
    key,
    label,
    count: totals[key],
    ofClaimed: totals.claimed ? totals[key] / totals.claimed : 0,
    ofPrevious: i === 0 ? 1 : (totals[STAGES[i - 1].key] ? totals[key] / totals[STAGES[i - 1].key] : 0),
  }));

  return {
    since: sinceMs ? new Date(sinceMs).toISOString() : null,
    total: totals.claimed,
    stages,
    reps: top(byRep, 50),
    specialties: top(bySpecialty, 8),
    states: top(byState, 8),
  };
}
