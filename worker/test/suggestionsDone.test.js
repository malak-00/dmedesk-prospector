import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInsights, ERROR_DAYS } from '../src/lib/insights.js';
import { listAllSuggestions, setSuggestionDone } from '../src/repos/suggestionsRepo.js';

const NOW = new Date('2026-10-27T12:00:00Z');
const ago = (days) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const users = [{ id: 'u1', username: 'ana', display_name: 'Ana', is_admin: false }, { id: 'u2', username: 'ben', display_name: 'Ben', is_admin: false }];
const err = (user, name, daysAgo) => ({ user_id: user, kind: 'error', name, status: 500, ms: 10, result_count: null, detail: { message: 'timeout' }, created_at: ago(daysAgo) });

// ---- errors drop off after five days ----------------------------------------

test('errors older than five days no longer appear', () => {
  const events = [err('u1', 'GET /a', 1), err('u1', 'GET /a', 4.5), err('u2', 'GET /old', 6), err('u2', 'GET /older', 20)];
  const out = buildInsights({ users, events, days: 28, now: NOW });
  assert.equal(ERROR_DAYS, 5);
  assert.equal(out.usage.errors.days, 5);
  assert.equal(out.usage.errors.total, 2, 'only the two from the last five days');
  assert.deepEqual(out.usage.errors.top.map((e) => e.name), ['GET /a']);
  assert.equal(out.usage.errors.people, 1);
});

test('with no recent errors the list is empty (older ones do not linger)', () => {
  const out = buildInsights({ users, events: [err('u1', 'GET /old', 9)], days: 28, now: NOW });
  assert.equal(out.usage.errors.total, 0);
  assert.deepEqual(out.usage.errors.top, []);
  assert.equal(out.signals.some((s) => /failed in the last/.test(s.text)), false);
});

test('the "worth a look" line counts the five-day window', () => {
  const out = buildInsights({ users, events: [err('u1', 'GET /a', 1), err('u2', 'GET /a', 2), err('u2', 'GET /b', 7)], days: 28, now: NOW });
  const line = out.signals.find((s) => /failed in the last/.test(s.text));
  assert.match(line.text, /2 requests failed in the last 5 days, affecting 2 people/);
});

// ---- suggestions: done ones stop counting -------------------------------------

test('only open suggestions are counted and listed in the insights', () => {
  const suggestions = [
    { id: 1, text: 'Add dark mode', submitted_by: 'u1', created_at: ago(1), done_at: null },
    { id: 2, text: 'Fix the thing', submitted_by: 'u2', created_at: ago(2), done_at: ago(1) },
    { id: 3, text: 'Older idea', submitted_by: 'u1', created_at: ago(30) },
  ];
  const out = buildInsights({ users, suggestions, days: 28, now: NOW });
  assert.equal(out.friction.suggestions.total, 3);
  assert.equal(out.friction.suggestions.open, 2);
  assert.equal(out.friction.suggestions.last7, 1, 'the done one is not "this week"');
  assert.deepEqual(out.friction.suggestions.recent.map((s) => s.text), ['Add dark mode', 'Older idea']);
});

// ---- the repo -----------------------------------------------------------------

function fakeDb({ rows = [], names = {}, columnsExist = true, updateError = null, updated = [{ id: 1 }] } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const q = {
        select(columns) { q.columns = columns; return q; },
        order() { return q; },
        in() { return Promise.resolve({ data: Object.entries(names).map(([id, display_name]) => ({ id, display_name })), error: null }); },
        update(values) { calls.push({ update: values }); q.isUpdate = true; return q; },
        eq() { return q; },
        then(resolve, reject) {
          if (table === 'suggestions' && q.isUpdate) return Promise.resolve(updateError ? { data: null, error: updateError } : { data: updated, error: null }).then(resolve, reject);
          if (table === 'suggestions') {
            if (!columnsExist && /done_at/.test(q.columns)) return Promise.resolve({ data: null, error: { code: '42703', message: 'column suggestions.done_at does not exist' } }).then(resolve, reject);
            return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
          }
          return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
}

test('listing: done suggestions say who finished them and when', async () => {
  const db = fakeDb({
    rows: [{ id: 1, text: 'A', submitted_by: 'u1', created_at: ago(2), done_at: ago(1), done_by: 'u2' }, { id: 2, text: 'B', submitted_by: 'u1', created_at: ago(1), done_at: null, done_by: null }],
    names: { u1: 'Ana', u2: 'Ben' },
  });
  const list = await listAllSuggestions(db);
  assert.deepEqual(list.map((s) => [s.id, s.done, s.doneBy]), [[1, true, 'Ben'], [2, false, '']]);
  assert.equal(list[0].submittedBy, 'Ana');
});

test('listing: before sql/055 the suggestions still load, all open', async () => {
  const db = fakeDb({ rows: [{ id: 1, text: 'A', submitted_by: 'u1', created_at: ago(1) }], names: { u1: 'Ana' }, columnsExist: false });
  const list = await listAllSuggestions(db);
  assert.equal(list.length, 1);
  assert.equal(list[0].done, false);
});

test('marking done records who and when; reopening clears them', async () => {
  const db = fakeDb();
  const done = await setSuggestionDone(db, { id: 'admin-1', displayName: 'Caroline' }, 1, true);
  assert.equal(done.done, true);
  assert.equal(done.doneBy, 'Caroline');
  assert.equal(db.calls[0].update.done_by, 'admin-1');
  assert.ok(db.calls[0].update.done_at);
  const reopened = await setSuggestionDone(db, { id: 'admin-1' }, 1, false);
  assert.deepEqual(db.calls[1].update, { done_at: null, done_by: null });
  assert.equal(reopened.done, false);
});

test('marking done: a missing suggestion is a 404, a missing column explains sql/055', async () => {
  await assert.rejects(() => setSuggestionDone(fakeDb({ updated: [] }), { id: 'a' }, 9, true), (e) => e.status === 404);
  await assert.rejects(() => setSuggestionDone(fakeDb({ updateError: { code: '42703', message: 'column "done_at" of relation "suggestions" does not exist' } }), { id: 'a' }, 1, true),
    (e) => e.status === 503 && /sql\/055/.test(e.message));
  await assert.rejects(() => setSuggestionDone(fakeDb(), { id: 'a' }, '', true), (e) => e.status === 400);
});
