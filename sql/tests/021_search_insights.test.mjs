// Runs sql/021_search_insights.sql against a throwaway in-memory Postgres
// (PGlite) with a handful of invented providers, and checks the counts, the
// quality filters, sorting before paging, the lookups, and that a hostile
// value stays inert. It never touches a real database.
//
// To run it (PGlite is not a project dependency, so install it somewhere temporary):
//   mkdir %TEMP%\pgtest && cd %TEMP%\pgtest && npm init -y && npm i @electric-sql/pglite
//   copy this file there, point SQL_FILE at the real file, then:
//   set SQL_FILE=C:\path\to\sql\021_search_insights.sql && node 021_search_insights.test.mjs
// The tables below are minimal stand-ins for the live ones, with only the
// columns the SQL reads.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";

const db = new PGlite();
const sqlFile = process.env.SQL_FILE || new URL("../021_search_insights.sql", import.meta.url);

// Minimal stand-ins for the live tables the file reads.
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
  create function public.taxonomy_description_for(p_code text) returns text language sql stable as
    $$ select coalesce(nullif(btrim(t.description), ''), nullif(btrim(t.facility_type), '')) from public.taxonomies t where btrim(t.code) = btrim(p_code) limit 1 $$;

  insert into public.taxonomies values ('332B00000X', 'Durable Medical Equipment & Medicare Supplier', 'DME'), ('333600000X', 'Pharmacy', 'Pharmacy');

  -- 1 full lead (score 100), 2 phone only, 3 no phone but official+addr, 4 claimed, 5 other state, 6 inactive, 7 individual
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

// Run the real file; only the grant/revoke lines need the roles created above.
await db.exec(fs.readFileSync(sqlFile, "utf8"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`}`);
};
const one = async (sql, params) => (await db.query(sql, params)).rows;
const npis = async (criteria, limit = 50, skip = 0) =>
  (await one("select npi from public.search_providers_v2($1::jsonb, $2, $3)", [JSON.stringify(criteria), limit, skip])).map((r) => r.npi);
const insights = async (criteria, seen = []) => (await one("select public.search_insights($1::jsonb, $2::text[]) as r", [JSON.stringify(criteria), seen]))[0].r;

check("features probe", (await one("select public.search_features() as r"))[0].r.version, 1);

// Baseline: FL active organizations = 1,2,3,4 (+8 pharmacy); inactive(6) and individual(7) excluded.
check("FL baseline", await npis({ states: ["FL"] }), ["1000000001", "1000000002", "1000000003", "1000000004", "1000000008"]);
check("specialty narrows", await npis({ states: ["FL"], taxonomyCodes: ["333600000X"] }), ["1000000008"]);
check("two states", await npis({ states: ["FL", "TX"], taxonomyCodes: ["332B00000X"] }), ["1000000001", "1000000002", "1000000003", "1000000004", "1000000005"]);

// Quality filters.
check("hasPhone", await npis({ states: ["FL"], taxonomyCodes: ["332B00000X"], hasPhone: true }), ["1000000001", "1000000002", "1000000004"]);
check("hasDecisionMaker", await npis({ states: ["FL"], taxonomyCodes: ["332B00000X"], hasDecisionMaker: true }), ["1000000001", "1000000003", "1000000004"]);
check("activeMedicare (0 claims is not active)", await npis({ states: ["FL"], taxonomyCodes: ["332B00000X"], activeMedicare: true }), ["1000000001", "1000000004"]);
check("minMedicareClaims 100", await npis({ states: ["FL"], minMedicareClaims: 100 }), ["1000000001"]);
check("zip prefix 331", await npis({ states: ["FL"], taxonomyCodes: ["332B00000X"], zip: "331" }), ["1000000001", "1000000002"]);
check("zip prefix 33101", await npis({ states: ["FL"], zip: "33101" }), ["1000000001"]);

