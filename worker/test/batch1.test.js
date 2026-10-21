import test from 'node:test';
import assert from 'node:assert/strict';
import { retryInfo, buildTodayView, RETRY_AFTER_MS } from '../src/lib/leadView.js';
import { billerCounts } from '../src/lib/intel.js';
import { buildInsights } from '../src/lib/insights.js';
import { buildSameOwner, ownerName, MAX_SAME_STATE } from '../src/lib/sameOwner.js';
import { findSameOwner } from '../src/repos/sameOwnerRepo.js';


const NOW = Date.parse('2026-10-21T18:00:00Z');
const line = (date, time, text) => `${date} ${time} — Ana: ${text}`;
const lead = (npi, notes, extra = {}) => ({ npi, name: 'Lead ' + npi, state: 'FL', status: 'voicemail', notes, ...extra });

// ---- Try again now ----

test('a lead whose last answered-or-not result was a miss, a few hours ago, is worth another try', () => {
  const l = lead('1', [line('2026-10-21', '12:00', 'Voicemail'), line('2026-10-20', '15:00', 'No answer'), line('2026-10-19', '10:00', 'Interested')].join('\n'));
  const r = retryInfo(l, NOW);
  assert.equal(r.tries, 2); // two misses since someone last answered
  assert.equal(r.lastResult, 'Voicemail');
  assert.equal(r.lastAt, '2026-10-21T12:00:00.000Z');
});

test('too soon, too old, answered, or only unclear lines: not a retry', () => {
  assert.equal(retryInfo(lead('1', line('2026-10-21', '17:00', 'Voicemail')), NOW), null); // one hour ago
  assert.equal(retryInfo(lead('1', line('2026-09-01', '12:00', 'Voicemail')), NOW), null); // weeks ago
  assert.equal(retryInfo(lead('1', line('2026-10-21', '10:00', 'Interested')), NOW), null);
  assert.equal(retryInfo(lead('1', line('2026-10-21', '10:00', 'Called')), NOW), null);
  assert.equal(retryInfo(lead('1', ''), NOW), null);
  assert.ok(RETRY_AFTER_MS >= 3 * 3600 * 1000);
});

test('the Today view lists retries oldest first, and leaves out finished, scheduled and callback leads', () => {
  const opts = { nowMs: NOW, endOfDayMs: NOW + 6 * 3600 * 1000, startOfDayMs: NOW - 18 * 3600 * 1000, startOfWeekMs: NOW - 2 * 86400000, me: 'Ana' };
  const leads = [
    lead('1', line('2026-10-21', '12:00', 'Voicemail')),
    lead('2', line('2026-10-20', '09:00', 'No answer')),
    lead('3', line('2026-10-21', '12:00', 'Voicemail'), { status: 'not interested' }),
    lead('4', line('2026-10-21', '12:00', 'Voicemail'), { meetingAt: '2026-10-25T15:00:00Z' }),
    lead('5', line('2026-10-21', '12:00', 'Voicemail'), { reminderAt: '2026-10-21T20:00:00Z' }), // already a callback today
  ];
  const view = buildTodayView(leads, opts);
  assert.deepEqual(view.retry.items.map((l) => l.npi), ['2', '1']);
  assert.equal(view.retry.total, 2);
  assert.equal(view.retry.items[0].retryTries, 1);
  assert.equal(view.retry.items[0].retryResult, 'No answer');
});

// ---- Who we are up against ----

test('billers are grouped loosely, in-house is one bucket, and objections ride along', () => {
  const rows = [
    { current_biller: 'Acme Billing LLC', objection: 'price' },
    { current_biller: 'ACME billing', objection: 'price' },
    { current_biller: 'acme', objection: 'bad timing' },
    { current_biller: 'In-house' },
    { current_biller: 'in house', objection: 'in-house' },
    { current_biller: 'MedBill Pro' },
    { current_biller: '' },
    { objection: 'price' },
  ];
  const out = billerCounts(rows);
  assert.deepEqual(out.map((b) => [b.name, b.count, b.inHouse]), [['Acme Billing LLC', 3, false], ['In-house', 2, true], ['MedBill Pro', 1, false]]);
  assert.deepEqual(out[0].objections, [{ reason: 'price', count: 2 }, { reason: 'bad timing', count: 1 }]);
  assert.deepEqual(billerCounts([]), []);
  assert.equal(billerCounts(Array.from({ length: 30 }, (_, i) => ({ current_biller: 'Biller ' + i }))).length, 10);
});

