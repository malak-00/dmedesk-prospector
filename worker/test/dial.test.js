import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTeamActivity, callEvents, noteKind } from '../src/lib/teamActivity.js';
import { buildTodayView } from '../src/lib/leadView.js';
import { leadStages } from '../src/lib/funnel.js';
import { logDial } from '../src/repos/leadsRepo.js';

const T = (iso) => Date.parse(iso);
const stamp = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
const line = (ms, who, text) => `${stamp(ms)} — ${who}: ${text}`;
const MIN = 60_000;

test('a tap on a phone number is its own kind of call-log line', () => {
  assert.equal(noteKind('Dialed (404) 808-5118'), 'dial');
  assert.equal(noteKind('Voicemail'), 'call');
});

test('a tap counts as a call, and a result logged soon after it is the same call', () => {
  const base = T('2026-10-07T14:00:00Z');
  const parse = (notes) => notes.split('\n').map((raw) => {
    const m = /^(\S+) (\S+) — (.+?): (.*)$/.exec(raw);
    return { date: m[1], time: m[2], by: m[3], text: m[4] };
  });
  const one = callEvents(parse([line(base, 'Ana', 'Dialed (404) 808-5118')].join('\n')));
  assert.equal(one.length, 1, 'a tap on its own is a call');

  const paired = callEvents(parse([line(base + 5 * MIN, 'Ana', 'Voicemail'), line(base, 'Ana', 'Dialed (404) 808-5118')].join('\n')));
  assert.equal(paired.length, 1, 'the tap and its result are one call');

  const later = callEvents(parse([line(base + 45 * MIN, 'Ana', 'Voicemail'), line(base, 'Ana', 'Dialed (404) 808-5118')].join('\n')));
  assert.equal(later.length, 2, 'a result 45 minutes later is another call');

  const twoTaps = callEvents(parse([line(base + 40 * MIN, 'Ana', 'Dialed (404) 808-5118'), line(base, 'Ana', 'Dialed (404) 808-5118')].join('\n')));
  assert.equal(twoTaps.length, 2, 'ringing again later is another call');

  const resultOnly = callEvents(parse([line(base, 'Ana', 'Spoke to the owner')].join('\n')));
  assert.equal(resultOnly.length, 1, 'a result with no tap still counts (a call made from a desk phone)');

  const otherPerson = callEvents(parse([line(base + 5 * MIN, 'Ben', 'Voicemail'), line(base, 'Ana', 'Dialed (404) 808-5118')].join('\n')));
  assert.equal(otherPerson.length, 2, 'someone else\'s result is not Ana\'s call');

  const resultsAfterOneTap = callEvents(parse([line(base + 9 * MIN, 'Ana', 'Spoke to the owner'), line(base + 5 * MIN, 'Ana', 'Voicemail'), line(base, 'Ana', 'Dialed (404) 808-5118')].join('\n')));
  assert.equal(resultsAfterOneTap.length, 2, 'one tap covers one result; a second result is another call');
});

test('team activity and Today count taps as calls', () => {
  const now = new Date('2026-10-07T18:00:00Z');
  const base = T('2026-10-07T14:00:00Z');
  const notes = [
    line(base + 5 * MIN, 'Ana Lopez', 'Voicemail'),           // the result of the first tap
    line(base, 'Ana Lopez', 'Dialed (404) 808-5118'),         // call 1
    line(base - 3 * 60 * MIN, 'Ana Lopez', 'Dialed (404) 808-5118'), // call 2, a separate tap
  ].join('\n');
  const users = [{ id: 'a', display_name: 'Ana Lopez' }];
  const team = buildTeamActivity({ users, events: [], leads: [{ claimed_by: 'a', is_disconnected: false, notes }], weeks: 1, now });
  assert.equal(team.reps.find((r) => r.id === 'a').calls[0], 2);

  const lead = { npi: '1', name: 'Co', status: 'new', notes, claimedAt: '2026-09-01T00:00:00Z', lastUpdated: '2026-09-01T00:00:00Z' };
  const view = buildTodayView([lead], {
    nowMs: now.getTime(), startOfDayMs: T('2026-10-07T00:00:00Z'), endOfDayMs: T('2026-10-07T23:59:59Z'),
    startOfWeekMs: T('2026-10-05T00:00:00Z'), tzOffsetMin: 0, staleDays: 14, me: 'Ana Lopez',
  });
  assert.equal(view.stats.callsToday, 2);
  assert.equal(view.stats.streak, 1);
});

test('a lead that was only dialed counts as contacted in the funnel', () => {
  assert.equal(leadStages({ status: 'new', notes: line(T('2026-10-07T14:00:00Z'), 'Ana', 'Dialed (404) 808-5118') }).contacted, true);
});

// ---- taps kept in their own table: claimed or not ---------------------------------------------

import { tapsToLines, allCallEvents, parseNoteLines } from '../src/lib/teamActivity.js';

