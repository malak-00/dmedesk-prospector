import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildCallBrief, briefToText, trendText } = require('../../docs/callbrief.js');

const NOW = Date.parse('2026-10-19T00:00:00Z');
const lead = (extra = {}) => ({
  name: 'Medical Hotspots, Inc',
  npi: '1003386889',
  address: { city: 'Saint Petersburg', state: 'FL' },
  taxonomy: { description: 'Durable Medical Equipment' },
  phone: '727-256-1305',
  website: 'https://example.com',
  isOrganization: true,
  lastUpdated: '2024-09-20',
  medicare: { totalClaims: 1307, totalBeneficiaries: 194, medicarePayment: 525505 },
  decisionMakers: [{ name: 'Trisha Bailey', title: 'CEO', phone: '772-226-7700' }],
  ...extra,
});
const part = (brief, label) => (brief.script.find((s) => s.label === label) || {}).text || '';
const items = (brief, label) => (brief.script.find((s) => s.label === label) || {}).items || [];
const fact = (brief, label) => (brief.facts.find((f) => f.label === label) || {}).text || '';

test('a full lead gets who to ask for, the money, and a five-part plan', () => {
  const brief = buildCallBrief({ company: lead(), now: NOW });
  assert.equal(brief.title, 'Medical Hotspots, Inc');
  assert.match(fact(brief, 'Ask for'), /Trisha Bailey, CEO \(direct 772-226-7700, main line 727-256-1305\)/);
  assert.match(fact(brief, 'Medicare'), /\$526k paid, 1,307 claims, 194 patients/);
  assert.match(fact(brief, 'Business'), /a company \(NPI-2\).*registry updated 2 years ago/);
  assert.deepEqual(brief.script.map((s) => s.label), ['Opening line', 'If the front desk asks', 'Likely pain point', 'Talking point', 'Questions to ask', 'If they push back', 'Close', 'Voicemail']);
  assert.match(part(brief, 'Opening line'), /^Hi Trisha, this is \[your name\] with \[company name\]\./);
  assert.match(part(brief, 'Opening line'), /30 seconds.*prior authorizations/);
  assert.match(part(brief, 'Opening line'), /Saint Petersburg, FL/);
});

test('the same lead always gives the same brief, and it is plain text', () => {
  const a = buildCallBrief({ company: lead(), now: NOW });
  const b = buildCallBrief({ company: lead(), now: NOW });
  assert.deepEqual(a, b);
  const text = briefToText(a);
  assert.match(text, /What we know/);
  assert.match(text, /Call plan/);
  assert.match(text, /1\. Opening line:/);
});

test('a lead with nothing on file still gets a usable brief', () => {
  const brief = buildCallBrief({ company: { name: 'Bare Supply' }, now: NOW });
  assert.match(fact(brief, 'Ask for'), /No decision maker on file/);
  assert.match(fact(brief, 'Medicare'), /No Medicare billing found/);
  assert.equal(brief.script.length, 8);
  assert.match(part(brief, 'Opening line'), /^Hi, this is/);
  assert.equal(buildCallBrief({ now: NOW }).title, 'Lead');
});

test('the pain point follows the strongest signal, in a fixed order', () => {
  const growing = { direction: 'up', change: 0.5, points: [{ year: 2023, payment: 100000 }, { year: 2024, payment: 150000 }], latestYear: 2024 };
  assert.match(part(buildCallBrief({ company: lead(), trend: growing, now: NOW }), 'Likely pain point'), /climbing.*back-office/);
  assert.match(part(buildCallBrief({ company: lead(), now: NOW }), 'Likely pain point'), /about \$526k in Medicare payments.*unworked denials/);
  const small = { medicare: { totalClaims: 20, medicarePayment: 2000 } };
  assert.match(part(buildCallBrief({ company: lead(small), mix: { rentalShare: 0.7, total: 10, categories: [{ name: 'Other DME', share: 1 }], verticals: [] }, now: NOW }), 'Likely pain point'), /rental/);
  assert.match(part(buildCallBrief({ company: lead({ ...small, locations: [{}, {}] }), now: NOW }), 'Likely pain point'), /more than one office.*split/i);
  assert.match(part(buildCallBrief({ company: lead({ ...small, isOrganization: false }), now: NOW }), 'Likely pain point'), /owner-operator does billing/i);
  assert.match(part(buildCallBrief({ company: lead(small), now: NOW }), 'Likely pain point'), /small team covers intake/i);
  const shrinking = { direction: 'down', change: -0.4, points: [{ year: 2023, payment: 100000 }, { year: 2024, payment: 60000 }], latestYear: 2024 };
  assert.match(part(buildCallBrief({ company: lead(small), trend: shrinking, now: NOW }), 'Likely pain point'), /dropped/);
});

