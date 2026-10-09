import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanFlag, cleanNpiList, nationalNumber, prettyNumber } from '../src/lib/badNumbers.js';
import { listForNpis, flagNumber, clearFlag } from '../src/repos/badNumbersRepo.js';
import { classifyResult, buildBestTimes, summarize, smoothed, MIN_CELL } from '../src/lib/bestTimes.js';
import { getBestTimes, clearBestTimesCache } from '../src/repos/insightsRepo.js';
import { findRelatedClaims, phoneKey, ownerKey } from '../src/lib/relatedClaims.js';
import { checkRelated, clearRelatedCache } from '../src/repos/relatedClaimsRepo.js';

/* ---------- wrong numbers ---------- */

test('a number is read from any way it is written', () => {
  assert.equal(nationalNumber('(404) 808-5118'), '4048085118');
  assert.equal(nationalNumber('+1 404-808-5118'), '4048085118');
  assert.equal(nationalNumber('404.808.5118'), '4048085118');
  assert.equal(nationalNumber('808-5118'), '');
  assert.equal(prettyNumber('4048085118'), '(404) 808-5118');
});

test('flagging needs a real NPI, a number and one of two reasons', () => {
  assert.deepEqual(cleanFlag({ npi: '1234567890', number: '(404) 808-5118' }), { npi: '1234567890', number: '4048085118', reason: 'wrong' });
  assert.equal(cleanFlag({ npi: '1234567890', number: '4048085118', reason: 'Disconnected' }).reason, 'disconnected');
  assert.throws(() => cleanFlag({ npi: '123', number: '4048085118' }), /NPI/);
  assert.throws(() => cleanFlag({ npi: '1234567890', number: '12' }), /10-digit/);
  assert.throws(() => cleanFlag({ npi: '1234567890', number: '4048085118', reason: 'rude' }), /wrong number or not in service/);
  assert.deepEqual(cleanNpiList('1234567890, bad,1234567890,9876543210'), ['1234567890', '9876543210']);
});

function fakeDb({ tables, missing = [] }) {
  const state = { tables, selected: [] };
  const from = (table) => {
    const filters = [];
    let op = null;
    let patch = null;
    let range = null;
    const q = {
      select(c) { state.selected.push([table, String(c || '')]); return q; },
      order: () => q,
      limit: () => q,
      range(a, b) { range = [a, b]; return q; },
      eq(c, v) { filters.push((r) => r[c] === v); return q; },
      is(c, v) { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return q; },
      not(c, _op, v) { filters.push((r) => (v === null ? r[c] != null : r[c] !== v)); return q; },
      in(c, vs) { filters.push((r) => vs.includes(r[c])); return q; },
      upsert(p) { op = 'upsert'; patch = p; return q; },
      update(p) { op = 'update'; patch = p; return q; },
      then(resolve) {
        if (missing.includes(table)) return resolve({ data: null, error: { code: '42P01', message: `relation "public.${table}" does not exist` } });
        const source = state.tables[table];
        if (op === 'upsert') {
          const at = source.findIndex((r) => r.npi === patch.npi && r.number === patch.number);
          if (at >= 0) source[at] = { ...source[at], ...patch }; else source.push({ ...patch });
          return resolve({ data: null, error: null });
        }
        let matched = source.filter((r) => filters.every((f) => f(r)));
        if (op === 'update') { matched.forEach((r) => Object.assign(r, patch)); return resolve({ data: null, error: null }); }
        if (range) matched = matched.slice(range[0], range[1] + 1);
        return resolve({ data: matched, error: null });
      },
    };
    return q;
  };
  return { state, from };
}

test('a flagged number is listed with who flagged it, and un-flagging keeps the row', async () => {
  const db = fakeDb({ tables: { bad_numbers: [], app_users: [{ id: 'a', display_name: 'Ana' }] } });
  await flagNumber(db, { id: 'a' }, { npi: '1234567890', number: '(404) 808-5118', reason: 'disconnected' }, new Date('2026-10-08T15:00:00Z'));
  assert.deepEqual((await listForNpis(db, '1234567890,9876543210')).flags, [{ npi: '1234567890', number: '4048085118', reason: 'disconnected', by: 'Ana', at: '2026-10-08T15:00:00.000Z' }]);
  await clearFlag(db, { id: 'a' }, { npi: '1234567890', number: '4048085118' }, new Date('2026-10-08T16:00:00Z'));
  assert.deepEqual((await listForNpis(db, '1234567890')).flags, []);
  assert.equal(db.state.tables.bad_numbers.length, 1); // never deleted
  await flagNumber(db, { id: 'a' }, { npi: '1234567890', number: '4048085118' }); // flagged again later
  assert.equal(db.state.tables.bad_numbers.length, 1);
  assert.equal(db.state.tables.bad_numbers[0].cleared_at, null);
});