test('a tap on a lead nobody has claimed still counts, and pairs with the result once it is claimed', () => {
  const base = T('2026-10-07T14:00:00Z');
  const users = [{ id: 'a', display_name: 'Ana Lopez' }];
  const nameOf = (id) => (id === 'a' ? 'Ana Lopez' : '');
  const taps = [
    { user_id: 'a', npi: '1111111111', tapped_at: new Date(base).toISOString() },           // claimed afterwards, result logged 5 minutes later
    { user_id: 'a', npi: '2222222222', tapped_at: new Date(base + 20 * MIN).toISOString() }, // never claimed
  ];
  const lead = { npi: '1111111111', claimed_by: 'a', is_disconnected: false, notes: line(base + 5 * MIN, 'Ana Lopez', 'Voicemail') };

  const events = allCallEvents([{ npi: lead.npi, lines: parseNoteLines(lead.notes) }], tapsToLines(taps, nameOf));
  assert.equal(events.length, 2, 'one call for the claimed lead (tap + result), one for the unclaimed lead');

  const team = buildTeamActivity({ users, events: [], leads: [lead], taps, weeks: 1, now: new Date('2026-10-07T18:00:00Z') });
  assert.equal(team.reps.find((r) => r.id === 'a').calls[0], 2);

  const view = buildTodayView([{ npi: lead.npi, name: 'Co', status: 'voicemail', notes: lead.notes, claimedAt: '2026-09-01T00:00:00Z', lastUpdated: '2026-09-01T00:00:00Z' }], {
    nowMs: T('2026-10-07T18:00:00Z'), startOfDayMs: T('2026-10-07T00:00:00Z'), endOfDayMs: T('2026-10-07T23:59:59Z'),
    startOfWeekMs: T('2026-10-05T00:00:00Z'), tzOffsetMin: 0, staleDays: 14, me: 'Ana Lopez', taps,
  });
  assert.equal(view.stats.callsToday, 2);
});

test('taps by other people are not mine, and a different lead is a different call', () => {
  const base = T('2026-10-07T14:00:00Z');
  const nameOf = (id) => ({ a: 'Ana Lopez', b: 'Ben Arthur' }[id]);
  const taps = [
    { user_id: 'a', npi: '1111111111', tapped_at: new Date(base).toISOString() },
    { user_id: 'b', npi: '1111111111', tapped_at: new Date(base + MIN).toISOString() },
    { user_id: 'a', npi: '3333333333', tapped_at: new Date(base + 2 * MIN).toISOString() },
  ];
  const events = allCallEvents([], tapsToLines(taps, nameOf));
  assert.equal(events.length, 3);
  assert.deepEqual(events.map((e) => e.by).sort(), ['Ana Lopez', 'Ana Lopez', 'Ben Arthur']);
});

function tapDb({ tableMissing = false, owned = false } = {}) {
  const state = { taps: [], notes: '' };
  const from = (table) => {
    let patch = null;
    let inserted = null;
    let wantRecent = false;
    const q = {
      select: () => q, eq: () => q, maybeSingle: () => q, limit: () => q,
      gte() { wantRecent = true; return q; },
      insert(row) { inserted = row; return q; },
      update(p) { patch = p; return q; },
      then(resolve) {
        if (table === 'call_taps') {
          if (tableMissing) return resolve({ data: null, error: { code: '42P01', message: 'relation "public.call_taps" does not exist' } });
          if (inserted) { state.taps.push({ ...inserted, tapped_at: new Date().toISOString() }); return resolve({ data: null, error: null }); }
          if (wantRecent) return resolve({ data: state.taps.filter((t) => Date.now() - Date.parse(t.tapped_at) < 120_000).map((t) => ({ id: 1 })), error: null });
        }
        if (table === 'leads') {
          if (patch) { state.notes = patch.notes; return resolve({ data: null, error: null }); }
          return resolve({ data: owned ? { npi: '1', notes: state.notes } : null, error: null });
        }
        return resolve({ data: [], error: null });
      },
    };
    return q;
  };
  return { state, from };
}

test('a tap on any lead is recorded once per two minutes', async () => {
  const db = tapDb();
  const session = { id: 'a', displayName: 'Ana Lopez' };
  assert.equal((await logDial(db, '1111111111', '+14048085118', session)).logged, true);
  assert.equal(db.state.taps[0].number, '+14048085118');
  assert.equal((await logDial(db, '1111111111', '4048085118', session)).logged, false, 'a second tap straight after is the same call');
  assert.equal(db.state.taps.length, 1);
  await assert.rejects(logDial(db, '1111111111', '', session), /number is required/);
  await assert.rejects(logDial(db, '12', '4048085118', session), /10-digit NPI/);
});

test('before sql/029 a tap on your own lead goes in its call log; on any other lead it cannot be kept', async () => {
  const mine = tapDb({ tableMissing: true, owned: true });
  const saved = await logDial(mine, '1234567890', '4048085118', { id: 'a', displayName: 'Ana Lopez' });
  assert.equal(saved.logged, true);
  assert.match(mine.state.notes, /Ana Lopez: Dialed \(404\) 808-5118$/);

  const notMine = tapDb({ tableMissing: true, owned: false });
  const result = await logDial(notMine, '1234567890', '4048085118', { id: 'a', displayName: 'Ana Lopez' });
  assert.deepEqual([result.logged, result.unavailable], [false, true]);
});
