// Read-only answers about a search before it is run: how many leads it holds
// and how many are left for this rep, what to loosen when it holds none, what
// the one-click quick picks would find, and where the unclaimed leads are.
// All of it comes from sql/021's functions over DME Desk's own provider table,
// so it only works when searches read from that table (NPI_SOURCE=dmedesk).
import { baseLocationCriteria, quickPickDefinitions, relaxedVariants, toFilterPayload } from "../lib/searchFilters.js";
import * as searchProgressRepo from "../repos/searchProgressRepo.js";
import * as taxonomiesRepo from "../repos/taxonomiesRepo.js";
import * as ProviderSource from "./providerSource.js";

const COUNT_CAP = 5000; // matches sql/021
const MAX_RELAXATIONS_TRIED = 8;
const SUGGESTIONS_SHOWN = 3;
const TERRITORY_STATES_SHOWN = 30;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function isMissingFunction(error) {
  return Boolean(error) && (error.code === "PGRST202" || error.code === "42883" || /Could not find the function/i.test(error.message || ""));
}

async function callRpc(supabase, name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    if (isMissingFunction(error)) throw httpError(503, "Search insights aren't installed yet. Run sql/021_search_insights.sql.");
    throw httpError(502, `${name} failed: ${error.message}`);
  }
  return data;
}

