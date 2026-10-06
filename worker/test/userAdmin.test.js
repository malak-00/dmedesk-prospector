import test from 'node:test';
import assert from 'node:assert/strict';
import { createUser, updateUser, listUsers, validateNewUser } from '../src/repos/userAdminRepo.js';
import { applyUserFlags, loadUserFlags, clearUserGate } from '../src/lib/userGate.js';

// A tiny in-memory stand-in for the two tables these functions touch.
function fakeDb({ users, leads = [], withDisable = true }) {
  const state = { users: users.map((u) => ({ ...u })), inserted: [] };
  const query = (table) => {
    let rows = table === 'app_users' ? state.users : leads;
    let selected = null;
    let pending = null; // 'insert' | 'update'
    let patch = null;
    const filters = [];
    const q = {
      select(cols) {
        selected = cols;
        return q;
      },
      order: () => q,
      ilike(col, value) { filters.push((r) => String(r[col] || '').toLowerCase() === String(value).toLowerCase()); return q; },
      eq(col, value) { filters.push((r) => r[col] === value); return q; },
      not(col, _op, _v) { filters.push((r) => r[col] != null); return q; },
      limit: () => q,
      range: (from, to) => { rows = rows.slice(from, to + 1); return q; },
      insert(row) { pending = 'insert'; patch = row; return q; },
      update(p) { pending = 'update'; patch = p; return q; },
      single() { return q; },
      then(resolve) {
        // A column that doesn't exist (before sql/026) is a PostgREST error.
        if (table === 'app_users' && !withDisable && ((selected || '').includes('disabled_at') || (patch && 'disabled_at' in patch))) {
          return resolve({ data: null, error: { code: '42703', message: 'column app_users.disabled_at does not exist' } });
        }
        if (pending === 'insert') {
          if (state.users.some((u) => u.username === patch.username)) return resolve({ data: null, error: { code: '23505', message: 'duplicate' } });
          const row = { id: `u${state.users.length + 1}`, ...patch };
          state.users.push(row);
          state.inserted.push(row);
          return resolve({ data: { id: row.id }, error: null });
        }
        const matched = rows.filter((r) => filters.every((f) => f(r)));
        if (pending === 'update') { matched.forEach((r) => Object.assign(r, patch)); return resolve({ data: null, error: null }); }
        return resolve({ data: matched, error: null });
      },
    };
    return q;
  };
  return { state, from: query };
}

const admin = { id: 'a1', username: 'boss', display_name: 'Boss Person', is_admin: true, disabled_at: null };
const rep = { id: 'r1', username: 'ana', display_name: 'Ana Lopez', is_admin: false, disabled_at: null };
const noHash = async (pw) => `hashed:${pw}`;

test('a new user needs a sensible username, name and password', () => {
  const ok = validateNewUser({ username: ' ben.arthur ', displayName: '  Ben   Arthur ', password: 'longenough1' });
  assert.deepEqual([ok.username, ok.displayName, ok.isAdmin], ['ben.arthur', 'Ben Arthur', false]);
  assert.throws(() => validateNewUser({ username: 'a b', displayName: 'Ab', password: 'longenough1' }), /Username/);
  assert.throws(() => validateNewUser({ username: 'abc', displayName: 'A', password: 'longenough1' }), /Name must be/);
  assert.throws(() => validateNewUser({ username: 'abc', displayName: 'Ben: Boss', password: 'longenough1' }), /colon/);
  assert.throws(() => validateNewUser({ username: 'abc', displayName: 'Ben — Boss', password: 'longenough1' }), /colon/);
  assert.throws(() => validateNewUser({ username: 'abc', displayName: 'Ben', password: 'short' }), /at least 8/);
});

test('adding a user stores a hash, never the password, and refuses duplicate usernames and names', async () => {
  const db = fakeDb({ users: [admin, rep] });
  const created = await createUser(db, { username: 'newrep', displayName: 'New Rep', password: 'password123', isAdmin: false }, { hash: noHash });
  assert.equal(created.username, 'newrep');
  assert.equal(db.state.inserted[0].password_hash, 'hashed:password123');
  assert.equal('password' in db.state.inserted[0], false);
  await assert.rejects(createUser(db, { username: 'ANA', displayName: 'Someone Else', password: 'password123' }, { hash: noHash }), { status: 409 });
  await assert.rejects(createUser(db, { username: 'another', displayName: 'ana lopez', password: 'password123' }, { hash: noHash }), { status: 409 });
});

