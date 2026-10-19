import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildProductMix, buildTrend, verticalOf } from '../src/lib/productMix.js';
import { getProductMix } from '../src/services/productMix.js';

const require = createRequire(import.meta.url);
const { describeMix, describeTrend, describeTraits } = require('../../docs/whycall.js');

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
    // by-supplier year files answer with one payment row; the by-service file with the product rows
    if (/size=1$/.test(String(url))) return { status: 200, json: async () => [{ Suplr_Mdcr_Pymt_Amt: '1000', Tot_Suplr_Benes: '10' }] };
    return { status: 200, json: async () => [row('K0001', 'Standard wheelchair', 'DME-Wheelchairs', 10, 100)] };
  };
  try {
    const db = fakeSupabase();
    const first = await getProductMix(db, '1003386889');
    assert.equal(first.mix.total, 1000);
    const afterFirst = calls;
    const second = await getProductMix(db, '1003386889');
    assert.equal(second.mix.total, 1000);
    assert.equal(calls, afterFirst); // the second ask is served from the cache
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
    assert.equal((await getProductMix(db, '1003386889')).mix, null);
    assert.equal(db.store.size, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('rental share and urban/rural come from the same rows', () => {
  const mix = buildProductMix([
    { ...row('E0601', 'CPAP', 'DME-Other DME', 10, 100), Suplr_Rentl_Ind: 'Y', Suplr_Prvdr_RUCA_Cat: 'Urban', Suplr_Prvdr_RUCA_Desc: 'Metropolitan core' },
    { ...row('A7030', 'Mask', 'DME-Other DME', 10, 100), Suplr_Rentl_Ind: 'N', Suplr_Prvdr_RUCA_Cat: 'Urban' },
  ]);
  assert.equal(mix.rentalShare, 0.5);
  assert.deepEqual(mix.area, { category: 'Urban', detail: 'Metropolitan core' });
  assert.equal(buildProductMix([row('K0001', 'x', 'DME-Wheelchairs', 1, 1)]).area, null);
});

test('trend: new, growing, shrinking, steady, single, stopped and nothing', () => {
  const t = (...pairs) => buildTrend(pairs.map(([year, payment]) => ({ year, payment })));
  assert.equal(t([2023, 1420], [2024, 525505]).direction, 'new');
  assert.equal(t([2023, 100000], [2024, 150000]).direction, 'up');
  assert.equal(t([2023, 100000], [2024, 60000]).direction, 'down');
  assert.equal(t([2023, 100000], [2024, 105000]).direction, 'flat');
  assert.equal(t([2024, 80000]).direction, 'single');
  assert.equal(t([2022, 90000], [2023, 95000]).direction, 'stopped');
  assert.equal(t([2022, 50000], [2023, 60000], [2024, 90000]).previousYear, 2023);
  assert.equal(buildTrend([]), null);
  assert.equal(buildTrend([{ year: 2024, payment: 0 }]), null);
  assert.equal(Math.round(t([2023, 100000], [2024, 150000]).change * 100), 50);
});

test('the card words the trend, rental share and area', () => {
  const up = describeTrend(buildTrend([{ year: 2023, payment: 100000 }, { year: 2024, payment: 150000 }]));
  assert.equal(up.tone, 'high');
  assert.match(up.text, /Growing \+50%/);
  assert.equal(describeTrend(buildTrend([{ year: 2023, payment: 100000 }, { year: 2024, payment: 50000 }])).tone, 'low');
  assert.equal(describeTrend(null), null);
  const traits = describeTraits({ total: 100, rentalShare: 0.62, area: { category: 'Rural', detail: '' } });
  assert.deepEqual(traits.map((x) => x.label), ['Billing', 'Area']);
  assert.match(traits[0].text, /62% rentals/);
});
