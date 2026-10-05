import test from 'node:test';
import assert from 'node:assert/strict';
import { WEIGHTS } from '../src/lib/scoring.js';
import { fingerprint } from '../src/repos/searchProgressRepo.js';
import {
  baseLocationCriteria, isLookup, quickPickDefinitions, readAdvancedCriteria, relaxedVariants, toFilterPayload, usesAdvancedSearch,
} from '../src/lib/searchFilters.js';
import { getCapabilities, getInsights, getQuickPicks } from '../src/services/searchInsights.js';

const query = (params) => (name) => params[name];

test('reads only the options a request carries', () => {
  assert.deepEqual(readAdvancedCriteria(query({})), {});
  const out = readAdvancedCriteria(query({
    hasPhone: 'true', hasDecisionMaker: 'on', activeMedicare: '1', minScore: '75', zip: ' 33-101 ', sortBy: 'SCORE',
    lookupText: ' Smith,  LLC % ', lookupPhone: '(954) 907-8765',
  }));
  assert.deepEqual(out, {
    hasPhone: true, hasDecisionMaker: true, activeMedicare: true, minScore: 75, zip: '33101', sortBy: 'score',
    lookupText: 'Smith LLC', lookupPhone: '9549078765',
  });
});

test('rejects nonsense values', () => {
  assert.deepEqual(readAdvancedCriteria(query({ hasPhone: 'false', minScore: '0', zip: '12', sortBy: 'price', lookupPhone: '12345' })), {});
  assert.equal(readAdvancedCriteria(query({ minScore: '250' })).minScore, 100);
  assert.equal(readAdvancedCriteria(query({ lookupPhone: '+1 954 907 8765' })).lookupPhone, '9549078765');
});

test('knows which searches need the new database functions', () => {
  assert.equal(usesAdvancedSearch({ states: ['FL'] }), false);
  assert.equal(usesAdvancedSearch({ states: ['FL'], minMedicareClaims: 10 }), false); // still the old after-the-fact filter on its own
  assert.equal(usesAdvancedSearch({ sortBy: 'score' }), true);
  assert.equal(usesAdvancedSearch({ hasPhone: true }), true);
  assert.equal(usesAdvancedSearch({ lookupText: 'acme' }), true);
  assert.equal(isLookup({ npi: '1' }), true);
  assert.equal(isLookup({ lookupPhone: '9549078765' }), true);
  assert.equal(isLookup({ states: ['FL'] }), false);
});

test('builds the database payload, collapsed or per fan-out variant', () => {
  const criteria = {
    states: ['FL', 'TX'], state: 'FL', taxonomyCodes: ['332B00000X', undefined, '333600000X'], taxonomyCode: '332B00000X',
    city: 'Miami', nameContainsTerms: ['acme', ' '], minScore: 60, hasPhone: true, sortBy: 'score', minMedicareClaims: 25,
    lastUpdatedYears: ['2025'], limit: 50, skip: 100, excludeNpis: ['1'],
  };
  const collapsed = toFilterPayload(criteria, { collapsed: true });
  assert.deepEqual(collapsed.states, ['FL', 'TX']);
  assert.deepEqual(collapsed.taxonomyCodes, ['332B00000X', '333600000X']);
  assert.equal(collapsed.minScore, 60);
  assert.equal(collapsed.minMedicareClaims, 25);
  assert.deepEqual(collapsed.nameContains, ['acme']);
  assert.deepEqual(collapsed.scoreWeights, WEIGHTS);
  assert.equal('limit' in collapsed, false);
  assert.equal('excludeNpis' in collapsed, false);

  const single = toFilterPayload(criteria);
  assert.equal(single.state, 'FL');
  assert.equal(single.taxonomyCode, '332B00000X');
  assert.equal('states' in single, false);

  assert.equal('scoreWeights' in toFilterPayload({ hasPhone: true }), false); // weights only matter for score
  assert.equal('minMedicareClaims' in toFilterPayload({ minMedicareClaims: 0 }), false);
});

