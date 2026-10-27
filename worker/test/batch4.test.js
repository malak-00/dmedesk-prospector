import test from 'node:test';
import assert from 'node:assert/strict';
import { enrollmentDate, buildEnrollment } from '../src/lib/enrollment.js';
import { buildShifts } from '../src/lib/productMix.js';
import { pickLastTouch } from '../src/lib/lastTouch.js';
import { cleanIntel, shapeIntel, statePattern, winReasonCounts, WIN_REASONS } from '../src/lib/intel.js';
import { getLastTouch } from '../src/repos/lastTouchRepo.js';
import { getStatePattern } from '../src/repos/statePatternRepo.js';

test('the enrollment date comes from the enrollment id', () => {
  assert.equal(enrollmentDate('O20151130001936'), '2015-11-30');
  assert.equal(enrollmentDate('I20031103000001'), '2003-11-03');
  assert.equal(enrollmentDate('nonsense'), null);
  assert.equal(enrollmentDate('O20151330001936'), null); // month 13
});

test('enrollment says whether, since when, and as what', () => {
  assert.deepEqual(buildEnrollment([]), { enrolled: false });
  const e = buildEnrollment([
    { ENRLMT_ID: 'O20190101000002', PROVIDER_TYPE_DESC: 'DME SUPPLIER - CERTIFIED ORTH/PROS/PEDORTHIST' },
    { ENRLMT_ID: 'O20151130001936', PROVIDER_TYPE_DESC: 'PART B SUPPLIER - OTHER' },
  ]);
  assert.equal(e.enrolled, true);
  assert.equal(e.since, '2015-11-30');
  assert.equal(e.dme, true);
  assert.equal(e.enrollments, 2);
  assert.match(e.types[0], /DME Supplier/);
});

const row = (cat, services, avg) => ({ RBCS_Desc: 'DME-' + cat, Tot_Suplr_Srvcs: String(services), Avg_Suplr_Mdcr_Pymt_Amt: String(avg) });

test('shifts name the product categories that moved most between two years', () => {
  const now = [row('Orthotic Devices', 1000, 100), row('Oxygen', 100, 100), row('Wheelchairs', 10, 100)];
  const before = [row('Orthotic Devices', 500, 100), row('Oxygen', 400, 100), row('Wheelchairs', 10, 100)];
  const s = buildShifts(now, before);
  assert.deepEqual(s.moves.map((m) => [m.name, m.kind]), [['Orthotic Devices', 'up'], ['Oxygen', 'down']]);
  assert.equal(s.moves[0].from, 50000);
  assert.equal(s.moves[0].to, 100000);
  assert.equal(buildShifts(now, []), null);
  assert.equal(buildShifts(before, before), null);
});

test('the newest touch wins, whoever made it', () => {
  const t = pickLastTouch([{ at: 1000, by: 'Ana', kind: 'dial' }, { at: 5000, by: 'Ben', kind: 'comment' }, { at: NaN, by: 'x', kind: 'note' }]);
  assert.equal(t.by, 'Ben');
  assert.equal(t.text, 'left a team note');
  assert.equal(pickLastTouch([]), null);
});

const q = (result) => {
  const o = { select() { return o; }, eq() { return o; }, not() { return o; }, or() { return o; }, order() { return o; }, limit() { return o; }, in() { return o; }, then(res, rej) { return Promise.resolve(result).then(res, rej); } };
  return o;
};

test('last touch looks across taps, team notes and the claimed lead log', async () => {
  const db = { from: (t) => q({
    call_taps: { data: [{ user_id: 'u1', tapped_at: '2026-10-01T10:00:00Z' }], error: null },
    lead_comments: { data: [], error: null },
    leads: { data: [{ claimed_by: 'u2', status_updated_at: null, notes: '2026-10-05 09:30 — Ben: Left voicemail\n2026-10-06 09:30 — Ben: Imported from sheet' }], error: null },
    app_users: { data: [{ id: 'u1', display_name: 'Ana' }], error: null },
  }[t]) };
  const out = await getLastTouch(db, '1234567890');
  assert.equal(out.touch.by, 'Ben'); // the import line is context, the voicemail is the newest real touch
  assert.equal(out.touch.at.slice(0, 10), '2026-10-05');
  await assert.rejects(() => getLastTouch(db, 'abc'), (e) => e.status === 400);
});

test('a missing table does not break last touch', async () => {
  const gone = { data: null, error: { code: '42P01', message: 'relation does not exist' } };
  const db = { from: () => q(gone) };
  assert.deepEqual(await getLastTouch(db, '1234567890'), { touch: null });
});

test('why-they-signed is validated and shaped', () => {
  assert.deepEqual(cleanIntel({ winReason: 'Savings' }).patch, { win_reason: 'savings' });
  assert.deepEqual(cleanIntel({ winReason: '' }).patch, { win_reason: null });
  assert.ok(cleanIntel({ winReason: 'vibes' }).error);
  assert.ok(WIN_REASONS.includes('trust'));
  assert.equal(shapeIntel({ win_reason: 'growth' }, 'Ana').winReason, 'growth');
  assert.deepEqual(winReasonCounts([{ win_reason: 'savings' }, { win_reason: 'savings' }, { win_reason: 'trust' }, {}]), [{ reason: 'savings', count: 2 }, { reason: 'trust', count: 1 }]);
});

