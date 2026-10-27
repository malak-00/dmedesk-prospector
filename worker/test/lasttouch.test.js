import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const t = require('../../docs/lasttouch.js');
const s = require('../../docs/shift.js');

const NOW = Date.parse('2026-10-27T20:00:00Z');

test('the newest call-log line says who and when', () => {
  const notes = '2026-10-27 18:00 — Ana: voicemail — left a message\n2026-10-20 10:00 — Ben: no answer';
  const got = t.lastTouch(notes);
  assert.equal(got.by, 'Ana');
  assert.equal(got.at, Date.parse('2026-10-27T18:00:00Z'));
  assert.equal(t.describe(notes, NOW), 'Ana, 2h ago');
});

test('nothing to read gives nothing', () => {
  assert.equal(t.lastTouch(''), null);
  assert.equal(t.lastTouch('just a note with no time'), null);
  assert.equal(t.describe(null, NOW), '');
});

test('how long ago reads like a person would say it', () => {
  const at = (ms) => NOW - ms;
  assert.equal(t.ago(at(30 * 1000), NOW), 'just now');
  assert.equal(t.ago(at(25 * 60000), NOW), '25m ago');
  assert.equal(t.ago(at(5 * 3600000), NOW), '5h ago');
  assert.equal(t.ago(at(24 * 3600000), NOW), 'yesterday');
  assert.equal(t.ago(at(4 * 86400000), NOW), '4d ago');
  assert.equal(t.ago(NOW + 60000, NOW), 'just now'); // a clock a little ahead is not "in the future"
});

// 27 Oct 2026: Cairo is UTC+3 until the clocks change at the end of October.
test('the shift runs 3:30 PM to 11:30 PM Cairo time', () => {
  assert.equal(s.minutesLeft(new Date('2026-10-27T12:29:00Z')), null); // 3:29 PM Cairo
  assert.equal(s.minutesLeft(new Date('2026-10-27T12:30:00Z')), 480); // 3:30 PM: all 8 hours left
  assert.equal(s.minutesLeft(new Date('2026-10-27T18:20:00Z')), 130); // 9:20 PM: 2h 10m
  assert.equal(s.minutesLeft(new Date('2026-10-27T20:30:00Z')), null); // 11:30 PM
});

test('the countdown is worded in hours and minutes', () => {
  assert.equal(s.label(130), '2h 10m left in shift');
  assert.equal(s.label(45), '45m left in shift');
  assert.equal(s.label(null), '');
});
