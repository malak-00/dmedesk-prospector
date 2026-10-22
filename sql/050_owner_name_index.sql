-- DME Desk Prospector: an index for "other businesses run by the same owner".
-- MANUAL ONLY: review against the live schema before execution. The agent
-- never executes SQL against Supabase.
-- Run any time. Rerun-safe. It creates ONE INDEX: no table is altered, no data
-- changes, nothing is dropped.
--
-- Why: opening a Prospect card calls GET /companies/same-owner, which finds the
-- other records with the same authorized official:
--   select ... from npi_records
--    where authorizedofficial_lastname = $1 and authorizedofficial_firstname = $2
--    limit 200
-- No index covers those columns, so every card open read all ~395,000 providers
-- (~183 MB). In the app's error list this was 268 of 360 failures in 28 days
-- ("canceling statement due to statement timeout", 6 people). With this index
-- the lookup reads only the rows with that name.
--
-- Builds in about a second on ~395,000 rows and briefly blocks writes to
-- npi_records while it does (the same as sql/040).

begin;

create index if not exists idx_npi_records_official_name
  on public.npi_records (authorizedofficial_lastname, authorizedofficial_firstname)
  where authorizedofficial_lastname is not null;

commit;

-- Verification (read-only): expect "Index Scan using idx_npi_records_official_name",
-- not a Seq Scan.
--   explain (analyze, buffers)
--   select npi from public.npi_records
--    where authorizedofficial_lastname = 'SMITH' and authorizedofficial_firstname = 'JOHN'
--    limit 200;
