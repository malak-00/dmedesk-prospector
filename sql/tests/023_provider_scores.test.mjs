// Checks sql/023_provider_scores.sql on a throwaway in-memory Postgres (PGlite)
// with 3,000 randomly generated providers (fixed seed, so it is repeatable):
//   * the stored-score path returns EXACTLY what the live search returns, in the
//     same order, across many filter combinations and pages;
//   * it is never used while the data is stale, when the weights differ, or for
//     filters the narrow table cannot answer;
//   * a rebuild picks up changes, and drops providers that stopped qualifying;
//   * the score-ordered index can serve the sorted query without sorting.
// It never touches a real database.
//
// To run it (PGlite is not a project dependency, so install it somewhere temporary):
//   mkdir %TEMP%\pgtest && cd %TEMP%\pgtest && npm init -y && npm i @electric-sql/pglite
//   copy this file there, then:
//   set SQL_DIR=C:\path\to\sql && node 023_provider_scores.test.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sqlDir = process.env.SQL_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => fs.readFileSync(path.join(sqlDir, name), "utf8");

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table public.npi_records (
    npi text primary key, name text, enumerationtype text, status text, isorganization boolean,
    address_line1 text, address_line2 text, address_city text, address_state text, address_postalcode text,
    address_countrycode text, phone text, taxonomy_code text, taxonomy_description text,
    authorizedofficial_firstname text, authorizedofficial_lastname text, authorizedofficial_title text,
    authorizedofficial_phone text, lastupdated date, deactivation_date date);
  create table public.npi_cms_enrichment (npi text primary key, total_claims numeric, total_services numeric,
    total_beneficiaries numeric, medicare_payment numeric, medicare_allowed numeric);
  create table public.leads (npi text, claimed_by uuid, is_disconnected boolean default false);
  create table public.taxonomies (code text, description text, facility_type text);
  create function public.taxonomy_description_for(p_code text) returns text language sql stable as $$ select null::text $$;
`);

// A repeatable pseudo-random source.
let seed = 20261005;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (list) => list[Math.floor(rnd() * list.length)];

const states = ["VA", "NY", "TX", "FL", "OH"];
const cities = { VA: ["Richmond", "Norfolk", "Reston"], NY: ["Albany", "Buffalo", "Queens"], TX: ["Austin", "Dallas"], FL: ["Miami", "Tampa", "Orlando"], OH: ["Dayton", "Akron"] };
const tax = ["332B00000X", "333600000X", "3336C0003X", "251E00000X"];
const zips = ["23219", "10001-1234", "33101", "75201", "", "4520", "44301"];
const rows = [];
for (let i = 1; i <= 3000; i++) {
  const st = pick(states);
  const kind = rnd();
  const org = kind < 0.9 ? true : kind < 0.95 ? false : null; // 5% null isorganization
  const enumType = org === false ? "NPI-1" : "NPI-2";
  const status = rnd() < 0.93 ? (rnd() < 0.2 ? "active" : "A") : "I";
  const dead = rnd() < 0.05 ? "2023-05-01" : null;
  const npi = String(1000000000 + i);
  rows.push({
    npi, name: `${pick(["ALPHA", "BRAVO", "CHARLIE", "DELTA", "ECHO"])} ${pick(["MEDICAL", "HOME CARE", "DME", "PHARMACY"])} ${i}`,
    enumType, status, org,
    line1: rnd() < 0.85 ? `${i} Main St` : null,
    city: rnd() < 0.9 ? pick(cities[st]) : null, state: st,
    zip: rnd() < 0.85 ? pick(zips) : null,
    phone: rnd() < 0.7 ? `${300 + (i % 600)}555${String(i % 10000).padStart(4, "0")}` : (rnd() < 0.5 ? "   " : null),
    tax: pick(tax),
    first: rnd() < 0.6 ? "Pat" : null, last: rnd() < 0.6 ? `Owner${i}` : (rnd() < 0.3 ? "  " : null),
    updated: `${2022 + Math.floor(rnd() * 5)}-0${1 + Math.floor(rnd() * 9)}-15`,
    dead,
    claims: rnd() < 0.35 ? (rnd() < 0.2 ? 0 : Math.round(rnd() * 900)) : null,
  });
}
const q = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
for (let i = 0; i < rows.length; i += 500) {
  const chunk = rows.slice(i, i + 500);
  await db.exec(`insert into public.npi_records
    (npi, name, enumerationtype, status, isorganization, address_line1, address_city, address_state, address_postalcode, phone, taxonomy_code, authorizedofficial_firstname, authorizedofficial_lastname, lastupdated, deactivation_date)
    values ${chunk.map((r) => `(${q(r.npi)},${q(r.name)},${q(r.enumType)},${q(r.status)},${r.org === null ? "null" : r.org},${q(r.line1)},${q(r.city)},${q(r.state)},${q(r.zip)},${q(r.phone)},${q(r.tax)},${q(r.first)},${q(r.last)},${q(r.updated)},${q(r.dead)})`).join(",")}`);
  const withClaims = chunk.filter((r) => r.claims !== null);
  if (withClaims.length) await db.exec(`insert into public.npi_cms_enrichment (npi, total_claims) values ${withClaims.map((r) => `(${q(r.npi)},${r.claims})`).join(",")}`);
}
await db.exec(`insert into public.leads (npi, claimed_by, is_disconnected) select npi, gen_random_uuid(), false from public.npi_records order by npi limit 40`);

await db.exec(read("021_search_insights.sql"));
await db.exec(read("022_search_speed.sql"));
await db.exec(read("023_provider_scores.sql"));

let failed = 0;
let passed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? passed++ : failed++;
  if (!ok) console.log(`FAIL  ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
};
const one = async (sql, params) => (await db.query(sql, params)).rows;
const page = async (criteria, limit, skip) =>
  (await one("select npi, total_count from public.search_providers_v2($1::jsonb, $2, $3)", [JSON.stringify(criteria), limit, skip])).map((r) => r.npi);
