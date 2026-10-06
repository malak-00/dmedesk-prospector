import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { localInfo, openStates, STATE_TO_TZ } = require('../../docs/localtime.js');

// Wednesday 2026-10-07 16:00 UTC = 12:00 in New York (EDT), 11:00 Chicago, 10:00 Denver/Phoenix, 09:00 Los Angeles.
const NOON_ET = Date.parse('2026-10-07T16:00:00Z');

test('each state reads its own local time', () => {
  assert.equal(localInfo('FL', NOON_ET).time, '12:00 PM');
  assert.equal(localInfo('TX', NOON_ET).time, '11:00 AM');
  assert.equal(localInfo('CO', NOON_ET).time, '10:00 AM');
  assert.equal(localInfo('CA', NOON_ET).time, '9:00 AM');
  assert.equal(localInfo('AZ', NOON_ET).time, '9:00 AM', 'Arizona does not change its clocks: Mountain time minus daylight saving is Pacific time in October');
  assert.equal(localInfo('HI', NOON_ET).time, '6:00 AM');
  assert.equal(localInfo('fl', NOON_ET).time, '12:00 PM', 'lower case is fine');
  assert.equal(localInfo('ZZ', NOON_ET), null);
  assert.equal(localInfo('', NOON_ET), null);
});

test('good time, lunch hour, early, late and weekend', () => {
  assert.equal(localInfo('FL', NOON_ET).status, 'lunch');
  assert.match(localInfo('FL', NOON_ET).label, /lunch hour/);
  assert.equal(localInfo('TX', NOON_ET).status, 'good');
  assert.equal(localInfo('TX', NOON_ET).good, true);
  assert.equal(localInfo('CA', NOON_ET).status, 'good', '9:00 AM');
  assert.equal(localInfo('HI', NOON_ET).status, 'early', '6:00 AM');
  assert.match(localInfo('HI', NOON_ET).label, /opens at 8:00 AM/);

  const evening = Date.parse('2026-10-07T22:00:00Z'); // 6 PM in New York
  assert.equal(localInfo('NY', evening).status, 'late');
  assert.match(localInfo('NY', evening).label, /tomorrow/);
  const fridayEvening = Date.parse('2026-10-09T22:00:00Z');
  assert.match(localInfo('NY', fridayEvening).label, /Mon 8:00 AM/, 'Friday evening opens on Monday');
  const saturday = Date.parse('2026-10-10T16:00:00Z');
  assert.equal(localInfo('NY', saturday).status, 'weekend');
});

test('the edges of the day follow the lead\'s clock, not the viewer\'s', () => {
  const justBefore = Date.parse('2026-10-07T11:59:00Z'); // 7:59 AM in New York
  const justAfter = Date.parse('2026-10-07T12:00:00Z');  // 8:00 AM
  assert.equal(localInfo('NY', justBefore).status, 'early');
  assert.equal(localInfo('NY', justAfter).status, 'good');
  const winter = Date.parse('2026-01-14T17:00:00Z'); // EST: noon again, so the offset changed with daylight saving
  assert.equal(localInfo('NY', winter).time, '12:00 PM');
});

test('"open now" lists only the states where it is a good time to call', () => {
  const states = openStates(NOON_ET);
  assert.ok(states.includes('TX') && states.includes('CA') && states.includes('CO'));
  assert.ok(!states.includes('FL'), 'lunch hour');
  assert.ok(!states.includes('HI'), 'too early');
  assert.ok(Object.keys(STATE_TO_TZ).length >= 51);
});
