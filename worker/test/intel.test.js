import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cleanIntel, shapeIntel, objectionCounts, OBJECTIONS } from '../src/lib/intel.js';
import * as repo from '../src/repos/intelRepo.js';
import { buildInsights } from '../src/lib/insights.js';

const require = createRequire(import.meta.url);
const { buildCallBrief } = require('../../docs/callbrief.js');

const NOW = Date.parse('2026-10-19T00:00:00Z');

test('only the fields sent are saved, trimmed, and an empty value clears one', () => {
  const r = cleanIntel({ currentBiller: '  Acme   Billing ', gatekeeper: '', unknown: 'x' });
  assert.deepEqual(r.patch, { current_biller: 'Acme Billing', gatekeeper: null });
  assert.equal(cleanIntel({}).error, 'Nothing to save.');
  assert.equal(cleanIntel({ unknown: 'x' }).error, 'Nothing to save.');
});

test('email, phone, objection and length are validated', () => {
  assert.match(cleanIntel({ email: 'not an email' }).error, /email/);
  assert.deepEqual(cleanIntel({ email: 'a@b.co' }).patch, { email: 'a@b.co' });
  assert.match(cleanIntel({ directLine: 'call me' }).error, /phone/);
  assert.deepEqual(cleanIntel({ directLine: '(727) 226-7700' }).patch, { direct_line: '(727) 226-7700' });
  assert.match(cleanIntel({ objection: 'because' }).error, /listed reasons/);
  assert.deepEqual(cleanIntel({ objection: 'Price' }).patch, { objection: 'price' });
  assert.deepEqual(cleanIntel({ objection: '' }).patch, { objection: null });
  assert.match(cleanIntel({ gatekeeper: 'x'.repeat(81) }).error, /80/);
  assert.ok(OBJECTIONS.includes('in-house'));
});

test('rows are shaped for the browser and objections are counted', () => {
  assert.equal(shapeIntel(null).currentBiller, '');
  const s = shapeIntel({ current_biller: 'Acme', objection: 'price', updated_at: 't' }, 'Ana');
  assert.deepEqual([s.currentBiller, s.objection, s.updatedBy], ['Acme', 'price', 'Ana']);
  assert.deepEqual(objectionCounts([{ objection: 'price' }, { objection: 'price' }, { objection: 'bad timing' }, { objection: null }, {}]), [
    { reason: 'price', count: 2 },
    { reason: 'bad timing', count: 1 },
  ]);
});

// ---- the repo against a tiny in-memory table ----

function fakeDb({ rows = [], missing = false } = {}) {
  const store = new Map(rows.map((r) => [r.npi, r]));
  const nothing = { error: { code: 'PGRST205', message: 'Could not find the table' } };
  return {
    store,
    from(name) {
      let want = null;
      const q = {
        select() { return q; },
        eq(_c, v) { want = v; return q; },
        maybeSingle: async () => {
          if (name === 'app_users') return { data: { display_name: 'Ana' } };
          return missing ? nothing : { data: store.get(want) || null };
        },
        upsert(row) {
          if (missing) { const r = Promise.resolve(nothing); r.select = () => ({ single: async () => nothing }); return r; }
          const merged = { ...(store.get(row.npi) || {}), ...row };
          store.set(row.npi, merged);
          return { select: () => ({ single: async () => ({ data: merged }) }) };
        },
      };
      return q;
    },
  };
}

const ana = { id: 'u1', displayName: 'Ana' };

test('saving merges into what is there and returns the whole row', async () => {
  const db = fakeDb();
  const a = await repo.saveIntel(db, '1003386889', { currentBiller: 'Acme Billing' }, ana, new Date('2026-10-19T10:00:00Z'));
  assert.equal(a.currentBiller, 'Acme Billing');
  const b = await repo.saveIntel(db, '1003386889', { gatekeeper: 'Dee' }, ana);
  assert.deepEqual([b.currentBiller, b.gatekeeper, b.installed], ['Acme Billing', 'Dee', true]);
  await assert.rejects(() => repo.saveIntel(db, 'nope', { gatekeeper: 'x' }, ana), (e) => e.status === 400);
  await assert.rejects(() => repo.saveIntel(db, '1003386889', { email: 'bad' }, ana), (e) => e.status === 400);
});

