import test from 'node:test';
import assert from 'node:assert/strict';
import { searchCompanies } from '../src/services/companyService.js';

// A stand-in for the Supabase client: every table query answers "no rows", and
// every rpc is recorded and answered by the handler for that function.
function fakeDb(handlers) {
  const calls = [];
  const query = () => {
    const q = new Proxy(function () {}, {
      get(_, prop) {
        if (prop === 'then') return (resolve) => resolve({ data: [], error: null });
        if (prop === 'maybeSingle') return () => Promise.resolve({ data: null, error: null });
        return () => q;
      },
    });
    return q;
  };
  return {
    calls,
    from: () => query(),
    rpc: async (name, args) => {
      calls.push({ name, args });
      const handler = handlers[name];
      return handler ? handler(args) : { data: [], error: null };
    },
  };
}

const row = (npi, name, over = {}) => ({
  npi, name, enumeration_type: 'NPI-2', status: 'A', is_organization: true,
  address_line1: '1 Main St', address_line2: null, city: 'Miami', state: 'FL', postal_code: '33101', country_code: 'US',
  phone: null, taxonomy_code: '332B00000X', taxonomy_description: 'DME', official_first_name: null, official_last_name: null,
  official_credential: null, official_title: null, official_phone: null, last_updated: '2025-01-01', deactivation_date: null,
  medicare_total_claims: null, medicare_total_services: null, medicare_total_beneficiaries: null, medicare_payment: null, medicare_allowed: null,
  total_count: null, count_capped: false, ...over,
});

// Database order (sorted by Medicare claims): A, B, C.
// Fit scores: A = 100, B = 45 (address + Medicare), C = 75 (phone + address + owner).
const medicareOrder = [
  row('1000000001', 'ALPHA', { phone: '3055550101', official_last_name: 'Owner', medicare_total_claims: 900 }),
  row('1000000002', 'BRAVO', { medicare_total_claims: 50 }),
  row('1000000003', 'CHARLIE', { phone: '3055550303', official_last_name: 'Boss' }),
];

const dmedesk = { npiSource: () => 'dmedesk' };

test('a sorted search asks the database once, for every state and specialty, and keeps its order', async () => {
  const db = fakeDb({ search_providers_v2: async () => ({ data: medicareOrder, error: null }) });
  const result = await searchCompanies(dmedesk, db, {
    states: ['FL', 'TX'], taxonomyDescriptions: ['DME', 'Pharmacy'], taxonomyCodes: ['332B00000X', '333600000X'],
    sortBy: 'medicare', hasPhone: false, limit: 10,
  }, { userId: 'user-1' });

  const searches = db.calls.filter((c) => c.name.startsWith('search_providers'));
  assert.equal(searches.length, 1, 'one query, not one per state and specialty');
  assert.equal(searches[0].name, 'search_providers_v2');
  assert.deepEqual(searches[0].args.p_criteria.states, ['FL', 'TX']);
  assert.deepEqual(searches[0].args.p_criteria.taxonomyCodes, ['332B00000X', '333600000X']);
  assert.equal(searches[0].args.p_criteria.sortBy, 'medicare');
  assert.equal(searches[0].args.p_criteria.includeCount, false);

  // The Worker must not re-sort by score and undo the database's order.
  assert.deepEqual(result.companies.map((c) => c.name), ['ALPHA', 'BRAVO', 'CHARLIE']);
  assert.deepEqual(result.companies.map((c) => c.score.percentage), [100, 45, 75]);
  assert.deepEqual(Object.keys(result.variantSkips), ['*|medicare']);
});

test('quality filters and the minimum score reach the database', async () => {
  const db = fakeDb({ search_providers_v2: async () => ({ data: [], error: null }) });
  await searchCompanies(dmedesk, db, {
    states: ['FL'], hasPhone: true, hasDecisionMaker: true, activeMedicare: true, minScore: 75, zip: '331', sortBy: 'score', minMedicareClaims: 10, limit: 5,
  }, { userId: 'user-1' });
  const payload = db.calls.find((c) => c.name === 'search_providers_v2').args.p_criteria;
  assert.deepEqual(
    [payload.hasPhone, payload.hasDecisionMaker, payload.activeMedicare, payload.minScore, payload.zip, payload.minMedicareClaims],
    [true, true, true, 75, '331', 10]
  );
  assert.deepEqual(payload.scoreWeights, { hasPhone: 25, completeAddress: 20, hasDecisionMaker: 30, medicareActive: 25 });
});

test('a search that uses none of the new options still goes through the original function, sorted by score', async () => {
  const db = fakeDb({ search_providers: async () => ({ data: medicareOrder, error: null }) });
  const result = await searchCompanies(dmedesk, db, { states: ['FL'], taxonomyDescriptions: ['DME'], taxonomyCodes: ['332B00000X'], limit: 10 }, { userId: 'user-1' });
  const searches = db.calls.filter((c) => c.name.startsWith('search_providers'));
  assert.equal(searches[0].name, 'search_providers');
  assert.equal('sortBy' in searches[0].args.p_criteria, false);
  assert.deepEqual(result.companies.map((c) => c.name), ['ALPHA', 'CHARLIE', 'BRAVO']); // 100, 75, 45
});

test('a phone or name lookup is one query, and is not remembered as search progress', async () => {
  const db = fakeDb({ search_providers_v2: async () => ({ data: [medicareOrder[0]], error: null }) });
  const result = await searchCompanies(dmedesk, db, { lookupPhone: '3055550101', states: ['TX'], limit: 10 }, { userId: 'user-1' });
  const searches = db.calls.filter((c) => c.name.startsWith('search_providers'));
  assert.equal(searches.length, 1);
  assert.equal(searches[0].args.p_criteria.phone, '3055550101');
  assert.equal(result.companies.length, 1);
});

test('asking the database for a feature that is not installed is a clear 503', async () => {
  const db = fakeDb({ search_providers_v2: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.search_providers_v2' } }) });
  const result = await searchCompanies(dmedesk, db, { states: ['FL'], sortBy: 'score', limit: 5 }, { userId: 'user-1' });
  // A failed variant is reported, not thrown, exactly as before.
  assert.equal(result.companies.length, 0);
  assert.match(result.rejectedVariants[0].message, /sql\/021_search_insights\.sql/);
});
