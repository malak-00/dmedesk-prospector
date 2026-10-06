import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTodayView, cleanSearchTerm, isStale, parseListParams } from '../src/lib/leadView.js';
import { listClaimedPage, getDueLeads } from '../src/repos/leadsRepo.js';

const NOW = Date.parse('2026-10-07T15:00:00Z'); // a Wednesday
const DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();
const stamp = (ms) => iso(ms).slice(0, 16).replace('T', ' ');
const line = (ms, who, text) => `${stamp(ms)} — ${who}: ${text}`;

const lead = (npi, over = {}) => ({
  npi, name: `Co ${npi}`, status: 'new', notes: '', reminderAt: '', meetingAt: '', meetingDurationMin: '', claimedAt: iso(NOW - 30 * DAY), lastUpdated: iso(NOW - 30 * DAY),
  city: 'Miami', state: 'FL', ...over,
});

const opts = {
  nowMs: NOW,
  startOfDayMs: Date.parse('2026-10-07T00:00:00Z'),
  endOfDayMs: Date.parse('2026-10-07T23:59:59Z'),
  startOfWeekMs: Date.parse('2026-10-05T00:00:00Z'),
  tzOffsetMin: 0, staleDays: 14, me: 'Ana Lopez',
};

// ---- paging parameters -------------------------------------------------------------------

test('list parameters are clamped, cleaned and given sensible defaults', () => {
  const p = parseListParams({}, NOW);
  assert.deepEqual([p.page, p.pageSize, p.status, p.term, p.overdueOnly, p.sortKey, p.dir], [1, 50, '', '', false, '', '']);
  const q = parseListParams({ page: '0', pageSize: '9999', status: ' voicemail ', q: " a%b_c,(d)* 'e' ", overdue: '1', states: 'fl, GA ,xyz,1', sort: 'reminder', dir: 'sideways' }, NOW);
  assert.deepEqual([q.page, q.pageSize, q.status, q.term, q.overdueOnly], [1, 200, 'voicemail', 'a b c d e', true]);
  assert.deepEqual(q.states, ['FL', 'GA']);
  assert.deepEqual([q.sortKey, q.dir], ['reminder', 'asc'], 'a sort starts in its natural direction');
  assert.equal(parseListParams({ sort: 'updated' }, NOW).dir, 'desc');
  assert.equal(parseListParams({ sort: 'drop table' }, NOW).sortKey, '', 'an unknown sort is ignored');
  assert.equal(cleanSearchTerm('x'.repeat(200)).length, 60);
});

// ---- the Claimed page query ----------------------------------------------------------------

function recordingDb(rowsForPage = [], total = 120) {
  const log = [];
  const builder = (head) => {
    const entry = { head, calls: [] };
    log.push(entry);
    const q = new Proxy({}, {
      get(_, method) {
        if (method === 'then') return (resolve) => resolve({ data: rowsForPage, count: head ? 7 : total, error: null });
        return (...args) => { entry.calls.push([method, ...args]); return q; };
      },
    });
    return q;
  };
  return { log, from: () => ({ select: (cols, o) => builder(Boolean(o && o.head)).select(cols, o) }) };
}

test('the claimed page applies every filter and the sort in the database, and counts the rest', async () => {
  const db = recordingDb([{ id: 1, npi: '1', company_name: 'A', claimed_at: '2026-10-01', status: 'new' }]);
  const params = parseListParams({ page: '3', pageSize: '25', status: 'voicemail', q: 'clay', overdue: '1', states: 'FL,GA', sort: 'company', dir: 'desc' }, NOW);
  const result = await listClaimedPage(db, { id: 'u1', displayName: 'Ana Lopez' }, params);

  const main = db.log.find((e) => !e.head);
  const has = (...call) => main.calls.some((c) => JSON.stringify(c) === JSON.stringify(call));
  assert.ok(has('eq', 'claimed_by', 'u1'));
  assert.ok(has('eq', 'is_disconnected', false));
  assert.ok(has('ilike', 'status', 'voicemail'));
  assert.ok(has('in', 'state', ['FL', 'GA']));
  assert.ok(main.calls.some((c) => c[0] === 'or' && c[1].includes('company_name.ilike.%clay%')), 'the search covers name, NPI, city, state and contact');
  assert.ok(main.calls.some((c) => c[0] === 'order' && c[1] === 'company_name' && c[2].ascending === false));
  assert.ok(has('range', 50, 74), 'page 3 of 25');
  assert.equal(result.page, 3);
  assert.equal(result.total, 120);
  assert.equal(result.pages, 5);
  assert.deepEqual(Object.keys(result.counts).sort(), ['due', 'overdue', 'total', 'withReminder']);
  assert.equal(result.leads[0].name, 'A');
});

test('an NPI search also finds the lead whose business holds that NPI as another location', async () => {
  const db = recordingDb();
  await listClaimedPage(db, { id: 'u1', displayName: 'Ana' }, parseListParams({ q: '1134722390' }, NOW));
  const lookup = db.log.find((e) => !e.head && e.calls.some((c) => c[0] === 'eq' && c[1] === 'npi'));
  assert.ok(lookup, 'the NPI is looked up for its group');
});

test('due leads are the ones to notify about, once each', async () => {
  const db = { from: () => ({ select: () => {
    const q = new Proxy({}, { get(_, m) { return m === 'then' ? (res) => res({ data: [{ npi: '1', company_name: 'A', reminder_at: '2026-10-07T10:00:00Z', meeting_at: '2026-10-08T10:00:00Z', meeting_remind_before_min: 60 }], error: null }) : () => q; } });
    return q;
  } }) };
  const due = await getDueLeads(db, { id: 'u1' }, NOW);
  assert.equal(due.length, 1, 'the same lead from both queries appears once');
  assert.deepEqual([due[0].npi, due[0].meetingRemindBeforeMin], ['1', 60]);
});

