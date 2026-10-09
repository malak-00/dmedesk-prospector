import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const h = require('../../docs/holidays.js');
const on = (iso) => h.holidayFor(new Date(`${iso}T12:00:00`));

test('Easter is worked out for any year', () => {
  assert.deepEqual(h.easter(2026), { m: 4, d: 5 });
  assert.deepEqual(h.easter(2027), { m: 3, d: 28 });
  assert.deepEqual(h.easter(2028), { m: 4, d: 16 });
});

test('the fixed holidays start and stop on their days', () => {
  assert.equal(on('2026-10-19'), '');
  assert.equal(on('2026-10-20'), 'halloween');
  assert.equal(on('2026-10-31'), 'halloween');
  assert.equal(on('2026-11-01'), '');
  assert.equal(on('2026-12-01'), 'christmas');
  assert.equal(on('2026-12-26'), 'christmas');
  assert.equal(on('2026-12-28'), 'newyear');
  assert.equal(on('2027-01-02'), 'newyear');
  assert.equal(on('2027-01-03'), '');
  assert.equal(on('2027-01-06'), 'christmas'); // Coptic Christmas Eve, 7 January is Christmas Day
  assert.equal(on('2027-01-08'), '');
  assert.equal(on('2026-07-03'), 'june30'); // Egypt's 30 June week runs to 3 July
  assert.equal(on('2026-07-04'), 'july4');
  assert.equal(on('2026-07-06'), '');
  assert.equal(on('2026-09-15'), '');
});

test('Thanksgiving covers the ten days before the fourth Thursday and the day after', () => {
  assert.equal(on('2026-11-15'), '');
  assert.equal(on('2026-11-16'), 'thanksgiving');
  assert.equal(on('2026-11-26'), 'thanksgiving'); // the fourth Thursday of November 2026
  assert.equal(on('2026-11-27'), 'thanksgiving');
  assert.equal(on('2026-11-28'), '');
});

test('Easter week: a week before, through Easter Monday', () => {
  assert.equal(on('2026-03-28'), '');
  assert.equal(on('2026-03-29'), 'easter');
  assert.equal(on('2026-04-05'), 'easter');
  assert.equal(on('2026-04-06'), 'easter');
  assert.equal(on('2026-04-08'), '');
});

test('Mother\'s Day: the US weekend in May, and 21 March in Egypt', () => {
  assert.equal(on('2026-05-08'), 'mothers');
  assert.equal(on('2026-05-10'), 'mothers'); // the second Sunday of May 2026
  assert.equal(on('2026-05-11'), '');
  assert.equal(on('2023-03-20'), 'mothers'); // a year when Ramadan had not yet begun
  assert.equal(on('2023-03-22'), '');
});

test('Ramadan and the two Eids follow the Islamic calendar', () => {
  assert.equal(on('2026-02-17'), '');
  assert.equal(on('2026-03-01'), 'ramadan');
  assert.equal(on('2026-03-10'), 'ramadan');
  assert.equal(on('2026-03-21'), 'eid'); // Eid al-Fitr
  assert.equal(on('2026-03-25'), '');
  assert.equal(on('2026-05-27'), 'eid'); // Eid al-Adha
  assert.equal(on('2026-09-15'), '');
});

test('where two holidays overlap, the earlier one in the list wins (Ramadan over St. Patrick\'s Day)', () => {
  assert.ok(h.KEYS.indexOf('ramadan') < h.KEYS.indexOf('stpatrick'));
  assert.equal(on('2026-03-16'), 'ramadan');
  assert.equal(on('2023-03-16'), 'stpatrick'); // in 2023 Ramadan began on 23 March
});

test('Egypt\'s national days show for the whole week around them (three days either side)', () => {
  assert.equal(on('2026-10-02'), '');
  assert.equal(on('2026-10-03'), 'armedforces');
  assert.equal(on('2026-10-06'), 'armedforces'); // 6th of October
  assert.equal(on('2026-10-09'), 'armedforces');
  assert.equal(on('2026-10-10'), '');
  assert.equal(on('2027-01-22'), 'jan25');
  assert.equal(on('2027-01-28'), 'jan25');
  assert.equal(on('2027-01-29'), '');
  assert.equal(on('2026-04-25'), 'sinai');
  assert.equal(on('2026-05-01'), 'labour');
  assert.equal(on('2026-06-30'), 'june30');
  assert.equal(on('2026-07-23'), 'july23');
  assert.equal(on('2026-07-27'), '');
});

test('Sham El-Nessim is the Monday after Coptic Easter, and that Easter is worked out for any year', () => {
  assert.deepEqual(h.orthodoxEaster(2026), { m: 4, d: 12 });
  assert.deepEqual(h.orthodoxEaster(2027), { m: 5, d: 2 });
  assert.equal(on('2026-04-13'), 'shamelnessim');
  assert.equal(on('2026-04-10'), 'shamelnessim');
  assert.equal(on('2026-04-17'), '');
});

test('the Islamic New Year and the Mawlid get their week too', () => {
  assert.equal(on('2026-06-16'), 'hijri'); // 1 Muharram 1448
  assert.equal(on('2026-06-21'), '');
  assert.equal(on('2026-08-25'), 'mawlid'); // 12 Rabi al-awwal 1448
  assert.equal(on('2026-08-29'), '');
});

test('every holiday key has a way to be drawn', () => {
  // The key list and the decoration sets must agree, or a holiday would show nothing. The sets are inside the page
  // code, so read the source.
  const source = require('node:fs').readFileSync(new URL('../../docs/holidays.js', import.meta.url), 'utf8');
  for (const key of h.KEYS) assert.ok(source.includes(`${key}: [[`), `${key} has no decoration set`);
});

test('every holiday has its own look: no two sets are the same, and each uses at least three different drawings', () => {
  const source = require('node:fs').readFileSync(new URL('../../docs/holidays.js', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('const SETS = {') + 'const SETS = '.length, source.indexOf('};', source.indexOf('const SETS = {')) + 1);
  const sets = new Function(`return ${block}`)();
  const looks = new Map();
  for (const [key, items] of Object.entries(sets)) {
    assert.ok(new Set(items.map(([name]) => name)).size >= 3, `${key} uses fewer than three different drawings`);
    const signature = [...new Set(items.map(([name]) => name))].sort().join(',');
    assert.ok(!looks.has(signature), `${key} looks the same as ${looks.get(signature)}`);
    looks.set(signature, key);
  }
  // the Egyptian national days in particular must differ from each other
  const egypt = ['armedforces', 'jan25', 'sinai', 'june30', 'july23'].map((k) => new Set(sets[k].map(([n]) => n)));
  for (let i = 0; i < egypt.length; i += 1) for (let j = i + 1; j < egypt.length; j += 1) {
    const shared = [...egypt[i]].filter((n) => egypt[j].has(n));
    assert.ok(shared.length <= 2, `two Egyptian days share too many drawings: ${shared.join(', ')}`);
  }
});
