import test from 'node:test';
import assert from 'node:assert/strict';
import { findTierTwoReviews, firstTenDigitPhone, identitySignals, normalizeNpi, preflightCandidates, strictIdentityKey, summarizePreflight, tokenSimilarity } from '../src/services/leadPreflight.js';

test('normalizes identity signals and phone values deterministically', () => {
  const candidate = { npi: '123-456-7890', name: 'Acme, Medical  Group', address_state: 'ny', authorizedofficial_firstname: 'José', authorizedofficial_lastname: 'Smith', phone: '(212) 555-0199 ext 4' };
  assert.equal(normalizeNpi(candidate.npi), '1234567890');
  assert.equal(firstTenDigitPhone(candidate.phone), '2125550199');
  assert.deepEqual(identitySignals(candidate), { name: 'acme medical group', state: 'NY', official: 'jose smith', phone: '2125550199' });
  assert.equal(strictIdentityKey(candidate), 'acme medical group|NY|jose smith|2125550199');
});

test('requires corroborating evidence for fuzzy review', () => {
  const candidate = { npi: '1234567890', name: 'Genome Insight Inc', state: 'CA', phone: '4155550100' };
  const possibleSuccessor = { npi: '9876543210', name: 'Genome Insight Inc', state: 'CA', phone: '4155550100' };
  assert.ok(tokenSimilarity(candidate.name, possibleSuccessor.name) >= 88);
  const reviews = findTierTwoReviews([candidate], [possibleSuccessor]);
  assert.equal(reviews[0].decision, 'needs_review');
  assert.deepEqual(reviews[0].evidence, ['phone']);
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