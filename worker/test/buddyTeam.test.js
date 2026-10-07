import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanKudos, cleanMood, cleanScript, cleanTeamGoal, cleanHandover, lastWeekRange, moodTrend, upcomingOccasions, weekStartUtc } from '../src/lib/buddy.js';
import { teamInfo, kudosForMe, giveKudos, markKudosSeen, setMood, listScripts, saveScript, retireScript, setTeamGoal, adminExtras, getHandover, saveHandover, markHandoverShown, adminDigest } from '../src/repos/buddyTeamRepo.js';

const NOW = new Date('2026-10-08T15:00:00Z'); // a Thursday

test('kudos go to a teammate, not yourself, in a few words', () => {
  assert.deepEqual(cleanKudos({ toUserId: 'b', body: '  thanks   for covering ' }, 'a'), { toUser: 'b', body: 'thanks for covering' });
  assert.throws(() => cleanKudos({ toUserId: 'a', body: 'me' }, 'a'), /not yourself/);
  assert.throws(() => cleanKudos({ toUserId: '', body: 'hi' }, 'a'), /Choose who/);
  assert.throws(() => cleanKudos({ toUserId: 'b', body: '  ' }, 'a'), /few words/);
  assert.throws(() => cleanKudos({ toUserId: 'b', body: 'x'.repeat(141) }, 'a'), /140/);
});

test('a mood is 1 to 3', () => {
  assert.deepEqual(cleanMood({ mood: 3, day: '2026-10-08' }), { mood: 3, day: '2026-10-08' });
  assert.equal(cleanMood({ mood: '2' }).day, null);
  assert.throws(() => cleanMood({ mood: 4 }), /how your day/);
});

test('a script needs a title and text; the specialty may be blank', () => {
  assert.deepEqual(cleanScript({ title: ' Opener ', body: 'Hi, this is...', specialty: '' }), { title: 'Opener', body: 'Hi, this is...', specialty: null });
  assert.throws(() => cleanScript({ title: '', body: 'x' }), /title/);
  assert.throws(() => cleanScript({ title: 't', body: '' }), /Write the script/);
  assert.throws(() => cleanScript({ title: 't', body: 'x'.repeat(801) }), /800/);
});

test('the team goal is a whole number, or blank to switch it off', () => {
  assert.equal(cleanTeamGoal('500'), 500);
  assert.equal(cleanTeamGoal(''), null);
  assert.throws(() => cleanTeamGoal('lots'), /whole number/);
  assert.throws(() => cleanTeamGoal(0), /whole number/);
});

test('the week starts on Monday (UTC)', () => {
  assert.equal(weekStartUtc(NOW), '2026-10-05T00:00:00.000Z');
  assert.equal(weekStartUtc(new Date('2026-10-04T23:00:00Z')), '2026-09-28T00:00:00.000Z'); // a Sunday belongs to the week before
});

test('mood is summed per day with no names', () => {
  const rows = [{ day: '2026-10-08', mood: 3 }, { day: '2026-10-08', mood: 1 }, { day: '2026-10-07', mood: 2 }];
  const trend = moodTrend(rows, 3, NOW);
  assert.deepEqual(trend.map((d) => [d.day, d.great, d.okay, d.rough]), [['2026-10-06', 0, 0, 0], ['2026-10-07', 0, 1, 0], ['2026-10-08', 1, 0, 1]]);
});

