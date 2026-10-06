// Checks the search SQL in its final state: sql/021, then 022, then 024 applied in
// that order (exactly how the live database has them), on a throwaway in-memory
// Postgres (PGlite) with invented providers. Covers filters, the three sorts,
// stable paging, lookups, the counts, the territory grid, that scoring is gone,
// and that a hostile value stays inert. It never touches a real database.
//
// To run it (PGlite is not a project dependency, so install it somewhere temporary):
//   mkdir %TEMP%\pgtest && cd %TEMP%\pgtest && npm init -y && npm i @electric-sql/pglite
//   copy this file there, then:
//   set SQL_DIR=C:\path\to\sql && node search_insights.test.mjs
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
  insert into public.taxonomies values ('332B00000X', 'Durable Medical Equipment & Medicare Supplier', 'DME'), ('333600000X', 'Pharmacy', 'Pharmacy');
`);

// A few hand-made providers with known answers.
//  1 full (phone, owner, address, Medicare 500)   2 phone only (Medicare row with 0 claims)
//  3 owner + address, no phone                     4 phone + owner + Medicare 90, CLAIMED by a teammate
//  5 Texas                                         6 deactivated            7 an individual   8 a pharmacy
await db.exec(`
  insert into public.npi_records values
   ('1000000001','ALPHA MEDICAL SUPPLY','NPI-2','A',true,'1 Main St',null,'Miami','FL','33101','US','3055550101','332B00000X',null,'Ann','Alpha','Owner','3055550102','2025-03-01',null),
   ('1000000002','BRAVO HOME CARE','NPI-2','A',true,null,null,'Miami','FL','33102','US','3055550202','332B00000X',null,null,null,null,null,'2024-05-01',null),
   ('1000000003','CHARLIE DME LLC','NPI-2','A',true,'3 Oak Ave',null,'Tampa','FL','33601','US',null,'332B00000X',null,'Cal','Charlie','CEO',null,'2023-01-01',null),
   ('1000000004','DELTA OXYGEN','NPI-2','A',true,'4 Pine Rd',null,'Orlando','FL','32801','US','4075550404','332B00000X',null,'Dee','Delta','Owner',null,'2025-07-01',null),
   ('1000000005','ECHO MEDICAL','NPI-2','A',true,'5 Elm St',null,'Austin','TX','73301','US','5125550505','332B00000X',null,'Eve','Echo','Owner',null,'2025-01-01',null),
   ('1000000006','FOXTROT CLOSED CO','NPI-2','A',true,'6 Ash St',null,'Miami','FL','33103','US','3055550606','332B00000X',null,'Fay','Fox','Owner',null,'2020-01-01','2022-01-01'),
   ('1000000007','DR GOLF PERSON','NPI-1','A',false,'7 Fir St',null,'Miami','FL','33104','US','3055550707','332B00000X',null,'Gil','Golf',null,null,'2025-01-01',null),
   ('1000000008','HOTEL PHARMACY','NPI-2','A',true,'8 Birch St',null,'Miami','FL','33105','US','3055550808','333600000X',null,'Hal','Hotel','Owner',null,'2025-06-01',null);
  insert into public.npi_cms_enrichment values ('1000000001', 500, 600, 40, 9000, 12000), ('1000000004', 90, 100, 10, 1000, 1500), ('1000000002', 0, 0, 0, 0, 0);
  insert into public.leads values ('1000000004', gen_random_uuid(), false);
`);

// The same order the live database has them.
await db.exec(read("021_search_insights.sql"));
await db.exec(read("022_search_speed.sql"));
await db.exec(read("024_remove_scoring.sql"));
await db.exec(read("025_territory_cache.sql"));

let failed = 0;
let passed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? passed++ : failed++;
  if (!ok) console.log(`FAIL  ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
};
const one = async (sql, params) => (await db.query(sql, params)).rows;
const npis = async (criteria, limit = 50, skip = 0) =>
  (await one("select npi from public.search_providers_v2($1::jsonb, $2, $3)", [JSON.stringify(criteria), limit, skip])).map((r) => r.npi);
const insights = async (criteria, seen = []) => (await one("select public.search_insights($1::jsonb, $2::text[]) as r", [JSON.stringify(criteria), seen]))[0].r;

check("features probe", (await one("select public.search_features() as r"))[0].r.version, 1);
check("the score function is gone", (await one("select to_regprocedure('public.provider_score_sql(jsonb)') is null as gone"))[0].gone, true);

// Baseline: FL active organizations; inactive (6) and individual (7) excluded.
const FL = { states: ["FL"] };
const DME = { taxonomyCodes: ["332B00000X"] };
check("FL baseline, in NPI order", await npis(FL), ["1000000001", "1000000002", "1000000003", "1000000004", "1000000008"]);
check("specialty narrows", await npis({ ...FL, taxonomyCodes: ["333600000X"] }), ["1000000008"]);
check("two states", await npis({ states: ["FL", "TX"], ...DME }), ["1000000001", "1000000002", "1000000003", "1000000004", "1000000005"]);
check("single state and specialty (the form search uses)", await npis({ state: "FL", taxonomyCode: "333600000X" }), ["1000000008"]);
check("a specialty code nothing has matches nothing", await npis({ ...FL, taxonomyCodes: ["__no_such_specialty__"] }), []);

