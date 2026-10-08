import test from 'node:test';
import assert from 'node:assert/strict';
import { getSheetConflictOwners } from '../src/repos/adminRepo.js';
import { claimForUser } from '../src/repos/leadsRepo.js';
import { flattenCompany } from '../src/lib/csvExport.js';

function fakeDb({ leads = [], users = [] } = {}) {
  const calls = [];
  return {
    calls,
    from(name) {
      const q = {
        select: () => q, eq: (c, v) => { calls.push([name, c, v]); return q; }, not: () => q, in: () => q,
        then: (resolve) => resolve({ data: name === 'leads' ? leads : users, error: null }),
      };
      return q;
    },
  };
}

test('the lookup names each NPI\'s current owner, status and business group', async () => {
  const db = fakeDb({
    leads: [{ npi: '1225656291', company_name: 'DELTA MEDICAL', claimed_by: 'n', claimed_at: '2026-09-23T00:00:00Z', status: 'new', status_updated_at: null, group_id: 'g1' }],
    users: [{ id: 'n', display_name: 'Nora Atkins' }],
  });
  const { leads } = await getSheetConflictOwners(db, ['1225-656-291', '1225656291']);
  assert.deepEqual(leads, [{ npi: '1225656291', companyName: 'DELTA MEDICAL', ownerId: 'n', ownerName: 'Nora Atkins', status: 'new', statusUpdatedAt: '', claimedAt: '2026-09-23T00:00:00Z', groupId: 'g1' }]);
  assert.ok(db.calls.some(([t, c, v]) => t === 'leads' && c === 'is_disconnected' && v === false), 'a disconnected lead is not an owner');
});

test('the lookup refuses an empty or oversized list', async () => {
  await assert.rejects(getSheetConflictOwners(fakeDb(), []), (e) => e.status === 400);
  await assert.rejects(getSheetConflictOwners(fakeDb(), ['abc']), (e) => e.status === 400);
  const many = Array.from({ length: 201 }, (_, i) => String(1000000000 + i));
  await assert.rejects(getSheetConflictOwners(fakeDb(), many), (e) => e.status === 400);
});

test('a refused claim says which business group and which owner blocked it', async () => {
  const blocked = [{ npi: '1225656291', companyName: 'DELTA', groupId: 'g1', owners: [{ userId: 'n', displayName: 'Nora Atkins' }] }];
  const db = {
    from(name) {
      const q = {
        select: () => q, eq: () => q, in: () => q, ilike: () => q, limit: () => q,
        maybeSingle: () => { q.single = true; return q; },
        then: (resolve) => {
          if (name === 'app_users') return resolve(q.single ? { data: { id: 'bot', is_admin: false, can_claim_for_others: true }, error: null } : { data: [{ id: 'u1', username: 'selene', display_name: 'Selene Myles' }], error: null });
          return resolve({ data: [], error: null });
        },
      };
      return q;
    },
    rpc: async () => ({ data: { claimed: [], skipped: [], blocked, held: [] }, error: null }),
  };
  const result = await claimForUser(db, { id: 'bot', username: 'bd-bot' }, { username: 'selene', companies: [{ npi: '1225656291', name: 'DELTA' }] }, flattenCompany);
  assert.equal(result.blocked[0].groupId, 'g1');
  assert.deepEqual(result.blocked[0].ownerIds, ['n']);
  assert.deepEqual(result.blocked[0].owners, ['Nora Atkins']);
});