// A small stand-in for the tables these functions touch.
function fakeDb({ users, kudos = [], scripts = [], mood = [], settings = [], taps = [], notes = [], handover = [], missing = false }) {
  const tables = { app_users: users, buddy_kudos: kudos, buddy_scripts: scripts, buddy_mood: mood, buddy_settings: settings, call_taps: taps, buddy_notes: notes, buddy_handover: handover };
  const state = { writes: [] };
  const from = (table) => {
    const filters = [];
    let op = null;
    let patch = null;
    let single = false;
    let head = false;
    const q = {
      select(_c, opts) { head = Boolean(opts && opts.head); return q; },
      order: () => q,
      limit(n) { filters.push((r, i) => i < n); return q; },
      eq(c, v) { filters.push((r) => r[c] === v); return q; },
      is(c, v) { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return q; },
      gte(c, v) { filters.push((r) => String(r[c]) >= String(v)); return q; },
      lt(c, v) { filters.push((r) => String(r[c]) < String(v)); return q; },
      in(c, vs) { filters.push((r) => vs.includes(r[c])); return q; },
      insert(p) { op = 'insert'; patch = p; return q; },
      update(p) { op = 'update'; patch = p; return q; },
      upsert(p) { op = 'upsert'; patch = p; return q; },
      single() { single = true; return q; },
      maybeSingle() { single = true; return q; },
      then(resolve) {
        if (missing && /^(buddy_kudos|buddy_mood|buddy_scripts|buddy_handover)$/.test(table)) return resolve({ data: null, error: { code: '42P01', message: `relation "public.${table}" does not exist` } });
        const source = tables[table];
        if (op === 'insert') {
          const r = { id: source.length + 1, ...patch };
          source.push(r);
          state.writes.push([table, 'insert', r]);
          return resolve({ data: { id: r.id }, error: null });
        }
        if (op === 'upsert') {
          const keys = { buddy_mood: ['user_id', 'day'], buddy_settings: ['key'], buddy_handover: ['user_id'] }[table];
          const at = source.findIndex((r) => keys.every((k) => r[k] === patch[k]));
          if (at >= 0) source[at] = { ...source[at], ...patch }; else source.push({ ...patch });
          return resolve({ data: null, error: null });
        }
        const matched = source.filter((r, i) => filters.every((f) => f(r, i)));
        if (op === 'update') { matched.forEach((r) => Object.assign(r, patch)); return resolve({ data: null, error: null }); }
        if (head) return resolve({ data: null, count: matched.length, error: null });
        return resolve({ data: single ? matched[0] || null : matched, error: null });
      },
    };
    return q;
  };
  return { state, tables, from };
}

const users = [
  { id: 'a', display_name: 'Ana', disabled_at: null },
  { id: 'b', display_name: 'Ben', disabled_at: null },
  { id: 'c', display_name: 'Gone', disabled_at: '2026-01-01T00:00:00Z' },
];

test('the team view lists active teammates (not you) and counts this week\'s taps against the goal', async () => {
  const db = fakeDb({
    users,
    settings: [{ key: 'team_goal', value: '500' }],
    taps: [{ id: 1, tapped_at: '2026-10-06T10:00:00Z' }, { id: 2, tapped_at: '2026-10-07T10:00:00Z' }, { id: 3, tapped_at: '2026-09-30T10:00:00Z' }],
  });
  const info = await teamInfo(db, { id: 'a' }, NOW);
  assert.deepEqual(info.people, [{ id: 'b', name: 'Ben' }]);
  assert.deepEqual(info.goal, { target: 500, calls: 2, weekStart: '2026-10-05' });
  const noGoal = await teamInfo(fakeDb({ users }), { id: 'a' }, NOW);
  assert.deepEqual(noGoal.goal, { target: null, calls: 0, weekStart: '2026-10-05' });
});

