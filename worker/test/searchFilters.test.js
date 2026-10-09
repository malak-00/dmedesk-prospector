import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint, getProgress } from '../src/repos/searchProgressRepo.js';
import {
  baseLocationCriteria, isLookup, NO_SUCH_SPECIALTY, quickPickDefinitions, readAdvancedCriteria, relaxedVariants, toFilterPayload, usesAdvancedSearch,
} from '../src/lib/searchFilters.js';
import { getCapabilities, getInsights, getQuickPicks } from '../src/services/searchInsights.js';

const query = (params) => (name) => params[name];

test('reads only the options a request carries', () => {
  assert.deepEqual(readAdvancedCriteria(query({})), {});
  const out = readAdvancedCriteria(query({
    hasPhone: 'true', hasDecisionMaker: 'on', activeMedicare: '1', zip: ' 33-101 ', sortBy: 'MEDICARE',
    lookupText: ' Smith,  LLC % ', lookupPhone: '(954) 907-8765',
  }));
  assert.deepEqual(out, {
    hasPhone: true, hasDecisionMaker: true, activeMedicare: true, zip: '33101', sortBy: 'medicare',
    lookupText: 'Smith LLC', lookupPhone: '9549078765',
  });
});

test('rejects nonsense values, and no longer knows the old score options', () => {
  assert.deepEqual(readAdvancedCriteria(query({ hasPhone: 'false', zip: '12', sortBy: 'price', lookupPhone: '12345' })), {});
  assert.deepEqual(readAdvancedCriteria(query({ minScore: '75', sortBy: 'score' })), {}); // scoring was removed
  assert.equal(readAdvancedCriteria(query({ lookupPhone: '+1 954 907 8765' })).lookupPhone, '9549078765');
});

test('knows which searches use the extra options', () => {
  assert.equal(usesAdvancedSearch({ states: ['FL'] }), false);
  assert.equal(usesAdvancedSearch({ states: ['FL'], minMedicareClaims: 10 }), false);
  assert.equal(usesAdvancedSearch({ sortBy: 'medicare' }), true);
  assert.equal(usesAdvancedSearch({ hasPhone: true }), true);
  assert.equal(usesAdvancedSearch({ lookupText: 'acme' }), true);
  assert.equal(isLookup({ npi: '1' }), true);
  assert.equal(isLookup({ lookupPhone: '9549078765' }), true);
  assert.equal(isLookup({ states: ['FL'] }), false);
});

test('builds the database payload, collapsed or per fan-out variant', () => {
  const criteria = {
    states: ['FL', 'TX'], state: 'FL', taxonomyCodes: ['332B00000X', undefined, '333600000X'], taxonomyCode: '332B00000X',
    taxonomyDescriptions: ['DME', 'Pharmacy', 'Other'],
    city: 'Miami', nameContainsTerms: ['acme', ' '], hasPhone: true, sortBy: 'medicare', minMedicareClaims: 25,
    lastUpdatedYears: ['2025'], limit: 50, skip: 100, excludeNpis: ['1'],
  };
  const collapsed = toFilterPayload(criteria, { collapsed: true });
  assert.deepEqual(collapsed.states, ['FL', 'TX']);
  assert.deepEqual(collapsed.taxonomyCodes, ['332B00000X', '333600000X']);
  assert.equal(collapsed.minMedicareClaims, 25);
  assert.deepEqual(collapsed.nameContains, ['acme']);
  assert.equal('minScore' in collapsed, false);
  assert.equal('scoreWeights' in collapsed, false);
  assert.equal('limit' in collapsed, false);
  assert.equal('excludeNpis' in collapsed, false);

  const single = toFilterPayload(criteria);
  assert.equal(single.state, 'FL');
  assert.equal(single.taxonomyCode, '332B00000X');
  assert.equal('states' in single, false);
  assert.equal('minMedicareClaims' in toFilterPayload({ minMedicareClaims: 0 }), false);
});

