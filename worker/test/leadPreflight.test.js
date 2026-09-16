import test from 'node:test';
import assert from 'node:assert/strict';
import { findMatches, firstTenDigitPhone, identityKey, identitySignals, matchRecords, nameSimilarity, normalizeNpi, preflightCandidates, summarizePreflight } from '../src/services/leadPreflight.js';

const base = {
  npi: '1111111111',
  name: 'ABC Medical Supply LLC',
  address_state: 'VA',
  authorizedofficial_firstname: 'Jane',
  authorizedofficial_lastname: 'Smith',
  phone: '5551234567',
};
const other = (overrides) => ({ ...base, npi: '2222222222', ...overrides });

test('normalizes identity signals and phone values deterministically', () => {
  const candidate = { npi: '123-456-7890', name: 'Acme, Medical  Group', address_state: 'ny', authorizedofficial_firstname: 'José', authorizedofficial_lastname: 'Smith', phone: '(212) 555-0199 ext 4' };
  assert.equal(normalizeNpi(candidate.npi), '1234567890');
  assert.equal(firstTenDigitPhone(candidate.phone), '2125550199');
  assert.equal(firstTenDigitPhone('+1 (212) 555-0199'), '2125550199');
  assert.equal(firstTenDigitPhone('555-0199'), '');
  assert.deepEqual(identitySignals(candidate), { name: 'acme medical group', state: 'NY', official: 'jose smith', phone: '2125550199' });
  assert.equal(identityKey(candidate), 'group:acme medical group|jose smith|2125550199');
});

test('strips legal suffixes from names in every tier', () => {
  assert.equal(identitySignals({ name: 'ABC Medical Supply, L.L.C.' }).name, 'abc medical supply');
  assert.equal(identitySignals({ name: 'ABC Medical Supply Inc' }).name, 'abc medical supply');
  assert.equal(identityKey(base), identityKey(other({ name: 'ABC Medical Supply, Inc.' })));
});

test('ignores middle names and initials on the authorized official', () => {
  assert.equal(identitySignals({ authorizedofficial_firstname: 'Jane M.', authorizedofficial_lastname: 'Smith' }).official, 'jane smith');
  assert.equal(identitySignals({ authorizedofficial_firstname: 'Jane', authorizedofficial_middlename: 'Marie', authorizedofficial_lastname: 'Smith' }).official, 'jane smith');
  assert.equal(matchRecords(base, other({ authorizedofficial_firstname: 'JANE M' })).tier, 1);
});

test('uses the location phone first and the authorized official phone as fallback', () => {
  assert.equal(identitySignals({ phone: '5551234567', authorizedofficial_phone: '5559999999' }).phone, '5551234567');
  assert.equal(identitySignals({ phone: '', authorizedofficial_phone: '5559999999' }).phone, '5559999999');
  assert.equal(identitySignals({ phone: '555-12', authorizedofficial_phone: '5559999999' }).phone, '5559999999');
});

test('applies each tier rule in order', () => {
  const cases = [
    ['all four keys', other({}), 1, 'auto_group'],
    ['name + official + phone, different state', other({ address_state: 'TX' }), 2, 'auto_group'],
    ['name + state + phone', other({ authorizedofficial_firstname: 'Bob', authorizedofficial_lastname: 'Jones' }), 2, 'review'],
    ['name + state + official', other({ phone: '5550000000' }), 2, 'review'],
    ['state + official + phone (renamed)', other({ name: 'Blue Ridge Mobility' }), 2, 'review'],
    ['official + phone', other({ name: 'Blue Ridge Mobility', address_state: 'TX' }), 3, 'review'],
    ['name + phone', other({ address_state: 'TX', authorizedofficial_firstname: 'Bob', authorizedofficial_lastname: 'Jones' }), 3, 'review'],
    ['name + official', other({ address_state: 'TX', phone: '5550000000' }), 3, 'review'],
  ];
  for (const [label, record, tier, action] of cases) {
    const match = matchRecords(base, record);
    assert.ok(match, `${label}: expected a match`);
    assert.equal(match.tier, tier, `${label}: tier`);
    assert.equal(match.action, action, `${label}: action`);
  }
});

