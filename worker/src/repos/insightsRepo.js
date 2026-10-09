// Best times to call, worked out from every call log (see lib/bestTimes.js). It reads all claimed leads' notes,
// so the aggregate is kept for ten minutes rather than rebuilt on every request.
import { buildBestTimes, mergeGrids, standardize, summarize } from "../lib/bestTimes.js";
import sheetBaseline from "../data/bestTimesBaseline.js";

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

const total = (grid) => (grid ? grid.flat().reduce((t, c) => t + c[0], 0) : 0);

// The team's best times: the calls logged here, plus the counts from the earlier calling sheet (see scripts/buildBestTimesBaseline.mjs),
// which is a lot more history than the app has gathered so far. "Mine" adds the sheet's calls for the rep with the same first name.
export async function getBestTimes(supabase, session, now = Date.now(), baseline = sheetBaseline) {
  if (!cache || now - cache.at > CACHE_MS) cache = { at: now, built: buildBestTimes(await loadEntries(supabase)) };
  const { sample, team, byName } = cache.built;
  const first = (name) => String(name || "").trim().toLowerCase().split(/\s+/)[0];
  const sheetMine = baseline && baseline.byOwner ? baseline.byOwner[first(session.displayName)] : null;
  const live = byName.get(session.displayName);
  const mine = mergeGrids(live, sheetMine);
  // Each rep's calls (the sheet's and the ones logged here, matched on first name) so the team view can allow for how each logs results.
  const reps = new Map();
  for (const [name, grid] of byName) reps.set(first(name), mergeGrids(reps.get(first(name)), grid));
  if (baseline && baseline.byOwner) for (const [name, grid] of Object.entries(baseline.byOwner)) reps.set(name, mergeGrids(reps.get(name), grid));
  const teamGrid = reps.size ? standardize(reps) : mergeGrids(team, baseline ? baseline.grid : null);
  return {
    sample: sample + (baseline ? baseline.counted : 0),
    sources: { live: sample, sheet: baseline ? baseline.counted : 0, mineLive: total(live), mineSheet: total(sheetMine), sheetBuiltAt: baseline ? baseline.builtAt : "" },
    team: summarize(teamGrid),
    mine: mine ? summarize(mine) : null,
    updatedAt: new Date(cache.at).toISOString(),
  };
}

// For tests: forget what was kept.
export function clearBestTimesCache() { cache = null; }
