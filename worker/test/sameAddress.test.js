import test from 'node:test';
import assert from 'node:assert/strict';
import { streetKey, usableStreetKey, sameBuilding, suiteOf, escapeLike, buildSameAddress } from '../src/lib/sameAddress.js';
import { pickupCounts } from '../src/repos/leadsRepo.js';

test('street key drops the suite so offices in one building match', () => {
  assert.equal(streetKey('3065 34TH ST N STE A'), '3065 34TH ST N');
  assert.equal(streetKey('3065 34th St N, Suite 200'), '3065 34TH ST N');
  assert.equal(streetKey('12 MAIN ST #4'), '12 MAIN ST');
  assert.equal(streetKey('12 MAIN ST UNIT 5B'), '12 MAIN ST');
  assert.equal(streetKey('500 OAK AVE'), '500 OAK AVE');
  assert.equal(streetKey(null), '');
});

test('suiteOf returns the part the key drops', () => {
  assert.equal(suiteOf('3065 34TH ST N STE A'), 'STE A');
  assert.equal(suiteOf('12 MAIN ST #4'), '#4');
  assert.equal(suiteOf('500 OAK AVE'), '');
});

test('a key needs a house number and some length to be worth searching', () => {
  assert.equal(usableStreetKey(''), false);
  assert.equal(usableStreetKey('MAIN'), false);
  assert.equal(usableStreetKey('1 A ST'), true);
  assert.equal(usableStreetKey('BROADWAY AVE'), false);
});

test('same building needs the same street key and agreeing ZIP5', () => {
  const me = { address_line1: '3065 34TH ST N STE A', address_postalcode: '337132401' };
  assert.equal(sameBuilding(me, { address_line1: '3065 34TH ST N STE B', address_postalcode: '33713' }), true);
  assert.equal(sameBuilding(me, { address_line1: '3065 34TH ST N', address_postalcode: '33714' }), false);
  assert.equal(sameBuilding(me, { address_line1: '3067 34TH ST N', address_postalcode: '33713' }), false);
  assert.equal(sameBuilding({ address_line1: 'PO', address_postalcode: '1' }, { address_line1: 'PO', address_postalcode: '1' }), false);
});

test('escapeLike makes % and _ literal', () => {
  assert.equal(escapeLike('A_B%C'), 'A\\_B\\%C');
});

test('buildSameAddress leaves out the lead itself, excluded branches and inactive providers, and marks claimed ones', () => {
  const me = { npi: '1', address_line1: '10 ELM ST STE 1', address_postalcode: '33701' };
  const rows = [
    { npi: '1', name: 'Me', address_line1: '10 ELM ST STE 1', address_postalcode: '33701', status: 'A' },
    { npi: '2', name: 'Branch', address_line1: '10 ELM ST STE 2', address_postalcode: '33701', status: 'A' },
    { npi: '3', name: 'Sibling Ortho', address_line1: '10 ELM ST STE 3', address_postalcode: '33701', status: 'A', taxonomy_description: 'Orthotic', phone: '727-555-0101' },
    { npi: '4', name: 'Closed Co', address_line1: '10 ELM ST', address_postalcode: '33701', status: 'D' },
    { npi: '5', name: 'Next Door', address_line1: '12 ELM ST', address_postalcode: '33701', status: 'A' },
    { npi: '6', name: 'Claimed Co', address_line1: '10 ELM ST #9', address_postalcode: '33701' },
  ];
  const claims = new Map([['6', { by: 'Dana', status: 'Called' }]]);
  const out = buildSameAddress(me, rows, claims, ['2']);
  assert.deepEqual(out.matches.map((m) => m.npi), ['3', '6']);
  assert.equal(out.total, 2);
  assert.equal(out.matches[0].suite, 'STE 3');
  assert.equal(out.matches[0].claimedBy, null);
  assert.equal(out.matches[1].claimedBy, 'Dana');
});

test('pickup counts only logged results that say whether a person answered', () => {
  const lines = [
    { text: 'Voicemail — left a message' },
    { text: 'Interested — wants pricing' },
    { text: 'No answer' },
    { text: 'Called' },
    { text: 'Dialed' },
    { text: 'Meeting booked' },
    { text: 'Spoke to the owner, send info' },
  ];
  assert.deepEqual(pickupCounts(lines), { answered: 1, total: 3 });
  assert.deepEqual(pickupCounts([]), { answered: 0, total: 0 });
});
