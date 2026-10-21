import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildCallBrief, buildFollowUpEmail, emailToText } = require('../../docs/callbrief.js');

const NOW = Date.parse('2026-10-21T18:00:00Z');
const biz = { name: 'Medical Hotspots, Inc', address: { city: 'Tampa', state: 'FL' }, decisionMakers: [{ name: 'Trisha Bailey', title: 'CEO' }], phone: '727-256-1305', isOrganization: true };

test('the brief shows other businesses the owner runs, and asks about them first', () => {
  const owner = { total: 2, ambiguous: false, matches: [{ name: 'Bay Orthotics' }, { name: 'Sun Mobility' }] };
  const brief = buildCallBrief({ company: biz, owner, now: NOW });
  const business = (brief.facts.find((f) => f.label === 'Business') || {}).text;
  assert.match(business, /the owner also runs 2 other businesses \(Bay Orthotics, Sun Mobility\)/);
  const questions = brief.script.find((s) => s.label === 'Questions to ask').items;
  assert.match(questions[0], /I see you also run Bay Orthotics/);
  const none = buildCallBrief({ company: biz, owner: { total: 0, matches: [] }, now: NOW });
  assert.equal(none.script.find((s) => s.label === 'Questions to ask').items[0].includes('also run'), false);
});

test('the follow-up email has two versions, uses the intel, and keeps the placeholders', () => {
  const intel = { installed: true, email: 'trisha@example.com', currentBiller: 'Acme Billing' };
  const spoke = buildFollowUpEmail({ company: biz, intel, now: NOW }, 'spoke');
  const missed = buildFollowUpEmail({ company: biz, intel, now: NOW }, 'missed');
  assert.equal(spoke.to, 'trisha@example.com');
  assert.equal(spoke.subject, 'Following up on our call');
  assert.equal(missed.subject, 'Sorry I missed you');
  assert.match(spoke.body, /^Hi Trisha,/);
  assert.match(spoke.body, /Thanks for taking my call\./);
  assert.match(missed.body, /I tried you earlier and didn't catch you/);
  assert.match(spoke.body, /alongside an existing biller such as Acme Billing/);
  assert.match(spoke.body, /\[day\] at \[time\] or \[day\] at \[time\]/);
  assert.ok(spoke.body.endsWith('[your name]\n[company name] · [number]'));
  const text = emailToText(spoke);
  assert.ok(text.startsWith('To: trisha@example.com\nSubject: Following up on our call\n\nHi Trisha,'));
});

test('the email makes no price, result or audit promises, and works with nothing known', () => {
  const email = buildFollowUpEmail({ company: { name: 'Bare Supply' }, now: NOW }, 'spoke');
  assert.equal(email.to, '');
  assert.match(email.body, /^Hi,/);
  assert.doesNotMatch(email.body, /audit|free|guarantee|save \$|%/i);
  assert.ok(emailToText(email).startsWith('Subject:'));
});
