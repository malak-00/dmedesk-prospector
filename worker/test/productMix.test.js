import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildProductMix, verticalOf } from '../src/lib/productMix.js';
import { getProductMix } from '../src/services/productMix.js';

const require = createRequire(import.meta.url);
const { describeMix } = require('../../docs/whycall.js');

const row = (code, desc, cat, srvcs, pay) => ({ HCPCS_Cd: code, HCPCS_Desc: desc, RBCS_Desc: cat, Tot_Suplr_Srvcs: String(srvcs), Avg_Suplr_Mdcr_Pymt_Amt: String(pay) });

test('HCPCS codes map to the team verticals', () => {
  assert.equal(verticalOf('L1832'), 'ort');
  assert.equal(verticalOf('L5301'), 'ort');
  assert.equal(verticalOf('A4239'), 'cgm');
  assert.equal(verticalOf('e2103'), 'cgm');
  assert.equal(verticalOf('E0651'), 'lymph');
  assert.equal(verticalOf('E0670'), 'lymph');
  assert.equal(verticalOf('A6545'), 'lymph');
  assert.equal(verticalOf('K0001'), null);
  assert.equal(verticalOf('E0653'), null);
  assert.equal(verticalOf(''), null);
});

test('no rows means no mix', () => {
  assert.equal(buildProductMix([]), null);
  assert.equal(buildProductMix(null), null);
});

test('mix groups by category, estimates payment, and finds verticals', () => {
  const mix = buildProductMix([
    row('K0001', 'Standard wheelchair', 'DME-Wheelchairs', 10, 100),       // 1000
    row('L1832', 'Knee orthosis', 'DME-Orthotic Devices', 5, 200),          // 1000
    row('L1833', 'Knee orthosis 2', 'DME-Orthotic Devices', 5, 100),        // 500
    row('A4239', 'CGM supply allowance', 'DME-Other DME', 2, 250),          // 500
  ]);
  assert.equal(mix.total, 3000);
  assert.equal(mix.codes, 4);
  assert.deepEqual(mix.categories.map((c) => [c.name, c.payment]), [['Orthotic Devices', 1500], ['Wheelchairs', 1000], ['Other DME', 500]]);
  assert.equal(Math.round(mix.categories[0].share * 100), 50);
  assert.deepEqual(mix.verticals.map((v) => [v.key, v.payment]), [['ort', 1500], ['cgm', 500]]);
  assert.equal(mix.products[0].payment, 1000);
  assert.equal(mix.products.length, 3);
});

test('small categories beyond the top five are folded into Other', () => {
  const rows = Array.from({ length: 8 }, (_, i) => row('X' + i, 'item', 'DME-Cat' + i, 1, 100 - i));
  const mix = buildProductMix(rows);
  assert.equal(mix.categories.length, 6);
  assert.equal(mix.categories[5].name, 'Other');
  assert.equal(mix.categories[5].payment, 95 + 94 + 93);
});

test('describeMix says whether the lead is in the verticals', () => {
  assert.equal(describeMix(null), null);
  const out = describeMix(buildProductMix([row('K0001', 'Standard wheelchair', 'DME-Wheelchairs', 10, 100)]));
  assert.equal(out.fit, false);
  assert.equal(out.lead, 'Outside your verticals: mostly wheelchairs');
  const inn = describeMix(buildProductMix([row('A4239', 'CGM', 'DME-Other DME', 10, 100)]));
  assert.equal(inn.fit, true);
  assert.match(inn.lead, /CGM \(\$1k\)/);
});

// ---- the service: validation, CMS call, cache ----

function fakeSupabase(store = new Map()) {
  return {
    store,
    from() {
      return {
        select() { return { in: async (_c, keys) => ({ data: keys.filter((k) => store.has(k)).map((k) => ({ cache_key: k, payload: store.get(k), created_at: new Date().toISOString() })) }) }; },
        upsert: async (rows) => { rows.forEach((r) => store.set(r.cache_key, r.payload)); return {}; },
      };
    },
  };
}

test('product mix rejects a bad NPI', async () => {
  await assert.rejects(() => getProductMix(fakeSupabase(), 'abc'), (e) => e.status === 400);
});

test('product mix fetches from CMS once, then serves the cache', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls += 1;
    assert.match(String(url), /filter\[Suplr_NPI\]=1003386889/);
    return { status: 200, json: async () => [row('K0001', 'Standard wheelchair', 'DME-Wheelchairs', 10, 100)] };
  };
  try {
    const db = fakeSupabase();
    const first = await getProductMix(db, '1003386889');
    assert.equal(first.mix.total, 1000);
    const second = await getProductMix(db, '1003386889');
    assert.equal(second.mix.total, 1000);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('product mix reports a CMS failure instead of caching it', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ status: 503, json: async () => ({}) });
  try {
    const db = fakeSupabase();
    await assert.rejects(() => getProductMix(db, '1003386889'), (e) => e.status === 502);
    assert.equal(db.store.size, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a supplier with no billing rows is cached as "nothing found"', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ status: 200, json: async () => [] });
  try {
    const db = fakeSupabase();
    assert.deepEqual(await getProductMix(db, '1003386889'), { mix: null });
    assert.equal(db.store.size, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});