// ---- Today ---------------------------------------------------------------------------------

test('Today sorts leads into what needs doing', () => {
  const leads = [
    lead('1', { meetingAt: iso(NOW - 3 * 3600_000) }),                       // meeting passed: how did it go?
    lead('2', { meetingAt: iso(NOW + 3 * 3600_000) }),                       // meeting later today
    lead('3', { meetingAt: iso(NOW + 3 * DAY) }),                            // meeting in a few days
    lead('4', { reminderAt: iso(NOW - DAY), status: 'voicemail' }),          // overdue callback
    lead('5', { reminderAt: iso(NOW + 2 * 3600_000), status: 'voicemail' }), // callback later today
    lead('6', { reminderAt: iso(NOW + 2 * DAY), status: 'voicemail' }),      // callback later
    lead('7', {}),                                                           // never called
    lead('8', { status: 'voicemail', notes: line(NOW - DAY, 'Ana Lopez', 'Voicemail'), lastUpdated: iso(NOW - DAY) }),
  ];
  const v = buildTodayView(leads, opts);
  assert.deepEqual(v.review.map((l) => l.npi), ['1']);
  assert.deepEqual(v.meetingsToday.map((l) => l.npi), ['2']);
  assert.deepEqual(v.callbacks.map((l) => l.npi), ['4', '5']);
  assert.equal(v.callbacksTotal, 2);
  assert.deepEqual(v.firstCalls.items.map((l) => l.npi), ['7']);
  assert.equal(v.nextMeeting.npi, '3');
  assert.deepEqual(v.comingUp.map((c) => [c.npi, c.kind]), [['6', 'Callback'], ['3', 'Meeting']]);
  assert.equal(v.totals.claimed, 8);
});

test('stale means quiet for N days with nothing coming up, and not won, lost or refused', () => {
  const quiet = lead('1', { status: 'voicemail', lastUpdated: iso(NOW - 20 * DAY) });
  assert.equal(isStale(quiet, NOW, 14), true);
  assert.equal(isStale({ ...quiet, lastUpdated: iso(NOW - 5 * DAY) }, NOW, 14), false, 'recent');
  assert.equal(isStale({ ...quiet, reminderAt: iso(NOW + DAY) }, NOW, 14), false, 'a callback is set');
  assert.equal(isStale({ ...quiet, meetingAt: iso(NOW + DAY) }, NOW, 14), false, 'a meeting is coming');
  assert.equal(isStale({ ...quiet, status: 'Not interested' }, NOW, 14), false);
  assert.equal(isStale({ ...quiet, status: 'Onboarded' }, NOW, 14), false);
  assert.equal(isStale({ ...quiet, notes: line(NOW - 2 * DAY, 'Ana Lopez', 'Called') }, NOW, 14), false, 'a recent note counts as activity');
  const v = buildTodayView([quiet, lead('2', { status: 'voicemail', claimedAt: iso(NOW - 45 * DAY), lastUpdated: iso(NOW - 40 * DAY) })], opts);
  assert.deepEqual(v.stale.items.map((l) => [l.npi, l.quietDays]), [['2', 40], ['1', 20]], 'the coldest first');
  assert.equal(v.stale.total, 2);
});

test('Today\'s numbers follow the rep\'s own day, week and streak', () => {
  const calls = [
    line(Date.parse('2026-10-07T13:00:00Z'), 'Ana Lopez', 'Voicemail'),            // today
    line(Date.parse('2026-10-07T12:00:00Z'), 'Ana Lopez', 'Spoke to the owner'),    // today
    line(Date.parse('2026-10-06T12:00:00Z'), 'Ana Lopez', 'Called'),                // yesterday
    line(Date.parse('2026-10-05T12:00:00Z'), 'Ana Lopez', 'Called'),                // Monday
    line(Date.parse('2026-10-03T12:00:00Z'), 'Ana Lopez', 'Called'),                // last week, a gap before it
    line(Date.parse('2026-10-07T11:00:00Z'), 'Ben Arthur', 'Called'),               // someone else's
    line(Date.parse('2026-10-07T09:00:00Z'), 'Ana Lopez', 'Meeting held — went well'),
  ].join('\n');
  const v = buildTodayView([lead('1', { status: 'voicemail', notes: calls })], opts);
  assert.deepEqual([v.stats.callsToday, v.stats.callsWeek, v.stats.heldWeek], [2, 4, 1]);
  assert.equal(v.stats.streak, 3, 'Oct 5, 6 and 7 in a row; Oct 4 is a gap');
  assert.equal(v.recent[0].text, 'Voicemail');
  // A rep west of UTC: 01:00 UTC on the 8th is still the 7th for them.
  const late = buildTodayView([lead('1', { status: 'voicemail', notes: line(Date.parse('2026-10-08T01:00:00Z'), 'Ana Lopez', 'Called') })],
    { ...opts, nowMs: Date.parse('2026-10-08T02:00:00Z'), tzOffsetMin: 300, startOfDayMs: Date.parse('2026-10-07T05:00:00Z'), endOfDayMs: Date.parse('2026-10-08T04:59:59Z') });
  assert.equal(late.stats.callsToday, 1);
  assert.equal(late.stats.streak, 1);
});

test('an empty list is fine', () => {
  const v = buildTodayView([], opts);
  assert.deepEqual([v.totals.claimed, v.review.length, v.firstCalls.total, v.stale.total, v.stats.streak], [0, 0, 0, 0, 0]);
});