test('before sql/038 flags come back empty and flagging says which file to run', async () => {
  const db = fakeDb({ tables: { bad_numbers: [], app_users: [] }, missing: ['bad_numbers'] });
  assert.deepEqual(await listForNpis(db, '1234567890'), { flags: [], unavailable: true });
  await assert.rejects(flagNumber(db, { id: 'a' }, { npi: '1234567890', number: '4048085118' }), { status: 503 });
});

/* ---------- best times ---------- */

test('a logged result says whether a person answered', () => {
  assert.equal(classifyResult('voicemail — left a message'), 'missed');
  assert.equal(classifyResult('VM'), 'missed');
  assert.equal(classifyResult('no answer'), 'missed');
  assert.equal(classifyResult('interested — send info'), 'answered');
  assert.equal(classifyResult('gatekeeper'), 'answered');
  assert.equal(classifyResult('called'), null);
  assert.equal(classifyResult('Spoke to the owner about Friday'), null);
});

// 19:40 UTC on Tuesday 6 Oct 2026 is 3:40 PM Eastern (EDT) and 12:40 PM Pacific.
test('calls are counted by the lead\'s own weekday and hour', () => {
  const eastern = '2026-10-06 19:40 — Ana: interested\n2026-10-06 19:50 — Ana: voicemail\n2026-10-06 19:55 — Ben: no answer';
  const pacific = '2026-10-06 19:40 — Ana: voicemail';
  const out = buildBestTimes([{ state: 'NY', notes: eastern }, { state: 'CA', notes: pacific }, { state: 'ZZ', notes: eastern }]);
  assert.equal(out.sample, 4); // the unknown state is skipped
  assert.deepEqual(out.team[1][7], [3, 1]); // Tuesday, 3 PM local (hour 15 = index 7)
  assert.deepEqual(out.team[1][4], [1, 0]); // Tuesday, noon local (Pacific)
  assert.deepEqual(out.byName.get('Ana')[1][7], [2, 1]);
  assert.deepEqual(out.byName.get('Ben')[1][7], [1, 0]);
});

test('weekends and out-of-hours calls are left out', () => {
  const sat = '2026-10-10 17:00 — Ana: interested'; // Saturday 1 PM Eastern
  const night = '2026-10-06 02:00 — Ana: interested'; // Monday 10 PM Eastern
  assert.equal(buildBestTimes([{ state: 'NY', notes: `${sat}\n${night}` }]).sample, 0);
});

test('the best slots need enough calls, and a lucky one is not read as perfect', () => {
  const lines = [];
  for (let i = 0; i < MIN_CELL; i += 1) lines.push(`2026-10-06 19:${10 + i} — Ana: interested`);
  lines.push('2026-10-07 19:10 — Ana: interested'); // one answered call elsewhere: too few to rank
  const s = summarize(buildBestTimes([{ state: 'NY', notes: lines.join('\n') }]).team);
  assert.equal(s.best.length, 1);
  assert.deepEqual([s.best[0].day, s.best[0].hour, s.best[0].calls], ['Tue', 15, MIN_CELL]);
  assert.ok(smoothed(1, 1) < 1 && smoothed(1, 1) < smoothed(10, 10));
  assert.equal(s.byDay[2].rate, 1);
});

test('the repo reads every claimed lead once and keeps the result for a while', async () => {
  clearBestTimesCache();
  const db = fakeDb({ tables: { leads: [{ npi: '1', state: 'NY', notes: '2026-10-06 19:40 — Ana: interested', claimed_by: 'a' }] } });
  const a = await getBestTimes(db, { displayName: 'Ana' }, 1000);
  assert.equal(a.sample, 1);
  assert.ok(a.mine);
  db.state.tables.leads.push({ npi: '2', state: 'NY', notes: '2026-10-06 19:41 — Ana: voicemail', claimed_by: 'a' });
  assert.equal((await getBestTimes(db, { displayName: 'Ben' }, 2000)).sample, 1); // still the kept result
  assert.equal((await getBestTimes(db, { displayName: 'Ben' }, 2000)).mine, null); // Ben has no logged calls
  assert.equal((await getBestTimes(db, { displayName: 'Ana' }, 11 * 60 * 1000)).sample, 2); // refreshed
  clearBestTimesCache();
});

/* ---------- related claims ---------- */

test('phones and owner names are compared in a steady form', () => {
  assert.equal(phoneKey('(404) 808-5118'), '4048085118');
  assert.equal(phoneKey('5555555555'), '');
  assert.equal(ownerKey('Dr. Jane  Smith, MD'), 'jane smith');
});

