import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStatusMerges, getStatusCleanup } from '../src/repos/adminRepo.js';
import { updateLeadStatus, getKnownStatuses } from '../src/repos/leadsRepo.js';

// An in-memory `leads` table with just enough of the query builder.
function fakeDb(rows) {
  const table = rows.map((r) => ({ ...r }));
  const updates = [];
  const from = () => {
    let filters = [];
    let patch = null;
    let range = null;
    const q = {
      select: () => q,
      eq(col, value) { filters.push((r) => r[col] === value); return q; },
      is: () => q,
      not: () => q,
      in: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: () => q,
      update(p) { patch = p; return q; },
      range(a, b) { range = [a, b]; return q; },
      then(resolve) {
        const matched = table.filter((r) => filters.every((f) => f(r)));
        if (patch) { matched.forEach((r) => Object.assign(r, patch)); updates.push({ patch, count: matched.length }); return resolve({ data: null, error: null }); }
        const page = range ? matched.slice(range[0], range[1] + 1) : matched;
        return resolve({ data: page.map((r) => ({ ...r })), error: null });
      },
    };
    return q;
  };
  return { table, updates, from };
}

const rows = [
  { npi: '1', status: 'Voicemail', claimed_by: 'a' },
  { npi: '2', status: 'voicemail', claimed_by: 'a' },
  { npi: '3', status: 'VM', claimed_by: 'b' },
  { npi: '4', status: 'asdf', claimed_by: 'b' },
  { npi: '5', status: 'Follow-up 2wk', claimed_by: 'b' },
  { npi: '6', status: 'new', claimed_by: null },
];

test('the cleanup list shows each stored spelling, how many leads carry it and what it should become', async () => {
  const result = await getStatusCleanup(fakeDb(rows));
  const by = Object.fromEntries(result.statuses.map((s) => [s.status, s]));
  assert.equal(by['VM'].target, 'voicemail');
  assert.equal(by['Voicemail'].target, 'voicemail');
  assert.equal(by['voicemail'].why, 'ok');
  assert.equal(by['asdf'].junk, true);
  assert.equal(by['Follow-up 2wk'].target, 'follow up');
  assert.equal(result.totalLeads, 6);
  assert.ok(result.canonical.includes('onboarded'));
});

test('merging changes only the status text, and returns what it changed for an undo file', async () => {
  const db = fakeDb(rows);
  const result = await applyStatusMerges(db, [{ from: 'Voicemail', to: 'voicemail' }, { from: 'VM', to: 'Voice mail' }, { from: 'asdf', to: 'called' }]);
  assert.equal(result.leadsChanged, 3);
  assert.deepEqual(db.table.map((r) => r.status), ['voicemail', 'voicemail', 'voicemail', 'called', 'Follow-up 2wk', 'new']);
  assert.ok(db.updates.every((u) => Object.keys(u.patch).join() === 'status'), 'nothing else on the lead is touched');
  assert.deepEqual(result.changed.map((c) => [c.npi, c.from, c.to]), [['1', 'Voicemail', 'voicemail'], ['3', 'VM', 'voicemail'], ['4', 'asdf', 'called']]);
  assert.equal(db.table[2].claimed_by, 'b', 'ownership is untouched');
});

test('a change that is not allowed is refused before anything is written', async () => {
  const db = fakeDb(rows);
  await assert.rejects(applyStatusMerges(db, []), /Nothing to change/);
  await assert.rejects(applyStatusMerges(db, [{ from: 'VM', to: 'Disconnected' }]), /Send to Disconnected/);
  await assert.rejects(applyStatusMerges(db, [{ from: 'Disconnected', to: 'called' }]), /Send to Disconnected/);
  await assert.rejects(applyStatusMerges(db, [{ from: 'VM', to: 'x' }]), /usable status/);
  await assert.rejects(applyStatusMerges(db, [{ from: '', to: 'called' }]), /missing/);
  await assert.rejects(applyStatusMerges(db, Array.from({ length: 101 }, () => ({ from: 'a', to: 'called' }))), /At most/);
  assert.equal(db.updates.length, 0);
  const same = await applyStatusMerges(db, [{ from: 'voicemail', to: 'voicemail' }]);
  assert.equal(same.leadsChanged, 0, 'a no-op change does nothing');
});

test('a status written by a rep is tidied, and junk or a disconnect typed as a status is refused', async () => {
  const db = fakeDb([{ npi: '1', claimed_by: 'a', status: 'new' }]);
  const session = { id: 'a' };
  const saved = await updateLeadStatus(db, '1', ' VM ', session);
  assert.equal(saved.status, 'voicemail');
  assert.equal(db.table[0].status, 'voicemail');
  assert.equal((await updateLeadStatus(db, '1', 'Site  Visit', session)).status, 'site visit');
  await assert.rejects(updateLeadStatus(db, '1', 'asdf', session), /doesn't say anything/);
  await assert.rejects(updateLeadStatus(db, '1', 'Disconnected', session), /Send to Disconnected/);
});

test('the status list offered to reps has each meaning once', async () => {
  const list = await getKnownStatuses(fakeDb(rows));
  assert.equal(list.filter((s) => s === 'voicemail').length, 1);
  assert.ok(!list.includes('VM') && !list.includes('Voicemail') && !list.includes('asdf'));
  assert.ok(list.includes('follow up'));
});

// ---- the default specialty (sql/028) ---------------------------------------------------

import { setDefault } from '../src/repos/taxonomiesRepo.js';

function taxDb({ withColumn = true } = {}) {
  const rows = [{ id: 'a', default_for_search: false, enabled: true, facility_type: 'DME' }, { id: 'b', default_for_search: true, enabled: true, facility_type: 'Pharmacy' }];
  const from = () => {
    const filters = [];
    let patch = null;
    let single = false;
    const q = {
      select: () => q, order: () => q, maybeSingle: () => { single = true; return q; },
      eq(col, v) { filters.push((r) => r[col] === v); return q; },
      update(p) { patch = p; return q; },
      then(resolve) {
        if (patch && !withColumn) return resolve({ data: null, error: { code: '42703', message: 'column taxonomies.default_for_search does not exist' } });
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (patch) { hit.forEach((r) => Object.assign(r, patch)); return resolve({ data: null, error: null }); }
        return resolve({ data: single ? hit[0] || null : hit, error: null });
      },
    };
    return q;
  };
  return { rows, from };
}

test('choosing a default specialty leaves exactly one, and clearing leaves none', async () => {
  const db = taxDb();
  await setDefault(db, 'a');
  assert.deepEqual(db.rows.map((r) => [r.id, r.default_for_search]), [['a', true], ['b', false]]);
  await setDefault(db, '');
  assert.ok(db.rows.every((r) => !r.default_for_search));
  await assert.rejects(setDefault(db, 'nope'), { status: 404 });
});

test('before sql/028 the default specialty explains what to run', async () => {
  await assert.rejects(setDefault(taxDb({ withColumn: false }), 'a'), /sql\/028/);
});
