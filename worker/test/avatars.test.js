import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanAvatarImage } from '../src/lib/buddy.js';
import { listAvatars, setAvatar } from '../src/repos/avatarRepo.js';

const PIC = 'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=';

test('a picture is a small png, jpeg or webp data URL; blank removes it', () => {
  assert.equal(cleanAvatarImage(PIC), PIC);
  assert.equal(cleanAvatarImage(''), null);
  assert.equal(cleanAvatarImage(null), null);
  assert.throws(() => cleanAvatarImage('data:image/svg+xml;base64,PHN2Zz4='), /png, jpeg or webp/);
  assert.throws(() => cleanAvatarImage('https://example.com/a.png'), /png, jpeg or webp/);
  assert.throws(() => cleanAvatarImage('data:image/png;base64,' + 'A'.repeat(60_001)), /too big/);
});

// A small stand-in for app_users and user_avatars.
function fakeDb({ users, pics = [], missing = false, noDisabled = false }) {
  const state = { users, pics: pics.map((p) => ({ ...p })) };
  const from = (table) => {
    const filters = [];
    let op = null;
    let patch = null;
    let cols = '';
    const q = {
      select(c) { cols = c || ''; return q; },
      order: () => q,
      limit: () => q,
      eq(c, v) { filters.push((r) => r[c] === v); return q; },
      upsert(p) { op = 'upsert'; patch = p; return q; },
      maybeSingle() { op = op || 'one'; return q; },
      then(resolve) {
        if (table === 'user_avatars' && missing) return resolve({ data: null, error: { code: '42P01', message: 'relation "public.user_avatars" does not exist' } });
        if (table === 'app_users' && noDisabled && cols.includes('disabled_at')) return resolve({ data: null, error: { code: '42703', message: 'column disabled_at does not exist' } });
        if (op === 'upsert') {
          const at = state.pics.findIndex((p) => p.user_id === patch.user_id);
          if (at >= 0) state.pics[at] = { ...state.pics[at], ...patch }; else state.pics.push({ ...patch });
          return resolve({ data: null, error: null });
        }
        const source = table === 'app_users' ? state.users : state.pics;
        const matched = source.filter((r) => filters.every((f) => f(r)));
        return resolve({ data: op === 'one' ? matched[0] || null : matched, error: null });
      },
    };
    return q;
  };
  return { state, from };
}

const users = [
  { id: 'a', username: 'ana', display_name: 'Ana', disabled_at: null },
  { id: 'b', username: 'ben', display_name: 'Ben', disabled_at: null },
  { id: 'c', username: 'gone', display_name: 'Gone', disabled_at: '2026-01-01T00:00:00Z' },
];

test('everyone active is listed, with a picture only if they have one', async () => {
  const db = fakeDb({ users, pics: [{ user_id: 'a', image: PIC }, { user_id: 'b', image: null }] });
  const { avatars, unavailable } = await listAvatars(db);
  assert.equal(unavailable, false);
  assert.deepEqual(avatars.map((a) => [a.name, a.username, Boolean(a.image)]), [['Ana', 'ana', true], ['Ben', 'ben', false]]);
});

test('before sql/037 everyone is listed without pictures', async () => {
  const { avatars, unavailable } = await listAvatars(fakeDb({ users, missing: true }));
  assert.equal(unavailable, true);
  assert.equal(avatars.length, 2);
  assert.ok(avatars.every((a) => a.image === null));
  await assert.rejects(setAvatar(fakeDb({ users, missing: true }), { id: 'a' }, { userId: 'b', image: PIC }), { status: 503 });
});

test('an admin sets a picture, replaces it, and removes it by blanking it (the row stays)', async () => {
  const db = fakeDb({ users });
  await setAvatar(db, { id: 'a' }, { userId: 'b', image: PIC });
  assert.equal(db.state.pics[0].image, PIC);
  assert.equal(db.state.pics[0].updated_by, 'a');
  assert.deepEqual(await setAvatar(db, { id: 'a' }, { userId: 'b', image: '' }), { userId: 'b', hasImage: false });
  assert.equal(db.state.pics.length, 1);
  assert.equal(db.state.pics[0].image, null);
  await assert.rejects(setAvatar(db, { id: 'a' }, { userId: 'ghost', image: PIC }), /wasn't found/);
  await assert.rejects(setAvatar(db, { id: 'a' }, { image: PIC }), /Choose a person/);
  await assert.rejects(setAvatar(db, { id: 'a' }, { userId: 'b', image: 'nope' }), /png, jpeg or webp/);
});

test('it still lists people when the disabled column is not installed yet', async () => {
  const older = users.map(({ disabled_at, ...rest }) => rest); // no such column yet
  const { avatars } = await listAvatars(fakeDb({ users: older, noDisabled: true }));
  assert.equal(avatars.length, 3);
});
