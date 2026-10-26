import test from 'node:test';
import assert from 'node:assert/strict';
import { getInsights } from '../src/repos/adminRepo.js';
import { saveEvent } from '../src/lib/events.js';

// A stand-in for the Supabase client: every table is a list of rows, and `fail` names tables whose reads error out
// the way a statement timeout does.
function fakeDb(tables, { fail = [], missing = [], insertResults = [] } = {}) {
  const inserts = [];
  const db = {
    inserts,
    from(table) {
      let ranged = false;
      let range = [0, 999];
      const result = () => {
        if (missing.includes(table)) return { data: null, count: null, error: { code: '42P01', message: `relation "public.${table}" does not exist` } };
        if (fail.includes(table)) return { data: null, count: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
        const rows = tables[table] || [];
        return ranged ? { data: rows.slice(range[0], range[1] + 1), error: null } : { data: rows, count: rows.length, error: null };
      };
      const chain = new Proxy({}, {
        get(_, prop) {
          if (prop === 'then') return (resolve, reject) => Promise.resolve(result()).then(resolve, reject);
          if (prop === 'range') return (a, b) => { ranged = true; range = [a, b]; return chain; };
          if (prop === 'insert') return async (row) => { inserts.push(row); return insertResults.shift() || { error: null }; };
          return () => chain;
        },
      });
      return chain;
    },
  };
  return db;
}

const users = [{ id: 'u1', username: 'ana', display_name: 'Ana', is_admin: false }, { id: 'su', username: 'boss', display_name: 'Boss', is_admin: true, is_super_admin: true }];
const recent = new Date(Date.now() - 3600_000).toISOString();
const events = [
  { user_id: 'u1', kind: 'error', name: 'GET /companies/same-owner', status: 500, ms: 8000, result_count: null, detail: { message: 'statement timeout' }, created_at: recent },
  { user_id: 'u1', kind: 'search', name: 'companies', status: 200, ms: 900, result_count: 4, detail: { states: ['FL'], specialties: [], filters: [] }, created_at: recent },
];

test('insights: when everything reads, errors show and nothing is flagged', async () => {
  const out = await getInsights(fakeDb({ app_users: users, app_events: events }), null, { days: 28 });
  assert.equal(out.eventsStatus, 'ok');
  assert.deepEqual(out.problems, []);
  assert.equal(out.usage.errors.total, 1);
});

test('insights: an event log that cannot be read is reported as failed, not as "no errors"', async () => {
  const out = await getInsights(fakeDb({ app_users: users, app_events: events }, { fail: ['app_events'] }), null, { days: 28 });
  assert.equal(out.eventsStatus, 'failed');
  assert.equal(out.usage, null, 'no usage figures made up from nothing');
  assert.ok(out.problems.some((p) => p.source === 'event log'));
});

test('insights: an event log that is not installed is still just "not collecting yet"', async () => {
  const out = await getInsights(fakeDb({ app_users: users }, { missing: ['app_events'] }), null, { days: 28 });
  assert.equal(out.eventsStatus, 'not_installed');
  assert.equal(out.usage, null);
  assert.equal(out.problems.some((p) => p.source === 'event log'), false);
});

test('insights: another source that fails is named, so its zeros are not trusted', async () => {
  const out = await getInsights(fakeDb({ app_users: users, app_events: events }, { fail: ['call_taps', 'leads'] }), null, { days: 28 });
  const sources = out.problems.map((p) => p.source);
  assert.ok(sources.includes('phone taps') && sources.includes('leads'));
  assert.equal(out.eventsStatus, 'ok');
});

test('saving an event: a write that fails once is tried again', async () => {
  const db = fakeDb({}, { insertResults: [{ error: { message: 'canceling statement due to statement timeout' } }, { error: null }] });
  const logs = [];
  const saved = await saveEvent(db, { kind: 'error', name: 'GET /x' }, { wait: async () => {}, log: (m) => logs.push(m) });
  assert.equal(saved, true);
  assert.equal(db.inserts.length, 2);
  assert.deepEqual(logs, []);
});

test('saving an event: a write that keeps failing is logged, not silently dropped', async () => {
  const bad = { error: { message: 'canceling statement due to statement timeout' } };
  const db = fakeDb({}, { insertResults: [bad, bad] });
  const logs = [];
  const saved = await saveEvent(db, { kind: 'error', name: 'GET /x' }, { wait: async () => {}, log: (m) => logs.push(m) });
  assert.equal(saved, false);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /could not save error GET \/x/);
});

test('saving an event: a missing table is quiet and not retried', async () => {
  const db = fakeDb({}, { insertResults: [{ error: { code: '42P01', message: 'relation "public.app_events" does not exist' } }] });
  const logs = [];
  assert.equal(await saveEvent(db, { kind: 'search', name: 'companies' }, { wait: async () => {}, log: (m) => logs.push(m) }), false);
  assert.equal(db.inserts.length, 1);
  assert.deepEqual(logs, []);
});
