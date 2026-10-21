import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanIntel, shapeIntel } from '../src/lib/intel.js';
import { cleanGoals, shapeGoals } from '../src/lib/goals.js';
import { readAdvancedCriteria, toFilterPayload, usesAdvancedSearch, relaxedVariants } from '../src/lib/searchFilters.js';
import { toCompany, listFollowUps } from '../src/repos/followUpRepo.js';
import { getGoals, saveGoals } from '../src/repos/goalsRepo.js';
import * as intelRepo from '../src/repos/intelRepo.js';

const NOW = Date.parse('2026-10-21T12:00:00Z');

// ---- follow-up date on call intel ----

test('a follow-up date is validated and can be cleared', () => {
  assert.deepEqual(cleanIntel({ followUpAt: '2026-11-04' }, NOW).patch, { follow_up_at: '2026-11-04' });
  assert.deepEqual(cleanIntel({ followUpAt: '' }, NOW).patch, { follow_up_at: null });
  assert.match(cleanIntel({ followUpAt: 'next week' }, NOW).error, /date/);
  assert.match(cleanIntel({ followUpAt: '2026-10-01' }, NOW).error, /today or a day in the future/);
  assert.match(cleanIntel({ followUpAt: '2028-01-01' }, NOW).error, /next year/);
  assert.equal(shapeIntel({ follow_up_at: '2026-11-04T00:00:00' }).followUpAt, '2026-11-04');
  assert.equal(shapeIntel(null).followUpAt, '');
});

function fakeDb(responses) {
  const log = [];
  return {
    log,
    from(name) {
      const q = {
        select() { return q; }, eq() { return q; }, not() { return q; }, lte() { return q; }, order() { return q; }, limit() { return q; }, in() { return q; },
        upsert(row) { log.push(['upsert', name, row]); return { select: () => ({ single: async () => responses[name + ':upsert'] || { data: row } }) }; },
        delete() { return { eq: async () => ({ error: null }) }; },
        then(res, rej) { return Promise.resolve(responses[name] || { data: [], error: null }).then(res, rej); },
      };
      return q;
    },
  };
}

test('saving a follow-up records who set it; clearing it clears that too', async () => {
  const db = fakeDb({});
  const set = await intelRepo.saveIntel(db, '1003386889', { followUpAt: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10) }, { id: 'u1', displayName: 'Ana' });
  assert.equal(set.installed, true);
  assert.equal(db.log[0][2].follow_up_by, 'u1');
  await intelRepo.saveIntel(db, '1003386889', { followUpAt: '' }, { id: 'u1', displayName: 'Ana' });
  assert.equal(db.log[1][2].follow_up_by, null);
});

test('before sql/051, saving a follow-up says what to run', async () => {
  const db = fakeDb({ 'lead_intel:upsert': { error: { code: 'PGRST204', message: "Could not find the 'follow_up_at' column" } } });
  await assert.rejects(() => intelRepo.saveIntel(db, '1003386889', { followUpAt: new Date(Date.now() + 86400000).toISOString().slice(0, 10) }, { id: 'u1' }), (e) => e.status === 503 && /sql\/051/.test(e.message));
});

