import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySheetResult, parseSheetTime, wallClockToMs, buildSheetBaseline } from '../src/lib/sheetCalls.js';
import { blocksOf, halvesOf, BLOCK_MIN, mergeGrids, standardize, summarize, wilsonLower, wilsonInterval, RANK_MIN } from '../src/lib/bestTimes.js';
import { getBestTimes, clearBestTimesCache } from '../src/repos/insightsRepo.js';
import baseline from '../src/data/bestTimesBaseline.js';

test('the sheet\'s wording says whether anyone picked up', () => {
  for (const missed of ['VM', 'vm 4/28', 'left a v.m', 'left a v,m 5/4', 'lefta v.m 5/4', 'FTVM', 'vm full 4/23', 'VM is not set', 'no answer 4/28', 'NA 3/10', 'Busy 3/26', 'Line is busy 5/11', 'left av.m 4/29', 'vmfull', 'DMEDESK VM 4/29', 'VM x3 6/18']) {
    assert.equal(classifySheetResult(missed), 'missed', missed);
  }
  for (const answered of ['NO ORT NO CGM', 'Hung Up 6/19', 'hungup', 'Not Interested 6/19', 'NI', 'GK 3/23', 'cb later', 'no dme 4/23', 'Part D only 9/22', "Can't dropship 9/17", 'the operator took a msg']) {
    assert.equal(classifySheetResult(answered), 'answered', answered);
  }
  // what kind of business it is says nothing about whether the phone was picked up
  for (const kind of ['Pharmacy 7/6', 'Not Qualified 10/2', 'Clinic 10/2', 'Doctor Office 6/19', 'Home Health Agency', 'Long Term Care Pharmacy']) assert.equal(classifySheetResult(kind), null, kind);
  for (const nothing of ['', '-', 'Dir 3/10', 'Directory', 'Disconnected 10/6', 'Invalid Number 8/20', 'Company Closed 6/25', 'closed', 'SHUT DOWN', 'sent an email 4/17/26 admin@x.com 4/17', '46133', '747-343-9575 6/25', 'stayed on hold']) {
    assert.equal(classifySheetResult(nothing), null, nothing);
  }
});

test('only the last line of a comment is the last call', () => {
  assert.equal(classifySheetResult('Gatekeeper 12/17\nVM'), 'missed');
  assert.equal(classifySheetResult('VM 12/17\nNot interested 1/5'), 'answered');
});

test('the sheet\'s date and time are read as month/day/year and 24-hour', () => {
  assert.deepEqual(parseSheetTime('3/9/2026 21:14:06'), { y: 2026, m: 3, d: 9, h: 21, mi: 14, s: 6 });
  assert.deepEqual(parseSheetTime('12/1/2026 9:05'), { y: 2026, m: 12, d: 1, h: 9, mi: 5, s: 0 });
  assert.equal(parseSheetTime('13/40/2026 10:00:00'), null);
  assert.equal(parseSheetTime('yesterday'), null);
  assert.equal(parseSheetTime(''), null);
});

test('Cairo time becomes the right instant, with daylight saving either side of the clock change', () => {
  // Cairo is UTC+2 in winter and UTC+3 in summer time (late April to late October).
  assert.equal(new Date(wallClockToMs({ y: 2026, m: 3, d: 9, h: 21, mi: 14, s: 6 })).toISOString(), '2026-03-09T19:14:06.000Z');
  assert.equal(new Date(wallClockToMs({ y: 2026, m: 7, d: 1, h: 21, mi: 0, s: 0 })).toISOString(), '2026-07-01T18:00:00.000Z');
  assert.equal(new Date(wallClockToMs({ y: 2026, m: 12, d: 1, h: 21, mi: 0, s: 0 })).toISOString(), '2026-12-01T19:00:00.000Z');
});