test('a specialty with no code matches nothing instead of matching everything', () => {
  // Asking for a specialty we cannot resolve must not quietly drop the filter.
  const unresolved = { states: ['FL'], taxonomyDescriptions: ['Made Up Specialty'], taxonomyCodes: [undefined] };
  assert.deepEqual(toFilterPayload(unresolved, { collapsed: true }).taxonomyCodes, [NO_SUCH_SPECIALTY]);
  assert.equal(toFilterPayload({ state: 'FL', taxonomyDescription: 'Made Up' }).taxonomyCode, NO_SUCH_SPECIALTY);
  // One of two resolves: the resolved one is searched, as when each was its own query.
  assert.deepEqual(toFilterPayload({ taxonomyDescriptions: ['A', 'B'], taxonomyCodes: ['111', undefined] }, { collapsed: true }).taxonomyCodes, ['111']);
  // No specialty asked for: no specialty filter.
  assert.equal('taxonomyCodes' in toFilterPayload({ states: ['FL'] }, { collapsed: true }), false);
  assert.equal('taxonomyCode' in toFilterPayload({ state: 'FL' }), false);
});

test('suggests loosening each filter that is actually set', () => {
  assert.deepEqual(relaxedVariants({ states: ['FL'] }), []);

  const variants = relaxedVariants({ states: ['FL'], city: 'Miami', hasPhone: true, zip: '331', lastUpdatedYears: ['2025'], taxonomyCodes: ['x'] });
  assert.deepEqual(variants.map((v) => v.key), ['hasPhone', 'zip', 'lastUpdatedYears', 'city', 'taxonomy']);
  const noPhone = variants.find((v) => v.key === 'hasPhone');
  assert.equal(noPhone.criteria.hasPhone, undefined);
  assert.equal(noPhone.criteria.zip, '331'); // only the one filter is dropped
  assert.deepEqual(variants.find((v) => v.key === 'taxonomy').criteria.taxonomyCodes, []);
  assert.equal(relaxedVariants({ excludeKeywords: ['x'] }).length, 0); // a saved default is never offered for removal
});

test('quick picks and the location base they are counted on', () => {
  const picks = quickPickDefinitions(new Date('2026-10-05T12:00:00Z'));
  assert.deepEqual(picks.map((p) => p.id), ['medicare', 'reachable', 'fresh']);
  assert.equal(picks.find((p) => p.id === 'fresh').label, 'Updated in 2026');
  assert.deepEqual(picks.find((p) => p.id === 'fresh').patch.lastUpdatedYears, ['2026']);
  assert.deepEqual(Object.keys(baseLocationCriteria({ states: ['FL'], hasPhone: true, city: 'Miami' })).sort(),
    ['city', 'state', 'states', 'taxonomyCode', 'taxonomyCodes', 'taxonomyDescription', 'taxonomyDescriptions']);
});

// ---- search progress bookmarks ---------------------------------------------

test('search progress fingerprints for existing searches are unchanged', () => {
  // The literal below is what this function produced before the new options
  // existed -- including the odd "years":["undefined"] it writes when no year
  // is set. That quirk is deliberately kept: fixing it would change every
  // saved fingerprint and send everyone back to the start of their searches.
  assert.equal(
    fingerprint({ states: ['FL'], taxonomyDescriptions: ['DME'] }),
    '{"npi":"","organizationName":"","nameContains":[],"city":"","states":["fl"],"taxonomies":["dme"],"years":["undefined"],"excludeKeywords":[]}'
  );
  // A lone Medicare minimum is still the old after-the-fact filter: same bookmark as before.
  assert.equal(fingerprint({ states: ['FL'], minMedicareClaims: 50 }), fingerprint({ states: ['FL'] }));
});

test('new options and a new source give a search its own bookmark', () => {
  const plain = fingerprint({ states: ['FL'] });
  assert.notEqual(plain, fingerprint({ states: ['FL'], sortBy: 'medicare' }));
  assert.notEqual(plain, fingerprint({ states: ['FL'], hasPhone: true }));
  assert.equal(fingerprint({ states: ['FL'], sortBy: 'medicare', minMedicareClaims: 50 }).includes('"minMedicareClaims":50'), true);
  assert.notEqual(plain, fingerprint({ states: ['FL'], source: 'dmedesk' }));
  assert.equal(fingerprint({ states: ['FL'], source: undefined }), plain);
});

function progressDb(rows) {
  return {
    from() {
      const q = {
        filters: {},
        select: () => q,
        eq(key, value) { q.filters[key] = value; return q; },
        maybeSingle: async () => ({ data: rows[q.filters.filter_fingerprint] || null, error: null }),
      };
      return q;
    },
  };
}

