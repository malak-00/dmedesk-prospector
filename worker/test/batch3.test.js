import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { parseDuration, isAnswered, parseWhen, toCallRow, cleanCallRows, phonesFor, tallyByPhone, summarizeCallRecords, MAX_IMPORT_ROWS } from '../src/lib/callLog.js';
import { importCalls, attachCallRecords } from '../src/repos/callLogRepo.js';
import { buildDigest, weekTotals } from '../src/lib/digest.js';
import { buildInsights } from '../src/lib/insights.js';

const require = createRequire(import.meta.url);
const { parseCsv, detectColumns, toImportRows } = require('../../docs/calllogcsv.js');

const NOW = Date.parse('2026-10-21T12:00:00Z');

// ---- cleaning ----

test('durations read as seconds, mm:ss or hh:mm:ss', () => {
  assert.equal(parseDuration(95), 95);
  assert.equal(parseDuration('95'), 95);
  assert.equal(parseDuration('1:35'), 95);
  assert.equal(parseDuration('01:01:35'), 3695);
  assert.equal(parseDuration(''), null);
  assert.equal(parseDuration('long'), null);
});

test('answered: the disposition wins, otherwise 15 seconds or more', () => {
  assert.equal(isAnswered({ disposition: 'ANSWERED', durationSec: 2 }), true);
  assert.equal(isAnswered({ disposition: 'No Answer', durationSec: 40 }), false);
  assert.equal(isAnswered({ disposition: 'Voicemail', durationSec: 60 }), false);
  assert.equal(isAnswered({ durationSec: 15 }), true);
  assert.equal(isAnswered({ durationSec: 14 }), false);
  assert.equal(isAnswered({}), false);
});

test('dates in the phone system formats are read as UTC, whatever the machine', () => {
  assert.equal(parseWhen('2026-10-07 19:40:12'), Date.UTC(2026, 9, 7, 19, 40, 12));
  assert.equal(parseWhen('2026-10-07T19:40Z'), Date.UTC(2026, 9, 7, 19, 40));
  assert.equal(parseWhen('10/7/2026 7:40 PM'), Date.UTC(2026, 9, 7, 19, 40));
  assert.equal(parseWhen('10/7/2026 12:05 AM'), Date.UTC(2026, 9, 7, 0, 5));
  assert.equal(parseWhen('2026-10-07'), Date.UTC(2026, 9, 7));
  assert.ok(Number.isNaN(parseWhen('')));
});

test('a row is cleaned, or skipped with a reason', () => {
  const ok = toCallRow({ calledAt: '2026-10-07 19:40:12', agent: '  Ana  Lopez ', phone: '(727) 226-7700', durationSec: '0:45', disposition: 'Answered' }, NOW);
  assert.deepEqual(ok.row, { called_at: '2026-10-07T19:40:12.000Z', agent: 'Ana Lopez', phone: '7272267700', duration_sec: 45, disposition: 'Answered' });
  assert.equal(toCallRow({ calledAt: '2026-10-07', phone: '123' }, NOW).skip, 'no valid phone number');
  assert.equal(toCallRow({ calledAt: 'soon', phone: '727-226-7700' }, NOW).skip, 'no valid date');
  assert.equal(toCallRow({ calledAt: '2030-01-01', phone: '727-226-7700' }, NOW).skip, 'date out of range');
  assert.equal(toCallRow({ calledAt: '2010-01-01', phone: '727-226-7700' }, NOW).skip, 'date out of range');
});

test('duplicates inside one upload are dropped and skips are counted by reason', () => {
  const rows = [
    { calledAt: '2026-10-07 19:40:12', agent: 'Ana', phone: '727-226-7700' },
    { calledAt: '2026-10-07 19:40:12', agent: 'Ana', phone: '(727) 226-7700' },
    { calledAt: '2026-10-07 19:41:00', agent: 'Ana', phone: '727-226-7700' },
    { calledAt: 'bad', agent: 'Ana', phone: '727-226-7700' },
    { calledAt: '2026-10-07 19:40:12', phone: 'x' },
  ];
  const c = cleanCallRows(rows, NOW);
  assert.equal(c.rows.length, 2);
  assert.equal(c.duplicates, 1);
  assert.deepEqual(c.skipped, { 'no valid date': 1, 'no valid phone number': 1 });
});