const claimed = [
  { npi: '1000000001', name: 'Beta DME', city: 'Austin', state: 'TX', status: 'voicemail', phones: ['(404) 808-5118'], owner: 'Jane Smith', claimedBy: 'Ana', claimedById: 'a' },
  { npi: '1000000002', name: 'Gamma Care', city: 'Dallas', state: 'TX', status: 'new', phones: ['(214) 555-0101'], owner: 'Jane Smith', claimedBy: 'Me', claimedById: 'me' },
];

test('a lead sharing a phone or an owner with a claimed lead is flagged, teammates\' first', () => {
  const out = findRelatedClaims([
    { npi: '2000000001', phones: ['404-808-5118'], owner: 'Someone Else', state: 'GA' },
    { npi: '2000000002', phones: [], owner: 'Jane Smith', state: 'TX' },
    { npi: '2000000003', phones: ['999-999-9999'], owner: 'No Match', state: 'TX' },
  ], claimed, 'me');
  assert.deepEqual(out.get('2000000001').map((r) => [r.name, r.claimedBy, r.mine, r.why]), [['Beta DME', 'Ana', false, ['same phone']]]);
  assert.deepEqual(out.get('2000000002').map((r) => [r.name, r.mine]), [['Beta DME', false], ['Gamma Care', true]]);
  assert.equal(out.has('2000000003'), false);
});

test('a lead is never related to itself, and a switchboard number is ignored', () => {
  assert.equal(findRelatedClaims([{ npi: '1000000001', phones: ['404-808-5118'] }], claimed, 'me').size, 0);
  const board = Array.from({ length: 7 }, (_, i) => ({ npi: `300000000${i}`, name: `B${i}`, phones: ['(800) 555-0199'], state: 'TX', claimedBy: 'Ana', claimedById: 'a' }));
  assert.equal(findRelatedClaims([{ npi: '2000000009', phones: ['800-555-0199'] }], board, 'me').size, 0);
});

test('the repo answers from the claimed leads and names who holds them', async () => {
  clearRelatedCache();
  const db = fakeDb({
    tables: {
      leads: [{ npi: '1000000001', company_name: 'Beta DME', city: 'Austin', state: 'TX', phone: '(404) 808-5118', contact_phone: '', contact_name: 'Jane Smith', claimed_by: 'a', status: 'voicemail', is_disconnected: false }],
      app_users: [{ id: 'a', display_name: 'Ana' }],
    },
  });
  const res = await checkRelated(db, { id: 'me' }, [{ npi: '2000000001', phones: ['404-808-5118'] }, { npi: 'bad', phones: [] }], 1000);
  assert.deepEqual(Object.keys(res.related), ['2000000001']);
  assert.equal(res.related['2000000001'][0].claimedBy, 'Ana');
  assert.deepEqual(await checkRelated(db, { id: 'me' }, [], 1000), { related: {} });
  clearRelatedCache();
});

// The fakes above answer whatever columns they are asked for, so this checks the real names: every column the new
// repos read from `leads` must be one the existing lead code already reads (an earlier slip asked for company_phone,
// which does not exist: the column is phone).
test('the new repos only read columns that exist on leads', async () => {
  const source = readFileSync(new URL('../src/repos/leadsRepo.js', import.meta.url), 'utf8');
  const known = new Set([...source.matchAll(/row\.([a-z_]+)/g)].map((m) => m[1]));
  ['npi', 'claimed_by', 'is_disconnected', 'notes', 'state', 'city', 'status'].forEach((c) => known.add(c));
  assert.ok(known.has('phone') && known.has('contact_phone') && !known.has('company_phone'));

  clearBestTimesCache();
  clearRelatedCache();
  const db = fakeDb({ tables: { leads: [{ npi: '1000000001', state: 'NY', notes: 'x', claimed_by: 'a', company_name: 'B', phone: '4048085118', contact_phone: '', contact_name: 'J', status: 's', is_disconnected: false }], app_users: [{ id: 'a', display_name: 'Ana' }] } });
  await getBestTimes(db, { displayName: 'Ana' }, 1);
  await checkRelated(db, { id: 'me' }, [{ npi: '2000000001', phones: ['404-808-5118'] }], 1);
  const leadColumns = db.state.selected.filter(([t]) => t === 'leads').flatMap(([, c]) => c.split(',').map((x) => x.trim()));
  assert.ok(leadColumns.length > 5);
  for (const col of leadColumns) assert.ok(known.has(col), `leads has no column called ${col}`);
  clearBestTimesCache();
  clearRelatedCache();
});