// Score: alpha=100 (phone25+addr20+dm30+med25), delta=75 (addr20+dm30+med25 -> no phone: 75), bravo=25(phone only), charlie=50 (addr+dm)
check("minScore 60 (alpha 100, delta 100, charlie 50)", await npis({ states: ["FL"], taxonomyCodes: ["332B00000X"], minScore: 60 }), ["1000000001", "1000000004"]);
check("minScore 100", await npis({ states: ["FL"], taxonomyCodes: ["332B00000X"], minScore: 100 }), ["1000000001", "1000000004"]);
check("minScore 50 keeps charlie too", await npis({ states: ["FL"], taxonomyCodes: ["332B00000X"], minScore: 50 }), ["1000000001", "1000000003", "1000000004"]);
check("minScore uses the passed weights (phone-only scoring)", await npis({ states: ["FL"], taxonomyCodes: ["332B00000X"], minScore: 100, scoreWeights: { hasPhone: 100, completeAddress: 0, hasDecisionMaker: 0, medicareActive: 0 } }), ["1000000001", "1000000002", "1000000004"]);

// Sorting happens before paging.
const fl = { states: ["FL"], taxonomyCodes: ["332B00000X"] };
check("sort by score", await npis({ ...fl, sortBy: "score" }), ["1000000001", "1000000004", "1000000003", "1000000002"]);
check("sort by medicare (ties fall back to fit score)", await npis({ ...fl, sortBy: "medicare" }), ["1000000001", "1000000004", "1000000003", "1000000002"]);
check("sort by updated", await npis({ ...fl, sortBy: "updated" }), ["1000000004", "1000000001", "1000000002", "1000000003"]);
check("sort by name", await npis({ ...fl, sortBy: "name" }), ["1000000001", "1000000002", "1000000003", "1000000004"]);
check("page 1 of sorted", await npis({ ...fl, sortBy: "score" }, 2, 0), ["1000000001", "1000000004"]);
check("page 2 of sorted", await npis({ ...fl, sortBy: "score" }, 2, 2), ["1000000003", "1000000002"]);
check("no sort = NPI order", await npis(fl, 50, 0), ["1000000001", "1000000002", "1000000003", "1000000004"]);

// Lookups ignore other filters.
check("npi exact ignores filters (even inactive)", await npis({ npi: "1000000006", states: ["TX"] }), ["1000000006"]);
check("phone lookup (formatted)", await npis({ phone: "(305) 555-0202", states: ["TX"] }), ["1000000002"]);
check("phone matches official phone", await npis({ phone: "305-555-0102" }), ["1000000001"]);
check("text lookup by company", await npis({ q: "alpha med", states: ["TX"] }), ["1000000001"]);
check("text lookup by owner name", await npis({ q: "Cal Charlie" }), ["1000000003"]);

// Insights: matched counts all, unclaimed drops the claimed lead (4), left drops what this rep saw.
let r = await insights({ states: ["FL"], taxonomyCodes: ["332B00000X"] });
check("insights matched", Number(r.matched), 4);
check("insights unclaimed", Number(r.unclaimed), 3);
check("insights left (nothing seen)", Number(r.left), 3);
r = await insights({ states: ["FL"], taxonomyCodes: ["332B00000X"] }, ["1000000001", "1000000002"]);
check("insights left after seeing two", Number(r.left), 1);
r = await insights({ states: ["FL"], taxonomyCodes: ["332B00000X"], minScore: 100 });
check("insights respects quality filters", [Number(r.matched), Number(r.unclaimed)], [2, 1]);
r = await insights({ states: ["TX"], taxonomyCodes: ["333600000X"] });
check("insights zero case", [Number(r.matched), Number(r.unclaimed), Number(r.left)], [0, 0, 0]);
r = await insights({ states: ["FL"] }, []);
check("empty seen list", Number(r.left), 4);

// Territory.
const terr = await one("select state, taxonomy_code, total::int as total, unclaimed::int as unclaimed from public.search_territory($1::text[]) order by 1, 2", [["332B00000X", "333600000X"]]);
check("territory grid", terr, [
  { state: "FL", taxonomy_code: "332B00000X", total: 4, unclaimed: 3 },
  { state: "FL", taxonomy_code: "333600000X", total: 1, unclaimed: 1 },
  { state: "TX", taxonomy_code: "332B00000X", total: 1, unclaimed: 1 },
]);

// A hostile value must be quoted, not executed.
check("sql injection attempt is inert", (await npis({ states: ["FL'; drop table public.leads; --"] })).length, 0);
check("leads table still exists", Number((await one("select count(*)::int as n from public.leads"))[0].n), 1);

// The original 018 function is not part of this file, so nothing here can change it.
console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