test('moving to DME Desk keeps what a rep has seen but restarts their position', async () => {
  const criteria = { states: ['FL'] };
  const mirrorRow = { variant_skips: { 'FL|': 400, _v: 2 }, seen_npis: ['1', '2', '3'] };
  const db = progressDb({ [fingerprint(criteria)]: mirrorRow });

  // On the mirror, nothing changes.
  assert.deepEqual(await getProgress(db, 'u1', criteria), { variantSkips: { 'FL|': 400 }, seenNpis: ['1', '2', '3'] });
  // First search on DME Desk: the old position is NOT reused (it counts positions in a different ordering),
  // but the leads already seen are.
  assert.deepEqual(await getProgress(db, 'u1', { ...criteria, source: 'dmedesk' }), { variantSkips: {}, seenNpis: ['1', '2', '3'] });
  // Once they have a DME Desk bookmark of their own, that one is used.
  const both = progressDb({
    [fingerprint(criteria)]: mirrorRow,
    [fingerprint({ ...criteria, source: 'dmedesk' })]: { variant_skips: { '*|': 200, _v: 2 }, seen_npis: ['9'] },
  });
  assert.deepEqual(await getProgress(both, 'u1', { ...criteria, source: 'dmedesk' }), { variantSkips: { '*|': 200 }, seenNpis: ['9'] });
  // The old bookmark was never touched, so switching back loses nothing.
  assert.deepEqual(await getProgress(both, 'u1', criteria), { variantSkips: { 'FL|': 400 }, seenNpis: ['1', '2', '3'] });
  // No bookmark at all anywhere.
  assert.equal(await getProgress(progressDb({}), 'u1', { ...criteria, source: 'dmedesk' }), null);
});

// ---- the service, against a stand-in database ------------------------------

function fakeSupabase(handlers, calls = []) {
  return {
    rpc: async (name, args) => {
      calls.push({ name, args });
      const handler = handlers[name];
      if (!handler) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
      return handler(args);
    },
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { seen_npis: ['1', '2'], variant_skips: {} } }) }) }) }) }),
  };
}
const mirrorConfig = { npiSource: () => 'mirror' };
const dmedeskConfig = { npiSource: () => 'dmedesk' };

test('capabilities: off on the mirror, off before sql/021, on after', async () => {
  assert.equal((await getCapabilities(mirrorConfig, fakeSupabase({}))).advanced, false);
  assert.match((await getCapabilities(mirrorConfig, fakeSupabase({}))).reason, /NPI_SOURCE=dmedesk/);
  // (results are cached per isolate for a minute, so the dmedesk case is checked once)
  const installed = await getCapabilities(dmedeskConfig, fakeSupabase({ search_features: async () => ({ data: { version: 1 }, error: null }) }));
  assert.deepEqual([installed.advanced, installed.version], [true, 1]);
});

test('insights: counts, and suggestions only when nothing is left', async () => {
  const calls = [];
  const rich = fakeSupabase({
    search_insights: async () => ({ data: { matched: 412, unclaimed: 137, left: 96, cap: 5000 }, error: null }),
  }, calls);
  const ok = await getInsights(rich, 'user-1', { states: ['FL'], city: 'Miami' });
  assert.deepEqual([ok.matched, ok.unclaimed, ok.left], [412, 137, 96]);
  assert.deepEqual(ok.suggestions, []);
  assert.equal(calls.filter((c) => c.name === 'search_insights').length, 1); // no extra work when there is something left
});

test('insights: an empty search gets the best ways to loosen it', async () => {
  const empty = fakeSupabase({
    search_insights: async ({ p_criteria }) => {
      const loosened = !p_criteria.hasPhone;
      return { data: loosened ? { matched: 40, unclaimed: 30, left: 25, cap: 5000 } : { matched: 0, unclaimed: 0, left: 0, cap: 5000 }, error: null };
    },
  });
  const result = await getInsights(empty, 'user-1', { states: ['FL'], hasPhone: true, city: 'Miami' });
  assert.equal(result.left, 0);
  assert.ok(result.suggestions.length >= 1);
  assert.equal(result.suggestions[0].key, 'hasPhone');
  assert.equal(result.suggestions[0].left, 25);
});

