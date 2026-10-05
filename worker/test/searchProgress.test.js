import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint, saveProgress, getProgress } from '../src/repos/searchProgressRepo.js';

test('fingerprint generates deterministic output regardless of list order', () => {
  const criteriaA = {
    states: ['VA', 'MD', 'DC'],
    taxonomyDescriptions: ['Medical Equipment', 'Pharmacy'],
    taxonomyCodes: ['332B00000X', '183500000X'],
    requireCmsClaims: true,
    minMedicareClaims: 50,
  };
  const criteriaB = {
    states: ['dc', 'md', 'va'],
    taxonomyDescriptions: ['Pharmacy', 'Medical Equipment'],
    taxonomyCodes: ['183500000X', '332B00000X'],
    requireCmsClaims: true,
    minMedicareClaims: '50',
  };
  assert.equal(fingerprint(criteriaA), fingerprint(criteriaB));
});

test('fingerprint differentiates on requireCmsClaims and minMedicareClaims', () => {
  const base = { states: ['VA'], taxonomyDescription: 'DME' };
  const fp1 = fingerprint({ ...base, requireCmsClaims: false });
  const fp2 = fingerprint({ ...base, requireCmsClaims: true });
  const fp3 = fingerprint({ ...base, requireCmsClaims: true, minMedicareClaims: 100 });

  assert.notEqual(fp1, fp2);
  assert.notEqual(fp2, fp3);
});

test('fingerprint supports single string vs array forms of taxonomy and state', () => {
  const single = { state: 'VA', taxonomyDescription: 'DME', taxonomyCode: '332B00000X' };
  const plural = { states: ['VA'], taxonomyDescriptions: ['DME'], taxonomyCodes: ['332B00000X'] };
  assert.equal(fingerprint(single), fingerprint(plural));
});

test('saveProgress deduplicates seen_npis and caps at MAX_SEEN_NPIS', async () => {
  let savedRecord = null;
  const mockSupabase = {
    from(table) {
      assert.equal(table, 'search_progress');
      return {
        upsert(payload) {
          savedRecord = payload;
          return Promise.resolve({ data: payload, error: null });
        },
      };
    },
  };

  const testNpis = ['1000000001', '1000000002', '1000000001', '1000000003', ''];
  await saveProgress(mockSupabase, 'user_123', { state: 'VA' }, { 'VA|DME': 200 }, testNpis);

  assert.ok(savedRecord);
  assert.deepEqual(savedRecord.seen_npis, ['1000000001', '1000000002', '1000000003']);
});

test('accumulating seen_npis preserves historical NPIs across searches', () => {
  const initialSeen = ['1111111111', '2222222222'];
  const newBatch = ['2222222222', '3333333333', '4444444444'];
  const merged = [...new Set(initialSeen.concat(newBatch))];

  assert.deepEqual(merged, ['1111111111', '2222222222', '3333333333', '4444444444']);
  assert.equal(merged.includes('1111111111'), true);
});