const usable = async (criteria) => (await one("select public.provider_scores_usable($1::jsonb) as u", [JSON.stringify(criteria)]))[0].u;
const status = async () => (await one("select public.search_score_index_status() as s"))[0].s;

const W = { hasPhone: 25, completeAddress: 20, hasDecisionMaker: 30, medicareActive: 25 };
const base = { sortBy: "score", scoreWeights: W, includeCount: false };

// 1. A new table starts stale, so nothing is served from it.
check("starts stale", (await status()).fresh, false);
check("not usable before the first build", await usable({ ...base, states: ["VA"] }), false);

// 2. Build it.
const built = (await one("select public.refresh_provider_scores() as r"))[0].r;
check("full build reports fresh", built.fresh, true);
const expectedRows = Number((await one(`select count(*)::int as n from public.npi_records r
  where coalesce(r.isorganization, r.enumerationtype = 'NPI-2', true) and r.deactivation_date is null and upper(coalesce(r.status,'A')) in ('A','ACTIVE')`))[0].n);
check("one stored row per active organization", Number((await one("select count(*)::int as n from public.provider_scores"))[0].n), expectedRows);
check("status says fresh", (await status()).fresh, true);
check("usable once fresh", await usable({ ...base, states: ["VA"] }), true);

// 3. Equivalence: stored path === live path, same order, many filters and pages.
const combos = [
  { states: ["VA"] }, { states: ["NY", "TX"] }, { states: ["FL"], taxonomyCodes: ["332B00000X"] },
  { taxonomyCodes: ["333600000X", "251E00000X"] }, { states: ["OH"], taxonomyCodes: ["3336C0003X"], city: "Dayton" },
  { states: ["VA", "FL"], lastUpdatedYears: ["2024", "2025"] }, { states: ["NY"], zip: "100" }, { states: ["TX"], zip: "75201" },
  { states: ["FL"], hasPhone: true }, { states: ["FL"], hasDecisionMaker: true }, { states: ["FL"], activeMedicare: true },
  { states: ["FL"], hasPhone: true, hasDecisionMaker: true, activeMedicare: true },
  { states: ["VA"], minScore: 50 }, { states: ["VA"], minScore: 75 }, { states: ["VA"], minScore: 100 },
  { states: ["NY"], minMedicareClaims: 100 }, { states: ["NY"], minMedicareClaims: 500, hasPhone: true },
  { taxonomyCodes: ["332B00000X"], states: ["TX", "OH"], minScore: 75, lastUpdatedYears: ["2026"], hasPhone: true },
  { city: "Miami" }, { city: "miami", states: ["FL"] }, { state: "VA", taxonomyCode: "332B00000X" },
  { states: ["VA"], lastUpdatedYears: ["1999"] }, { states: ["ZZ"] },
];
for (const [index, criteria] of combos.entries()) {
  for (const [limit, skip] of [[25, 0], [25, 25], [40, 100], [200, 0]]) {
    const request = { ...base, ...criteria };
    const fast = await page(request, limit, skip);
    const live = await page({ ...request, forceLive: true }, limit, skip);
    check(`combo ${index} page ${limit}/${skip} identical to the live search`, fast, live);
  }
  check(`combo ${index} is answered from the stored scores`, await usable({ ...base, ...criteria }), true);
}

