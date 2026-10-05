import test from 'node:test';
import assert from 'node:assert/strict';
import { applySourceTrial } from '../src/lib/sourceTrial.js';
import { resolveSource } from '../src/services/providerSource.js';
import { fingerprint } from '../src/repos/searchProgressRepo.js';

const mirrorConfig = () => ({ npiSource: () => 'mirror', other: () => 'kept' });
const admin = { id: 'a', isAdmin: true };
const rep = { id: 'r', isAdmin: false };

test('an admin who asks for DME Desk gets it for that request only', () => {
  const base = mirrorConfig();
  const result = applySourceTrial(base, admin, 'dmedesk');
  assert.equal(result.trial, true);
  assert.equal(resolveSource(result.config), 'dmedesk');
  assert.equal(result.config.other(), 'kept'); // the rest of the config is untouched
  assert.equal(resolveSource(base), 'mirror'); // and the shared config was not changed
});

test('the header is ignored for anyone who is not an admin', () => {
  for (const session of [rep, { id: 'x' }, { id: 'y', isAdmin: 'true' }, null, undefined]) {
    const base = mirrorConfig();
    const result = applySourceTrial(base, session, 'dmedesk');
    assert.equal(result.trial, false);
    assert.equal(resolveSource(result.config), 'mirror');
  }
});

test('an admin who does not ask, or asks for something else, stays on the configured source', () => {
  for (const requested of [undefined, '', 'mirror', 'DROP TABLE', 'dmedesk2']) {
    const result = applySourceTrial(mirrorConfig(), admin, requested);
    assert.equal(result.trial, false);
    assert.equal(resolveSource(result.config), 'mirror');
  }
  assert.equal(applySourceTrial(mirrorConfig(), admin, ' DMEDESK ').trial, true); // case and spacing don't matter
});

test('when everyone is already on DME Desk there is no trial to run', () => {
  const result = applySourceTrial({ npiSource: () => 'dmedesk' }, admin, 'dmedesk');
  assert.equal(result.trial, false);
  assert.equal(resolveSource(result.config), 'dmedesk');
});

test('a search on DME Desk keeps its own paging bookmark (trial or not); every other search is unchanged', () => {
  const plain = fingerprint({ states: ['FL'] });
  const onDmedesk = fingerprint({ states: ['FL'], source: 'dmedesk' });
  assert.notEqual(plain, onDmedesk);
  assert.equal(onDmedesk.includes('"src":"dmedesk"'), true);
  assert.equal(fingerprint({ states: ['FL'], source: undefined }), plain);
});
