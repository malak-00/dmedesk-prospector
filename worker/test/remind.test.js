import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const r = require('../../docs/remind.js');

// Local times throughout, so the result does not depend on the machine's time zone. 27 Oct 2026 is a Tuesday.
const tue10am = new Date(2026, 9, 27, 10, 0, 30);
const at = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()];

test('in two hours is two hours from now, to the minute', () => {
  assert.deepEqual(at(r.reminderAt('h2', tue10am)), [2026, 10, 27, 12, 0, 0]);
});

test('the day-based picks land at 4 PM, the start of the shift', () => {
  assert.deepEqual(at(r.reminderAt('1', tue10am)), [2026, 10, 28, 16, 0, 0]);
  assert.deepEqual(at(r.reminderAt('3', tue10am)), [2026, 10, 30, 16, 0, 0]);
  assert.deepEqual(at(r.reminderAt('7', tue10am)), [2026, 11, 3, 16, 0, 0]);
  assert.deepEqual(at(r.reminderAt(14, tue10am)), [2026, 11, 10, 16, 0, 0]); // a number works as well as a string
});

test('next Monday is the Monday after today, whatever day it is', () => {
  assert.deepEqual(at(r.reminderAt('mon', tue10am)), [2026, 11, 2, 16, 0, 0]); // from a Tuesday
  assert.deepEqual(at(r.reminderAt('mon', new Date(2026, 10, 1, 9, 0))), [2026, 11, 2, 16, 0, 0]); // from a Sunday: tomorrow
  assert.deepEqual(at(r.reminderAt('mon', new Date(2026, 10, 2, 9, 0))), [2026, 11, 9, 16, 0, 0]); // from a Monday: a week on
});

test('every pick is in the future and comes out as an ISO time', () => {
  for (const c of r.CHOICES) {
    const d = r.reminderAt(c.token, tue10am);
    assert.ok(d > tue10am, `${c.label} is later than now`);
    assert.equal(r.iso(c.token, tue10am), d.toISOString());
    assert.ok(r.describe(c.token, tue10am).length > 0);
  }
});
