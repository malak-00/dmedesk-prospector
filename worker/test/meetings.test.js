import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMeetingInput, validEmail } from '../src/lib/meetings.js';

const NOW = Date.parse('2026-10-05T12:00:00Z');
const future = '2026-10-08T18:00:00Z';

test('a blank meetingAt means cancel the meeting', () => {
  assert.deepEqual(normalizeMeetingInput({ meetingAt: '', noteLabel: ' Thu  2 PM ' }, NOW), { clear: true, label: 'Thu 2 PM' });
  assert.equal(normalizeMeetingInput({}, NOW).clear, true);
});

test('cleans a valid booking and applies defaults', () => {
  const result = normalizeMeetingInput({ meetingAt: future, email: ' Owner@Example.COM ', openerNotes: '  Ask about the Medicare billing lapse  ' }, NOW);
  assert.equal(result.clear, false);
  assert.equal(result.meetingAt, '2026-10-08T18:00:00.000Z');
  assert.equal(result.durationMin, 30);
  assert.equal(result.remindBeforeMin, null);
  assert.equal(result.email, 'owner@example.com');
  assert.equal(result.openerNotes, 'Ask about the Medicare billing lapse');
});

test('stores a reminder lead time when one is chosen', () => {
  assert.equal(normalizeMeetingInput({ meetingAt: future, remindBeforeMinutes: 60 }, NOW).remindBeforeMin, 60);
  assert.equal(normalizeMeetingInput({ meetingAt: future, remindBeforeMinutes: '1440' }, NOW).remindBeforeMin, 1440);
  assert.equal(normalizeMeetingInput({ meetingAt: future, remindBeforeMinutes: 0 }, NOW).remindBeforeMin, null);
});

test('empty email and notes are stored as null', () => {
  const result = normalizeMeetingInput({ meetingAt: future, email: '  ', openerNotes: '   ' }, NOW);
  assert.equal(result.email, null);
  assert.equal(result.openerNotes, null);
});

test('rejects bad dates, past times, durations and reminders', () => {
  assert.throws(() => normalizeMeetingInput({ meetingAt: 'not a date' }, NOW), { status: 400 });
  assert.throws(() => normalizeMeetingInput({ meetingAt: '2026-10-01T12:00:00Z' }, NOW), /future/);
  assert.throws(() => normalizeMeetingInput({ meetingAt: future, durationMinutes: 7 }, NOW), { status: 400 });
  assert.throws(() => normalizeMeetingInput({ meetingAt: future, remindBeforeMinutes: 10 }, NOW), { status: 400 });
});

test('allows a meeting that starts within the clock-drift grace window', () => {
  assert.doesNotThrow(() => normalizeMeetingInput({ meetingAt: '2026-10-05T11:58:00Z' }, NOW));
});

test('rejects invalid email and over-long opener notes', () => {
  assert.throws(() => normalizeMeetingInput({ meetingAt: future, email: 'nope' }, NOW), /email/);
  assert.throws(() => normalizeMeetingInput({ meetingAt: future, openerNotes: 'x'.repeat(2001) }, NOW), /2000/);
  assert.equal(validEmail('a@b.co'), true);
  assert.equal(validEmail('a b@c.co'), false);
});