test('the insights payload carries the biller list', () => {
  const out = buildInsights({ users: [{ id: 'u1', display_name: 'Ana' }], intel: [{ current_biller: 'Acme', objection: 'price' }], now: new Date('2026-10-21T12:00:00Z') });
  assert.equal(out.pipeline.billers[0].name, 'Acme');
});

// ---- Same owner elsewhere ----

const row = (npi, extra = {}) => ({ npi, name: 'Biz ' + npi, address_state: 'FL', address_city: 'Tampa', status: 'A', authorizedofficial_phone: '', ...extra });
const me = { npi: '1', state: 'FL', officialPhone: '(727) 226-7700' };

test('a usable owner name has both parts', () => {
  assert.deepEqual(ownerName('Trisha', 'Bailey'), { first: 'Trisha', last: 'Bailey' });
  assert.equal(ownerName('T', 'Bailey'), null);
  assert.equal(ownerName('', ''), null);
});

test('same name in the same state, or the same owner phone anywhere, counts; the lead and inactive ones do not', () => {
  const rows = [row('1'), row('2'), row('3', { address_state: 'GA' }), row('4', { address_state: 'GA', authorizedofficial_phone: '727-226-7700' }), row('5', { status: 'D' }), row('6')];
  const out = buildSameOwner(me, rows, new Map([['2', { by: 'Dana' }]]), ['6']);
  assert.deepEqual(out.matches.map((m) => m.npi), ['4', '2']); // the strong (phone) match first
  assert.equal(out.matches[0].why, 'same owner phone');
  assert.equal(out.matches[1].claimedBy, 'Dana');
  assert.equal(out.total, 2);
  assert.equal(out.ambiguous, false);
});

test('a common name with too many same-state matches and nothing else is ambiguous', () => {
  const rows = Array.from({ length: MAX_SAME_STATE + 1 }, (_, i) => row(String(100 + i)));
  const out = buildSameOwner(me, rows);
  assert.equal(out.ambiguous, true);
  assert.deepEqual(out.matches, []);
  // ...unless a phone match backs one of them up
  const backed = buildSameOwner(me, [...rows, row('999', { authorizedofficial_phone: '7272267700' })]);
  assert.equal(backed.ambiguous, false);
  assert.equal(backed.matches[0].npi, '999');
});

function fakeDb({ mine, candidates }) {
  return {
    from(name) {
      const q = {
        select() { return q; }, eq() { return q; }, in() { return q; }, not() { return q; }, limit() { return q; },
        maybeSingle: async () => ({ data: mine }),
        then(res, rej) { return Promise.resolve({ data: name === 'npi_records' ? candidates : [], error: null }).then(res, rej); },
      };
      return q;
    },
  };
}

test('the owner lookup reads the owner name, finds matches, and returns nothing without a usable name', async () => {
  const mineRow = { npi: '1003386889', address_state: 'FL', authorizedofficial_firstname: 'TRISHA', authorizedofficial_lastname: 'BAILEY', authorizedofficial_phone: '' };
  const found = await findSameOwner(fakeDb({ mine: mineRow, candidates: [row('1003386889'), row('2')] }), '1003386889');
  assert.deepEqual(found.matches.map((m) => m.npi), ['2']);
  const none = await findSameOwner(fakeDb({ mine: { ...mineRow, authorizedofficial_firstname: '' }, candidates: [row('2')] }), '1003386889');
  assert.equal(none.total, 0);
  await assert.rejects(() => findSameOwner(fakeDb({}), 'abc'), (e) => e.status === 400);
});
