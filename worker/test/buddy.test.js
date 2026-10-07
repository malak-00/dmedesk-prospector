import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanNoteInput, cleanPeopleInput, cleanReaction, notesFor, occasionsOn } from '../src/lib/buddy.js';
import { listForUser, createNote, retireNote, markSeen, react, announceWin, setPerson, setTeamWins, listForAdmin } from '../src/repos/buddyRepo.js';

const NOW = new Date('2026-10-08T15:00:00Z');
const row = (o) => ({ id: 1, to_user_id: null, body: 'Hi', created_by: 'a1', show_from: '2026-10-08T09:00:00Z', expires_at: '2026-10-15T09:00:00Z', retired_at: null, ...o });

test('a note needs text, within the limit, and a sensible number of days', () => {
  assert.throws(() => cleanNoteInput({ body: '   ' }, NOW), /Write the note/);
  assert.throws(() => cleanNoteInput({ body: 'x'.repeat(501) }, NOW), /500/);
  assert.throws(() => cleanNoteInput({ body: 'ok', expiresDays: 0 }, NOW), /1 to 365/);
  assert.throws(() => cleanNoteInput({ body: 'ok', showFrom: 'nonsense' }, NOW), /start time/);
  const n = cleanNoteInput({ body: '  Push Georgia this week  ' }, NOW);
  assert.equal(n.body, 'Push Georgia this week');
  assert.equal(n.toUserId, null);
  assert.equal(n.expiresAt, '2026-10-15T15:00:00.000Z'); // a week by default
});

test('a note written for later expires counting from when it first shows', () => {
  const n = cleanNoteInput({ body: 'Monday note', showFrom: '2026-10-12T13:00:00Z', expiresDays: 2, toUserId: 'r1' }, NOW);
  assert.equal(n.toUserId, 'r1');
  assert.equal(n.expiresAt, '2026-10-14T13:00:00.000Z');
});

test('people see the message of the day and notes for them, not other people\'s, retired, expired or future ones', () => {
  const rows = [
    row({ id: 1, body: 'for everyone' }),
    row({ id: 2, body: 'for ana', to_user_id: 'r1' }),
    row({ id: 3, body: 'for ben', to_user_id: 'r2' }),
    row({ id: 4, body: 'retired', retired_at: '2026-10-08T10:00:00Z' }),
    row({ id: 5, body: 'expired', expires_at: '2026-10-08T12:00:00Z' }),
    row({ id: 6, body: 'later', show_from: '2026-10-09T09:00:00Z' }),
  ];
  const mine = notesFor(rows, ['1'], 'r1', NOW, () => 'Boss');
  assert.deepEqual(mine.map((n) => n.body).sort(), ['for ana', 'for everyone']);
  assert.equal(mine.find((n) => n.id === '1').seen, true);
  assert.equal(mine.find((n) => n.id === '2').seen, false);
  assert.equal(mine.find((n) => n.id === '2').personal, true);
  assert.equal(mine[0].from, 'Boss');
});

