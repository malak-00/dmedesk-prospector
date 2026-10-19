import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvent, summarizeSearch } from '../src/lib/events.js';
import { buildInsights } from '../src/lib/insights.js';

test('a search keeps its states, specialty and filter names, never typed text', () => {
  const q = new URLSearchParams('states=TX,OK&taxonomyDescriptions=Orthopedic Surgery&organizationName=Acme Ortho&lookupPhone=5551234567&minMedicareClaims=50&sortBy=best&limit=25');
  const s = summarizeSearch(q);
  assert.deepEqual(s.states, ['TX', 'OK']);
  assert.deepEqual(s.specialties, ['Orthopedic Surgery']);
  assert.deepEqual(s.filters, ['minMedicareClaims']);
  assert.equal(s.typed, true);
  assert.ok(!JSON.stringify(s).includes('Acme'));
  assert.ok(!JSON.stringify(s).includes('5551234567'));
});

test('records searches, features and failures, and skips everything else', () => {
  const base = { userId: 'u1', ms: 120, query: new URLSearchParams('state=TX') };
  const search = buildEvent({ ...base, method: 'GET', path: '/search/companies', status: 200, resultCount: 0 });
  assert.equal(search.kind, 'search');
  assert.equal(search.result_count, 0);
  assert.equal(buildEvent({ ...base, method: 'POST', path: '/leads/dial', status: 200 }).name, 'call_tap');
  const err = buildEvent({ ...base, method: 'GET', path: '/leads/page', status: 500, errorMessage: 'boom' });
  assert.equal(err.kind, 'error');
  assert.equal(err.detail.message, 'boom');
  assert.equal(buildEvent({ ...base, method: 'GET', path: '/search/companies', status: 400, errorMessage: 'bad' }).kind, 'error');
  assert.equal(buildEvent({ ...base, method: 'GET', path: '/leads/page', status: 401 }), null);
  assert.equal(buildEvent({ ...base, method: 'GET', path: '/leads/page', status: 200 }), null);
  assert.equal(buildEvent({ ...base, method: 'POST', path: '/leads/dial', status: 403 }), null);
});

const now = new Date('2026-10-19T12:00:00Z');
const users = [{ id: 'a', display_name: 'Ana', is_admin: false }, { id: 'c', display_name: 'Caroline', is_super_admin: true }];
const ev = (o) => ({ user_id: 'a', status: 200, ms: 400, result_count: null, detail: null, created_at: '2026-10-18T10:00:00Z', ...o });

test('summarises empty searches, feature use and errors, leaving the super admin out', () => {
  const events = [
    ev({ kind: 'search', name: 'companies', result_count: 0, detail: { states: ['TX'], specialties: ['Orthopedic Surgery'], filters: ['minMedicareClaims'] } }),
    ev({ kind: 'search', name: 'companies', result_count: 0, detail: { states: ['TX'], specialties: ['Orthopedic Surgery'], filters: ['minMedicareClaims'] } }),
    ev({ kind: 'search', name: 'companies', result_count: 12, ms: 6000 }),
    ev({ kind: 'search', name: 'companies', result_count: 0, user_id: 'c' }),
    ev({ kind: 'feature', name: 'call_tap' }),
    ev({ kind: 'error', name: 'GET /leads/page', status: 500, detail: { message: 'timeout' } }),
  ];
  const u = buildInsights({ now, users, events }).usage;
  assert.equal(u.searches.total, 3);
  assert.equal(u.searches.zero, 2);
  assert.equal(u.searches.zeroShare, 67);
  assert.equal(u.searches.slow, 1);
  assert.equal(u.searches.zeroTop[0].count, 2);
  assert.equal(u.features.find((f) => f.name === 'call_tap').uses, 1);
  assert.equal(u.features.find((f) => f.name === 'bad_number').uses, 0);
  assert.equal(u.errors.last7, 1);
  assert.equal(u.errors.top[0].message, 'timeout');
});

test('usage is null until the event table exists', () => {
  assert.equal(buildInsights({ now, users }).usage, null);
});