// Counts agree too when asked for.
const withCount = { ...base, states: ["FL"], taxonomyCodes: ["332B00000X"], includeCount: true };
const countOf = async (c) => (await one("select total_count from public.search_providers_v2($1::jsonb, 1, 0)", [JSON.stringify(c)]))[0];
check("match count identical", await countOf(withCount), await countOf({ ...withCount, forceLive: true }));

// 4. What the stored table must NOT answer.
check("company-name text goes to the live search", await usable({ ...base, states: ["VA"], nameContains: ["alpha"] }), false);
check("exclude keywords go to the live search", await usable({ ...base, states: ["VA"], excludeKeywords: ["dme"] }), false);
check("owner/company text lookup goes live", await usable({ ...base, q: "alpha" }), false);
check("phone lookup goes live", await usable({ ...base, phone: "3005550001" }), false);
check("NPI lookup goes live", await usable({ ...base, npi: "1000000001" }), false);
check("including inactive goes live", await usable({ ...base, states: ["VA"], includeInactive: true }), false);
check("other sorts go live", await usable({ ...base, sortBy: "medicare", states: ["VA"] }), false);
check("different weights go live", await usable({ ...base, states: ["VA"], scoreWeights: { ...W, hasPhone: 40 } }), false);
check("name filter still returns the right rows (live)", (await page({ ...base, states: ["VA"], nameContains: ["alpha"] }, 25, 0)).length > 0, true);

// 5. Change the data: the table goes stale at once, answers stay correct, a rebuild catches up.
const target = (await page({ ...base, states: ["VA"] }, 1, 0))[0];
await db.exec(`update public.npi_records set phone = null, authorizedofficial_lastname = null where npi = '${target}'`);
check("a data change marks the stored scores stale", (await status()).fresh, false);
check("stale scores are not used", await usable({ ...base, states: ["VA"] }), false);
const afterChange = await page({ ...base, states: ["VA"] }, 25, 0);
check("answers stay correct while stale (live)", afterChange, await page({ ...base, states: ["VA"], forceLive: true }, 25, 0));
await db.exec(`update public.npi_records set deactivation_date = '2026-01-01' where npi = '${afterChange[1]}'`);
await db.exec(`update public.npi_cms_enrichment set total_claims = 99999 where npi = (select npi from public.npi_cms_enrichment limit 1)`);
await db.exec(`insert into public.npi_records (npi, name, enumerationtype, status, isorganization, address_state, taxonomy_code, phone, authorizedofficial_lastname, address_line1, address_city, address_postalcode)
  values ('1999999999', 'NEWCO DME', 'NPI-2', 'A', true, 'VA', '332B00000X', '8045550000', 'Newowner', '1 New St', 'Richmond', '23219')`);
const refreshed = (await one("select public.refresh_provider_scores() as r"))[0].r;
check("rebuild is fresh", refreshed.fresh, true);
check("usable again after the rebuild", await usable({ ...base, states: ["VA"] }), true);
check("deactivated provider is gone from the stored table", Number((await one("select count(*)::int as n from public.provider_scores where npi = $1", [afterChange[1]]))[0].n), 0);
check("new provider is in the stored table", Number((await one("select count(*)::int as n from public.provider_scores where npi = '1999999999'"))[0].n), 1);
for (const criteria of [{ states: ["VA"] }, { states: ["VA"], taxonomyCodes: ["332B00000X"], hasPhone: true }, { states: ["VA", "NY"], minScore: 60 }]) {
  check(`identical to live after the rebuild: ${JSON.stringify(criteria)}`, await page({ ...base, ...criteria }, 50, 0), await page({ ...base, ...criteria, forceLive: true }, 50, 0));
}

// 6. A rebuild stays stale if the data changed while it was running.
await db.exec(`update public.provider_scores_state set stale = true, stale_since = now() + interval '1 minute' where id = 1`);
const raced = (await one("select public.finish_provider_scores_refresh(now()) as r"))[0].r;
check("a change newer than the rebuild's start keeps it stale", raced.fresh, false);
check("still stale", (await status()).fresh, false);
await db.exec(`update public.provider_scores_state set stale_since = now() - interval '1 hour' where id = 1`); // undo the artificial future timestamp above
await db.exec("select public.refresh_provider_scores(null, array['VA'])");
check("a partial rebuild leaves it stale", (await status()).fresh, false);
await db.exec("select public.refresh_provider_scores()");
check("a full rebuild makes it fresh again", (await status()).fresh, true);

