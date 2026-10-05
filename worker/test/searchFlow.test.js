import test from 'node:test';
import assert from 'node:assert/strict';
import { searchCompanies } from '../src/services/companyService.js';
import { NO_SUCH_SPECIALTY } from '../src/lib/searchFilters.js';

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
  phone: null, taxonomy_code: '332B00000X', taxonomy_description: null, official_first_name: null, official_last_name: null,
  official_credential: null, official_title: null, official_phone: null, last_updated: '2025-01-01', deactivation_date: null,
  medicare_total_claims: null, medicare_total_services: null, medicare_total_beneficiaries: null, medicare_payment: null, medicare_allowed: null,
  total_count: null, count_capped: false, ...over,
});

// The database's order (here: most Medicare claims first). The Worker must keep it.
const dbOrder = [
  row('1000000001', 'ALPHA', { medicare_total_claims: 900 }),
  row('1000000002', 'BRAVO', { medicare_total_claims: 50 }),
  row('1000000003', 'CHARLIE'),
];
const names = (result) => result.companies.map((c) => c.name);

const dmedesk = { npiSource: () => 'dmedesk' };

test('a sorted search asks the database once, for every state and specialty, and keeps its order', async () => {
  const db = fakeDb({ search_providers_v2: async () => ({ data: dbOrder, error: null }) });
  const result = await searchCompanies(dmedesk, db, {
    states: ['FL', 'TX'], taxonomyDescriptions: ['DME', 'Pharmacy'], taxonomyCodes: ['332B00000X', '333600000X'],
    sortBy: 'medicare', limit: 10, source: 'dmedesk',
  }, { userId: 'user-1' });

  const searches = db.calls.filter((c) => c.name.startsWith('search_providers'));
  assert.equal(searches.length, 1, 'one query, not one per state and specialty');
  assert.equal(searches[0].name, 'search_providers_v2');
  assert.deepEqual(searches[0].args.p_criteria.states, ['FL', 'TX']);
  assert.deepEqual(searches[0].args.p_criteria.taxonomyCodes, ['332B00000X', '333600000X']);
  assert.equal(searches[0].args.p_criteria.sortBy, 'medicare');
  assert.equal(searches[0].args.p_criteria.includeCount, false);

  assert.deepEqual(names(result), ['ALPHA', 'BRAVO', 'CHARLIE']);
  assert.deepEqual(Object.keys(result.variantSkips), ['*|medicare']);
  assert.equal(result.companies.every((c) => !('score' in c) || c.score == null), true, 'leads are no longer scored');
});

test('quality filters reach the database, and there is no score filter any more', async () => {
  const db = fakeDb({ search_providers_v2: async () => ({ data: [], error: null }) });
  await searchCompanies(dmedesk, db, {
    states: ['FL'], hasPhone: true, hasDecisionMaker: true, activeMedicare: true, zip: '331', sortBy: 'medicare', minMedicareClaims: 10, limit: 5,
    source: 'dmedesk',
  }, { userId: 'user-1' });
  const payload = db.calls.find((c) => c.name === 'search_providers_v2').args.p_criteria;
  assert.deepEqual(
    [payload.hasPhone, payload.hasDecisionMaker, payload.activeMedicare, payload.zip, payload.minMedicareClaims],
    [true, true, true, '331', 10]
  );
  assert.equal('minScore' in payload, false);
  assert.equal('scoreWeights' in payload, false);
});

test('a plain search on DME Desk uses the same function, one state and specialty at a time, in the database order', async () => {
  const db = fakeDb({ search_providers_v2: async () => ({ data: dbOrder, error: null }) });
  const result = await searchCompanies(dmedesk, db, {
    states: ['FL'], taxonomyDescriptions: ['DME'], taxonomyCodes: ['332B00000X'], limit: 10, source: 'dmedesk',
  }, { userId: 'user-1' });
  const searches = db.calls.filter((c) => c.name.startsWith('search_providers'));
  assert.equal(searches[0].name, 'search_providers_v2'); // never the older per-row-lookup function
  assert.equal(searches[0].args.p_criteria.state, 'FL');
  assert.equal(searches[0].args.p_criteria.taxonomyCode, '332B00000X');
  assert.equal('states' in searches[0].args.p_criteria, false);
  assert.equal('sortBy' in searches[0].args.p_criteria, false);
  assert.deepEqual(names(result), ['ALPHA', 'BRAVO', 'CHARLIE']); // no re-sorting
});

test('a specialty we cannot find a code for matches nothing', async () => {
  const db = fakeDb({ search_providers_v2: async () => ({ data: [], error: null }) });
  await searchCompanies(dmedesk, db, { states: ['FL'], taxonomyDescriptions: ['Made Up'], taxonomyCodes: [undefined], limit: 10, source: 'dmedesk' }, { userId: 'user-1' });
  const payload = db.calls.find((c) => c.name === 'search_providers_v2').args.p_criteria;
  assert.equal(payload.taxonomyCode, NO_SUCH_SPECIALTY);
});

test('a phone or name lookup is one query, and is not remembered as search progress', async () => {
  const db = fakeDb({ search_providers_v2: async () => ({ data: [dbOrder[0]], error: null }) });
  const result = await searchCompanies(dmedesk, db, { lookupPhone: '3055550101', states: ['TX'], limit: 10, source: 'dmedesk' }, { userId: 'user-1' });
  const searches = db.calls.filter((c) => c.name.startsWith('search_providers'));
  assert.equal(searches.length, 1);
  assert.equal(searches[0].args.p_criteria.phone, '3055550101');
  assert.equal(result.companies.length, 1);
});

test('asking the database for a function that is not installed is a clear 503', async () => {
  const db = fakeDb({ search_providers_v2: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.search_providers_v2' } }) });
  const result = await searchCompanies(dmedesk, db, { states: ['FL'], sortBy: 'medicare', limit: 5, source: 'dmedesk' }, { userId: 'user-1' });
  // A failed variant is reported, not thrown, exactly as before.
  assert.equal(result.companies.length, 0);
  assert.match(result.rejectedVariants[0].message, /sql\/021_search_insights\.sql/);
});
