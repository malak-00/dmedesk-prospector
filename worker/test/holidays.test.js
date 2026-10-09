import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const h = require('../../docs/holidays.js');
const on = (iso) => h.holidayFor(new Date(`${iso}T12:00:00`));

test('Easter is worked out for any year', () => {
  assert.deepEqual(h.easter(2026), { m: 4, d: 5 });
  assert.deepEqual(h.easter(2027), { m: 3, d: 28 });
  assert.deepEqual(h.easter(2028), { m: 4, d: 16 });
});

test('the fixed holidays start and stop on their days', () => {
  assert.equal(on('2026-10-19'), '');
  assert.equal(on('2026-10-20'), 'halloween');
  assert.equal(on('2026-10-31'), 'halloween');
  assert.equal(on('2026-11-01'), '');
  assert.equal(on('2026-12-01'), 'christmas');
  assert.equal(on('2026-12-26'), 'christmas');
  assert.equal(on('2026-12-28'), 'newyear');
  assert.equal(on('2027-01-02'), 'newyear');
  assert.equal(on('2027-01-03'), '');
  assert.equal(on('2027-01-06'), 'christmas'); // Coptic Christmas Eve, 7 January is Christmas Day
  assert.equal(on('2027-01-08'), '');
  assert.equal(on('2026-07-03'), 'july4');
  assert.equal(on('2026-07-06'), '');
  assert.equal(on('2026-06-15'), '');
});

test('Thanksgiving covers the ten days before the fourth Thursday and the day after', () => {
  assert.equal(on('2026-11-15'), '');
  assert.equal(on('2026-11-16'), 'thanksgiving');
  assert.equal(on('2026-11-26'), 'thanksgiving'); // the fourth Thursday of November 2026
  assert.equal(on('2026-11-27'), 'thanksgiving');
  assert.equal(on('2026-11-28'), '');
});

test('Easter week: a week before, through Easter Monday', () => {
  assert.equal(on('2026-03-28'), '');
  assert.equal(on('2026-03-29'), 'easter');
  assert.equal(on('2026-04-05'), 'easter');
  assert.equal(on('2026-04-06'), 'easter');
  assert.equal(on('2026-04-08'), '');
});

test('Mother\'s Day: the US weekend in May, and 21 March in Egypt', () => {
  assert.equal(on('2026-05-08'), 'mothers');
  assert.equal(on('2026-05-10'), 'mothers'); // the second Sunday of May 2026
  assert.equal(on('2026-05-11'), '');
  assert.equal(on('2023-03-20'), 'mothers'); // a year when Ramadan had not yet begun
  assert.equal(on('2023-03-22'), '');
});

test('Ramadan and the two Eids follow the Islamic calendar', () => {
  assert.equal(on('2026-02-17'), '');
  assert.equal(on('2026-03-01'), 'ramadan');
  assert.equal(on('2026-03-10'), 'ramadan');
  assert.equal(on('2026-03-21'), 'eid'); // Eid al-Fitr
  assert.equal(on('2026-03-25'), '');
  assert.equal(on('2026-05-27'), 'eid'); // Eid al-Adha
  assert.equal(on('2026-06-15'), '');
});

test('where two holidays overlap, the earlier one in the list wins (Ramadan over St. Patrick\'s Day)', () => {
  assert.ok(h.KEYS.indexOf('ramadan') < h.KEYS.indexOf('stpatrick'));
  assert.equal(on('2026-03-16'), 'ramadan');
  assert.equal(on('2023-03-16'), 'stpatrick'); // in 2023 Ramadan began on 23 March
});
