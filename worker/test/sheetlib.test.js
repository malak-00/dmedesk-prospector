import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// The browser helpers are plain scripts that also export for tests.
const require = createRequire(import.meta.url);
const sheet = require('../../docs/sheetlib.js');
const related = require('../../docs/related.js');

const csv = [
  'NPI,Opener,Company Name,SUB,Status,Date Added,Authorized Person,Phone,EMAIL,Meeting Time,Opener Summary,Closer\'s Notes,SYNC',
  '1134722390,Ben,"CLAYTON, MEDICAL",DME,Onboarded,2026-01-02,Judith F,404-808-5118,a@b.co,,"Asked about\nbilling","Signed ""fast""",FALSE',
  '2025 -,,,,,,,,,,,,',
  '123,Selene,TOO SHORT,DME,,,,,,,,,',
  '1000000002,Selene,SOLAR CO,Solar,,,,,,,,,',
  '1000000003,George,GEORGE CO,DME,,,,,,,,,',
  '1000000004,Jimmy,MENTIONS,DME,,,,,,,,Talked to george about it,',
  '1000000005,Jimmy,ALREADY DONE,DME,,,,,,,,,TRUE',
  '1000000006,Jimmy,DUPLICATE A,DME,,,,,,,,,',
  '1000000006,Jimmy,DUPLICATE B,DME,,,,,,,,,',
  '1000000007,,NO OPENER,DME,,,,,,,,,',
].join('\n');