test('does not match on weak combinations', () => {
  const none = [
    ['name + state only', other({ authorizedofficial_firstname: 'Bob', authorizedofficial_lastname: 'Jones', phone: '5550000000' })],
    ['state + official only', other({ name: 'Blue Ridge Mobility', phone: '5550000000' })],
    ['state + phone only', other({ name: 'Blue Ridge Mobility', authorizedofficial_firstname: 'Bob', authorizedofficial_lastname: 'Jones' })],
    ['phone only', other({ name: 'Blue Ridge Mobility', address_state: 'TX', authorizedofficial_firstname: 'Bob', authorizedofficial_lastname: 'Jones' })],
  ];
  for (const [label, record] of none) assert.equal(matchRecords(base, record), null, label);
});

test('a fuzzy name only ever flags for review', () => {
  assert.ok(nameSimilarity('Genome Insight Inc', 'Genome Insights Incorporated') >= 88);
  assert.ok(nameSimilarity('Smith Medical Supply', 'Jones Medical Supply') < 88);
  const fuzzy = matchRecords(base, other({ name: 'ABC Medical Supplies, Inc.' }));
  assert.equal(fuzzy.tier, 1);
  assert.equal(fuzzy.action, 'review');
  assert.equal(fuzzy.nameMatch, 'fuzzy');
  assert.equal(matchRecords(base, other({ name: 'XYZ Medical Supply', address_state: 'TX', phone: '5550000000' })), null);
});

test('findMatches skips the same NPI and sorts by tier', () => {
  const records = [
    other({ npi: '3333333333', name: 'Blue Ridge Mobility', address_state: 'TX' }),
    other({ npi: '2222222222' }),
    { ...base },
  ];
  const matches = findMatches(base, records);
  assert.deepEqual(matches.map((m) => [m.existingNpi, m.tier]), [['2222222222', 1], ['3333333333', 3]]);
});

test('returns deterministic batch and ownership decisions without writes', () => {
  const results = preflightCandidates([
    { npi: '1111111111', name: 'One' },
    { npi: '1111111111', name: 'One duplicate' },
    { npi: 'bad', name: 'Invalid' },
    { npi: '2222222222', name: 'Owned' },
  ], { groups: [{ id: 'g1', active_owners: ['user-1'] }], memberships: [{ npi: '2222222222', group_id: 'g1' }] });
  assert.deepEqual(summarizePreflight(results), { total: 4, accept: 1, duplicate: 1, invalid: 1, owned_conflict: 1 });
});

test('preflight joins an owned group through an auto-group match and flags review matches', () => {
  const context = {
    existingRecords: [other({ npi: '2222222222', address_state: 'TX' }), other({ npi: '3333333333', name: 'Blue Ridge Mobility', address_state: 'TX', phone: '5550000000', authorizedofficial_phone: '' })],
    groups: [{ id: 'g-owned', active_owners: ['user-1'] }, { id: 'g-free', active_owners: [] }],
    memberships: [{ npi: '2222222222', group_id: 'g-owned' }, { npi: '3333333333', group_id: 'g-free' }],
  };
  const [owned] = preflightCandidates([base], context);
  assert.equal(owned.decision, 'owned_conflict');
  assert.equal(owned.groupId, 'g-owned');
  assert.equal(owned.match.tier, 2);

  const [flagged] = preflightCandidates([{ ...base, phone: '5550000000' }], { ...context, existingRecords: [context.existingRecords[1]] });
  assert.equal(flagged.decision, 'needs_review');
  assert.equal(flagged.groupId, null);
  assert.deepEqual(flagged.reviews.map((r) => [r.existingNpi, r.tier, r.matchedKeys.join('+'), r.groupId]), [['3333333333', 3, 'official+phone', 'g-free']]);
});
