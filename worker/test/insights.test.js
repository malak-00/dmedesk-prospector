import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInsights } from '../src/lib/insights.js';

const now = new Date('2026-10-19T12:00:00Z');
const users = [
  { id: 'u-ana', display_name: 'Ana Lopez', is_admin: false },
  { id: 'u-ben', display_name: 'Ben', is_admin: true },
  { id: 'u-car', display_name: 'Caroline', is_admin: true, is_super_admin: true },
];
const line = (date, who, text) => `${date} 10:00 — ${who}: ${text}`;

test('counts team activity and leaves the super admin out of every number', () => {
  const out = buildInsights({
    now, users,
    claimEvents: [
      { to_user_id: 'u-ana', created_at: '2026-10-18T10:00:00Z' },
      { to_user_id: 'u-car', created_at: '2026-10-18T11:00:00Z' },
    ],
    leads: [
      { npi: '1', claimed_by: 'u-ana', claimed_at: '2026-10-18T10:00:00Z', status: 'New', notes: line('2026-10-18', 'Ana Lopez', 'Voicemail') },
      { npi: '2', claimed_by: 'u-car', claimed_at: '2026-10-18T11:00:00Z', status: 'New', notes: '' },
    ],
  });
  assert.equal(out.team.total, 2);
  assert.equal(out.adoption.people.length, 2);
  const ana = out.adoption.people.find((p) => p.name === 'Ana Lopez');
  assert.equal(ana.claims, 1);
  assert.equal(ana.calls, 1);
  assert.equal(out.pipeline.funnel.total, 1);
  assert.equal(out.team.active7, 1);
  assert.deepEqual(out.team.dormant, ['Ben']);
});

test('flags claimed leads nobody has contacted after two weeks', () => {
  const leads = Array.from({ length: 10 }, (_, i) => ({
    npi: String(i), claimed_by: 'u-ana', claimed_at: '2026-09-01T00:00:00Z', status: 'New', notes: '',
  }));
  const out = buildInsights({ now, users, leads });
  assert.equal(out.pipeline.neverContacted, 10);
  assert.ok(out.signals.some((s) => /never contacted/.test(s.text)));
});

test('says so when nothing stands out, and survives empty input', () => {
  const out = buildInsights({ now, users: [{ id: 'u-ana', display_name: 'Ana', is_admin: false }], claimEvents: [{ to_user_id: 'u-ana', created_at: '2026-10-19T09:00:00Z' }] });
  assert.equal(out.signals[0].level, 'good');
  assert.doesNotThrow(() => buildInsights());
});

test('reports missing integrations and bad numbers', () => {
  const out = buildInsights({
    now, users,
    badNumbers: [{ reason: 'wrong', flagged_at: '2026-10-18T00:00:00Z', cleared_at: null }, { reason: 'disconnected', flagged_at: '2026-09-01T00:00:00Z', cleared_at: '2026-09-02T00:00:00Z' }],
    system: { integrations: [{ label: 'AI call briefs', configured: false }], installed: [] },
  });
  assert.equal(out.friction.badNumbers.open, 1);
  assert.ok(out.signals.some((s) => /AI call briefs/.test(s.text)));
});

test('suggests a friendly note for someone with uncalled leads, overdue callbacks or no activity', () => {
  const leads = Array.from({ length: 4 }, (_, i) => ({
    npi: String(i), company_name: `Clinic ${i}`, claimed_by: 'u-ana', claimed_at: '2026-09-20T00:00:00Z', status: 'New', notes: '', reminder_at: '2026-10-01T00:00:00Z',
  }));
  const out = buildInsights({ now, users, leads });
  const reasons = out.nudges.filter((n) => n.name === 'Ana Lopez').map((n) => n.reason);
  assert.ok(reasons.includes('4 claimed leads never called'));
  assert.ok(reasons.includes('4 overdue callbacks'));
  assert.ok(reasons.includes('No activity in 7 days'));
  assert.ok(out.nudges.every((n) => n.text.startsWith('Hi Ana')));
  assert.equal(out.pipeline.stuck[0].company, 'Clinic 0');
  assert.equal(out.pipeline.stuck.length, 4);
});

test('measures the time from claiming to the first call, and compares this week with last', () => {
  const leads = [
    { npi: '1', claimed_by: 'u-ana', claimed_at: '2026-10-15T00:00:00Z', status: 'New', notes: line('2026-10-15', 'Ana Lopez', 'Voicemail').replace('10:00', '06:00') },
    { npi: '2', claimed_by: 'u-ana', claimed_at: '2026-10-15T00:00:00Z', status: 'New', notes: line('2026-10-17', 'Ana Lopez', 'Spoke to owner') },
  ];
  const out = buildInsights({ now, users, leads, claimEvents: [{ to_user_id: 'u-ana', created_at: '2026-10-15T00:00:00Z' }] });
  assert.equal(out.pipeline.firstCall.contacted, 2);
  assert.equal(out.pipeline.firstCall.medianHours, 32);
  assert.equal(out.pipeline.firstCall.within1d, 1);
  const ana = out.adoption.people.find((p) => p.name === 'Ana Lopez');
  assert.equal(ana.weekNow, 3);
  assert.equal(ana.weekPrev, 0);
  assert.equal(out.callAt.length, 2);
});