test('kudos: sent, shown once, limited per day, and the tables missing is explained', async () => {
  const db = fakeDb({ users });
  await giveKudos(db, { id: 'a' }, { toUserId: 'b', body: 'thanks!' }, NOW);
  const mine = await kudosForMe(db, { id: 'b' });
  assert.deepEqual(mine.map((k) => [k.from, k.body]), [['Ana', 'thanks!']]);
  await markKudosSeen(db, { id: 'b' }, mine[0].id, NOW);
  assert.deepEqual(await kudosForMe(db, { id: 'b' }), []);
  for (let i = 0; i < 4; i += 1) await giveKudos(db, { id: 'a' }, { toUserId: 'b', body: `again ${i}` }, NOW);
  await assert.rejects(giveKudos(db, { id: 'a' }, { toUserId: 'b', body: 'sixth' }, NOW), { status: 429 });
  await assert.rejects(giveKudos(db, { id: 'a' }, { toUserId: 'ghost', body: 'hi' }, NOW), /wasn't found/);

  const missing = fakeDb({ users, missing: true });
  assert.deepEqual(await kudosForMe(missing, { id: 'b' }), []);
  await assert.rejects(giveKudos(missing, { id: 'a' }, { toUserId: 'b', body: 'hi' }, NOW), { status: 503 });
});

test('one mood a day per person; tapping again changes it', async () => {
  const db = fakeDb({ users });
  await setMood(db, { id: 'a' }, { mood: 1, day: '2026-10-08' }, NOW);
  await setMood(db, { id: 'a' }, { mood: 3, day: '2026-10-08' }, NOW);
  assert.deepEqual(db.tables.buddy_mood, [{ user_id: 'a', day: '2026-10-08', mood: 3 }]);
});

test('scripts: add, list, retire (kept), and the admin overview shows totals without names', async () => {
  const db = fakeDb({ users });
  const made = await saveScript(db, { id: 'a' }, { title: 'Opener', body: 'Hello', specialty: 'Orthotics' });
  assert.equal((await listScripts(db)).scripts.length, 1);
  await retireScript(db, made.id, NOW);
  assert.equal((await listScripts(db)).scripts.length, 0);
  assert.equal(db.tables.buddy_scripts.length, 1); // never deleted
  await setTeamGoal(db, '750');
  await setMood(db, { id: 'a' }, { mood: 2, day: '2026-10-08' }, NOW);
  const extras = await adminExtras(db, NOW);
  assert.equal(extras.teamGoal, 750);
  assert.deepEqual(extras.mood.at(-1), { day: '2026-10-08', great: 0, okay: 1, rough: 0 });
  assert.equal(JSON.stringify(extras.mood).includes('"a"'), false);
});

test('the week ahead lists birthdays and anniversaries after today, soonest first', () => {
  const people = [{ user_id: 'b', birthday_md: '10-10', started_on: '2024-10-12' }, { user_id: 'c', birthday_md: '10-08', started_on: null }];
  const out = upcomingOccasions(people, '2026-10-08', 'a', (id) => ({ b: 'Ben', c: 'Cy' }[id]));
  assert.deepEqual(out.map((o) => [o.kind, o.name, o.inDays, o.years]), [['birthday', 'Ben', 2, 0], ['anniversary', 'Ben', 4, 2]]);
});

test('last week is the previous Monday to Sunday', () => {
  const r = lastWeekRange(NOW); // Thursday 8 Oct
  assert.equal(r.from, '2026-09-28T00:00:00.000Z');
  assert.equal(r.to, '2026-10-05T00:00:00.000Z');
  assert.equal(r.beforeFrom, '2026-09-21T00:00:00.000Z');
});

test('a note to tomorrow\'s you is limited, shown once, then marked shown; replaced by a newer one', async () => {
  assert.throws(() => cleanHandover({ body: ' ' }), /Write the note/);
  assert.throws(() => cleanHandover({ body: 'x'.repeat(301) }), /300/);
  const db = fakeDb({ users });
  assert.deepEqual((await getHandover(db, { id: 'a' })).note, null);
  await saveHandover(db, { id: 'a' }, { body: 'Call Acme first' }, NOW);
  assert.equal((await getHandover(db, { id: 'a' })).note.body, 'Call Acme first');
  await markHandoverShown(db, { id: 'a' }, NOW);
  assert.equal((await getHandover(db, { id: 'a' })).note, null);
  await saveHandover(db, { id: 'a' }, { body: 'Try the Georgia list' }, NOW);
  assert.equal((await getHandover(db, { id: 'a' })).note.body, 'Try the Georgia list');
  const missing = fakeDb({ users, missing: true });
  assert.deepEqual(await getHandover(missing, { id: 'a' }), { note: null, unavailable: true });
  await assert.rejects(saveHandover(missing, { id: 'a' }, { body: 'x' }, NOW), { status: 503 });
});

test('the weekly digest counts last week only, and totals the mood without names', async () => {
  const db = fakeDb({
    users,
    taps: [{ id: 1, tapped_at: '2026-09-29T10:00:00Z' }, { id: 2, tapped_at: '2026-10-04T23:00:00Z' }, { id: 3, tapped_at: '2026-10-06T10:00:00Z' }, { id: 4, tapped_at: '2026-09-22T10:00:00Z' }],
    kudos: [{ id: 1, created_at: '2026-10-01T10:00:00Z' }],
    notes: [{ id: 1, kind: 'win', created_at: '2026-10-02T10:00:00Z' }, { id: 2, kind: 'note', created_at: '2026-10-02T10:00:00Z' }],
    mood: [{ day: '2026-09-30', mood: 3 }, { day: '2026-10-01', mood: 1 }, { day: '2026-10-06', mood: 3 }],
  });
  const d = await adminDigest(db, NOW);
  assert.deepEqual([d.from, d.to, d.calls, d.callsBefore, d.kudos, d.wins], ['2026-09-28', '2026-10-04', 2, 1, 1, 1]);
  assert.deepEqual(d.mood, { great: 1, okay: 0, rough: 1 });
});
