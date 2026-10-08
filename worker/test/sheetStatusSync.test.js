import test from 'node:test';
import assert from 'node:assert/strict';
import { syncLeadStatusesFromSheet } from '../src/repos/leadsRepo.js';

const bot = { id: 'bot', username: 'bd-bot' };

function fakeDb({ rows = [], caller = { id: 'bot', is_admin: false, can_claim_for_others: true } } = {}) {
  const updates = [];
  return {
    updates,
    from(name) {
      if (name === 'app_users') {
        let single = false;
        const q = {
          select: () => q, eq: () => q, ilike: () => q, limit: () => q,
          maybeSingle: () => { single = true; return q; },
          then: (resolve) => resolve(single
            ? { data: caller, error: null }
            : { data: [{ id: 'u1', username: 'ben', display_name: 'Ben Arthur' }], error: null }),
        };
        return q;
      }
      const q = {
        select: () => q, eq: () => q, in: () => q,
        then: (resolve) => resolve({ data: rows, error: null }),
        update: (patch) => {
          const filters = {};
          const u = {
            eq: (col, val) => { filters[col] = val; return u; },
            then: (resolve) => { updates.push({ patch, filters }); resolve({ error: null }); },
          };
          return u;
        },
      };
      return q;
    },
  };
}

const lead = (over) => ({ npi: '1134722390', status: 'new', status_updated_at: '2026-09-01T00:00:00Z', ...over });

test('the sheet status overwrites the app status, dated by the sheet\'s Last Call', async () => {
  const db = fakeDb({ rows: [lead({})] });
  const r = await syncLeadStatusesFromSheet(db, bot, { username: 'ben', leads: [{ npi: '1134722390', status: 'Onboarded', lastCallAt: '2026-09-20T10:00:00Z' }] });
  assert.deepEqual(r.updated, ['1134722390']);
  assert.equal(db.updates[0].patch.status, 'onboarded', 'tidied to the standard spelling');
  assert.equal(db.updates[0].patch.status_updated_at, '2026-09-20T10:00:00.000Z');
  assert.equal(db.updates[0].patch.status_updated_by, 'bot');
  assert.equal(db.updates[0].filters.is_disconnected, false, 'a disconnected lead is never touched');
});

test('an unchanged status with an older call date writes nothing', async () => {
  const db = fakeDb({ rows: [lead({ status: 'onboarded' })] });
  const r = await syncLeadStatusesFromSheet(db, bot, { username: 'ben', leads: [{ npi: '1134722390', status: 'Onboarded', lastCallAt: '2026-08-01T00:00:00Z' }] });
  assert.deepEqual(r.unchanged, ['1134722390']);
  assert.equal(db.updates.length, 0);
});

test('a newer Last Call moves only the call date, not the status or who set it', async () => {
  const db = fakeDb({ rows: [lead({ status: 'onboarded' })] });
  await syncLeadStatusesFromSheet(db, bot, { username: 'ben', leads: [{ npi: '1134722390', status: 'Onboarded', lastCallAt: '2026-09-15T00:00:00Z' }] });
  assert.deepEqual(db.updates[0].patch, { status_updated_at: '2026-09-15T00:00:00.000Z' });
});

test('a lead the teammate does not hold is reported, not changed', async () => {
  const db = fakeDb({ rows: [] });
  const r = await syncLeadStatusesFromSheet(db, bot, { username: 'ben', leads: [{ npi: '1134722390', status: 'Onboarded' }] });
  assert.deepEqual(r.notOwned, ['1134722390']);
  assert.equal(db.updates.length, 0);
});

test('disconnected, junk, invalid, duplicate and empty rows are skipped with a reason', async () => {
  const db = fakeDb({ rows: [lead({})] });
  const r = await syncLeadStatusesFromSheet(db, bot, {
    username: 'ben',
    leads: [
      { npi: '1134722390', status: 'Disconnected' },
      { npi: '1114282688', status: 'asdf' },
      { npi: '123', status: 'Onboarded' },
      { npi: '1134722390', status: 'Onboarded' },
      { npi: '1679248447' },
    ],
  });
  assert.deepEqual(r.skipped.map((s) => s.reason), ['disconnected_not_synced', 'junk_status', 'invalid_npi', 'duplicate_in_request', 'nothing_to_sync']);
  assert.equal(db.updates.length, 0);
});

test('a call date in the future is ignored', async () => {
  const db = fakeDb({ rows: [lead({ status: 'onboarded' })] });
  const r = await syncLeadStatusesFromSheet(db, bot, { username: 'ben', leads: [{ npi: '1134722390', status: 'Onboarded', lastCallAt: '2999-01-01T00:00:00Z' }] });
  assert.deepEqual(r.unchanged, ['1134722390']);
  assert.equal(db.updates.length, 0);
});

test('an account without permission cannot sync', async () => {
  const db = fakeDb({ caller: { id: 'x', is_admin: false, can_claim_for_others: false } });
  await assert.rejects(
    syncLeadStatusesFromSheet(db, bot, { username: 'ben', leads: [{ npi: '1134722390', status: 'Onboarded' }] }),
    (err) => err.status === 403,
  );
});