// Quality filters.
check("hasPhone", await npis({ ...FL, ...DME, hasPhone: true }), ["1000000001", "1000000002", "1000000004"]);
check("hasDecisionMaker", await npis({ ...FL, ...DME, hasDecisionMaker: true }), ["1000000001", "1000000003", "1000000004"]);
check("activeMedicare (0 claims is not active)", await npis({ ...FL, ...DME, activeMedicare: true }), ["1000000001", "1000000004"]);
check("minMedicareClaims 100", await npis({ ...FL, minMedicareClaims: 100 }), ["1000000001"]);
check("zip prefix 331", await npis({ ...FL, ...DME, zip: "331" }), ["1000000001", "1000000002"]);
check("zip prefix 33101", await npis({ ...FL, zip: "33101" }), ["1000000001"]);
check("last-updated year", await npis({ ...FL, ...DME, lastUpdatedYears: ["2025"] }), ["1000000001", "1000000004"]);
check("company-name text", await npis({ ...FL, nameContains: ["oxygen"] }), ["1000000004"]);
check("exclude keywords", await npis({ ...FL, ...DME, excludeKeywords: ["dme", "oxygen"] }), ["1000000001", "1000000002"]);

// The score is gone: its filter is ignored and its sort falls back to NPI order.
check("an old 'minScore' filter is ignored", await npis({ ...FL, ...DME, minScore: 100 }), await npis({ ...FL, ...DME }));
check("an old 'score' sort falls back to NPI order", await npis({ ...FL, ...DME, sortBy: "score" }), await npis({ ...FL, ...DME }));

// Sorting happens before paging; ties fall back to NPI.
check("sort by Medicare claims", await npis({ ...FL, ...DME, sortBy: "medicare" }), ["1000000001", "1000000004", "1000000002", "1000000003"]);
check("sort by most recently updated", await npis({ ...FL, ...DME, sortBy: "updated" }), ["1000000004", "1000000001", "1000000002", "1000000003"]);
check("sort by company name", await npis({ ...FL, ...DME, sortBy: "name" }), ["1000000001", "1000000002", "1000000003", "1000000004"]);
check("page 1 of a sorted search", await npis({ ...FL, ...DME, sortBy: "medicare" }, 2, 0), ["1000000001", "1000000004"]);
check("page 2 of a sorted search", await npis({ ...FL, ...DME, sortBy: "medicare" }, 2, 2), ["1000000002", "1000000003"]);

// Lookups ignore the other filters.
check("npi exact ignores filters (even inactive)", await npis({ npi: "1000000006", states: ["TX"] }), ["1000000006"]);
check("phone lookup (formatted)", await npis({ phone: "(305) 555-0202", states: ["TX"] }), ["1000000002"]);
check("phone matches the owner's phone too", await npis({ phone: "305-555-0102" }), ["1000000001"]);
check("text lookup by company", await npis({ q: "alpha med", states: ["TX"] }), ["1000000001"]);
check("text lookup by owner name", await npis({ q: "Cal Charlie" }), ["1000000003"]);

// Counts: matched counts all, unclaimed drops the claimed lead, left drops what this rep has seen.
let r = await insights({ ...FL, ...DME });
check("insights matched", Number(r.matched), 4);
check("insights unclaimed", Number(r.unclaimed), 3);
check("insights left (nothing seen)", Number(r.left), 3);
r = await insights({ ...FL, ...DME }, ["1000000001", "1000000002"]);
check("insights left after seeing two", Number(r.left), 1);
r = await insights({ ...FL, ...DME }, ["1000000001", "1000000002", "1000000003"]);
check("insights: everything seen or claimed", [Number(r.matched), Number(r.unclaimed), Number(r.left)], [4, 3, 0]);
r = await insights({ states: ["TX"], taxonomyCodes: ["333600000X"] });
check("insights zero case", [Number(r.matched), Number(r.unclaimed), Number(r.left)], [0, 0, 0]);
r = await insights({ ...FL, hasPhone: true, hasDecisionMaker: true });
check("insights respects quality filters", [Number(r.matched), Number(r.unclaimed)], [3, 2]);

const quick = (await one("select public.search_quick_counts($1::jsonb) as r", [JSON.stringify([
  { id: "phone", criteria: { ...FL, ...DME, hasPhone: true } },
  { id: "medicare", criteria: { ...FL, ...DME, activeMedicare: true } },
  { id: "none", criteria: { states: ["TX"], taxonomyCodes: ["333600000X"] } },
])]))[0].r;
check("quick counts (unclaimed only, one call)", quick.map((q) => [q.id, Number(q.unclaimed), q.capped]), [["phone", 2, false], ["medicare", 1, false], ["none", 0, false]]);

