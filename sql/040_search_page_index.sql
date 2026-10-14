-- DME Desk Prospector: let a page of search results read only its own rows.
-- MANUAL ONLY: review against the live schema before execution. The agent
-- never executes SQL against Supabase.
-- Run after 039. Rerun-safe. It creates ONE INDEX and refreshes statistics:
-- no table is altered, no data changes, nothing is dropped.
--
-- Why: the main search asks for one state and one specialty at a time, in NPI
-- order, a page at a time. The only index that fits is the state one, so every
-- page read all ~36,000 active providers in the state (27,000 buffers measured
-- for a Florida page) and threw away the ~29,000 of another specialty, again
-- for every "Search more" click, while competing with every other rep for the
-- same small database. With state + specialty + NPI in one index the page is
-- read straight off the index in order: a few hundred buffers instead.
--
-- The WHERE clause is the same "active organisation" test the existing partial
-- indexes use, so searches that do not include inactive providers or
-- individuals can use it. It builds in about a second on ~395,000 rows and
-- briefly blocks writes to npi_records while it does.

begin;

create index if not exists idx_npi_records_active_state_taxonomy
  on public.npi_records (upper(btrim((address_state)::text)), taxonomy_code, npi)
  where deactivation_date is null
    and upper((coalesce(status, 'A'::character varying))::text) = any (array['A'::text, 'ACTIVE'::text])
    and coalesce(isorganization, ((enumerationtype)::text = 'NPI-2'::text), true);

-- The planner estimated 1 row for a state + specialty filter that matches ~6,000
-- (statistics last refreshed 2026-10-05), which is why it picked the wrong plan.
analyze public.npi_records;

commit;

-- Verification (read-only). Expect "Index Scan using idx_npi_records_active_state_taxonomy"
-- and no Sort node; before this, the plan was an index scan on idx_npi_records_active_state
-- with "Rows Removed by Filter" in the tens of thousands.
--   explain (analyze, buffers)
--   select r.npi from public.npi_records r
--    where coalesce(r.isorganization, r.enumerationtype = 'NPI-2', true)
--      and r.deactivation_date is null
--      and upper(coalesce(r.status, 'A')) in ('A', 'ACTIVE')
--      and upper(btrim(r.address_state)) = any ('{FL}'::text[])
--      and r.taxonomy_code = any ('{332B00000X}'::text[])
--    order by r.npi limit 200 offset 4000;