test('quick picks count on top of the location only', async () => {
  const seen = [];
  const supabase = fakeSupabase({
    search_insights: async ({ p_criteria }) => { seen.push(p_criteria); return { data: { matched: 10, unclaimed: 8, left: 8, cap: 5000 }, error: null }; },
  });
  const picks = await getQuickPicks(supabase, { states: ['FL'], hasPhone: true, taxonomyCodes: ['x'], taxonomyDescriptions: ['X'] });
  assert.equal(picks.length, 3);
  assert.deepEqual(picks.map((p) => p.unclaimed), [8, 8, 8]);
  const medicare = seen.find((p) => p.activeMedicare);
  assert.equal(medicare.hasPhone, undefined); // the form's own filters aren't carried into a pick
  assert.deepEqual(medicare.states, ['FL']);
  assert.deepEqual(medicare.taxonomyCodes, ['x']);
});

test('quick picks use the one-call count when sql/022 is installed', async () => {
  const calls = [];
  const supabase = fakeSupabase({
    search_quick_counts: async ({ p_picks }) => ({
      data: p_picks.map((pick, i) => ({ id: pick.id, unclaimed: (i + 1) * 100, capped: i === 2 })),
      error: null,
    }),
  }, calls);
  const picks = await getQuickPicks(supabase, { states: ['FL'], hasPhone: true });
  assert.deepEqual(picks.map((p) => [p.id, p.unclaimed, p.capped]), [['medicare', 100, false], ['reachable', 200, false], ['fresh', 300, true]]);
  assert.equal(calls.length, 1, 'one database call for all the picks');
  assert.equal(calls[0].args.p_picks[0].criteria.activeMedicare, true);
  assert.equal('hasPhone' in calls[0].args.p_picks[0].criteria, false);
});

test('counts that hit the cap are all reported as "at least"', async () => {
  const supabase = fakeSupabase({
    search_insights: async () => ({ data: { matched: 5000, unclaimed: 4120, left: 3900, cap: 5000 }, error: null }),
  });
  const result = await getInsights(supabase, 'user-cap', { states: ['TX'] });
  assert.deepEqual(result.capped, { matched: true, unclaimed: true, left: true });
  assert.equal(result.unclaimed, 4120);
});

test('the same question asked twice in a moment is counted once', async () => {
  const calls = [];
  const supabase = fakeSupabase({
    search_insights: async () => ({ data: { matched: 10, unclaimed: 8, left: 8, cap: 5000 }, error: null }),
  }, calls);
  await getInsights(supabase, 'user-cache', { states: ['OH'] });
  await getInsights(supabase, 'user-cache', { states: ['OH'] });
  assert.equal(calls.filter((c) => c.name === 'search_insights').length, 1);
  await getInsights(supabase, 'user-cache', { states: ['OH'], hasPhone: true }); // a different question is counted
  assert.equal(calls.filter((c) => c.name === 'search_insights').length, 2);
});

test('quick picks are not counted until a state or specialty is chosen', async () => {
  const calls = [];
  const supabase = fakeSupabase({
    search_quick_counts: async () => ({ data: [], error: null }),
  }, calls);
  const picks = await getQuickPicks(supabase, { hasPhone: true });
  assert.equal(picks.length, 3);
  assert.deepEqual(picks.map((p) => p.unclaimed), [null, null, null]);
  assert.equal(calls.length, 0, 'no database call');
});

test('insights: loosening suggestions are counted one at a time and stop once enough are found', async () => {
  let running = 0;
  let peak = 0;
  const calls = [];
  const supabase = fakeSupabase({
    search_insights: async ({ p_criteria }) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
      const full = p_criteria.hasPhone && p_criteria.hasDecisionMaker && p_criteria.activeMedicare && p_criteria.zip && p_criteria.city;
      return { data: full ? { matched: 0, unclaimed: 0, left: 0, cap: 5000 } : { matched: 9, unclaimed: 9, left: 9, cap: 5000 }, error: null };
    },
  }, calls);
  const result = await getInsights(supabase, 'user-seq', { states: ['FL'], city: 'Miami', hasPhone: true, hasDecisionMaker: true, activeMedicare: true, zip: '33101' });
  assert.equal(peak, 1);
  assert.equal(result.suggestions.length, 3);
  assert.equal(calls.filter((c) => c.name === 'search_insights').length, 4, 'the base count plus three suggestions, not all six');
});

test('insights: a count that times out says so plainly (503)', async () => {
  const supabase = fakeSupabase({
    search_insights: async () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }),
  });
  await assert.rejects(() => getInsights(supabase, 'user-timeout', { states: ['NV'] }), (err) => err.status === 503 && /too long/i.test(err.message));
});
