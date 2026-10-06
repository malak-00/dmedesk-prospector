import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { loginWith, changePassword } from '../src/lib/auth.js';
import { afterFailedLogin, lockMinutesLeft, MAX_FAILED_LOGINS } from '../src/lib/loginGuard.js';
import { applyUserFlags } from '../src/lib/userGate.js';

const config = { jwtSecret: () => 'test-secret-test-secret-test-secret-1234' };
const wait = async () => {};

// One account in memory. `columns` lists what the table has, so a column that
// "doesn't exist yet" (before sql/026 or 027) fails like PostgREST does.
function fakeDb({ columns, row }) {
  const state = { row: { id: 'u1', username: 'ana', display_name: 'Ana Lopez', is_admin: false, exclude_keywords: '', password_hash: bcrypt.hashSync('correct-horse', 4), ...row } };
  const query = () => {
    let selected = '';
    let patch = null;
    const q = {
      select(cols) { selected = cols; return q; },
      ilike: () => q,
      eq: () => q,
      limit: () => q,
      update(p) { patch = p; return q; },
      maybeSingle() { return q; },
      then(resolve) {
        const wanted = (patch ? Object.keys(patch) : selected.split(',').map((c) => c.trim())).filter((c) => c !== '*');
        const missing = wanted.find((c) => state.row[c] === undefined && columns.includes('__strict') && !columns.includes(c) && !['id', 'username', 'display_name', 'is_admin', 'exclude_keywords', 'password_hash'].includes(c));
        if (missing) return resolve({ data: null, error: { code: '42703', message: `column app_users.${missing} does not exist` } });
        if (patch) { Object.assign(state.row, patch); return resolve({ data: null, error: null }); }
        const data = {};
        selected.split(',').map((c) => c.trim()).forEach((c) => { data[c] = state.row[c]; });
        // findUserByUsernameExact expects a list; the single-row reads expect an object.
        return resolve({ data: selected.includes('password_hash') && selected.includes('username') ? [{ ...state.row }] : data, error: null });
      },
    };
    return q;
  };
  return { state, from: () => query() };
}

const secure = { failed_logins: 0, locked_until: null, must_change_password: false, disabled_at: null };
const NOW = Date.parse('2026-10-06T12:00:00Z');

test('the lockout rules: five wrong passwords lock for 15 minutes', () => {
  let row = { failed_logins: 0 };
  for (let i = 1; i < MAX_FAILED_LOGINS; i++) {
    const next = afterFailedLogin(row, NOW);
    assert.equal(next.locked, false);
    row = next;
  }
  assert.equal(row.failed_logins, MAX_FAILED_LOGINS - 1);
  const last = afterFailedLogin(row, NOW);
  assert.equal(last.locked, true);
  assert.equal(last.failed_logins, 0, 'the count restarts after a lock');
  assert.equal(lockMinutesLeft({ locked_until: last.locked_until }, NOW), 15);
  assert.equal(lockMinutesLeft({ locked_until: last.locked_until }, NOW + 16 * 60000), 0, 'expires by itself');
  assert.equal(lockMinutesLeft(null, NOW), 0);
});

test('a good sign-in works, and a wrong password is counted', async () => {
  const db = fakeDb({ columns: [], row: { ...secure, failed_logins: 2 } });
  await assert.rejects(loginWith(db, config, 'ana', 'wrong-password', { now: () => NOW, wait }), { status: 401 });
  assert.equal(db.state.row.failed_logins, 3);
  const ok = await loginWith(db, config, 'ana', 'correct-horse', { now: () => NOW, wait });
  assert.equal(ok.username, 'ana');
  assert.equal(ok.mustChangePassword, false);
  assert.equal(db.state.row.failed_logins, 0, 'a good sign-in resets the count');
});

test('the fifth wrong password locks the account, and then even the right one is refused', async () => {
  const db = fakeDb({ columns: [], row: { ...secure, failed_logins: 4 } });
  await assert.rejects(loginWith(db, config, 'ana', 'nope', { now: () => NOW, wait }), { status: 429 });
  assert.ok(db.state.row.locked_until, 'locked_until is stored');
  await assert.rejects(loginWith(db, config, 'ana', 'correct-horse', { now: () => NOW + 60000, wait }), (e) => e.status === 429 && /15 minutes|14 minutes/.test(e.message));
  const later = await loginWith(db, config, 'ana', 'correct-horse', { now: () => NOW + 16 * 60000, wait });
  assert.equal(later.username, 'ana', 'the lock lifts by itself');
});

test('a temporary password is flagged at sign-in; a removed account is refused', async () => {
  const flagged = fakeDb({ columns: [], row: { ...secure, must_change_password: true } });
  assert.equal((await loginWith(flagged, config, 'ana', 'correct-horse', { now: () => NOW, wait })).mustChangePassword, true);
  const removed = fakeDb({ columns: [], row: { ...secure, disabled_at: '2026-10-01' } });
  await assert.rejects(loginWith(removed, config, 'ana', 'correct-horse', { now: () => NOW, wait }), /removed/);
});

test('before sql/027 sign-in works exactly as it did', async () => {
  const db = fakeDb({ columns: ['__strict'], row: {} });
  const result = await loginWith(db, config, 'ana', 'correct-horse', { now: () => NOW, wait });
  assert.equal(result.username, 'ana');
  await assert.rejects(loginWith(db, config, 'ana', 'wrong', { now: () => NOW, wait }), { status: 401 });
});

test('changing your own password', async () => {
  const hash = async (pw) => `new:${pw}`;
  const db = fakeDb({ columns: [], row: { ...secure, must_change_password: true } });
  const session = { id: 'u1' };
  await assert.rejects(changePassword(db, session, 'not-my-password', 'brand-new-pass1', { hash, wait }), (e) => e.status === 400 && /current password/.test(e.message));
  await assert.rejects(changePassword(db, session, 'correct-horse', 'short', { hash, wait }), /at least 8/);
  await assert.rejects(changePassword(db, session, 'correct-horse', 'correct-horse', { hash, wait }), /haven't used/);
  await changePassword(db, session, 'correct-horse', 'brand-new-pass1', { hash, wait });
  assert.equal(db.state.row.password_hash, 'new:brand-new-pass1');
  assert.equal(db.state.row.must_change_password, false, 'the temporary-password flag is cleared');
});

test('someone with a temporary password is flagged on every request until they change it', () => {
  const flags = new Map([['u1', { isAdmin: false, disabled: false, mustChange: true }]]);
  assert.equal(applyUserFlags({ id: 'u1' }, flags).session.mustChangePassword, true);
  flags.set('u1', { isAdmin: false, disabled: false, mustChange: false });
  assert.equal(applyUserFlags({ id: 'u1' }, flags).session.mustChangePassword, false);
});