test('a company\'s numbers: main line, contacts and branches, as 10 digits, once each', () => {
  assert.deepEqual(phonesFor({ phone: '727-256-1305', decisionMakers: [{ phone: '(772) 226-7700' }, { phone: '727.256.1305' }, { phone: '' }], locations: [{ phone: '+1 813 555 0100' }] }).sort(), ['7272561305', '7722267700', '8135550100']);
  assert.deepEqual(phonesFor(null), []);
});

test('calls tally by phone, and summarize by agent and weekday', () => {
  const calls = [{ phone: '1', duration_sec: 30 }, { phone: '1', duration_sec: 2, disposition: 'No Answer' }, { phone: '2', disposition: 'Answered' }];
  assert.deepEqual([...tallyByPhone(calls)], [['1', { total: 2, answered: 1 }], ['2', { total: 1, answered: 1 }]]);
  const sum = summarizeCallRecords([
    { called_at: '2026-10-19T14:00:00Z', agent: 'Ana', duration_sec: 120 }, // a Monday
    { called_at: '2026-10-19T15:00:00Z', agent: 'Ana', duration_sec: 3, disposition: 'No answer' },
    { called_at: '2026-10-20T15:00:00Z', agent: 'Ben', duration_sec: 60 },
  ]);
  assert.equal(sum.calls, 3);
  assert.equal(sum.answered, 2);
  assert.equal(sum.talkMinutes, 3);
  assert.deepEqual(sum.agents.map((a) => [a.agent, a.calls, a.answered]), [['Ana', 2, 1], ['Ben', 1, 1]]);
  assert.deepEqual(sum.weekdays.slice(0, 2).map((d) => [d.day, d.calls]), [['Mon', 2], ['Tue', 1]]);
  assert.equal(summarizeCallRecords([]), null);
  assert.equal(buildInsights({ users: [{ id: 'u', display_name: 'A' }], callRecords: [{ called_at: '2026-10-19T14:00:00Z', agent: 'Ana', duration_sec: 99 }], now: new Date('2026-10-21T12:00:00Z') }).callSystem.calls, 1);
});

// ---- the repo, against a small fake ----

function fakeDb({ missing = false, existing = [], records = [] } = {}) {
  const seen = new Set(existing);
  const nothing = { error: { code: 'PGRST205', message: 'Could not find the table' } };
  return {
    from() {
      const q = {
        upsert(rows) {
          if (missing) return { select: async () => nothing };
          const fresh = rows.filter((r) => !seen.has(`${r.agent}|${r.phone}|${r.called_at}`));
          fresh.forEach((r) => seen.add(`${r.agent}|${r.phone}|${r.called_at}`));
          return { select: async () => ({ data: fresh.map((_, i) => ({ id: i })), error: null }) };
        },
        select() { return q; }, in() { return q; }, limit() { return q; },
        then(res, rej) { return Promise.resolve(missing ? nothing : { data: records, error: null }).then(res, rej); },
      };
      return q;
    },
  };
}

test('importing counts new, already-there and skipped rows; a missing table says what to run', async () => {
  const rows = [
    { calledAt: '2026-10-07 19:40:12', agent: 'Ana', phone: '727-226-7700', durationSec: 30 },
    { calledAt: '2026-10-07 19:50:00', agent: 'Ana', phone: '727-226-7700', durationSec: 10 },
    { calledAt: 'bad', phone: '727-226-7700' },
  ];
  const out = await importCalls(fakeDb({ existing: ['Ana|7272267700|2026-10-07T19:50:00.000Z'] }), { id: 'u1' }, rows, NOW);
  assert.deepEqual([out.received, out.imported, out.alreadyThere, out.skipped], [3, 1, 1, { 'no valid date': 1 }]);
  await assert.rejects(() => importCalls(fakeDb({ missing: true }), { id: 'u1' }, rows, NOW), (e) => e.status === 503 && /sql\/053/.test(e.message));
  await assert.rejects(() => importCalls(fakeDb(), { id: 'u1' }, [], NOW), (e) => e.status === 400);
  await assert.rejects(() => importCalls(fakeDb(), { id: 'u1' }, new Array(MAX_IMPORT_ROWS + 1).fill({}), NOW), (e) => e.status === 400);
});

