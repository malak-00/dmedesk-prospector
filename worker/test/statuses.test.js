import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalStatus, cleanStatus, CANONICAL_STATUSES, isJunkStatus, normalizeStatus, statusCleanupRows, statusOptions, suggestMerge } from '../src/lib/statuses.js';

test('the many ways of typing one status all mean the same thing', () => {
  const cases = {
    voicemail: ['voicemail', 'Voicemail', 'VM', 'v.m.', 'Voice mail', 'voice-mail', 'Left VM', 'left a message', 'LVM'],
    'no answer': ['No answer', 'NA', 'N/A', 'no-answer', "didn't answer", 'DNP', 'no pickup'],
    gatekeeper: ['GK', 'Gatekeeper', 'gate keeper', 'Front desk'],
    callback: ['CBK', 'Call back', 'call-back', 'Callback', 'cb', 'Call back later'],
    'follow up': ['Follow up', 'follow-up', 'Follow-up 2wk', 'followup', 'FU', 'nurture'],
    interested: ['Interested', 'warm', 'HOT', 'Send info'],
    'not interested': ['NI', 'Not Interested', 'not_interested', 'declined', 'Pass'],
    'do not call': ['DNC', 'Do Not Call', "don't call", 'never call', 'opt out'],
    'meeting booked': ['Meeting Booked', 'booked', 'Appt set', 'appointment booked', 'demo scheduled'],
    'contract sent': ['Contract Sent', 'contract', 'sent contract'],
    'invoice sent': ['Invoice Sent', 'invoice'],
    onboarded: ['Onboarded', 'signed', 'Closed Won', 'won', 'customer'],
    called: ['called', 'Contacted', 'spoke to owner', 'Reached'],
    new: ['new', 'New', 'unworked', 'Untouched'],
  };
  for (const [want, typed] of Object.entries(cases)) {
    for (const t of typed) assert.equal(canonicalStatus(t), want, `"${t}" should be "${want}"`);
  }
});

test('unknown statuses are left alone, and disconnected is never folded into the list', () => {
  assert.equal(canonicalStatus('Site visit'), null);
  assert.equal(canonicalStatus('Disconnected'), null, 'a disconnect is a move, not a typed status');
  assert.equal(canonicalStatus(''), null);
  assert.equal(canonicalStatus(null), null);
  assert.ok(!CANONICAL_STATUSES.includes('disconnected'));
});

test('what is stored is the canonical status, or a tidied lower-case version of a custom one', () => {
  assert.equal(normalizeStatus('  VM '), 'voicemail');
  assert.equal(normalizeStatus('Site   Visit!'), 'site visit');
  assert.equal(normalizeStatus('Site Visit'), normalizeStatus('site  visit'), 'case and spacing never make a second status');
  assert.equal(normalizeStatus('x'.repeat(100)).length, 40);
  assert.equal(cleanStatus('Not_Interested'), 'not interested');
});

test('meaningless statuses are recognised', () => {
  for (const junk of ['', 'a', 'x', '??', '.', '123', 'test', 'asdf', 'xxxx', 'TBD', 'misc', 'ooo']) assert.equal(isJunkStatus(junk), true, junk);
  for (const fine of ['voicemail', 'site visit', 'ni', 'do not call']) assert.equal(isJunkStatus(fine), false, fine);
});

test('the cleanup screen proposes what each stored spelling should become', () => {
  assert.deepEqual(suggestMerge('voicemail'), { target: 'voicemail', why: 'ok', junk: false });
  assert.deepEqual(suggestMerge('Voicemail'), { target: 'voicemail', why: 'same meaning', junk: false });
  assert.equal(suggestMerge('Site Visit').target, 'site visit');
  assert.equal(suggestMerge('site visit').target, null, 'a clean custom status is left as it is');
  assert.equal(suggestMerge('asdf').junk, true);
  assert.equal(suggestMerge('asdf').target, 'new', 'a meaningless one goes back to new');
  assert.equal(suggestMerge('46253.0').target, 'new', 'a spreadsheet date number is not a status');
  assert.equal(suggestMerge('46253.0').junk, true);
  assert.equal(suggestMerge('Disconnected').why, 'disconnected');
  const rows = statusCleanupRows(new Map([['Voicemail', 5], ['voicemail', 40], ['VM', 3], ['', 9], ['zzz', 1]]));
  assert.deepEqual(rows.map((r) => [r.status, r.count]), [['voicemail', 40], ['Voicemail', 5], ['VM', 3], ['zzz', 1]], 'blank statuses are skipped, the biggest first');
});

test('dropdowns list the canonical statuses once, plus custom ones that are still used', () => {
  const options = statusOptions(['Voicemail', 'VM', 'Site Visit', 'site visit', 'asdf', 'Disconnected', 'new']);
  assert.deepEqual(options, [...CANONICAL_STATUSES, 'site visit']);
  assert.equal(new Set(options).size, options.length);
});