test('calls are counted by the lead\'s own weekday and hour, and only answered/missed ones count', () => {
  // 9 March 2026 21:14 Cairo = 19:14 UTC = 3:14 PM Eastern (EDT began 8 March) on a Monday; 12:14 PM Pacific
  const out = buildSheetBaseline([
    { state: 'NY', lastCalled: '3/9/2026 21:14:06', comments: 'Not Interested 3/9', owner: 'Jasmine' },
    { state: 'NY', lastCalled: '3/9/2026 21:30:00', comments: 'VM 3/9', owner: 'Jasmine Lee' },
    { state: 'CA', lastCalled: '3/9/2026 21:14:06', comments: 'NA 3/9', owner: 'Jane' },
    { state: 'NY', lastCalled: '3/9/2026 21:14:06', comments: 'Disconnected 3/9', owner: 'Jane' }, // not a call about picking up
    { state: 'ZZ', lastCalled: '3/9/2026 21:14:06', comments: 'VM', owner: 'Jane' }, // unknown state
    { state: 'NY', lastCalled: '3/10/2026 04:00:00', comments: 'VM', owner: 'Jane' }, // 9:00 PM Eastern the evening before: outside 8 to 5
  ]);
  assert.equal(out.rows, 6);
  assert.equal(out.counted, 3);
  assert.equal(out.outsideHours, 1);
  assert.deepEqual(out.grid[0][7], [2, 1]); // Monday, 3 PM Eastern: one answered, one voicemail
  assert.deepEqual(out.grid[0][4], [1, 0]); // Monday, noon Pacific
  assert.deepEqual(out.byOwner.jasmine[0][7], [2, 1]);
  assert.deepEqual(out.byOwner.jane[0][4], [1, 0]);
});

test('a slot with a lot of calls beats one with a few lucky ones', () => {
  assert.ok(wilsonLower(80, 48) > wilsonLower(5, 4)); // 60% of 80 is better supported than 80% of 5
  assert.ok(wilsonLower(5, 5) < 0.6);
  assert.equal(wilsonLower(0, 0), 0);
  const grid = Array.from({ length: 5 }, () => Array.from({ length: 9 }, () => [0, 0]));
  grid[1][7] = [80, 48];
  grid[2][3] = [RANK_MIN - 1, RANK_MIN - 1]; // every call answered, but one short of enough to rank
  const s = summarize(grid);
  assert.deepEqual([s.best[0].day, s.best[0].hour], ['Tue', 15]);
  assert.deepEqual([s.bestHour.hour, s.bestDay.day], [15, 'Tue']);
});

test('two grids add cell by cell, and either may be missing', () => {
  const a = [[[1, 1], [2, 0]], [[0, 0], [3, 3]]];
  const b = [[[4, 2], [0, 0]], [[1, 1], [1, 0]]];
  assert.deepEqual(mergeGrids(a, b), [[[5, 3], [2, 0]], [[1, 1], [4, 3]]]);
  assert.equal(mergeGrids(a, null), a);
  assert.equal(mergeGrids(null, b), b);
  assert.equal(mergeGrids(null, null), null);
});

function fakeLeads(rows) {
  return {
    from: () => {
      const q = { select: () => q, not: () => q, order: () => q, range: () => q, then: (resolve) => resolve({ data: rows, error: null }) };
      return q;
    },
  };
}

test('the Best times add the earlier sheet to the logged calls, and "Mine" adds the sheet\'s calls for the same first name', async () => {
  clearBestTimesCache();
  const grid = Array.from({ length: 5 }, () => Array.from({ length: 9 }, () => [0, 0]));
  const ana = grid.map((r) => r.map(() => [2, 1]));
  const sheet = { counted: 90, builtAt: '2026-10-09', grid: ana, byOwner: { ana } };
  const db = fakeLeads([{ state: 'NY', notes: '2026-10-06 19:40 — Ana Lopez: interested' }]);
  const res = await getBestTimes(db, { displayName: 'Ana Lopez' }, 1000, sheet);
  assert.equal(res.sample, 91); // one logged call and 90 from the sheet
  assert.deepEqual(res.sources, { live: 1, sheet: 90, mineLive: 1, mineSheet: 90, sheetBuiltAt: '2026-10-09' });
  assert.equal(res.team.calls, 91); // the sheet's 90 for Ana and her one logged call
  assert.equal(res.mine.calls, 91); // her 90 sheet calls and her logged one
  const other = await getBestTimes(db, { displayName: 'Ben Hill' }, 1000, sheet);
  assert.equal(other.mine, null); // no logged calls and no sheet history under that name
  clearBestTimesCache();
});

