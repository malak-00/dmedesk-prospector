import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStaleList, pickHandBack, cleanDays, MIN_DAYS, MAX_DAYS, DEFAULT_DAYS } from '../src/lib/staleLeads.js';
import { getStaleLeads, handBackStaleLeads } from '../src/repos/adminRepo.js';

const NOW = Date.parse('2026-10-21T12:00:00Z');
const names = new Map([['u1', 'Ana'], ['u2', 'Ben']]);
const day = (n) => new Date(NOW - n * 86_400_000).toISOString();
const note = (n, text) => `${day(n).slice(0, 10)} 10:00 — Ana: ${text}`;
const row = (npi, extra = {}) => ({ id: 'id' + npi, npi, company_name: 'Lead ' + npi, state: 'FL', specialty: 'DME', claimed_by: 'u1', claimed_at: day(60), status: 'voicemail', status_updated_at: day(45), notes: note(45, 'Voicemail'), reminder_at: null, meeting_at: null, is_disconnected: false, ...extra });

test('days are clamped to a sensible range', () => {
  assert.equal(cleanDays('30'), 30);
  assert.equal(cleanDays(3), MIN_DAYS);
  assert.equal(cleanDays(9999), MAX_DAYS);
  assert.equal(cleanDays('abc'), DEFAULT_DAYS);
});

test('a stale lead is quiet for the period, with nothing coming up and not finished', () => {
  const rows = [
    row('1'), // 45 days quiet
    row('2', { status_updated_at: day(5), notes: note(5, 'Voicemail') }), // worked recently
    row('3', { reminder_at: new Date(NOW + 86_400_000).toISOString() }), // a callback is coming
    row('4', { meeting_at: new Date(NOW + 3 * 86_400_000).toISOString() }), // a meeting is coming
    row('5', { status: 'not interested' }), // refused
    row('6', { claimed_by: 'u2', status_updated_at: day(90), notes: note(90, 'No answer') }),
    row('7', { is_disconnected: true }),
    row('8', { claimed_by: null }),
  ];
  const out = buildStaleList(rows, names, NOW, 30);
  assert.deepEqual(out.items.map((i) => i.npi), ['6', '1']); // longest quiet first
  assert.equal(out.items[1].quietDays, 45);
  assert.equal(out.items[0].rep, 'Ben');
  assert.equal(out.total, 2);
  assert.deepEqual(out.reps.map((r) => [r.rep, r.count]), [['Ana', 1], ['Ben', 1]]);
  assert.equal(buildStaleList(rows, names, NOW, 60).items.length, 1); // only the 90-day one
});

test('a call-log line newer than the status stamp counts as activity', () => {
  const out = buildStaleList([row('1', { notes: note(3, 'Callback') })], names, NOW, 30);
  assert.equal(out.total, 0);
});

test('hand-back only takes leads that are still stale, grouped by owner', () => {
  const rows = [row('1'), row('2', { claimed_by: 'u2', status_updated_at: day(80), notes: note(80, 'No answer') }), row('3', { status_updated_at: day(1), notes: note(1, 'Interested') })];
  const { byOwner, kept } = pickHandBack(rows, ['1', '2', '3', '999'], names, NOW, 30);
  assert.deepEqual([...byOwner.entries()], [['u2', ['2']], ['u1', ['1']]]);
  assert.equal(kept, 2); // one worked since the list loaded, one that is not claimed any more
});

// ---- the repo, against a small fake ----

function fakeDb(rows, { rpcError = null } = {}) {
  const log = { rpc: [], events: [] };
  return {
    log,
    from(name) {
      let filter = null;
      const q = {
        select() { return q; }, not() { return q; }, eq() { return q; }, order() { return q; },
        in(_c, vals) { filter = vals; return q; },
        range: async (from) => ({ data: from === 0 ? (filter ? rows.filter((r) => filter.includes(r.npi)) : rows) : [], error: null }),
        insert: async (list) => { log.events.push(...list); return { error: null }; },
        then(res, rej) { return Promise.resolve({ data: name === 'app_users' ? [{ id: 'u1', display_name: 'Ana' }, { id: 'u2', display_name: 'Ben' }] : [], error: null }).then(res, rej); },
      };
      return q;
    },
    rpc: async (fn, args) => { log.rpc.push([fn, args]); return rpcError ? { data: null, error: rpcError } : { data: { released_count: args.p_npis.length, not_found: [] }, error: null }; },
  };
}

test('listing reads claimed leads and names the owners', async () => {
  const out = await getStaleLeads(fakeDb([row('1'), row('2', { status_updated_at: day(2), notes: note(2, 'x') })]), { days: '30', now: NOW });
  assert.equal(out.total, 1);
  assert.equal(out.items[0].rep, 'Ana');
});

test('handing back releases through the sanctioned function per owner and writes an admin event', async () => {
  const rows = [row('1'), row('2', { claimed_by: 'u2', status_updated_at: day(80), notes: note(80, 'No answer') }), row('3', { status_updated_at: day(1), notes: note(1, 'Interested') })];
  const db = fakeDb(rows);
  const out = await handBackStaleLeads(db, { id: 'admin1', displayName: 'Boss' }, { npis: ['1', '2', '3'], days: 30 }, NOW);
  assert.deepEqual(out, { returned: 2, leftAlone: 1 });
  assert.deepEqual(db.log.rpc.map(([fn, a]) => [fn, a.p_user_id, a.p_npis]), [['release_claimed_leads', 'u2', ['2']], ['release_claimed_leads', 'u1', ['1']]]);
  assert.equal(db.log.events.length, 2);
  assert.equal(db.log.events[0].source, 'admin_stale_handback');
  assert.equal(db.log.events[0].approved_by, 'admin1');
  assert.match(db.log.events[0].reason, /Handed back by an admin: no activity for 30\+ days/);
  await assert.rejects(() => handBackStaleLeads(db, { id: 'a' }, { npis: [] }, NOW), (e) => e.status === 400);
  await assert.rejects(() => handBackStaleLeads(db, { id: 'a' }, { npis: Array.from({ length: 201 }, (_, i) => String(1000 + i)) }, NOW), (e) => e.status === 400);
});

test('if the release function is missing, the admin is told which file to run', async () => {
  const db = fakeDb([row('1')], { rpcError: { code: 'PGRST202', message: 'Could not find the function public.release_claimed_leads' } });
  await assert.rejects(() => handBackStaleLeads(db, { id: 'a' }, { npis: ['1'] }, NOW), (e) => e.status === 503 && /sql\/013/.test(e.message));
});
