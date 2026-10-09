import test from 'node:test';
import assert from 'node:assert/strict';
import { getSheetSyncStatus } from '../src/repos/leadsRepo.js';

const bot = { id: 'bot', username: 'bd-meetings-bot' };

function fakeDb({ caller = { id: 'bot', is_admin: false, can_claim_for_others: true }, leads = [], users = [] } = {}) {
  const calls = [];
  return {
    calls,
    from(name) {
      let single = false;
      const filters = {};
      const q = {
        select: () => q,
        eq: (column, value) => { calls.push([name, 'eq', column, value]); filters[column] = value; return q; },
        not: (column, operator, value) => { calls.push([name, 'not', column, operator, value]); filters[`${column}:${operator}`] = value; return q; },
        in: (column, values) => { calls.push([name, 'in', column, values]); return q; },
        maybeSingle: () => { single = true; return q; },
        then: (resolve) => {
          if (name === 'app_users' && single) return resolve({ data: caller, error: null });
          const activeLeads = leads.filter((lead) =>
            (filters.is_disconnected !== false || lead.is_disconnected === false || lead.is_disconnected == null) &&
            (!filters['claimed_by:is'] || lead.claimed_by != null),
          );
          return resolve({ data: name === 'leads' ? activeLeads : users, error: null });
        },
      };
      return q;
    },
  };
}

test('returns active claimed leads with their owner details', async () => {
  const db = fakeDb({
    leads: [{ npi: '1689470692', claimed_by: 'owner-1', claimed_at: '2026-10-01T09:00:00Z', status: 'called', status_updated_at: '2026-10-03T10:00:00Z' }],
    users: [{ id: 'owner-1', display_name: 'Ben Arthur', username: 'ben.arthur.wiz@gmail.com' }],
  });
  const result = await getSheetSyncStatus(db, bot, ['1689470692']);
  assert.deepEqual(result, {
    leads: [{ npi: '1689470692', ownerId: 'owner-1', ownerName: 'Ben Arthur', ownerUsername: 'ben.arthur.wiz@gmail.com', claimedAt: '2026-10-01T09:00:00Z', status: 'called', statusUpdatedAt: '2026-10-03T10:00:00Z' }],
    missingNpis: [],
  });
  assert.ok(db.calls.some((call) => call.join('|') === 'leads|eq|is_disconnected|false'));
  assert.ok(db.calls.some((call) => call[0] === 'leads' && call[1] === 'not' && call[2] === 'claimed_by' && call[3] === 'is' && call[4] === null));
});

test('allows delegated claim-for-others access but rejects callers without it', async () => {
  await getSheetSyncStatus(fakeDb(), bot, ['1689470692']);
  await assert.rejects(
    getSheetSyncStatus(fakeDb({ caller: { id: 'other', is_admin: false, can_claim_for_others: false } }), bot, ['1689470692']),
    (error) => error.status === 403,
  );
});

test('returns unmatched and disconnected NPIs as missing', async () => {
  const db = fakeDb({ leads: [{ npi: '1689470692', claimed_by: 'owner-1', is_disconnected: true }] });
  const result = await getSheetSyncStatus(db, bot, ['1689470692', '1821921602']);
  assert.deepEqual(result, { leads: [], missingNpis: ['1689470692', '1821921602'] });
  assert.ok(db.calls.some((call) => call.join('|') === 'leads|eq|is_disconnected|false'));
});

test('normalizes and deduplicates NPIs, while rejecting invalid and oversized input', async () => {
  const db = fakeDb({ leads: [{ npi: '1689470692', claimed_by: 'owner-1' }], users: [{ id: 'owner-1', display_name: 'Ben', username: 'ben@example.com' }] });
  const result = await getSheetSyncStatus(db, bot, ['168-947-0692', '1689470692']);
  assert.deepEqual(result.missingNpis, []);
  assert.equal(result.leads.length, 1);
  await assert.rejects(getSheetSyncStatus(fakeDb(), bot, ['not-an-npi']), (error) => error.status === 400);
  await assert.rejects(getSheetSyncStatus(fakeDb(), bot, Array.from({ length: 201 }, (_, index) => String(1_000_000_000 + index))), (error) => error.status === 400);
});