test('follow-ups due come back as call-mode companies, and nothing is "not installed" noise', async () => {
  const row = { npi: '1003386889', name: 'Medical Hotspots, Inc', phone: '727-256-1305', address_city: 'Tampa', address_state: 'FL', authorizedofficial_firstname: 'Trisha', authorizedofficial_lastname: 'Bailey', authorizedofficial_title: 'CEO', authorizedofficial_phone: '772-226-7700', enumeration_date: '2025-03-10', isorganization: true };
  const db = fakeDb({ lead_intel: { data: [{ npi: '1003386889', follow_up_at: '2026-10-20', objection: 'bad timing', current_biller: '' }, { npi: '999', follow_up_at: '2026-10-19' }], error: null }, npi_records: { data: [row], error: null } });
  const out = await listFollowUps(db, { id: 'u1' }, '2026-10-21');
  assert.equal(out.installed, true);
  assert.equal(out.items.length, 1); // the NPI with no registry row is left out
  assert.equal(out.items[0].objection, 'bad timing');
  assert.equal(out.items[0].company.decisionMakers[0].name, 'Trisha Bailey');
  assert.equal(out.items[0].company.enumerationDate, '2025-03-10');
  const missing = await listFollowUps(fakeDb({ lead_intel: { data: null, error: { code: '42703', message: 'column lead_intel.follow_up_by does not exist' } } }), { id: 'u1' }, '2026-10-21');
  assert.deepEqual(missing, { installed: false, items: [] });
  assert.equal(toCompany({ npi: '1', name: 'X' }).decisionMakers.length, 0);
});

// ---- weekly goals ----

test('goals are whole numbers, and blank clears one', () => {
  assert.deepEqual(cleanGoals({ callsWeek: '400', meetingsWeek: '' }).rows, [{ key: 'calls_week', value: 400 }, { key: 'meetings_week', value: null }]);
  assert.match(cleanGoals({ callsWeek: '4.5' }).error, /whole number/);
  assert.match(cleanGoals({ callsWeek: '-1' }).error, /whole number/);
  assert.equal(cleanGoals({}).error, 'Nothing to save.');
  assert.deepEqual(shapeGoals([{ key: 'calls_week', value: 300 }]), { callsWeek: 300, meetingsWeek: null });
});

test('goals read as "not installed" before sql/051 and save through the repo after', async () => {
  const none = await getGoals(fakeDb({ team_goals: { data: null, error: { code: 'PGRST205', message: 'Could not find the table' } } }));
  assert.equal(none.installed, false);
  const db = fakeDb({ team_goals: { data: [{ key: 'calls_week', value: 400 }], error: null } });
  const saved = await saveGoals(db, { id: 'u1' }, { callsWeek: '400' });
  assert.equal(saved.callsWeek, 400);
  assert.equal(db.log[0][2].value, 400);
  await assert.rejects(() => saveGoals(db, { id: 'u1' }, { callsWeek: 'lots' }), (e) => e.status === 400);
});

// ---- the new search filters ----

test('the team filters are read from a request, cleaned, and passed to the database', () => {
  const q = (k) => ({ newSupplier: 'true', establishedSupplier: 'on', untouched: '1', tag: '  Good FIT!! ', objection: 'Price' }[k]);
  const c = readAdvancedCriteria(q);
  assert.deepEqual(c, { newSupplier: true, establishedSupplier: true, untouched: true, tag: 'good fit', objection: 'price' });
  assert.equal(usesAdvancedSearch(c), true);
  assert.equal(usesAdvancedSearch({ tag: 'x' }), true);
  const payload = toFilterPayload({ states: ['FL'], ...c }, { collapsed: true });
  assert.deepEqual([payload.newSupplier, payload.establishedSupplier, payload.untouched, payload.tag, payload.objection], [true, true, true, 'good fit', 'price']);
  assert.equal(readAdvancedCriteria((k) => (k === 'objection' ? 'because' : undefined)).objection, undefined); // not on the list
  assert.deepEqual(readAdvancedCriteria(() => undefined), {});
  assert.equal('newSupplier' in toFilterPayload({ states: ['FL'] }), false);
});

test('an empty search can be loosened by dropping a team filter', () => {
  const variants = relaxedVariants({ states: ['FL'], newSupplier: true, tag: 'chain' });
  const keys = variants.map((v) => v.key);
  assert.ok(keys.includes('newSupplier') && keys.includes('tag'));
  const dropTag = variants.find((v) => v.key === 'tag');
  assert.equal(dropTag.criteria.tag, undefined);
  assert.equal(dropTag.criteria.newSupplier, true);
  assert.match(dropTag.label, /chain/);
});