test('product fit, trend, same address, team notes and earlier calls all show up', () => {
  const mix = { total: 100, rentalShare: 0.34, area: { category: 'Urban' }, categories: [{ name: 'Orthotic Devices', share: 0.8 }, { name: 'Wheelchairs', share: 0.2 }], verticals: [{ key: 'ort', label: 'Orthotics & prosthetics' }] };
  const brief = buildCallBrief({
    company: lead({ pickup: { answered: 0, total: 3 }, priorContact: { status: 'voicemail', by: 'Ana', at: '2026-10-02', note: 'asked for a callback' } }),
    mix,
    trend: { direction: 'new', change: null, points: [{ year: 2023, payment: 1000 }, { year: 2024, payment: 526000 }], latestYear: 2024 },
    same: { total: 2, matches: [] },
    notes: { tags: [{ tag: 'good fit' }], comments: [{ text: 'Owner out until Monday', by: 'Ben' }] },
    now: NOW,
  });
  assert.match(fact(brief, 'Sells'), /In your verticals \(Orthotics & prosthetics\).*orthotic devices 80%/);
  assert.match(fact(brief, 'Billing'), /34% rentals, urban/);
  assert.match(fact(brief, 'Trend'), /Ramping up fast/);
  assert.match(fact(brief, 'Business'), /2 other providers at the same address/);
  assert.match(fact(brief, 'History'), /answered 0 of 3 logged calls; worked before by Ana on 2026-10-02 \(voicemail\): asked for a callback/);
  assert.equal(fact(brief, 'Team tags'), 'good fit');
  assert.match(fact(brief, 'Team notes'), /Owner out until Monday \(Ben\)/);
  assert.match(part(brief, 'Talking point'), /Orthotics & prosthetics paperwork/);
  assert.match(part(brief, 'Talking point'), /prior authorizations, billing and denials follow-up/);
  assert.match(part(brief, 'Talking point'), /Earlier calls here went unanswered/);
  assert.match(items(brief, 'If they push back').join(' '), /Not a good time\.[^]*confirm the best time of day/);
});

test('a claimed lead brings its status and call log', () => {
  const brief = buildCallBrief({ company: lead(), claimed: { status: 'Callback', notes: '2026-10-15 10:00 — Ana: Callback\n2026-10-14 09:00 — Ana: Voicemail\n2026-10-13 09:00 — Ana: No answer' }, now: NOW });
  assert.match(fact(brief, 'History'), /status: callback/);
  assert.match(fact(brief, 'Call log'), /Callback/);
  assert.equal(brief.facts.filter((f) => !f.label).length, 1); // only the second log line is unlabelled
});

test('trend wording', () => {
  assert.equal(trendText(null), '');
  assert.match(trendText({ direction: 'stopped', latestYear: 2023, points: [{ year: 2023, payment: 5000 }] }), /last seen 2023/);
});

test('the plan is a business-development pitch for the outsourcing company, not a product pitch', () => {
  const text = briefToText(buildCallBrief({ company: lead(), now: NOW }));
  assert.doesNotMatch(text, /DME Desk/);
  assert.doesNotMatch(text, /receptionist/i);
  assert.match(text, /\[company name\]/);
});

test('the opening says who, why and how long; the front desk is never pitched', () => {
  const named = buildCallBrief({ company: lead(), now: NOW });
  assert.match(part(named, 'If the front desk asks'), /business matter for Trisha about billing and back-office support/);
  assert.match(part(named, 'If the front desk asks'), /Do not pitch the front desk/);
  const unnamed = buildCallBrief({ company: lead({ decisionMakers: [] }), now: NOW });
  assert.match(part(unnamed, 'If the front desk asks'), /who looks after billing/);
});

test('questions: one chosen for the lead, then three that suit any supplier', () => {
  const q = items(buildCallBrief({ company: lead({ isOrganization: false }), now: NOW }), 'Questions to ask');
  assert.equal(q.length, 4);
  assert.match(q[0], /hours a week do you personally spend/);
  const plain = items(buildCallBrief({ company: lead(), now: NOW }), 'Questions to ask');
  assert.equal(plain.length, 3);
  assert.match(plain[0], /Who handles verifications/);
  const rental = items(buildCallBrief({ company: lead(), mix: { rentalShare: 0.8, total: 1, categories: [{ name: 'x', share: 1 }], verticals: [] }, now: NOW }), 'Questions to ask');
  assert.match(rental[0], /monthly rental billing/);
});

test('every pushback agrees, asks, and offers a small next step', () => {
  const list = items(buildCallBrief({ company: lead({ isOrganization: false }), now: NOW }), 'If they push back');
  assert.equal(list.length, 4); // the owner-operator one comes first
  assert.match(list[0], /do it all myself/);
  list.forEach((t) => { assert.match(t, /Agree:/); assert.match(t, /Ask:/); assert.match(t, /Next step:/); });
  assert.equal(items(buildCallBrief({ company: lead(), now: NOW }), 'If they push back').length, 3);
});

test('the close offers two times and the voicemail is short and carries the placeholders', () => {
  const brief = buildCallBrief({ company: lead(), now: NOW });
  assert.match(part(brief, 'Close'), /two specific times/);
  assert.match(part(brief, 'Close'), /\[day\] at \[time\] or \[day\] at \[time\]/);
  const vm = part(brief, 'Voicemail');
  assert.match(vm, /^“Hi Trisha, this is \[your name\] with \[company name\]/);
  assert.match(vm, /\[number\]/);
  assert.match(vm, /under 25 seconds/);
});

test('no free audit is offered anywhere in the plan', () => {
  const text = briefToText(buildCallBrief({ company: lead({ isOrganization: false }), now: NOW }));
  assert.doesNotMatch(text, /audit|free|no cost|no-cost/i);
});

test('the plain-text brief lists the items under their section', () => {
  const text = briefToText(buildCallBrief({ company: lead(), now: NOW }));
  assert.match(text, /5\. Questions to ask:\n {3}- Who handles verifications/);
  assert.match(text, /8\. Voicemail:/);
});