// A small stand-in for the two tables and the users table.
function fakeDb({ notes = [], seen = [], reactions = [], people = [], settings = [], users = [{ id: 'a1', display_name: 'Boss' }, { id: 'r1', display_name: 'Ana' }], missing = false } = {}) {
  const state = { notes: notes.map((n) => ({ ...n })), seen: seen.map((s) => ({ ...s })), reactions: reactions.map((r) => ({ ...r })), people: people.map((r) => ({ ...r })), settings: settings.map((r) => ({ ...r })), inserted: [], updated: [] };
  const from = (table) => {
    const filters = [];
    let op = null;
    let patch = null;
    let single = false;
    const q = {
      select: () => q,
      order: () => q,
      limit: () => q,
      is(col, v) { filters.push((r) => (v === null ? r[col] == null : r[col] === v)); return q; },
      eq(col, v) { filters.push((r) => r[col] === v); return q; },
      in(col, vs) { filters.push((r) => vs.includes(r[col])); return q; },
      insert(p) { op = 'insert'; patch = p; return q; },
      update(p) { op = 'update'; patch = p; return q; },
      upsert(p) { op = 'upsert'; patch = p; return q; },
      single() { single = true; return q; },
      maybeSingle() { single = true; return q; },
      then(resolve) {
        if (missing && table.startsWith('buddy_')) return resolve({ data: null, error: { code: '42P01', message: `relation "public.${table}" does not exist` } });
        const source = { buddy_notes: state.notes, buddy_seen: state.seen, buddy_reactions: state.reactions, buddy_people: state.people, buddy_settings: state.settings }[table] || users;
        if (op === 'insert') {
          const r = { id: state.notes.length + 100, ...patch };
          state.notes.push(r);
          state.inserted.push(r);
          return resolve({ data: { id: r.id }, error: null });
        }
        if (op === 'upsert') {
          const keys = { buddy_seen: ['note_id', 'user_id'], buddy_reactions: ['note_id', 'user_id'], buddy_people: ['user_id'], buddy_settings: ['key'] }[table];
          const at = source.findIndex((r) => keys.every((k) => r[k] === patch[k]));
          if (at >= 0) source[at] = { ...source[at], ...patch }; else source.push({ ...patch });
          return resolve({ data: null, error: null });
        }
        const matched = source.filter((r) => filters.every((f) => f(r)));
        if (op === 'update') { matched.forEach((r) => Object.assign(r, patch)); state.updated.push(...matched); return resolve({ data: null, error: null }); }
        return resolve({ data: single ? matched[0] || null : matched, error: null });
      },
    };
    return q;
  };
  return { state, from };
}

test('before sql/031 is run, reading notes gives an empty list and writing says why', async () => {
  const db = fakeDb({ missing: true });
  assert.deepEqual(await listForUser(db, { id: 'r1' }, { now: NOW }), { notes: [], occasions: [], upcoming: [], unavailable: true });
  await assert.rejects(createNote(db, { id: 'a1' }, { body: 'hello' }, NOW), { status: 503 });
});

test('listing notes marks the ones this person has already been shown', async () => {
  const db = fakeDb({ notes: [row({ id: 1 }), row({ id: 2, body: 'second', show_from: '2026-10-08T10:00:00Z' })], seen: [{ note_id: 1, user_id: 'r1' }, { note_id: 2, user_id: 'someone-else' }] });
  const { notes } = await listForUser(db, { id: 'r1' }, { now: NOW });
  assert.deepEqual(notes.map((n) => [n.id, n.seen]), [['2', false], ['1', true]]);
  assert.equal(notes[0].from, 'Boss');
});