// Small per-isolate cache for answers that are the same for everyone and cost
// a full scan (the territory grid). A new deploy or a cold isolate just
// recomputes it.
const cache = new Map();
async function cached(key, ttlMs, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export async function getCapabilities(config, supabase) {
  const source = ProviderSource.resolveSource(config);
  if (source !== ProviderSource.DME_DESK) {
    return { source, advanced: false, reason: "Searches are reading from the mirror. Set NPI_SOURCE=dmedesk to turn on lead counts, quality filters and sorting." };
  }
  return cached("capabilities", 60_000, async () => {
    const { data, error } = await supabase.rpc("search_features");
    if (error) {
      return {
        source,
        advanced: false,
        reason: isMissingFunction(error) ? "Run sql/021_search_insights.sql to turn on lead counts, quality filters and sorting." : "Search insights are unavailable right now.",
      };
    }
    // Is the stored fit score fresh? (sql/023.) Absent when that file hasn't been run.
    const index = await supabase.rpc("search_score_index_status");
    const scoreIndex = !index.error && index.data ? index.data : null;
    return { source, advanced: true, version: (data && data.version) || 1, scoreIndex };
  });
}

const count = (value) => Number(value) || 0;

function shapeInsights(raw) {
  const cap = count(raw && raw.cap) || COUNT_CAP;
  const matched = count(raw && raw.matched);
  const unclaimed = count(raw && raw.unclaimed);
  const left = count(raw && raw.left);
  // All three figures come from one scan that stops at the cap, so once the
  // matches hit it the other two are "at least" figures too, not exact ones.
  const atCap = matched >= cap;
  return { matched, unclaimed, left, cap, capped: { matched: atCap, unclaimed: atCap || unclaimed >= cap, left: atCap || left >= cap } };
}

const INSIGHTS_CACHE_MS = 30_000;
const INSIGHTS_CACHE_MAX = 200;

export async function getInsights(supabase, userId, criteria) {
  // Memory of what this rep has already been shown for exactly these filters.
  const progress = userId ? await searchProgressRepo.getProgress(supabase, userId, criteria) : null;
  const seen = (progress && progress.seenNpis) || [];

  // The same question asked again within a moment (toggling a filter off and
  // on, two tabs) gets the same answer without another round of counting.
  const cacheKey = `${userId}|${seen.length}|${JSON.stringify(toFilterPayload(criteria, { collapsed: true }))}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < INSIGHTS_CACHE_MS) return hit.value;
  const value = await computeInsights(supabase, criteria, seen);
  if (cache.size >= INSIGHTS_CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(cacheKey, { at: Date.now(), value });
  return value;
}

async function computeInsights(supabase, criteria, seen) {
  const base = shapeInsights(await callRpc(supabase, "search_insights", {
    p_criteria: toFilterPayload(criteria, { collapsed: true }),
    p_seen: seen,
  }));

  // Nothing here (or nothing left for you): work out what would help.
  let suggestions = [];
  if (base.matched === 0 || base.left === 0) {
    const tried = await Promise.all(relaxedVariants(criteria).slice(0, MAX_RELAXATIONS_TRIED).map(async (variant) => {
      try {
        const raw = shapeInsights(await callRpc(supabase, "search_insights", {
          p_criteria: toFilterPayload(variant.criteria, { collapsed: true }),
          p_seen: seen,
        }));
        return { key: variant.key, label: variant.label, matched: raw.matched, unclaimed: raw.unclaimed, left: raw.left, capped: raw.capped.left };
      } catch {
        return null; // a suggestion that fails to count is simply not offered
      }
    }));
    suggestions = tried
      .filter((s) => s && s.left > 0)
      .sort((a, b) => b.left - a.left)
      .slice(0, SUGGESTIONS_SHOWN);
  }

  return { ...base, seenCount: seen.length, suggestions };
}

export async function getQuickPicks(supabase, criteria) {
  const base = baseLocationCriteria(criteria);
  const definitions = quickPickDefinitions();

  // sql/022 counts all the picks in one call. Before it is installed, fall
  // back to one call per pick, which gives the same numbers more slowly.
  const { data, error } = await supabase.rpc("search_quick_counts", {
    p_picks: definitions.map((pick) => ({ id: pick.id, criteria: toFilterPayload({ ...base, ...pick.criteria }, { collapsed: true }) })),
  });
  if (!error && Array.isArray(data)) {
    const byId = new Map(data.map((row) => [row.id, row]));
    return definitions.map((pick) => {
      const row = byId.get(pick.id);
      return { id: pick.id, label: pick.label, patch: pick.patch, unclaimed: row ? count(row.unclaimed) : null, capped: Boolean(row && row.capped) };
    });
  }
  if (error && !isMissingFunction(error)) {
    return definitions.map((pick) => ({ id: pick.id, label: pick.label, patch: pick.patch, unclaimed: null, capped: false }));
  }

  return Promise.all(definitions.map(async (pick) => {
    try {
      const raw = shapeInsights(await callRpc(supabase, "search_insights", {
        p_criteria: toFilterPayload({ ...base, ...pick.criteria }, { collapsed: true }),
        p_seen: [],
      }));
      return { id: pick.id, label: pick.label, patch: pick.patch, unclaimed: raw.unclaimed, capped: raw.capped.unclaimed };
    } catch {
      return { id: pick.id, label: pick.label, patch: pick.patch, unclaimed: null, capped: false };
    }
  }));
}

export async function getTerritory(supabase) {
  return cached("territory", 10 * 60_000, async () => {
    const specialties = (await taxonomiesRepo.listEnabled(supabase)).filter((t) => t.code);
    const codes = [...new Set(specialties.map((t) => String(t.code).trim()).filter(Boolean))];
    if (codes.length === 0) return { specialties: [], states: [], generatedAt: new Date().toISOString() };

    const rows = await callRpc(supabase, "search_territory", { p_codes: codes });
    const byState = new Map();
    for (const row of rows || []) {
      const entry = byState.get(row.state) || { state: row.state, total: 0, unclaimed: 0, cells: {} };
      entry.total += count(row.total);
      entry.unclaimed += count(row.unclaimed);
      entry.cells[row.taxonomy_code] = { total: count(row.total), unclaimed: count(row.unclaimed) };
      byState.set(row.state, entry);
    }
    const states = [...byState.values()].sort((a, b) => b.unclaimed - a.unclaimed).slice(0, TERRITORY_STATES_SHOWN);

    // Only specialties that exist somewhere in the grid, richest first.
    const totalByCode = new Map();
    states.forEach((s) => Object.entries(s.cells).forEach(([code, cell]) => totalByCode.set(code, (totalByCode.get(code) || 0) + cell.unclaimed)));
    const seenCodes = new Set();
    const columns = specialties
      .filter((t) => totalByCode.has(String(t.code).trim()) && !seenCodes.has(String(t.code).trim()) && seenCodes.add(String(t.code).trim()))
      .map((t) => ({ code: String(t.code).trim(), label: t.facilityType || t.description, description: t.description, unclaimed: totalByCode.get(String(t.code).trim()) }))
      .sort((a, b) => b.unclaimed - a.unclaimed);

    return { specialties: columns, states, generatedAt: new Date().toISOString() };
  });
}