test('reads quoted fields, doubled quotes and line breaks inside a cell', () => {
  const rows = sheet.parseCsv(csv);
  assert.equal(rows[1][2], 'CLAYTON, MEDICAL');
  assert.equal(rows[1][10], 'Asked about\nbilling');
  assert.equal(rows[1][11], 'Signed "fast"');
  assert.deepEqual(sheet.parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(sheet.parseCsv('﻿a,b\n'), [['a', 'b']], 'a spreadsheet byte-order mark is ignored');
});

test('columns are found by name, wherever they sit', () => {
  const map = sheet.headerMap(["Foo", "MEDB", "NPI", "Closer's Notes", "Authorized Person", "EMAIL", "SYNC"]);
  assert.deepEqual([map.npi, map.closerNotes, map.authorized, map.email, map.sync], [2, 3, 4, 5, 6]);
  assert.equal(sheet.qualify([['Name', 'Phone']]).missingNpi, true);
});

test('rows are qualified by the protocol rules, with the exclusions as settings', () => {
  const q = sheet.qualify(sheet.parseCsv(csv), { excludeSubs: 'solar', excludeWords: 'george', skipSynced: true });
  assert.deepEqual(q.candidates.map((c) => c.npi), ['1134722390', '1000000006', '1000000007']);
  assert.deepEqual(q.skipped, { invalid: 2, excluded: 3, synced: 1, duplicate: 1 });
  assert.deepEqual(q.openers.map((o) => [o.name, o.count]).sort(), [['', 1], ['Ben', 1], ['Jimmy', 1]]);
  // The same file with different settings keeps different rows.
  const loose = sheet.qualify(sheet.parseCsv(csv), { excludeSubs: '', excludeWords: '', skipSynced: false });
  assert.equal(loose.candidates.length, 7);
});

test('the sheet\'s context becomes one call-log line that is not counted as a call', () => {
  const c = sheet.qualify(sheet.parseCsv(csv), {}).candidates[0];
  const payload = sheet.toPayload(c, { stamp: '2026-10-06 12:00', actor: 'Admin Person' });
  assert.match(payload.notes, /^2026-10-06 12:00 — Admin Person: Imported from BD MEETINGS — Opener: Ben/);
  assert.equal(payload.notes.includes('\n'), false, 'one line, so the History list stays intact');
  assert.match(payload.notes, /Opener summary: Asked about billing/);
  assert.equal(payload.status, 'Onboarded');
  assert.equal(sheet.toPayload({ ...c, status: '' }, { stamp: 's', statusMode: { useSheet: true, fallback: 'Follow up' } }).status, 'Follow up');
  assert.equal(sheet.toPayload(c, { stamp: 's', statusMode: { useSheet: false, fixed: 'New lead' } }).status, 'New lead');
});

test('the server\'s answer is sorted into one result per row', () => {
  const real = sheet.verdictFor(['1', '2', '3', '4', '5'], {
    claimedNpis: ['1'], alreadyClaimedNpis: ['2'], blocked: [{ npi: '3', owners: ['Selene Myles'] }], heldForReview: [{ npi: '4' }],
  });
  assert.deepEqual(Object.values(real).map((r) => r.result), ['imported', 'already-theirs', 'blocked', 'held', 'not-imported']);
  assert.equal(real['3'].detail, 'Owned by Selene Myles');
  const dry = sheet.verdictFor(['1', '3'], { dryRun: true, allowedNpis: ['1'], blocked: [{ npi: '3', owners: ['X'] }] });
  assert.equal(dry['1'].result, 'would-import');
  assert.equal(dry['3'].result, 'blocked');
});

test('exports are safe to open in a spreadsheet', () => {
  assert.equal(sheet.csvEscape('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(sheet.csvEscape('@cmd'), "'@cmd");
  assert.equal(sheet.csvEscape('+1 404 808 5118'), '+1 404 808 5118', 'a phone number is left alone');
  assert.equal(sheet.csvEscape('-cmd|x'), "'-cmd|x");
  assert.equal(sheet.csvEscape('plain, text'), '"plain, text"');
  const out = sheet.leadsToCsv([{ npi: '1', name: 'A, Inc', notes: 'line 1\nline 2', claimedBy: 'Ana' }]);
  assert.ok(out.startsWith('﻿NPI,Company,Rep'));
  assert.match(out, /"line 1\nline 2"/);
  const results = sheet.resultsToCsv([{ rowNumber: 5, npi: '1', company: 'A', rep: 'Ana', result: 'imported', detail: '' }, { rowNumber: 6, npi: '2', company: 'B', rep: 'Ana', result: 'blocked', detail: 'Owned by X' }]);
  assert.match(results, /5,1,A,Ana,Imported,,TRUE/);
  assert.match(results, /6,2,B,Ana,Blocked,Owned by X,FALSE/);
});

// ---- related businesses ----------------------------------------------------------------

const describe = (x) => x;

test('leads sharing a phone, or an owner in the same state, are one business', () => {
  const items = [
    { phones: ['(404) 808-5118'], owner: 'Judith Fairclough', state: 'GA' },   // 0
    { phones: ['404.808.5118'], owner: 'Someone Else', state: 'GA' },           // 1: same phone as 0
    { phones: ['305-555-0101'], owner: 'Judith Fairclough', state: 'GA' },     // 2: same owner as 0
    { phones: ['305-555-0102'], owner: 'Judith Fairclough', state: 'TX' },     // 3: same name, other state: not related
    { phones: ['305-555-0199'], owner: 'Lone Wolf', state: 'FL' },             // 4: alone
  ];
  const c = related.clusterRelated(items, describe);
  assert.deepEqual(c.clusters, [[0, 1, 2]]);
  assert.deepEqual(c.clusterOf, [0, 0, 0, -1, -1]);
  assert.equal(c.relation(0, 1), 'same phone');
  assert.equal(c.relation(0, 2), 'same owner');
});

test('a switchboard number shared by many rows, or a single name, does not merge anything', () => {
  const owners = ['Alice Adams', 'Brian Baker', 'Chloe Clark', 'Derek Dunn', 'Elena Evans', 'Frank Fox', 'Grace Gray', 'Henry Hall'];
  const many = owners.map((owner) => ({ phones: ['800-555-0000'], owner, state: 'FL' }));
  assert.deepEqual(related.clusterRelated(many, describe).clusters, []);
  const oneWord = [{ phones: [], owner: 'Smith', state: 'FL' }, { phones: [], owner: 'Smith', state: 'FL' }];
  assert.deepEqual(related.clusterRelated(oneWord, describe).clusters, [], 'a one-word name is too weak to join on');
  const junk = [{ phones: ['0000000000'], owner: '', state: '' }, { phones: ['0000000000'], owner: '', state: '' }];
  assert.deepEqual(related.clusterRelated(junk, describe).clusters, []);
});

test('keeping related rows together moves them side by side and changes nothing else', () => {
  const clusters = [[0, 3], [1, 4]];
  const clusterOf = [0, 1, -1, 0, 1];
  assert.deepEqual(related.groupedOrder(5, clusters, clusterOf), [0, 3, 1, 4, 2]);
});