test('results get exact pickup numbers from the phone system, replacing the estimate', async () => {
  const records = [{ phone: '7272561305', duration_sec: 40 }, { phone: '7272561305', duration_sec: 2, disposition: 'No Answer' }, { phone: '7722267700', duration_sec: 90 }];
  const companies = [
    { npi: '1', phone: '727-256-1305', decisionMakers: [{ phone: '772-226-7700' }], pickup: { answered: 0, total: 1 } },
    { npi: '2', phone: '813-555-0100', decisionMakers: [] },
  ];
  const out = await attachCallRecords(fakeDb({ records }), companies);
  assert.deepEqual(out[0].pickup, { answered: 2, total: 3, source: 'phone system' });
  assert.equal(out[1].pickup, undefined);
  assert.equal((await attachCallRecords(fakeDb({ missing: true }), companies))[0].pickup.total, 1);
});

// ---- the CSV reader (browser module) ----

test('a CSV is split with quotes, commas, CRLF and a BOM', () => {
  const rows = parseCsv('﻿Call Date,Agent,Phone,Duration\r\n"2026-10-07 19:40","Lopez, Ana",(727) 226-7700,0:45\r\n\r\n2026-10-07 19:41,Ben,7272267701,12\r\n');
  assert.deepEqual(rows[0], ['Call Date', 'Agent', 'Phone', 'Duration']);
  assert.deepEqual(rows[1], ['2026-10-07 19:40', 'Lopez, Ana', '(727) 226-7700', '0:45']);
  assert.equal(rows.length, 3);
  assert.deepEqual(parseCsv('a;b\n1;2'), [['a', 'b'], ['1', '2']]);
});

test('columns are found from the header names, each used once', () => {
  assert.deepEqual(detectColumns(['Call Date', 'Agent', 'Phone', 'Duration (sec)', 'Disposition']), { calledAt: 0, phone: 2, durationSec: 3, disposition: 4, agent: 1 });
  assert.deepEqual(detectColumns(['Timestamp', 'Extension', 'Dialed Number', 'Talk Time', 'Result']), { calledAt: 0, phone: 2, durationSec: 3, disposition: 4, agent: 1 });
  assert.equal(detectColumns(['foo', 'bar']).phone, -1);
  const rows = parseCsv('Date,Phone,Duration\n2026-10-07 19:40,727-226-7700,30\n,,\n');
  const mapping = detectColumns(rows[0]);
  assert.deepEqual(toImportRows(rows, mapping), [{ calledAt: '2026-10-07 19:40', agent: '', phone: '727-226-7700', durationSec: '30', disposition: '' }]);
});

// ---- the weekly digest ----

const day = (calls, dials, claims) => ({ calls, dials, claims });

test('the digest compares the last week with the one before and stays under the note limit', () => {
  const daily = [...Array(7).fill(day(2, 1, 1)), ...Array(7).fill(day(3, 2, 2))];
  const w = weekTotals(daily);
  assert.deepEqual([w.calls, w.callsPrev, w.claims, w.claimsPrev, w.hasPrev], [35, 21, 14, 7, true]);
  const text = buildDigest({
    adoption: { daily },
    team: { active7: 4, total: 5 },
    signals: [{ level: 'warn', text: 'Only 40% of claimed leads get a first call.' }, { level: 'good', text: 'fine' }],
    friction: { queues: { matchReviews: 3, providerChanges: 0 }, suggestions: { last7: 2 } },
  });
  assert.match(text, /^Weekly digest: 35 calls \(\+14 on the week before\), 14 claims \(\+7 on the week before\)\./);
  assert.match(text, /4 of 5 reps active\./);
  assert.match(text, /Worth a look: Only 40%/);
  assert.match(text, /Waiting on you: 3 possible duplicates, 2 suggestions this week\./);
  assert.ok(text.length <= 500);
  assert.match(buildDigest({}), /^Weekly digest: 0 calls/);
  assert.ok(buildDigest({ signals: Array.from({ length: 5 }, () => ({ level: 'bad', text: 'x'.repeat(300) })) }).length <= 480);
});
