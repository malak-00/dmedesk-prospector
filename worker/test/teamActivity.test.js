import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTeamActivity, noteKind, parseNoteLines, weekStartOf, weekStartsEndingAt } from '../src/lib/teamActivity.js';
import { summarizePriorContact } from '../src/repos/leadsRepo.js';
import { normalizeMeetingInput } from '../src/lib/meetings.js';

// The exact shape leadsRepo.addLeadNote writes: "YYYY-MM-DD HH:mm — <name>: <text>".
const line = (date, time, who, text) => `${date} ${time}${who ? ` — ${who}` : ''}: ${text}`;

test('reads call-log lines, including ones with no name and ones that are not lines at all', () => {
  const notes = [
    line('2026-10-06', '14:05', 'Ana Lopez', 'Voicemail — asked for a callback'),
    line('2026-10-05', '09:00', '', 'an old note with no author'),
    'a stray sentence that is not a dated entry',
    '',
  ].join('\n');
  const lines = parseNoteLines(notes);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0], { date: '2026-10-06', time: '14:05', by: 'Ana Lopez', text: 'Voicemail — asked for a callback' });
  assert.equal(lines[1].by, '');
  assert.deepEqual(parseNoteLines(null), []);
});

test('tells the app-written meeting lines apart from real call notes', () => {
  assert.equal(noteKind('Meeting booked for Thu, Oct 8, 2:00 PM'), 'booked');
  assert.equal(noteKind('Meeting held — went well'), 'held');
  assert.equal(noteKind('Meeting no-show'), 'noShow');
  assert.equal(noteKind('Meeting cancelled'), 'cancelled');
  assert.equal(noteKind('Voicemail — asked for a callback'), 'call');
  assert.equal(noteKind('meeting with the owner next week'), 'call'); // an ordinary note that merely starts with "meeting with"
});

test('weeks start on Monday (UTC) and run up to the current week', () => {
  assert.equal(weekStartOf('2026-10-07'), '2026-10-05'); // a Wednesday
  assert.equal(weekStartOf('2026-10-05'), '2026-10-05'); // the Monday itself
  assert.equal(weekStartOf('2026-10-11'), '2026-10-05'); // the Sunday before the next Monday
  assert.deepEqual(weekStartsEndingAt(new Date('2026-10-07T12:00:00Z'), 3), ['2026-09-21', '2026-09-28', '2026-10-05']);
});

const users = [
  { id: 'a', display_name: 'Ana Lopez', username: 'ana', is_admin: false },
  { id: 'b', display_name: 'Ben Arthur', username: 'ben', is_admin: true },
  { id: 'c', display_name: 'Cy Quiet', username: 'cy', is_admin: false },
];
const now = new Date('2026-10-07T12:00:00Z');

test('counts each rep\'s claims, calls and meetings by week, and their open work right now', () => {
  const events = [
    { event_type: 'claimed', to_user_id: 'a', created_at: '2026-10-06T09:00:00Z' },
    { event_type: 'claimed', to_user_id: 'a', created_at: '2026-10-05T09:00:00Z' },
    { event_type: 'claimed', to_user_id: 'b', created_at: '2026-09-30T09:00:00Z' },
    { event_type: 'released', to_user_id: null, created_at: '2026-10-06T10:00:00Z' }, // not a claim
    { event_type: 'claimed', to_user_id: 'a', created_at: '2026-06-01T09:00:00Z' }, // before the range
    { event_type: 'claimed', to_user_id: 'gone', created_at: '2026-10-06T09:00:00Z' }, // a removed user
  ];
  const leads = [
    {
      claimed_by: 'a', is_disconnected: false, reminder_at: '2026-10-01T09:00:00Z', meeting_at: '2026-10-09T18:00:00Z',
      notes: [
        line('2026-10-07', '10:05', 'Ana Lopez', 'Meeting no-show'),
        line('2026-10-07', '10:00', 'Ana Lopez', 'Meeting held — went well'),
        line('2026-10-06', '15:00', 'Ana Lopez', 'Meeting booked for Thu, Oct 8, 2:00 PM'),
        line('2026-10-06', '14:05', 'Ana Lopez', 'Voicemail — asked for a callback'),
        line('2026-09-30', '09:00', 'Ben Arthur', 'Spoke to the owner'),
        line('2026-08-01', '09:00', 'Ana Lopez', 'a call before the range'),
        line('2026-10-06', '16:00', 'Zed Unknown', 'a note by someone who is not a user'),
      ].join('\n'),
    },
    { claimed_by: 'a', is_disconnected: true, reminder_at: '2026-10-01T09:00:00Z', meeting_at: null, notes: null }, // disconnected: not open work
    { claimed_by: 'c', is_disconnected: false, reminder_at: null, meeting_at: null, notes: null },
  ];
  const result = buildTeamActivity({ users, events, leads, weeks: 3, now });

  assert.deepEqual(result.weeks.map((w) => w.label), ['Sep 21', 'Sep 28', 'Oct 5']);
  const ana = result.reps.find((r) => r.id === 'a');
  assert.deepEqual(ana.claims, [0, 0, 2]);
  assert.deepEqual(ana.calls, [0, 0, 1]);
  assert.deepEqual(ana.meetingsBooked, [0, 0, 1]);
  assert.deepEqual(ana.meetingsHeld, [0, 0, 1]);
  assert.deepEqual(ana.noShows, [0, 0, 1]);
  assert.deepEqual([ana.openLeads, ana.overdue, ana.upcomingMeetings], [1, 1, 1]);

  const ben = result.reps.find((r) => r.id === 'b');
  assert.deepEqual(ben.claims, [0, 1, 0]);
  assert.deepEqual(ben.calls, [0, 1, 0]);

  const other = result.reps.find((r) => r.id === 'other');
  assert.deepEqual(other.claims, [0, 0, 1]); // the removed user's claim
  assert.deepEqual(other.calls, [0, 0, 1]); // the unknown author's note
  assert.deepEqual(result.totals.claims, [0, 1, 3]);
  assert.deepEqual(result.totals.calls, [0, 1, 2]);

  assert.equal(result.reps[0].id, 'a', 'the busiest rep is listed first');
  assert.equal(result.reps.find((r) => r.id === 'c').openLeads, 1); // a quiet rep still shows their open work
});

