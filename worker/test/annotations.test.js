import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanComment, cleanNpi, cleanTag, isTableMissing, shapeAnnotations, summarize, MAX_TAG } from '../src/lib/annotations.js';
import * as repo from '../src/repos/annotationsRepo.js';

test('npi, tag and comment cleaning', () => {
  assert.equal(cleanNpi(' 1003386889 '), '1003386889');
  assert.equal(cleanNpi('abc'), null);
  assert.equal(cleanNpi(''), null);
  assert.equal(cleanTag('  Wheelchair   ONLY '), 'wheelchair only');
  assert.equal(cleanTag('call after 2pm!!'), 'call after 2pm');
  assert.equal(cleanTag('<script>'), 'script');
  assert.equal(cleanTag('   '), null);
  assert.equal(cleanTag('x'.repeat(MAX_TAG + 1)), null);
  assert.equal(cleanComment('  Closed   Fridays  '), 'Closed Fridays');
  assert.equal(cleanComment(''), null);
  assert.equal(cleanComment('y'.repeat(501)), null);
});

test('a missing table is recognised', () => {
  assert.equal(isTableMissing({ code: 'PGRST205' }), true);
  assert.equal(isTableMissing({ code: '42P01' }), true);
  assert.equal(isTableMissing({ message: 'relation "lead_tags" does not exist' }), true);
  assert.equal(isTableMissing({ code: '23505', message: 'duplicate' }), false);
  assert.equal(isTableMissing(null), false);
});

test('rows are shaped for the card and summarised for a page of results', () => {
  const users = new Map([['u1', 'Ana']]);
  const shaped = shapeAnnotations([{ id: 1, user_id: 'u1', body: 'hi', created_at: 't' }], [{ user_id: 'u2', tag: 'chain', created_at: 't' }], users);
  assert.deepEqual(shaped.comments[0], { id: 1, by: 'Ana', byId: 'u1', at: 't', text: 'hi' });
  assert.equal(shaped.tags[0].by, 'A teammate');

  const sum = summarize([{ npi: '1', body: 'Closed Fridays' }, { npi: '1', body: 'x' }, { npi: '2', body: 'y' }], [{ npi: '1', tag: 'chain' }, { npi: '3', tag: 'closed' }]);
  const none = { answered: 0, total: 0 };
  assert.deepEqual(sum.get('1'), { tags: ['chain'], comments: 2, calls: none });
  assert.deepEqual(sum.get('2'), { tags: [], comments: 1, calls: none });
  assert.deepEqual(sum.get('3'), { tags: ['closed'], comments: 0, calls: none });
});

// ---- the repo, against a tiny in-memory stand-in for the tables ----

function fakeDb({ tags = [], comments = [], missing = false } = {}) {
  const tables = { lead_tags: tags, lead_comments: comments, app_users: [{ id: 'u1', display_name: 'Ana' }, { id: 'u2', display_name: 'Ben' }] };
  const nothing = { error: { code: 'PGRST205', message: 'Could not find the table' } };
  const gone = (name) => missing && name !== 'app_users';
  return {
    tables,
    from(name) {
      let rows = tables[name] || [];
      const q = {
        select() { return q; },
        eq(col, val) { rows = rows.filter((r) => String(r[col]) === String(val)); return q; },
        in(col, vals) { rows = rows.filter((r) => vals.includes(r[col])); return q; },
        order() { return q; },
        limit() { return q; },
        maybeSingle: async () => (gone(name) ? nothing : { data: rows[0] || null }),
        insert(row) {
          if (gone(name)) {
            const failed = Promise.resolve(nothing);
            failed.select = () => ({ single: async () => nothing });
            return failed;
          }
          const full = { id: tables[name].length + 1, created_at: 't', ...row };
          tables[name].push(full);
          const done = Promise.resolve({ error: null, data: [full] });
          done.select = () => ({ single: async () => ({ data: full }) });
          return done;
        },
        delete() {
          return { eq(c1, v1) { return { eq: async (c2, v2) => { tables[name] = tables[name].filter((r) => !(String(r[c1]) === String(v1) && String(r[c2]) === String(v2))); return { error: null }; } }; } };
        },
        then(res, rej) { return Promise.resolve(gone(name) ? nothing : { data: rows, error: null }).then(res, rej); },
      };
      return q;
    },
  };
}

