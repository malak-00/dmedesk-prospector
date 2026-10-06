import test from 'node:test';
import assert from 'node:assert/strict';
import { getTerritory, resetTerritoryCacheForTests } from '../src/services/searchInsights.js';

const specialties = [
  { id: 'a', facility_type: 'DME', code: 'AAA', description: 'Durable equipment' },
  { id: 'b', facility_type: 'Pharmacy', code: 'BBB', description: 'Pharmacy' },
  { id: 'c', facility_type: 'Orthotics', code: 'CCC', description: 'Orthotics' },
];

// supabase.from('taxonomies').select().eq().order() -> the rows above.
function fakeDb({ stale, grid, failRefresh = [], noStaleFunction = false }) {
  const calls = [];
  const chain = { select: () => chain, eq: () => chain, order: () => Promise.resolve({ data: specialties, error: null }) };
  return {
    calls,
    from: () => chain,
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'territory_stale_codes') {
        return noStaleFunction ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } } : { data: stale, error: null };
      }
      if (name === 'refresh_territory_code') {
        return failRefresh.includes(args.p_code) ? { data: null, error: { message: 'canceling statement due to statement timeout' } } : { data: 1, error: null };
      }
      if (name === 'search_territory') return { data: grid, error: null };
      return { data: null, error: null };
    },
  };
}

const grid = [
  { state: 'FL', taxonomy_code: 'AAA', total: 10, unclaimed: 7 },
  { state: 'FL', taxonomy_code: 'BBB', total: 4, unclaimed: 4 },
  { state: 'TX', taxonomy_code: 'AAA', total: 5, unclaimed: 1 },
];

test('stale specialties are recounted one at a time and the grid is then read from the small table', async () => {
  resetTerritoryCacheForTests();
  const db = fakeDb({ stale: ['AAA', 'BBB', 'CCC'], grid });
  const result = await getTerritory(db);
  const refreshed = db.calls.filter((c) => c.name === 'refresh_territory_code').map((c) => c.args.p_code).sort();
  assert.deepEqual(refreshed, ['AAA', 'BBB', 'CCC'], 'each specialty is its own short statement');
  assert.equal(result.pending, 0);
  assert.equal(result.states[0].state, 'FL');
  assert.equal(result.states[0].unclaimed, 11);
  assert.deepEqual(result.specialties.map((s) => s.code), ['AAA', 'BBB'], 'a specialty with no providers is not a column');
});

test('an answer is kept for a while, so reopening does not recount', async () => {
  resetTerritoryCacheForTests();
  const db = fakeDb({ stale: [], grid });
  await getTerritory(db);
  await getTerritory(db);
  assert.equal(db.calls.filter((c) => c.name === 'search_territory').length, 1);
});

test('when the time budget runs out the rest is reported as pending and the partial grid is still shown', async () => {
  resetTerritoryCacheForTests();
  let t = 0;
  const clock = () => (t += 7000); // every look at the clock costs 7 seconds
  const db = fakeDb({ stale: ['AAA', 'BBB', 'CCC'], grid });
  const result = await getTerritory(db, { now: clock });
  assert.ok(result.pending > 0, 'something is left to count');
  assert.ok(result.states.length > 0, 'what is counted is still shown');
});

test('a specialty whose count fails is reported as pending, not as a failed map', async () => {
  resetTerritoryCacheForTests();
  const db = fakeDb({ stale: ['AAA', 'BBB'], grid, failRefresh: ['BBB'] });
  const result = await getTerritory(db);
  assert.equal(result.pending, 1);
  assert.ok(result.states.length > 0);
});

test('before sql/025 is installed the old one-statement count is used', async () => {
  resetTerritoryCacheForTests();
  const db = fakeDb({ stale: [], grid, noStaleFunction: true });
  const result = await getTerritory(db);
  assert.equal(db.calls.filter((c) => c.name === 'refresh_territory_code').length, 0);
  assert.equal(result.pending, 0);
  assert.equal(result.states.length, 2);
});
