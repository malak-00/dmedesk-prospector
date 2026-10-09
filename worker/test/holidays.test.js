import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const h = require('../../docs/holidays.js');
const on = (iso) => h.holidayFor(new Date(`${iso}T12:00:00`));
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

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
  assert.equal(on('2026-07-01'), 'july4');
  assert.equal(on('2026-07-04'), 'july4');
  assert.equal(on('2026-07-06'), '');
  assert.equal(on('2026-09-15'), '');
});

test('6th of October shows for the whole week around it', () => {
  assert.equal(on('2026-10-02'), '');
  assert.equal(on('2026-10-03'), 'armedforces');
  assert.equal(on('2026-10-06'), 'armedforces');
  assert.equal(on('2026-10-09'), 'armedforces');
  assert.equal(on('2026-10-10'), '');
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

test('St. Patrick\'s and Valentine\'s', () => {
  assert.equal(on('2023-03-13'), '');
  assert.equal(on('2023-03-14'), 'stpatrick');
  assert.equal(on('2023-03-17'), 'stpatrick');
  assert.equal(on('2023-03-18'), '');
  assert.equal(on('2025-02-09'), '');
  assert.equal(on('2025-02-10'), 'valentine'); // Ramadan 2025 began on 1 March
  assert.equal(on('2025-02-14'), 'valentine');
  assert.equal(on('2025-02-15'), '');
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

test('only holidays that have a picture of Caro are decorated', () => {
  const buddy = read('../../docs/buddy.js');
  for (const key of h.KEYS) {
    assert.ok(existsSync(new URL(`../../docs/avatar/bd-${key}.webp`, import.meta.url)), `${key} has no picture in docs/avatar`);
    assert.ok(buddy.includes(`${key}: "bd-${key}.webp"`), `${key} is not one of Caro's looks in buddy.js`);
  }
  // and nothing else is drawn: the decoration sets are exactly the holidays on the list
  const source = read('../../docs/holidays.js');
  const block = source.slice(source.indexOf('const SETS = {') + 'const SETS = '.length, source.indexOf('};', source.indexOf('const SETS = {')) + 1);
  const sets = new Function(`return ${block}`)();
  assert.deepEqual(Object.keys(sets).sort(), [...h.KEYS].sort());
});

test('every holiday has its own look: no two sets are the same, and each uses at least three different drawings', () => {
  const source = read('../../docs/holidays.js');
  const block = source.slice(source.indexOf('const SETS = {') + 'const SETS = '.length, source.indexOf('};', source.indexOf('const SETS = {')) + 1);
  const sets = new Function(`return ${block}`)();
  const glyphs = new Function(`${source.slice(source.indexOf('const G = {'), source.indexOf('// Which little drawings'))}; return G;`)();
  const looks = new Map();
  for (const [key, items] of Object.entries(sets)) {
    assert.ok(new Set(items.map(([name]) => name)).size >= 3, `${key} uses fewer than three different drawings`);
    for (const [name] of items) assert.ok(glyphs[name], `${key} uses a drawing called ${name} that does not exist`);
    const signature = [...new Set(items.map(([name]) => name))].sort().join(',');
    assert.ok(!looks.has(signature), `${key} looks the same as ${looks.get(signature)}`);
    looks.set(signature, key);
  }
});