test('a state pattern needs a few calls and names the common objections and billers', () => {
  const rows = [
    { npi: '1', objection: 'price', current_biller: 'In-house' },
    { npi: '2', objection: 'price', current_biller: 'Acme Billing LLC' },
    { npi: '3', objection: 'bad timing', current_biller: 'Acme Billing' },
    { npi: '4', objection: 'no need', current_biller: '' },
  ];
  const states = new Map([['1', 'FL'], ['2', 'FL'], ['3', 'FL'], ['4', 'TX']]);
  const p = statePattern(rows, states, 'fl');
  assert.equal(p.calls, 3);
  assert.deepEqual(p.objections[0], { reason: 'price', count: 2 });
  assert.equal(p.billers.length, 2);
  assert.equal(statePattern(rows, states, 'TX'), null); // one call is not a pattern
});

test('the state pattern repo joins call intel to the registry state', async () => {
  const db = { from: (t) => q(t === 'lead_intel'
    ? { data: [1, 2, 3].map((n) => ({ npi: String(n), objection: 'price', current_biller: 'X' })), error: null }
    : { data: [1, 2, 3].map((n) => ({ npi: String(n), address_state: 'FL' })), error: null }) };
  const out = await getStatePattern(db, 'fl');
  assert.equal(out.pattern.calls, 3);
  await assert.rejects(() => getStatePattern(db, 'Florida'), (e) => e.status === 400);
  const missing = { from: () => q({ data: null, error: { code: '42P01', message: 'relation does not exist' } }) };
  assert.deepEqual(await getStatePattern(missing, 'FL'), { pattern: null });
});

// ---- the browser modules, loaded the way the other front-end tests do ----
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

test('the call card words enrollment, product shifts, last touch and the local pattern', () => {
  const w = require('../../docs/whycall.js');
  const e = w.describeEnrollment({ enrolled: true, since: '2015-11-30', types: ['DME Supplier - Other'], dme: true });
  assert.match(e.text, /Since 2015/);
  assert.equal(w.describeEnrollment({ enrolled: false }).tone, 'low');
  assert.equal(w.describeEnrollment(null), null);
  const s = w.describeShifts({ year: 2024, previousYear: 2023, moves: [{ name: 'Oxygen', from: 40000, to: 0, kind: 'dropped' }, { name: 'Orthotic Devices', from: 50000, to: 100000, change: 1, kind: 'up' }] });
  assert.match(s.text, /Oxygen: stopped/);
  assert.match(s.text, /Orthotic Devices up 100%/);
  const now = Date.parse('2026-10-27T12:00:00Z');
  assert.equal(w.describeTouch({ at: '2026-10-20T10:00:00Z', by: 'Ana', text: 'dialed the number' }, now).tone, 'mid');
  assert.equal(w.describeTouch({ at: '2026-05-01T10:00:00Z', by: 'Ana' }, now).tone, 'none');
  assert.equal(w.describeTouch(null, now), null);
  assert.match(w.describeStatePattern({ state: 'FL', calls: 3, withObjection: 3, objections: [{ reason: 'price', count: 2 }], billers: [] }).text, /In FL.*"price" \(2 of 3\)/);
  assert.equal(w.describeStatePattern(null), null);
});

test('the call brief includes the new facts when it has them', () => {
  const b = require('../../docs/callbrief.js');
  const brief = b.buildCallBrief({
    company: { npi: '1', name: 'Acme DME', address: { state: 'FL' }, medicare: null },
    enrollment: { enrolled: true, since: '2015-11-30', types: ['DME Supplier - Other'], dme: true },
    touch: { at: '2026-10-20T10:00:00Z', by: 'Ana', text: 'dialed the number' },
    statePattern: { state: 'FL', calls: 3, withObjection: 3, objections: [{ reason: 'price', count: 2 }], billers: [] },
    mix: { categories: [{ name: 'Orthotic Devices', share: 1 }], verticals: [], total: 1000, rentalShare: 0 },
    shifts: { year: 2024, previousYear: 2023, moves: [{ name: 'Orthotic Devices', from: 50000, to: 100000, change: 1, kind: 'up' }] },
    now: Date.parse('2026-10-27T12:00:00Z'),
  });
  const labels = brief.facts.map((f) => f.label);
  for (const label of ['Enrolled', 'Since last year', 'Last touched', 'Local pattern']) assert.ok(labels.includes(label), label);
});

test('the close-reason bar asks about wins and refusals only', () => {
  const r = require('../../docs/closereason.js');
  assert.equal(r.questionFor('onboarded').field, 'winReason');
  assert.equal(r.questionFor('Not interested').field, 'objection');
  assert.equal(r.questionFor('voicemail'), null);
  assert.ok(r.WIN.every(([v]) => ['savings', 'trust', 'bad experience', 'growth', 'compliance', 'timing', 'other'].includes(v)));
});
