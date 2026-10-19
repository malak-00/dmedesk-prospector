import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildWhyCall, money } = require('../../docs/whycall.js');

const NOW = Date.parse('2026-10-19T00:00:00Z');
const item = (r, key) => r.items.find((i) => i.key === key);

test('money shortens large amounts', () => {
  assert.equal(money(850), '$850');
  assert.equal(money(85000), '$85k');
  assert.equal(money(1250000), '$1.3M');
});

test('medicare tiers follow the scoring plan thresholds', () => {
  const tone = (pay) => item(buildWhyCall({ medicare: { totalClaims: 10, medicarePayment: pay } }, { now: NOW }), 'medicare').tone;
  assert.equal(tone(150000), 'high');
  assert.equal(tone(50000), 'mid');
  assert.equal(tone(2000), 'low');
});

test('no medicare data is shown as a neutral chip, not hidden', () => {
  const m = item(buildWhyCall({ medicare: null }, { now: NOW }), 'medicare');
  assert.equal(m.tone, 'none');
});

test('entity type: company, individual, and unknown', () => {
  assert.equal(item(buildWhyCall({ isOrganization: true }, { now: NOW }), 'entity').tone, 'high');
  assert.equal(item(buildWhyCall({ isOrganization: false }, { now: NOW }), 'entity').tone, 'mid');
  assert.equal(item(buildWhyCall({ isOrganization: null }, { now: NOW }), 'entity'), undefined);
});

test('registry freshness buckets and wording', () => {
  const f = (d) => item(buildWhyCall({ lastUpdated: d }, { now: NOW }), 'fresh');
  assert.equal(f('2026-07-15').tone, 'high');
  assert.equal(f('2026-07-15').text, 'Updated 3 mo ago');
  assert.equal(f('2024-10-01').tone, 'mid');
  assert.equal(f('2021-01-01').tone, 'low');
  assert.equal(f('2021-01-01').text, 'Updated 5 yrs ago');
  assert.equal(f(null), undefined);
  assert.equal(f('not a date'), undefined);
});

test('prior contact line is carried through only when given', () => {
  assert.equal(buildWhyCall({}, { now: NOW }).prior, null);
  const r = buildWhyCall({}, { now: NOW, priorLine: 'marked "Called" by Dana', priorNote: 'call back' });
  assert.deepEqual(r.prior, { text: 'marked "Called" by Dana', note: 'call back' });
});
