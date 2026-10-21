// The team's weekly goals (sql/051, team_goals). Pure helpers so the rules are tested without a database.
export const GOAL_KEYS = ["calls_week", "meetings_week"];
export const GOAL_LABELS = { calls_week: "Calls per week", meetings_week: "Meetings held per week" };

// Accepts { callsWeek, meetingsWeek } and returns { rows } (database rows to upsert) or { error }.
export function cleanGoals(input = {}) {
  const map = { callsWeek: "calls_week", meetingsWeek: "meetings_week" };
  const rows = [];
  for (const [key, goalKey] of Object.entries(map)) {
    if (!(key in input)) continue;
    const raw = String(input[key] ?? "").trim();
    if (raw === "") { rows.push({ key: goalKey, value: null }); continue; } // cleared
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 100000) return { error: `${GOAL_LABELS[goalKey]} must be a whole number from 0 to 100,000.` };
    rows.push({ key: goalKey, value: n });
  }
  return rows.length ? { rows } : { error: "Nothing to save." };
}

export function shapeGoals(rows) {
  const out = { callsWeek: null, meetingsWeek: null };
  for (const r of rows || []) {
    if (r.key === "calls_week") out.callsWeek = r.value;
    if (r.key === "meetings_week") out.meetingsWeek = r.value;
  }
  return out;
}
