// Claimed leads nobody has touched for a while, for the admin "Stale leads" hand-back. Pure, so it is tested without a database.
// Stale means what it means on a rep's Today screen (leadView.isStale): quiet for N days, no meeting or callback coming up,
// and not already won, lost or refused.
import { isStale, lastActivityMs } from "./leadView.js";

export const MIN_DAYS = 14;
export const MAX_DAYS = 365;
export const DEFAULT_DAYS = 30;
export const LIST_CAP = 400;
export const HAND_BACK_CAP = 200;

export function cleanDays(raw) {
  const n = Math.round(Number(raw));
  return Number.isFinite(n) ? Math.min(Math.max(n, MIN_DAYS), MAX_DAYS) : DEFAULT_DAYS;
}

// rows: leads rows (claimed, not disconnected); names: Map user id -> display name.
export function buildStaleList(rows, names = new Map(), nowMs = Date.now(), days = DEFAULT_DAYS) {
  const DAY = 86_400_000;
  const items = [];
  for (const row of rows || []) {
    if (!row.claimed_by || row.is_disconnected) continue;
    const lead = {
      status: row.status,
      meetingAt: row.meeting_at,
      meetingDurationMin: row.meeting_duration_min,
      reminderAt: row.reminder_at,
      lastUpdated: row.status_updated_at || row.claimed_at,
      claimedAt: row.claimed_at,
      notes: row.notes,
    };
    if (!isStale(lead, nowMs, days)) continue;
    const last = lastActivityMs(lead);
    items.push({
      npi: String(row.npi),
      name: row.company_name || "",
      state: row.state || "",
      specialty: row.specialty || "",
      status: row.status || "new",
      repId: row.claimed_by,
      rep: names.get(row.claimed_by) || "Removed user",
      claimedAt: row.claimed_at || "",
      lastActivity: new Date(last).toISOString(),
      quietDays: Math.floor((nowMs - last) / DAY),
    });
  }
  items.sort((a, b) => b.quietDays - a.quietDays || a.name.localeCompare(b.name));
  const byRep = new Map();
  items.forEach((i) => byRep.set(i.repId, { repId: i.repId, rep: i.rep, count: (byRep.get(i.repId)?.count || 0) + 1 }));
  return {
    days,
    total: items.length,
    reps: [...byRep.values()].sort((a, b) => b.count - a.count || a.rep.localeCompare(b.rep)),
    items: items.slice(0, LIST_CAP),
  };
}

// Of the NPIs an admin ticked, the ones that are still stale right now, grouped by owner (a lead that someone
// worked since the list was loaded is left alone).
export function pickHandBack(rows, npis, names, nowMs, days) {
  const wanted = new Set((npis || []).map(String));
  const stale = buildStaleList(rows.filter((r) => wanted.has(String(r.npi))), names, nowMs, days).items;
  const byOwner = new Map();
  for (const item of stale) {
    if (!byOwner.has(item.repId)) byOwner.set(item.repId, []);
    byOwner.get(item.repId).push(item.npi);
  }
  return { byOwner, kept: wanted.size - stale.length };
}