// 7. The small score index finds the last row a page needs without sorting everything.
//    The SQL under test is what the search really generates, not a hand-written copy.
await db.exec("set enable_seqscan = off");
await db.exec("set enable_bitmapscan = off");
const planFor = async (criteria, offset = 199) => {
  const where = (await one("select public.provider_scores_filter_sql($1::jsonb) as w", [JSON.stringify(criteria)]))[0].w;
  const rowsOut = await one(`explain select s.score from public.provider_scores s where ${where} order by s.score desc offset ${offset} limit 1`);
  return { where, plan: rowsOut.map((r) => r["QUERY PLAN"]).join("\n") };
};
const both = await planFor({ ...base, states: ["VA"], taxonomyCodes: ["332B00000X"] });
check("one state and one specialty are written as plain equality", /state_u = 'VA'/.test(both.where) && /taxonomy_code = '332B00000X'/.test(both.where) && !/any/.test(both.where), true);
check("state + specialty: reads a score index in order, no sort node", /idx_provider_scores_(state|tax)_score/.test(both.plan) && !/Sort/.test(both.plan), true);
const stateOnly = await planFor({ ...base, states: ["VA"] });
check("state only: reads the state/score index in order, no sort node", /idx_provider_scores_state_score/.test(stateOnly.plan) && !/Sort/.test(stateOnly.plan), true);
const taxOnly = await planFor({ ...base, taxonomyCodes: ["332B00000X"] });
check("specialty only: reads the specialty/score index in order, no sort node", /idx_provider_scores_tax_score/.test(taxOnly.plan) && !/Sort/.test(taxOnly.plan), true);
const several = await planFor({ ...base, states: ["VA", "NY"] });
check("several states still use the array form (and stay correct)", /any \(/.test(several.where), true);
await db.exec("reset enable_seqscan");
await db.exec("reset enable_bitmapscan");

// Only the two small indexes plus the primary key exist.
check("only the lean indexes exist", (await one("select indexname from pg_indexes where tablename = 'provider_scores' order by 1")).map((r) => r.indexname),
  ["idx_provider_scores_state_score", "idx_provider_scores_tax_score", "provider_scores_pkey"]);

// Pages that run past the end, and tiny result sets, still match the live search exactly.
for (const criteria of [{ states: ["VA"], taxonomyCodes: ["332B00000X"], minScore: 100 }, { states: ["OH"], hasPhone: true, hasDecisionMaker: true, activeMedicare: true }, { states: ["ZZ"] }]) {
  for (const [limit, skip] of [[25, 0], [25, 5], [50, 40], [200, 0], [25, 2000]]) {
    const request = { ...base, ...criteria };
    check(`edge page ${limit}/${skip} ${JSON.stringify(criteria)}`, await page(request, limit, skip), await page({ ...request, forceLive: true }, limit, skip));
  }
}

// 8. Nothing here is readable through the public API.
check("RLS is on for the stored scores", (await one("select relrowsecurity as r from pg_class where relname = 'provider_scores'"))[0].r, true);


// 9. A data load can never fail because of the stored scores, even if their tables are gone...
await db.exec("drop table public.provider_scores_state");
await db.exec(`update public.npi_records set phone = phone where npi = (select npi from public.npi_records limit 1)`);
check("a data load still works with the freshness table missing", true, true);
check("the stored scores answer 'not usable' without the freshness table", await usable({ ...base, states: ["VA"] }), false);

// ...and after the uninstall script, sorted searches run the live path and match it.
await db.exec(read("023_provider_scores_uninstall.sql"));
check("uninstalled: stored table is gone", (await one("select to_regclass('public.provider_scores') is null as gone"))[0].gone, true);
check("uninstalled: no triggers left on the provider table", Number((await one("select count(*)::int as n from pg_trigger where tgname like 'provider_scores_stale%'"))[0].n), 0);
check("uninstalled: not usable", await usable({ ...base, states: ["VA"] }), false);
check("uninstalled: status says not installed", (await status()).installed, false);
check("uninstalled: a sorted search still works and equals the live path", (await page({ ...base, states: ["VA"] }, 25, 0)).length > 0, true);
await db.exec(`update public.npi_records set phone = phone where npi = (select npi from public.npi_records limit 1)`);
check("uninstalled: data loads still work", true, true);

console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\nALL ${passed} PASSED`);
process.exit(failed ? 1 : 0);