test('suggests loosening each filter that is actually set', () => {
  const none = relaxedVariants({ states: ['FL'] });
  assert.deepEqual(none, []);

  const variants = relaxedVariants({ states: ['FL'], city: 'Miami', minScore: 90, zip: '331', lastUpdatedYears: ['2025'], taxonomyCodes: ['x'] });
  assert.deepEqual(variants.map((v) => v.key), ['minScore', 'zip', 'lastUpdatedYears', 'city', 'taxonomy']);
  const noScore = variants.find((v) => v.key === 'minScore');
  assert.equal(noScore.criteria.minScore, undefined);
  assert.equal(noScore.criteria.zip, '331'); // only the one filter is dropped
  assert.match(noScore.label, /90%/);
  assert.deepEqual(variants.find((v) => v.key === 'taxonomy').criteria.taxonomyCodes, []);
});

test('quick picks and the location base they are counted on', () => {
  const picks = quickPickDefinitions(new Date('2026-10-05T12:00:00Z'));
  assert.deepEqual(picks.map((p) => p.id), ['high-fit', 'medicare', 'reachable', 'fresh']);
  assert.equal(picks.find((p) => p.id === 'fresh').label, 'Updated in 2026');
  assert.deepEqual(picks.find((p) => p.id === 'fresh').patch.lastUpdatedYears, ['2026']);
  assert.deepEqual(Object.keys(baseLocationCriteria({ states: ['FL'], minScore: 80, city: 'Miami', hasPhone: true })).sort(),
    ['city', 'state', 'states', 'taxonomyCode', 'taxonomyCodes']);
});

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

test('new options give a search its own bookmark', () => {
  const plain = fingerprint({ states: ['FL'] });
  const sorted = fingerprint({ states: ['FL'], sortBy: 'score' });
  const phone = fingerprint({ states: ['FL'], hasPhone: true });
  assert.notEqual(plain, sorted);
  assert.notEqual(sorted, phone);
  assert.equal(fingerprint({ states: ['FL'], sortBy: 'score', minMedicareClaims: 50 }).includes('"minMedicareClaims":50'), true);
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
  // (results are cached per isolate for a minute, so the dmedesk cases are checked once)
  const installed = await getCapabilities(dmedeskConfig, fakeSupabase({ search_features: async () => ({ data: { version: 1 }, error: null }) }));
  assert.deepEqual([installed.advanced, installed.version], [true, 1]);
});

test('insights: counts, and suggestions only when nothing is left', async () => {
  const calls = [];
  const rich = fakeSupabase({
    search_insights: async ({ p_criteria }) => ({ data: { matched: 412, unclaimed: 137, left: 96, cap: 5000 }, error: null }),
  }, calls);
  // getProgress reads search_progress through supabase.from(...); the stand-in returns two seen NPIs.
  const ok = await getInsights(rich, 'user-1', { states: ['FL'], city: 'Miami' });
  assert.deepEqual([ok.matched, ok.unclaimed, ok.left], [412, 137, 96]);
  assert.deepEqual(ok.suggestions, []);
  assert.equal(calls.filter((c) => c.name === 'search_insights').length, 1); // no extra work when there is something left
});

test('insights: an empty search gets the best ways to loosen it', async () => {
  const empty = fakeSupabase({
    search_insights: async ({ p_criteria }) => {
      const loosened = !p_criteria.minScore;
      return { data: loosened ? { matched: 40, unclaimed: 30, left: 25, cap: 5000 } : { matched: 0, unclaimed: 0, left: 0, cap: 5000 }, error: null };
    },
  });
  const result = await getInsights(empty, 'user-1', { states: ['FL'], minScore: 90, city: 'Miami' });
  assert.equal(result.left, 0);
  assert.ok(result.suggestions.length >= 1);
  assert.equal(result.suggestions[0].key, 'minScore');
  assert.equal(result.suggestions[0].left, 25);
});

test('quick picks count on top of the location only', async () => {
  const seen = [];
  const supabase = fakeSupabase({
    search_insights: async ({ p_criteria }) => { seen.push(p_criteria); return { data: { matched: 10, unclaimed: 8, left: 8, cap: 5000 }, error: null }; },
  });
  const picks = await getQuickPicks(supabase, { states: ['FL'], minScore: 50, hasPhone: true, taxonomyCodes: ['x'] });
  assert.equal(picks.length, 4);
  assert.deepEqual(picks.map((p) => p.unclaimed), [8, 8, 8, 8]);
  const highFit = seen.find((p) => p.minScore === 75);
  assert.equal(highFit.hasPhone, undefined); // the form's own quality filters aren't carried into a pick
  assert.deepEqual(highFit.states, ['FL']);
  assert.deepEqual(highFit.taxonomyCodes, ['x']);
});