test('the committed counts are only counts', () => {
  assert.equal(baseline.grid.length, 5);
  assert.ok(baseline.grid.every((day) => day.length === 9 && day.every(([n, a]) => Number.isInteger(n) && Number.isInteger(a) && a <= n)));
  assert.equal(baseline.grid.flat().reduce((t, [n]) => t + n, 0), baseline.counted);
  assert.ok(baseline.counted > 1000);
  // nothing but numbers and short labels: no lead names, numbers, emails or comments
  const text = JSON.stringify(baseline);
  assert.ok(!/@|https?:|\d{3}[-. )]\d{3}[-. ]\d{4}/.test(text));
  for (const [name, g] of Object.entries(baseline.byOwner)) assert.ok(/^[a-z]{2,20}$/.test(name) && g.length === 5, name);
});

const blank = () => Array.from({ length: 5 }, () => Array.from({ length: 9 }, () => [0, 0]));

test('a rep who logs "answered" results freely does not make their hours look better than they are', () => {
  // Ana logs nearly everything as answered (90%) and only calls at 9 AM; Ben logs only voicemail and no answer (10% answered)
  // and only calls at 3 PM. Raw numbers would call 9 AM nine times better than 3 PM, which is just their styles.
  const ana = blank(); ana[0][1] = [100, 90];
  const ben = blank(); ben[0][7] = [100, 10];
  const raw = mergeGrids(ana, ben);
  assert.ok(raw[0][1][1] / raw[0][1][0] > 5 * (raw[0][7][1] / raw[0][7][0]));
  const fair = standardize(new Map([['ana', ana], ['ben', ben]]));
  const rate = (c) => c[1] / c[0];
  assert.ok(Math.abs(rate(fair[0][1]) - rate(fair[0][7])) < 1e-9); // the same, once each is compared with their own usual
  assert.deepEqual([fair[0][1][0], fair[0][7][0]], [100, 100]); // the number of calls is unchanged
  assert.ok(Math.abs(rate(fair[0][1]) - 0.5) < 1e-9); // and it sits at the team's overall 50%
});

test('when an hour really is better for the same rep, the correction keeps it', () => {
  const ana = blank();
  ana[0][1] = [100, 40]; ana[0][7] = [100, 80]; // the same person: 40% at 9 AM, 80% at 3 PM
  const fair = standardize(new Map([['ana', ana]]));
  assert.ok(fair[0][7][1] / fair[0][7][0] > fair[0][1][1] / fair[0][1][0] + 0.3);
});

test('a rep with only a few calls is treated as average, so the correction changes nothing for them', () => {
  const few = blank(); few[2][3] = [5, 5];
  const out = standardize(new Map([['new', few]]));
  assert.deepEqual(out[2][3], [5, 5]);
  assert.equal(standardize(new Map()), null);
});

test('only a window that clearly differs from the average is marked strong or slower', () => {
  const grid = blank();
  // an average of 50%: every cell 50%, with plenty of calls (30 a cell across an hour)
  grid.forEach((row) => row.forEach((_, h) => { row[h] = [30, 15]; }));
  grid[1][6] = [60, 45]; grid[1][7] = [60, 45]; // Tuesday 2 to 5 PM: hours 14 and 15 at 75%
  grid[4][4] = [70, 20]; grid[4][5] = [70, 20]; // Friday 12 to 2 PM: hours 12 and 13 at 29%
  const b = blocksOf(grid);
  const at = (part, day) => b.cells[part][day];
  assert.equal(at(3, 1).verdict, 'strong'); // Tuesday 2 to 5 PM
  assert.equal(at(2, 4).verdict, 'weak'); // Friday 12 to 2 PM
  assert.equal(at(1, 0).verdict, 'typical'); // an ordinary window stays unmarked
  assert.deepEqual(b.strong.map((c) => `${c.day} ${c.part}`), ['Tue 2–5 PM']);
  assert.deepEqual(b.weak.map((c) => `${c.day} ${c.part}`), ['Fri 12–2 PM']);
  assert.ok(b.overall > 0.4 && b.overall < 0.6);
});