test('you cannot remove yourself or take away your own admin access', async () => {
  const db = fakeDb({ users: [admin, { ...admin, id: 'a2', username: 'second', display_name: 'Second Admin' }] });
  await assert.rejects(updateUser(db, { id: 'a1' }, { id: 'a1', disabled: true }), /your own/);
  await assert.rejects(updateUser(db, { id: 'a1' }, { id: 'a1', isAdmin: false }), /your own/);
});

test('the last active admin cannot be removed or demoted by someone else', async () => {
  const db = fakeDb({ users: [admin, { ...rep, is_admin: true, id: 'r2', username: 'gone', display_name: 'Gone Admin', disabled_at: '2026-01-01' }] });
  // a1 is the only ACTIVE admin; a (hypothetical) other actor tries to remove them.
  await assert.rejects(updateUser(db, { id: 'someone-else' }, { id: 'a1', disabled: true }), /at least one active admin/);
  await assert.rejects(updateUser(db, { id: 'someone-else' }, { id: 'a1', isAdmin: false }), /at least one active admin/);
});

test('removing and restoring a user, changing a role and resetting a password', async () => {
  const db = fakeDb({ users: [admin, rep] });
  await updateUser(db, { id: 'a1' }, { id: 'r1', disabled: true });
  assert.ok(db.state.users.find((u) => u.id === 'r1').disabled_at, 'removed');
  await updateUser(db, { id: 'a1' }, { id: 'r1', disabled: false });
  assert.equal(db.state.users.find((u) => u.id === 'r1').disabled_at, null, 'restored');
  const promoted = await updateUser(db, { id: 'a1' }, { id: 'r1', isAdmin: true, canClaimForOthers: true });
  assert.deepEqual(promoted.changed.sort(), ['can_claim_for_others', 'is_admin']);
  const reset = await updateUser(db, { id: 'a1' }, { id: 'r1', password: 'newpassword1' }, { hash: noHash });
  assert.equal(reset.passwordReset, true);
  assert.equal(db.state.users.find((u) => u.id === 'r1').password_hash, 'hashed:newpassword1');
  await assert.rejects(updateUser(db, { id: 'a1' }, { id: 'r1', password: 'short' }, { hash: noHash }), /at least 8/);
  await assert.rejects(updateUser(db, { id: 'a1' }, { id: 'nobody', disabled: true }), { status: 404 });
  await assert.rejects(updateUser(db, { id: 'a1' }, { id: 'r1' }), /Nothing to change/);
});

test('before sql/026, users can be listed and edited but not removed, with a clear message', async () => {
  const db = fakeDb({ users: [admin, rep], withDisable: false });
  const listed = await listUsers(db);
  assert.equal(listed.features.remove, false);
  assert.equal(listed.users.length, 2);
  await assert.rejects(updateUser(db, { id: 'a1' }, { id: 'r1', disabled: true }), /sql\/026/);
});

test('the list shows how many leads each person holds', async () => {
  const db = fakeDb({ users: [admin, rep], leads: [{ claimed_by: 'r1', is_disconnected: false }, { claimed_by: 'r1', is_disconnected: false }, { claimed_by: 'a1', is_disconnected: false }] });
  const { users } = await listUsers(db);
  assert.deepEqual(users.map((u) => [u.username, u.claimedCount]).sort(), [['ana', 2], ['boss', 1]]);
});

// ---- the per-request gate ------------------------------------------------------

test('a removed user is turned away and an admin flag change applies without a new sign-in', () => {
  const flags = new Map([['r1', { isAdmin: false, disabled: true }], ['a1', { isAdmin: false, disabled: false }]]);
  assert.equal(applyUserFlags({ id: 'r1', isAdmin: false }, flags).ok, false);
  assert.equal(applyUserFlags({ id: 'ghost', isAdmin: true }, flags).ok, false, 'a deleted user is turned away too');
  const demoted = applyUserFlags({ id: 'a1', isAdmin: true }, flags); // token says admin, database says not
  assert.equal(demoted.ok, true);
  assert.equal(demoted.session.isAdmin, false);
  assert.equal(applyUserFlags({ id: 'a1', isAdmin: true }, null).session.isAdmin, true, 'if the lookup failed, carry on as the token says');
});

test('the gate reads the users once per half minute', async () => {
  clearUserGate();
  let calls = 0;
  let t = 1000;
  const db = { from: () => ({ select: () => { calls += 1; return Promise.resolve({ data: [{ id: 'a1', is_admin: true, disabled_at: null }], error: null }); } }) };
  await loadUserFlags(db, () => t);
  await loadUserFlags(db, () => t + 10_000);
  assert.equal(calls, 1);
  await loadUserFlags(db, () => t + 31_000);
  assert.equal(calls, 2);
  clearUserGate();
});
