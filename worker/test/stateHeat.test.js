import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStateHeat } from '../src/lib/stateHeat.js';

const NOW = new Date('2026-10-19T12:00:00Z');
const line = (date, text) => `${date} 10:00 — Ana: ${text}`;
const lead = (state, extra = {}) => ({ claimed_by: 'u1', state, status: 'new', notes: '', is_disconnected: false, ...extra });

test('counts claimed, calls, pickup and stages per state', () => {
  const leads = [
    lead('FL', { notes: [line('2026-10-15', 'Interested — wants pricing'), line('2026-10-14', 'Voicemail'), line('2026-10-13', 'No answer'), line('2026-10-12', 'Gatekeeper'), line('2026-10-11', 'Voicemail')].join('\n'), status: 'Meeting Booked' }),
    lead('FL', { status: 'Onboarded' }),
    lead('GA', { notes: line('2026-10-15', 'Voicemail') }),
  ];
  const { states } = buildStateHeat({ leads, days: 28, now: NOW });
  const fl = states.find((s) => s.state === 'FL');
  assert.equal(fl.claimed, 2);
  assert.equal(fl.calls, 5);
  assert.equal(fl.answered, 2);
  assert.equal(fl.pickup, 0.4);
  assert.equal(fl.booked, 2); // a booked lead and an onboarded one (which has passed that stage)
  assert.equal(fl.won, 1);
  assert.equal(states[0].state, 'FL'); // most claimed first
});

test('a pickup rate needs enough calls; old calls and unusable rows are left out', () => {
  const leads = [
    lead('TX', { notes: line('2026-10-15', 'Interested') }), // one call: no rate
    lead('TX', { notes: line('2025-01-01', 'Interested') }), // too old to count as a call
    lead('OH', { is_disconnected: true }), // binned
    lead('', {}), // no state
    lead('NY', { status: 'Disconnected' }), // disconnected status
    { ...lead('CA'), claimed_by: null }, // not claimed
  ];
  const { states } = buildStateHeat({ leads, days: 28, now: NOW });
  assert.deepEqual(states.map((s) => s.state), ['TX']);
  assert.equal(states[0].claimed, 2);
  assert.equal(states[0].calls, 1);
  assert.equal(states[0].pickup, null);
});