test('reading says "not installed" instead of failing; writing says how to install', async () => {
  const db = fakeDb({ missing: true });
  const read = await repo.getIntel(db, '1003386889');
  assert.equal(read.installed, false);
  await assert.rejects(() => repo.saveIntel(db, '1003386889', { gatekeeper: 'Dee' }, ana), (e) => e.status === 503 && /sql\/050/.test(e.message));
});

test('the brief uses what reps learned: gatekeeper, biller, objection, email, direct line', () => {
  const lead = { name: 'Medical Hotspots, Inc', npi: '1003386889', address: { city: 'Tampa', state: 'FL' }, decisionMakers: [{ name: 'Trisha Bailey', title: 'CEO' }], phone: '727-256-1305', isOrganization: true };
  const intel = { installed: true, currentBiller: 'Acme Billing', gatekeeper: 'Dee Marks', directLine: '772-226-7700', email: 'trisha@example.com', patientVolume: 'about 80 a month', objection: 'price' };
  const brief = buildCallBrief({ company: lead, intel, now: NOW });
  const fact = (l) => (brief.facts.find((f) => f.label === l) || {}).text || '';
  const part = (l) => (brief.script.find((s) => s.label === l) || {});
  assert.equal(fact('Current biller'), 'Acme Billing');
  assert.equal(fact('Gatekeeper'), 'Dee Marks');
  assert.equal(fact('Size'), 'about 80 a month');
  assert.equal(fact('Main objection'), 'price');
  assert.match(fact('Ask for'), /direct 772-226-7700/);
  assert.match(part('If the front desk asks').text, /Dee Marks: greet Dee by name/);
  assert.match(part('Close').text, /short email to trisha@example\.com/);
  const pushback = part('If they push back').items;
  assert.match(pushback[0], /^Last time they said: price\./);
  assert.ok(pushback.some((t) => /We already use Acme Billing/.test(t)));
  pushback.forEach((t) => { assert.match(t, /Agree:/); assert.match(t, /Ask:/); assert.match(t, /Next step:/); });
});

test('an in-house answer does not become a named biller, and no intel changes nothing', () => {
  const lead = { name: 'X', decisionMakers: [] };
  const inhouse = buildCallBrief({ company: lead, intel: { installed: true, currentBiller: 'In-house' }, now: NOW });
  assert.ok(inhouse.script.find((s) => s.label === 'If they push back').items.some((t) => /We do it in-house/.test(t)));
  const plain = buildCallBrief({ company: lead, now: NOW });
  const notInstalled = buildCallBrief({ company: lead, intel: { installed: false, currentBiller: 'Acme' }, now: NOW });
  assert.deepEqual(plain.script, notInstalled.script);
});

test('a new supplier gets a "new supplier" fact and pain point', () => {
  const lead = { name: 'Fresh DME', enumerationDate: '2025-06-01', decisionMakers: [] };
  const brief = buildCallBrief({ company: lead, now: NOW });
  assert.match((brief.facts.find((f) => f.label === 'Business') || {}).text, /a new supplier \(NPI since Jun 2025\)/);
  assert.match(brief.script.find((s) => s.label === 'Likely pain point').text, /newer supplier/);
});

test('the insights payload carries the reasons leads said no', () => {
  const out = buildInsights({ users: [{ id: 'u1', display_name: 'Ana' }], intel: [{ objection: 'price' }, { objection: 'price' }, { objection: 'in-house' }], now: new Date('2026-10-19T12:00:00Z') });
  assert.deepEqual(out.pipeline.objections, [{ reason: 'price', count: 2 }, { reason: 'in-house', count: 1 }]);
  assert.deepEqual(buildInsights({ users: [{ id: 'u1', display_name: 'Ana' }], now: new Date('2026-10-19T12:00:00Z') }).pipeline.objections, []);
});