test('a window with too few calls is never called strong or weak, however it looks', () => {
  const grid = blank();
  grid.forEach((row) => row.forEach((_, h) => { row[h] = [30, 15]; }));
  grid[0][0] = [Math.floor(BLOCK_MIN / 2) - 1, Math.floor(BLOCK_MIN / 2) - 1]; // all answered, but few
  grid[0][1] = [0, 0];
  const b = blocksOf(grid);
  assert.equal(b.cells[0][0].verdict, 'few');
  assert.equal(b.strong.length, 0);
});

test('the intervals widen with fewer calls', () => {
  const [lo1, hi1] = wilsonInterval(20, 10);
  const [lo2, hi2] = wilsonInterval(2000, 1000);
  assert.ok(hi1 - lo1 > 4 * (hi2 - lo2));
  assert.ok(lo2 < 0.5 && hi2 > 0.5);
});

test('with the real sheet counts, the verdicts match what the data shows: Monday and Tuesday afternoons stand out', () => {
  const s = summarize(standardize(new Map(Object.entries(baseline.byOwner))));
  assert.ok(s.blocks.strong.some((c) => c.part === '2–5 PM' || c.part === '12–2 PM'), 'an afternoon window should be marked strong');
  assert.ok(s.blocks.weak.length >= 1);
  assert.ok(s.blocks.overall > 0.2 && s.blocks.overall < 0.4); // about a quarter to a third of calls are picked up
  const am = s.blocks.byPart.slice(0, 2).reduce((t, p) => [t[0] + p.calls, t[1] + p.answered], [0, 0]);
  const pm = s.blocks.byPart.slice(2).reduce((t, p) => [t[0] + p.calls, t[1] + p.answered], [0, 0]);
  assert.ok(pm[1] / pm[0] > am[1] / am[0], 'after noon should be better than before noon');
});

test('each part of the day and each weekday gets a verdict over the whole week', () => {
  const grid = blank();
  grid.forEach((row) => row.forEach((_, h) => { row[h] = [40, h >= 4 ? 20 : 8]; })); // from noon: half picked up; before noon: a fifth
  const b = blocksOf(grid);
  assert.deepEqual(b.byPart.map((p) => p.verdict), ['weak', 'weak', 'strong', 'strong']);
  assert.ok(b.byPart.every((p) => p.calls > BLOCK_MIN));
  assert.deepEqual(b.days.map((d) => d.verdict), ['typical', 'typical', 'typical', 'typical', 'typical']); // every day is the same here
});

test('before noon against after noon: only a clear difference is reported', () => {
  const grid = blank();
  grid.forEach((row) => row.forEach((_, h) => { row[h] = [40, h < 4 ? 8 : 14]; })); // a fifth before noon, 35% after
  const clear = halvesOf(grid);
  assert.equal(clear.verdict, 'pm');
  assert.ok(Math.abs(clear.lift - 0.75) < 1e-9);
  const even = blank();
  even.forEach((row) => row.forEach((_, h) => { row[h] = [40, 12]; }));
  assert.equal(halvesOf(even).verdict, 'same');
  const small = blank();
  small[0][0] = [10, 1]; small[0][8] = [10, 9];
  assert.equal(halvesOf(small).verdict, 'few'); // 10 calls a side is too few to say
  const morning = blank();
  morning.forEach((row) => row.forEach((_, h) => { row[h] = [40, h < 4 ? 20 : 8]; }));
  assert.equal(halvesOf(morning).verdict, 'am');
});

test('on the real sheet, after noon is clearly ahead of before noon', () => {
  const s = summarize(standardize(new Map(Object.entries(baseline.byOwner))));
  const h = s.blocks.halves;
  assert.equal(h.verdict, 'pm');
  assert.ok(h.pm.rate > h.am.rate + 0.02);
  assert.ok(h.lift > 0.1 && h.lift < 0.4);
});
