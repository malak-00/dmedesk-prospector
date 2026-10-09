// Best times to call, worked out from every call log (see lib/bestTimes.js). It reads all claimed leads' notes,
// so the aggregate is kept for ten minutes rather than rebuilt on every request.
import { buildBestTimes, summarize } from "../lib/bestTimes.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const CACHE_MS = 10 * 60 * 1000;
const PAGE = 1000;
const MAX_PAGES = 100;
let cache = null; // { at, built }

async function loadEntries(supabase) {
  const out = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await supabase
      .from("leads")
      .select("state, notes")
      .not("claimed_by", "is", null)
      .not("notes", "is", null)
      .order("npi", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw httpError(500, "Failed to read call logs: " + error.message);
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export async function getBestTimes(supabase, session, now = Date.now()) {
  if (!cache || now - cache.at > CACHE_MS) cache = { at: now, built: buildBestTimes(await loadEntries(supabase)) };
  const { sample, team, byName } = cache.built;
  const mine = byName.get(session.displayName);
  return { sample, team: summarize(team), mine: mine ? summarize(mine) : null, updatedAt: new Date(cache.at).toISOString() };
}

// For tests: forget what was kept.
export function clearBestTimesCache() { cache = null; }