test('creating a note for a person who does not exist is refused; retiring keeps the row', async () => {
  const db = fakeDb({ notes: [row({ id: 7 })] });
  await assert.rejects(createNote(db, { id: 'a1' }, { body: 'hi', toUserId: 'ghost' }, NOW), /wasn't found/);
  const made = await createNote(db, { id: 'a1' }, { body: 'hi', toUserId: 'r1' }, NOW);
  assert.ok(made.id);
  assert.equal(db.state.inserted[0].created_by, 'a1');
  await retireNote(db, 7, NOW);
  assert.equal(db.state.notes.find((n) => n.id === 7).retired_at, NOW.toISOString());
  assert.equal(db.state.notes.length, 2); // nothing deleted
});

test('marking a note seen needs a real id', async () => {
  const db = fakeDb();
  await assert.rejects(markSeen(db, { id: 'r1' }, 'abc'), { status: 400 });
  assert.deepEqual(await markSeen(db, { id: 'r1' }, '5'), { id: '5', seen: true });
  assert.deepEqual(db.state.seen[0], { note_id: 5, user_id: 'r1' });
});

test('a repeating note defaults to half a year and needs a real weekday', () => {
  const n = cleanNoteInput({ body: 'Log your calls', repeatWeekday: '1' }, NOW);
  assert.equal(n.repeatWeekday, 1);
  assert.equal(n.expiresAt, new Date(NOW.getTime() + 180 * 86_400_000).toISOString());
  assert.throws(() => cleanNoteInput({ body: 'x', repeatWeekday: 9 }, NOW), /day of the week/);
  assert.equal(cleanNoteInput({ body: 'x' }, NOW).repeatWeekday, null);
});

test('reactions are limited to the offered emoji and replies to a short line', () => {
  assert.deepEqual(cleanReaction({ reaction: 'like' }), { reaction: 'like' });
  assert.deepEqual(cleanReaction({ reaction: '' }), { reaction: null });
  assert.deepEqual(cleanReaction({ reply: '  thanks   boss ' }), { reply: 'thanks boss' });
  assert.throws(() => cleanReaction({ reaction: 'x' }), /isn't available/);
  assert.throws(() => cleanReaction({ reply: 'x'.repeat(201) }), /200/);
});

test('birthdays and anniversaries show on the day, and the start day itself is not an anniversary', () => {
  const people = [
    { user_id: 'r1', birthday_md: '10-08', started_on: '2024-10-08' },
    { user_id: 'r2', birthday_md: '03-02', started_on: '2026-10-08' },
  ];
  const names = { r1: 'Ana', r2: 'Ben' };
  const out = occasionsOn(people, '2026-10-08', 'r1', (id) => names[id]);
  assert.deepEqual(out.map((o) => [o.kind, o.name, o.years, o.mine]), [['birthday', 'Ana', 0, true], ['anniversary', 'Ana', 2, true]]);
  assert.deepEqual(occasionsOn(people, '2026-10-09', 'r1'), []);
});

test('birthday and start date input is checked', () => {
  assert.deepEqual(cleanPeopleInput({ userId: 'r1', birthday: '04-23', startedOn: '2023-05-01' }), { userId: 'r1', birthday: '04-23', startedOn: '2023-05-01' });
  assert.throws(() => cleanPeopleInput({ userId: 'r1', birthday: '13-40' }), /month and day/);
  assert.throws(() => cleanPeopleInput({ userId: 'r1', startedOn: 'soon' }), /start date/);
  assert.deepEqual(cleanPeopleInput({ userId: 'r1', birthday: '' }), { userId: 'r1', birthday: null, startedOn: null });
});

test('a reaction keeps an earlier reply, and you cannot react to a personal note meant for someone else', async () => {
  const db = fakeDb({ notes: [row({ id: 1 }), row({ id: 2, to_user_id: 'r2' })] });
  await react(db, { id: 'r1' }, { id: 1, reply: 'on it' });
  const second = await react(db, { id: 'r1' }, { id: 1, reaction: 'like' });
  assert.deepEqual(second, { id: '1', reaction: 'like', reply: 'on it' });
  assert.equal(db.state.reactions.length, 1);
  await assert.rejects(react(db, { id: 'r1' }, { id: 2, reaction: 'like' }), { status: 404 });
  await assert.rejects(react(db, { id: 'r1' }, { id: 1 }), /Choose a reaction/);
});

test('onboarded leads are only announced when an admin has switched it on, and not to the person who did it', async () => {
  const off = fakeDb();
  assert.deepEqual(await announceWin(off, { id: 'r1', displayName: 'Ana Lopez' }, 'Acme DME', NOW), { announced: false });
  assert.equal(off.state.notes.length, 0);

  const on = fakeDb({ settings: [{ key: 'team_wins', value: 'on' }] });
  assert.deepEqual(await announceWin(on, { id: 'r1', displayName: 'Ana Lopez' }, 'Acme DME', NOW), { announced: true });
  const made = on.state.notes[0];
  assert.equal(made.kind, 'win');
  assert.match(made.body, /Ana Lopez just onboarded Acme DME/);
  assert.equal(made.to_user_id, null);
  assert.deepEqual(on.state.seen, [{ note_id: made.id, user_id: 'r1' }]);
});

test('an announcement that fails never breaks the status change', async () => {
  const broken = { from: () => { throw new Error('boom'); } };
  assert.deepEqual(await announceWin(broken, { id: 'r1' }, 'Acme', NOW), { announced: false });
});

test('the admin can set a person\'s dates and the team-wins switch, and sees them back', async () => {
  const db = fakeDb();
  await assert.rejects(setPerson(db, { userId: 'ghost', birthday: '01-01' }), /wasn't found/);
  await setPerson(db, { userId: 'r1', birthday: '04-23', startedOn: '2023-05-01' });
  assert.deepEqual(await setTeamWins(db, true), { teamWins: true });
  const admin = await listForAdmin(db, NOW);
  assert.deepEqual(admin.people, [{ userId: 'r1', birthday: '04-23', startedOn: '2023-05-01' }]);
  assert.equal(admin.settings.teamWins, true);
});
