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

// ---- recording a tap ----------------------------------------------------------------------

function leadsDb(row) {
  const state = { row: { ...row } };
  const from = () => {
    let patch = null;
    let owner = null;
    const q = {
      select: () => q, maybeSingle: () => q,
      eq(col, value) { if (col === 'claimed_by') owner = value; return q; },
      update(p) { patch = p; return q; },
      then(resolve) {
        if (patch) { Object.assign(state.row, patch); return resolve({ data: null, error: null }); }
        return resolve({ data: state.row.claimed_by === owner ? { npi: state.row.npi, notes: state.row.notes } : null, error: null });
      },
    };
    return q;
  };
  return { state, from };
}

test('a tap is saved as a "Dialed" line, formatted, once per two minutes', async () => {
  const db = leadsDb({ npi: '1', claimed_by: 'a', notes: '' });
  const session = { id: 'a', displayName: 'Ana Lopez' };
  const first = await logDial(db, '1', 'tel:+14048085118'.replace('tel:', ''), session);
  assert.equal(first.logged, true);
  assert.match(db.state.row.notes, /Ana Lopez: Dialed \(404\) 808-5118$/);
  const again = await logDial(db, '1', '4048085118', session);
  assert.equal(again.logged, false, 'a second tap straight after is the same call');
  assert.equal(db.state.row.notes.split('\n').length, 1);
  await assert.rejects(logDial(db, '1', '', session), /number is required/);
  await assert.rejects(logDial(db, '1', '4048085118', { id: 'someone-else', displayName: 'Ben' }), { status: 404 });
});