// Territory is counted one specialty at a time into a small table, then read from it.
const CODES = ["332B00000X", "333600000X"];
check("nothing counted yet: every specialty is stale", (await one("select public.territory_stale_codes($1::text[], 168) as r", [CODES]))[0].r, CODES);
check("before counting, the grid is empty", (await one("select count(*)::int as n from public.search_territory($1::text[])", [CODES]))[0].n, 0);
for (const code of CODES) await one("select public.refresh_territory_code($1)", [code]);
check("after counting, nothing is stale", (await one("select public.territory_stale_codes($1::text[], 168) as r", [CODES]))[0].r, []);
await one("select public.refresh_territory_code('999999999X')");
check("a specialty with no providers is remembered, not recounted", (await one("select public.territory_stale_codes($1::text[], 168) as r", [["999999999X"]]))[0].r, []);
check("and it adds no row to the grid", (await one("select count(*)::int as n from public.search_territory($1::text[])", [["999999999X"]]))[0].n, 0);
const terr = await one("select state, taxonomy_code, total::int as total, unclaimed::int as unclaimed from public.search_territory($1::text[]) order by 1, 2", [CODES]);
check("territory grid", terr, [
  { state: "FL", taxonomy_code: "332B00000X", total: 4, unclaimed: 3 },
  { state: "FL", taxonomy_code: "333600000X", total: 1, unclaimed: 1 },
  { state: "TX", taxonomy_code: "332B00000X", total: 1, unclaimed: 1 },
]);

await db.exec("insert into public.leads values ('1000000001', gen_random_uuid(), false)");
check("a new claim lowers 'unclaimed' at once, without recounting",
  (await one("select unclaimed::int as u from public.search_territory($1::text[]) where state = 'FL' and taxonomy_code = '332B00000X'", [CODES]))[0].u, 2);
await db.exec("delete from public.leads where npi = '1000000001'");

check("rows carry the stored specialty name (the Worker fills blanks in)",
  (await one("select taxonomy_description from public.search_providers_v2($1::jsonb, 1, 0)", [JSON.stringify({ npi: "1000000001" })]))[0].taxonomy_description, null);

// Paging is stable and complete for every sort, on 3,000 random providers.
let seed = 20261005;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (list) => list[Math.floor(rnd() * list.length)];
const states = ["VA", "NY", "TX"];
const tax = ["332B00000X", "333600000X"];
const q = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const rows = [];
for (let i = 1; i <= 3000; i++) {
  rows.push({
    npi: String(2000000000 + i), name: `${pick(["ALPHA", "BRAVO", "CHARLIE"])} ${pick(["MEDICAL", "HOME CARE"])} ${i % 40}`,
    state: pick(states), tax: pick(tax), claims: rnd() < 0.4 ? Math.round(rnd() * 60) : null, // lots of ties on purpose
    updated: `${2022 + Math.floor(rnd() * 4)}-0${1 + Math.floor(rnd() * 3)}-15`,
  });
}
for (let i = 0; i < rows.length; i += 500) {
  const chunk = rows.slice(i, i + 500);
  await db.exec(`insert into public.npi_records (npi, name, enumerationtype, status, isorganization, address_state, taxonomy_code, lastupdated)
    values ${chunk.map((r) => `(${q(r.npi)},${q(r.name)},'NPI-2','A',true,${q(r.state)},${q(r.tax)},${q(r.updated)})`).join(",")}`);
  const withClaims = chunk.filter((r) => r.claims !== null);
  if (withClaims.length) await db.exec(`insert into public.npi_cms_enrichment (npi, total_claims) values ${withClaims.map((r) => `(${q(r.npi)},${r.claims})`).join(",")}`);
}
const BIG = { states: ["VA", "NY"], taxonomyCodes: ["332B00000X"] };
const activeWhere = `r.npi like '2%' and r.address_state in ('VA','NY') and r.taxonomy_code = '332B00000X'`;
const expectedOrder = {
  "": "r.npi",
  medicare: "coalesce(e.total_claims, 0) desc, r.npi",
  updated: "r.lastupdated desc, r.npi",
  name: "r.name asc nulls last, r.npi",
};
for (const [sortBy, orderBy] of Object.entries(expectedOrder)) {
  const expected = (await one(`select r.npi from public.npi_records r left join public.npi_cms_enrichment e on e.npi = r.npi where ${activeWhere} order by ${orderBy}`)).map((x) => x.npi);
  const collected = [];
  for (let skip = 0; skip < 5000; skip += 70) {
    const pageRows = await npis({ ...BIG, ...(sortBy ? { sortBy } : {}) }, 70, skip);
    if (!pageRows.length) break;
    collected.push(...pageRows);
  }
  check(`paging every page of the '${sortBy || "default"}' order returns exactly the right providers, once each, in order`, collected, expected);
}

// A hostile value must be quoted, not executed.
check("sql injection attempt is inert", (await npis({ states: ["FL'; drop table public.leads; --"] })).length, 0);
check("leads table still exists", Number((await one("select count(*)::int as n from public.leads"))[0].n), 1);

console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\nALL ${passed} PASSED`);
process.exit(failed ? 1 : 0);