test('"Other" only appears when it has activity', () => {
  const result = buildTeamActivity({ users, events: [], leads: [], weeks: 2, now });
  assert.equal(result.reps.some((r) => r.id === 'other'), false);
  assert.equal(result.reps.length, 3);
  assert.deepEqual(result.totals.claims, [0, 0]);
});

// ---- earlier contact on a lead that was returned to Prospect -----------------

test('summarises earlier contact on leads that were worked and returned to Prospect', () => {
  const names = new Map([['u1', 'Ana Lopez']]);
  const rows = [
    { npi: '1', status: 'voicemail', status_updated_at: '2026-10-02T10:00:00Z', status_updated_by: 'u1', claimed_by: null, is_disconnected: false,
      notes: line('2026-10-02', '10:00', 'Ana Lopez', 'Voicemail — asked for a callback') },
    { npi: '2', status: 'new', claimed_by: null, is_disconnected: false, notes: null },                       // never worked
    { npi: '3', status: 'new', claimed_by: null, is_disconnected: false, notes: line('2026-09-01', '08:00', 'Ben Arthur', 'Called, no answer') },
    { npi: '4', status: 'interested', claimed_by: 'u9', is_disconnected: false, notes: 'x' },                  // currently claimed: the search already hides it
    { npi: '5', status: 'disconnected', claimed_by: null, is_disconnected: true, notes: 'x' },                // disconnected: hidden by the search too
    { npi: '6', status: 'called', status_updated_at: '2026-09-15T00:00:00Z', status_updated_by: 'u1', claimed_by: null, is_disconnected: false, notes: '' },
  ];
  const result = summarizePriorContact(rows, names);
  assert.deepEqual([...result.keys()].sort(), ['1', '3', '6']);
  assert.deepEqual(result.get('1'), { status: 'voicemail', at: '2026-10-02', by: 'Ana Lopez', note: 'Voicemail — asked for a callback' });
  assert.deepEqual(result.get('3'), { status: '', at: '2026-09-01', by: 'Ben Arthur', note: 'Called, no answer' });
  assert.deepEqual(result.get('6'), { status: 'called', at: '2026-09-15', by: 'Ana Lopez', note: '' }); // falls back to the status stamp
});

// ---- the meeting outcome ------------------------------------------------------

test('clearing a meeting can record that it happened or was a no-show', () => {
  assert.deepEqual(normalizeMeetingInput({ meetingAt: '', outcome: 'held', noteLabel: ' went well ' }), { clear: true, label: 'went well', outcome: 'held' });
  assert.equal(normalizeMeetingInput({ meetingAt: '', outcome: 'NO-SHOW' }).outcome, 'no-show');
  assert.equal(normalizeMeetingInput({ meetingAt: '', outcome: 'something else' }).outcome, null); // anything else is a plain cancellation
  assert.equal(normalizeMeetingInput({ meetingAt: '' }).outcome, null);
});
