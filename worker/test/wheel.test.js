import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const w = require('../../docs/wheel.js');

// A fixed "random" so every roll is predictable.
const rolling = (...values) => { let i = 0; return () => values[i++ % values.length]; };

test('the wheel has eight slices and every prize has something to give', () => {
  assert.equal(w.PRIZES.length, 8);
  for (const p of w.PRIZES) {
    assert.ok(p.options.length >= 1 && p.weight > 0 && p.days >= 1, p.id);
    assert.ok(p.short.length <= 7, `${p.id}'s short name has to fit on its slice`);
  }
  assert.equal(new Set(w.PRIZES.map((p) => p.kind)).size, 8); // no two slices give the same kind of perk
});

test('a roll picks by weight: the common ones first, the rare one last', () => {
  assert.equal(w.weightedIndex(() => 0), 0);
  assert.equal(w.weightedIndex(() => 0.999999), w.PRIZES.length - 1);
  const rolls = new Array(8).fill(0);
  for (let i = 0; i < 20000; i += 1) rolls[w.weightedIndex(rolling((i + 0.5) / 20000))] += 1;
  assert.ok(rolls[0] > rolls[7] * 3, 'the golden kudos is the rare one');
  assert.ok(rolls.every((n) => n > 0));
});

test('the prize value comes from its own options', () => {
  w.PRIZES.forEach((p, i) => { for (const r of [0, 0.5, 0.999999]) assert.ok(p.options.includes(w.resolve(i, () => r))); });
});

test('the disc stops with the won slice under the pointer', () => {
  const seg = 360 / w.PRIZES.length;
  for (let i = 0; i < w.PRIZES.length; i += 1) {
    for (const r of [0, 0.5, 0.999]) {
      const turned = ((w.spinAngle(i, 5, () => r) % 360) + 360) % 360; // where the disc ends up, clockwise from the start
      // The pointer is at the top; the slice's centre has moved to (centre + turned) clockwise from the top.
      const centre = (((i + 0.5) * seg + turned) % 360 + 360) % 360;
      const offTop = Math.min(centre, 360 - centre);
      assert.ok(offTop <= seg * 0.3 + 1e-9, `slice ${i} is under the pointer (off by ${offTop})`);
    }
  }
  assert.ok(w.spinAngle(0, 5, () => 0.5) > 5 * 360 - 360, 'it makes several full turns first');
});

test('a perk lasts until the end of the day it was won, or a few days for the bigger ones', () => {
  const noon = new Date(2026, 10, 3, 12, 0).getTime();
  const frame = w.PRIZES.findIndex((p) => p.kind === 'frame');
  const accent = w.PRIZES.findIndex((p) => p.kind === 'accent');
  const perks = w.grant(w.grant({}, frame, 'gold', noon), accent, 'rose', noon);
  assert.equal(w.activeValue(perks, 'frame', noon + 3600000), 'gold');
  assert.equal(w.activeValue(perks, 'frame', new Date(2026, 10, 4, 0, 0, 1).getTime()), null); // gone the next morning
  assert.equal(w.activeValue(perks, 'accent', new Date(2026, 10, 5, 9, 0).getTime()), 'rose'); // still there two days on
  assert.equal(w.activeValue(perks, 'accent', new Date(2026, 10, 6, 0, 0, 1).getTime()), null);
  assert.equal(w.activeValue({}, 'frame', noon), null);
});

test('pruning drops the finished ones and keeps the bookkeeping', () => {
  const now = 1000;
  const perks = { frame: { value: 'gold', until: 500 }, title: { value: 'Closer', until: 5000 }, lookRestore: { pose: 'neutral' } };
  const kept = w.prune(perks, now);
  assert.deepEqual(Object.keys(kept).sort(), ['lookRestore', 'title']);
  assert.deepEqual(w.consume(kept, 'title'), { lookRestore: { pose: 'neutral' } });
});

test('every prize explains itself in a sentence', () => {
  w.PRIZES.forEach((p, i) => assert.ok(w.describe(i, p.options[0]).length > 20, p.id));
});

test('the accent colours the wheel can give all exist in the stylesheet', () => {
  const css = readFileSync(new URL('../../docs/style.css', import.meta.url), 'utf8');
  for (const a of w.ACCENTS) assert.ok(css.includes(`:root[data-accent="${a}"]`), `${a} accent is styled`);
  for (const f of w.FRAMES) assert.ok(css.includes(`html[data-frame="${f}"]`), `${f} frame is styled`);
  for (const d of w.DECOS) assert.ok(css.includes(`html[data-deco="${d}"]`), `${d} sparkle is styled`);
});