const ana = { id: 'u1', displayName: 'Ana', isAdmin: false };
const ben = { id: 'u2', displayName: 'Ben', isAdmin: false };
const boss = { id: 'u9', displayName: 'Boss', isAdmin: true };

test('adding a tag cleans it, ignores a repeat, and enforces the per-lead limit', async () => {
  const db = fakeDb();
  assert.deepEqual(await repo.addTag(db, '1003386889', ' Wheelchair ONLY ', ana), { tag: 'wheelchair only', added: true });
  assert.deepEqual(await repo.addTag(db, '1003386889', 'wheelchair only', ben), { tag: 'wheelchair only', added: false });
  assert.equal(db.tables.lead_tags.length, 1);
  for (let i = 0; i < 11; i += 1) await repo.addTag(db, '1003386889', `t${i}`, ana);
  await assert.rejects(() => repo.addTag(db, '1003386889', 'one too many', ana), (e) => e.status === 409);
  await assert.rejects(() => repo.addTag(db, 'nope', 'x', ana), (e) => e.status === 400);
});

test('only the person who added a tag, or an admin, can remove it', async () => {
  const db = fakeDb({ tags: [{ npi: '1003386889', tag: 'chain', user_id: 'u1' }] });
  await assert.rejects(() => repo.removeTag(db, '1003386889', 'chain', ben), (e) => e.status === 403);
  assert.equal(db.tables.lead_tags.length, 1);
  assert.deepEqual(await repo.removeTag(db, '1003386889', 'chain', boss), { tag: 'chain', removed: true });
  assert.equal(db.tables.lead_tags.length, 0);
  assert.deepEqual(await repo.removeTag(db, '1003386889', 'chain', ana), { tag: 'chain', removed: false });
});

test('a comment is saved with the author and is validated', async () => {
  const db = fakeDb();
  const out = await repo.addComment(db, '1003386889', '  Owner is out until Monday ', ana);
  assert.equal(out.comment.text, 'Owner is out until Monday');
  assert.equal(out.comment.by, 'Ana');
  assert.equal(db.tables.lead_comments.length, 1);
  await assert.rejects(() => repo.addComment(db, '1003386889', '   ', ana), (e) => e.status === 400);
});

test('reading says "not installed" instead of failing, and writing says how to install', async () => {
  const db = fakeDb({ missing: true });
  const read = await repo.getAnnotations(db, '1003386889');
  assert.equal(read.installed, false);
  assert.deepEqual(read.comments, []);
  await assert.rejects(() => repo.addComment(db, '1003386889', 'hello', ana), (e) => e.status === 503 && /sql\/049/.test(e.message));
});

test('reading returns comments and tags with author names', async () => {
  const db = fakeDb({ tags: [{ npi: '1003386889', tag: 'chain', user_id: 'u1' }], comments: [{ id: 1, npi: '1003386889', user_id: 'u2', body: 'Closed Fridays', created_at: 't' }] });
  const read = await repo.getAnnotations(db, '1003386889');
  assert.equal(read.installed, true);
  assert.equal(read.tags[0].by, 'Ana');
  assert.equal(read.comments[0].by, 'Ben');
  assert.ok(read.suggested.includes('good fit'));
});

test('comments that start with a call result count as logged calls', () => {
  const sum = summarize([
    { npi: '1', body: 'Voicemail — left a message' },
    { npi: '1', body: 'Interested — wants pricing' },
    { npi: '1', body: 'No answer' },
    { npi: '1', body: 'Owner is out until Monday' }, // free text: says nothing about a pick-up
    { npi: '1', body: 'Gatekeeper' },
  ], []);
  assert.deepEqual(sum.get('1').calls, { answered: 2, total: 4 });
  assert.equal(sum.get('1').comments, 5);
});

test('popular tags are sorted by frequency and fall back to suggestions', async () => {
  const db = fakeDb({
    tags: [
      { npi: '1', tag: 'closed' },
      { npi: '2', tag: 'closed' },
      { npi: '3', tag: 'wrong specialty' },
    ],
  });
  const res = await repo.getPopularTags(db);
  assert.equal(res.tags[0], 'closed');
  assert.equal(res.tags[1], 'wrong specialty');
  assert.ok(res.tags.includes('do not call'));
});

