import test from 'node:test';
import assert from 'node:assert/strict';
import { quietDaysOf } from '../src/lib/leadView.js';
import { toLeadDTO } from '../src/repos/leadsRepo.js';
import { noteKind } from '../src/lib/teamActivity.js';
import { reassignStaleLeads } from '../src/repos/adminRepo.js';

const NOW = Date.parse('2026-10-21T12:00:00Z');
const day = (n) => new Date(NOW - n * 86_400_000).toISOString();

test('quiet days count from the last activity, and are blank when something is scheduled or finished', () => {
  const lead = { status: 'voicemail', lastUpdated: day(40), claimedAt: day(60), notes: '' };
  assert.equal(quietDaysOf(lead, NOW), 40);
  assert.equal(quietDaysOf({ ...lead, status: 'not interested' }, NOW), null);
  assert.equal(quietDaysOf({ ...lead, reminderAt: new Date(NOW + 86_400_000).toISOString() }, NOW), null);
  assert.equal(quietDaysOf({ ...lead, meetingAt: new Date(NOW + 86_400_000).toISOString() }, NOW), null);
  assert.equal(quietDaysOf({ ...lead, notes: `${day(3).slice(0, 10)} 10:00 — Ana: Called` }, NOW), 3);
});

test('the claimed lead carries its quiet days', () => {
  // toLeadDTO reads the real clock, so these dates are counted back from it, not from the fixed NOW above
  // (with NOW it only passed within two days of 2026-10-21).
  const ago = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
  const dto = toLeadDTO({ npi: '1234567890', status: 'voicemail', status_updated_at: ago(30), claimed_at: ago(50), notes: '' }, 'Ana');
  assert.ok(dto.quietDays >= 29 && dto.quietDays <= 31);
});

test('a reassignment line is context, not a call', () => {
  assert.equal(noteKind('Reassigned by Boss from Ana. It had been quiet for 30+ days.'), 'import');
});

const row = (npi, extra = {}) => ({ id: 'id' + npi, npi, company_name: 'Lead ' + npi, state: 'FL', specialty: 'DME', claimed_by: 'u1', claimed_at: day(60), status: 'voicemail', status_updated_at: day(45), notes: '', reminder_at: null, meeting_at: null, is_disconnected: false, group_id: 'g' + npi, ...extra });

function fakeDb(rows, { target = { id: 'u2', display_name: 'Ben', disabled_at: null } } = {}) {
  const log = { rpc: [], updates: [] };
  return {
    log,
    from(name) {
      let filter = null; let eqId = null;
      const q = {
        select() { return q; }, not() { return q; }, order() { return q; },
        eq(col, v) { if (col === 'id') eqId = v; return q; },
        in(_c, vals) { filter = vals; return q; },
        maybeSingle: async () => ({ data: target, error: null }),
        range: async (from) => ({ data: from === 0 ? (filter ? rows.filter((r) => filter.includes(r.npi)) : rows) : [], error: null }),
        update(patch) { log.updates.push({ patch, get id() { return eqId; } }); return q; },
        then(res, rej) { return Promise.resolve({ data: name === 'app_users' ? [{ id: 'u1', display_name: 'Ana' }, { id: 'u2', display_name: 'Ben' }] : [], error: null }).then(res, rej); },
      };
      return q;
    },
    rpc: async (fn, args) => { log.rpc.push([fn, args]); return { data: { moved: rows.filter((r) => r.group_id === args.p_group_id).map((r) => ({ npi: r.npi })), skipped: [] }, error: null }; },
  };
}

test('reassigning moves stale leads through the sanctioned function and leaves a note', async () => {
  const rows = [row('1'), row('2', { status_updated_at: day(1) }), row('3', { group_id: null }), row('4', { claimed_by: 'u2' })];
  const db = fakeDb(rows);
  const out = await reassignStaleLeads(db, { id: 'admin1', displayName: 'Boss' }, { npis: ['1', '2', '3', '4'], toUserId: 'u2', days: 30 }, NOW);
  assert.deepEqual(db.log.rpc.map(([fn, a]) => [fn, a.p_group_id, a.p_to_user_id, a.p_approved_by]), [['resolve_ownership_conflict', 'g1', 'u2', 'admin1']]);
  assert.match(db.log.rpc[0][1].p_reason, /Reassigned by an admin: no activity for 30\+ days/);
  assert.equal(out.reassigned, 1);
  assert.equal(out.noGroup, 1);
  assert.equal(out.leftAlone, 2); // one worked since, one already Ben's
  assert.equal(out.to, 'Ben');
  assert.equal(db.log.updates.length, 1);
  assert.match(db.log.updates[0].patch.notes, /Boss: Reassigned by Boss from Ana\./);
});

test('reassigning needs leads and a live target', async () => {
  const db = fakeDb([row('1')]);
  await assert.rejects(() => reassignStaleLeads(db, { id: 'a' }, { npis: [], toUserId: 'u2' }, NOW), (e) => e.status === 400);
  await assert.rejects(() => reassignStaleLeads(db, { id: 'a' }, { npis: ['1'] }, NOW), (e) => e.status === 400);
  const off = fakeDb([row('1')], { target: { id: 'u2', display_name: 'Ben', disabled_at: '2026-01-01' } });
  await assert.rejects(() => reassignStaleLeads(off, { id: 'a' }, { npis: ['1'], toUserId: 'u2' }, NOW), (e) => e.status === 400 && /disabled/.test(e.message));
});

test('sending stale leads to Disconnected marks only the still-stale ones and notes why', async () => {
  const { disconnectStaleLeads } = await import('../src/repos/adminRepo.js');
  const rows = [row('1'), row('2', { status_updated_at: day(1) })];
  const db = fakeDb(rows);
  const out = await disconnectStaleLeads(db, { id: 'admin1', displayName: 'Boss' }, { npis: ['1', '2'], days: 30 }, NOW);
  assert.deepEqual(out, { disconnected: 1, leftAlone: 1 });
  assert.equal(db.log.updates.length, 1);
  assert.equal(db.log.updates[0].patch.is_disconnected, true);
  assert.equal(db.log.updates[0].patch.status, 'disconnected');
  assert.equal(db.log.updates[0].patch.status_updated_by, 'admin1');
  assert.match(db.log.updates[0].patch.notes, /Boss: Disconnected by Boss\. No activity for 30\+ days\./);
  assert.equal(noteKind('Disconnected by Boss. No activity for 30+ days.'), 'import');
  await assert.rejects(() => disconnectStaleLeads(db, { id: 'a' }, { npis: [] }, NOW), (e) => e.status === 400);
});
