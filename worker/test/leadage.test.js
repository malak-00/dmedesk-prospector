import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ageOf } = require('../../docs/leadage.js');

const NOW = Date.parse('2026-10-19T00:00:00Z');

test('no date, no age', () => {
  assert.equal(ageOf(null, NOW), null);
  assert.equal(ageOf('', NOW), null);
  assert.equal(ageOf('not a date', NOW), null);
});

test('registered within two years is new', () => {
  const a = ageOf('2025-03-10', NOW);
  assert.equal(a.kind, 'new');
  assert.equal(a.registered, 'Mar 2025');
  assert.match(a.text, /^New · since Mar 2025$/);
  assert.match(a.title, /New supplier/);
  assert.equal(ageOf('2024-11-01', NOW).kind, 'new');
});

test('registered 15 or more years ago is established; the middle has no badge', () => {
  assert.equal(ageOf('2009-05-23', NOW).kind, 'established');
  assert.equal(ageOf('2011-09-01', NOW).kind, 'established');
  assert.equal(ageOf('2019-06-01', NOW).kind, '');
  assert.equal(ageOf('2019-06-01', NOW).text, 'NPI since Jun 2019');
  assert.equal(ageOf('2024-09-01', NOW).kind, ''); // 25 months: past "new", far from established
  assert.equal(ageOf('2024-09-01', NOW).months, 25);
});

test('a date in the future is treated as just registered', () => {
  const a = ageOf('2026-12-01', NOW);
  assert.equal(a.kind, 'new');
  assert.equal(a.months, 0);
});
