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

// ---- paging: "Search more" must not lose rows --------------------------------

// A table of 450 providers served in the database's order, honouring p_limit / p_skip
// the way search_providers_v2 does.
const table = Array.from({ length: 450 }, (_, i) => row(String(1000000000 + i), `CO ${i}`));
const pagedDb = () => fakeDb({
  search_providers_v2: async ({ p_limit, p_skip }) => ({ data: table.slice(p_skip, p_skip + p_limit), error: null }),
});

test('paging with Search more reaches every provider exactly once', async () => {
  const db = pagedDb();
  const seen = [];
  let variantSkips = {};
  let exhausted = false;
  for (let click = 0; click < 40 && !exhausted; click++) {
    const result = await searchCompanies(dmedesk, db, {
      states: ['FL'], taxonomyDescriptions: ['DME'], taxonomyCodes: ['332B00000X'], limit: 20, source: 'dmedesk',
      variantSkips, excludeNpis: seen,
    }, { userId: 'user-1', clientProvidedVariantSkips: click > 0 });
    result.companies.forEach((c) => seen.push(String(c.npi)));
    variantSkips = result.variantSkips;
    exhausted = result.exhaustedRegistry;
  }
  assert.equal(new Set(seen).size, seen.length, 'no provider is shown twice');
  assert.equal(seen.length, 450, 'every provider in the table was reachable');
});

test('a page that is only partly used is not marked as done', async () => {
  const db = pagedDb();
  const result = await searchCompanies(dmedesk, db, {
    states: ['FL'], taxonomyDescriptions: ['DME'], taxonomyCodes: ['332B00000X'], limit: 20, source: 'dmedesk',
  }, { userId: 'user-1' });
  assert.equal(result.companies.length, 20);
  assert.equal(result.exhaustedRegistry, false);
  assert.equal(Object.values(result.variantSkips)[0], 20, 'the bookmark moves by what was shown, not by the page size');
});

// ---- saved bookmarks from before the paging fix --------------------------------

import { readPositions } from '../src/repos/searchProgressRepo.js';

test('an old bookmark loses its position but is otherwise left alone; a new one keeps it', () => {
  assert.deepEqual(readPositions({ '*|': 400 }), {}, 'no marker: the position may be past unseen rows');
  assert.deepEqual(readPositions({ 'FL|DME': -1 }), {}, '"done" from the old code cannot be trusted either');
  assert.deepEqual(readPositions({ '*|': 40, _v: 2 }), { '*|': 40 }, 'stamped bookmarks keep their position, without the marker');
  assert.deepEqual(readPositions(null), {});
});

// ---- a failed page is not "no more leads"; Rescan finds what was never shown ----------

const baseCriteria = { states: ['FL'], taxonomyDescriptions: ['DME'], taxonomyCodes: ['332B00000X'], source: 'dmedesk' };

test('a page that fails is reported and retried, never mistaken for the end of the results', async () => {
  const failing = fakeDb({ search_providers_v2: async () => ({ data: null, error: { message: 'canceling statement due to statement timeout' } }) });
  const none = await searchCompanies(dmedesk, failing, { ...baseCriteria, limit: 20 }, { userId: 'user-1' });
  assert.equal(none.companies.length, 0);
  assert.equal(none.exhaustedRegistry, false, 'a timeout is not the end of the list');
  assert.equal(none.searchErrors.length, 1);
  assert.match(none.searchErrors[0].message, /timeout/);

  // The first page works, the second one times out: keep what was found, stay where we were.
  const flaky = fakeDb({
    search_providers_v2: async ({ p_skip, p_limit }) => (p_skip >= 200
      ? { data: null, error: { message: 'canceling statement due to statement timeout' } }
      : { data: table.slice(p_skip, p_skip + p_limit), error: null }),
  });
  const partial = await searchCompanies(dmedesk, flaky, { ...baseCriteria, limit: 250 }, { userId: 'user-1' });
  assert.equal(partial.companies.length, 200);
  assert.equal(partial.exhaustedRegistry, false);
  assert.equal(Object.values(partial.variantSkips)[0], 200, 'the position stops at the last page that was read');
  assert.equal(partial.searchErrors.length, 1);
});

test('Rescan starts from the top again and skips what was already seen, even when the saved position says "done"', async () => {
  const seen = table.slice(0, 100).map((r) => r.npi);
  const db = {
    calls: [],
    from(name) {
      const q = new Proxy(function () {}, {
        get(_, prop) {
          if (prop === 'then') return (resolve) => resolve({ data: [], error: null });
          if (prop === 'maybeSingle') return () => Promise.resolve({ data: name === 'search_progress' ? { variant_skips: { 'FL|DME': -1, _v: 2 }, seen_npis: seen } : null, error: null });
          return () => q;
        },
      });
      return q;
    },
    rpc: async (fn, args) => ({ data: table.slice(args.p_skip, args.p_skip + args.p_limit), error: null }),
  };
  const result = await searchCompanies(dmedesk, db, { ...baseCriteria, limit: 20 }, { userId: 'user-1', rescan: true });
  assert.equal(result.companies.length, 20);
  assert.equal(result.companies[0].npi, table[100].npi, 'the first 100 were seen already, so the rescan starts at the 101st');
  assert.equal(result.exhaustedRegistry, false);
});
