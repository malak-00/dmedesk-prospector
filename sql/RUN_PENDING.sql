-- DME Desk Prospector: everything still to run, in one file.
--
-- MANUAL ONLY: review against the live schema before execution.
-- Generated from the files below, unchanged apart from their own
-- begin/commit -- running them individually, in this order, does the same
-- thing. Keep doing that for anything added later; this file exists so the
-- backlog can be cleared in one paste.
--
--   sql/017_lead_sync_restart.sql
--     Let a claimed-lead sync run again from the start, instead of resuming past the end.
--   sql/018_provider_search.sql
--     Search providers in this project's own npi_records, with every filter in SQL.
--
-- They are wrapped in a single transaction: if anything fails, nothing
-- is applied and the error names the statement. Every file is rerun-safe on
-- its own, so re-running this one is safe too.
--
-- Paste the WHOLE file into the Supabase SQL Editor with nothing selected --
-- a partial selection cuts a dollar-quoted function body in half and fails
-- with "unterminated dollar-quoted string".
--
-- Verification queries are at the bottom. Run them after, and keep the
-- output with the run.

begin;

-- ========================================================================
-- sql/017_lead_sync_restart.sql
-- ========================================================================

-- DME Desk Prospector: run a claimed-lead sync again from the start.
-- MANUAL ONLY: review against the live schema before execution.
-- Run after 015.
--
-- apply_provider_changes_to_leads resumes from a cursor on the run
-- (metadata.lead_sync_last_npi), so an interrupted sync continues where it
-- stopped. The cost of that is a sync which has run once can never run
-- again: the cursor sits past the last NPI, the next call finds nothing
-- below it and truthfully reports "nothing to do" -- even when the pass that
-- set the cursor covered a different set of NPIs than the current one would.
--
-- That happened here. A release applied before the sync existed was synced
-- once under the old, unscoped query, which walks every NPI in the release;
-- when the query was narrowed to NPIs somebody holds a lead for, the cursor
-- left behind was already past the end, so the next run reported 0 refreshed
-- while 3,558 claimed leads were still showing pre-refresh data. Clearing
-- three metadata keys by hand fixed it -- which is not a thing anyone should
-- have to know.
--
-- reset_lead_sync(run) drops the cursor so the next sync starts from the
-- beginning. Re-running a sync is safe by construction: the snapshot copy is
-- idempotent, and an alert for one lead in one run can only exist once (a
-- unique index enforces it), so nothing is duplicated or re-raised.
-- Rerun-safe.


create or replace function public.reset_lead_sync(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.refresh_runs%rowtype;
  v_cursor text;
begin
  select * into r from public.refresh_runs where id = p_run_id for update;
  if not found then raise exception 'refresh run % does not exist', p_run_id; end if;
  if r.source <> 'nppes' then
    raise exception 'refresh run % is not an NPPES run', p_run_id;
  end if;

  v_cursor := r.metadata->>'lead_sync_last_npi';

  update public.refresh_runs
     set metadata = (metadata - 'lead_sync_last_npi' - 'lead_sync_state' - 'lead_sync_finished_at')
                    || jsonb_build_object('lead_sync_reset_at', now(), 'lead_sync_reset_from', v_cursor)
   where id = p_run_id;

  return jsonb_build_object(
    'run_id', p_run_id,
    'cleared_cursor', v_cursor,
    'was_complete', coalesce(r.metadata->>'lead_sync_state', '') = 'complete');
end
$$;

revoke all on function public.reset_lead_sync(uuid) from public, anon, authenticated;
grant execute on function public.reset_lead_sync(uuid) to service_role;


-- Verification (read-only):
-- select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and proname = 'reset_lead_sync';
--
-- What each applied release did for the people who own leads:
-- select id, started_at,
--        metadata->>'lead_sync_state' as sync_state,
--        metadata->>'lead_sync_leads_updated' as leads_refreshed,
--        metadata->>'lead_sync_alerts' as alerts_raised
--   from public.refresh_runs
--  where source = 'nppes' and metadata->>'apply_state' = 'applied'
--  order by started_at desc;

-- ========================================================================
-- sql/018_provider_search.sql
-- ========================================================================

-- DME Desk Prospector: provider search against our own npi_records.
-- MANUAL ONLY: review against the live schema before execution.
-- Run after 007 (it needs deactivation_date).
--
-- Search still goes to the mirror project (fakeNPI) over HTTP, one page at a
-- time, while this project now holds the same 387k providers in
-- public.npi_records -- refreshed monthly by scripts/nppes_ingest, and
-- covering 3,579 of the 3,611 leads people actually own. search_providers()
-- is the same search done here instead:
--
--   * every filter is applied in SQL. The mirror can only filter by state,
--     city, taxonomy code and organization name, so name terms, excluded
--     keywords and last-updated years are filtered in the Worker *after*
--     paging -- which is why a page of 200 can come back with 3 usable rows
--     and the search has to keep fetching. Here a page of 200 is 200 rows
--     that already match.
--   * deactivated providers are left out unless asked for. A lead nobody can
--     bill for is not a prospect.
--   * Medicare enrichment is joined in the same query, as the mirror does.
--   * the full match count rides along on every row (total_count), so the
--     caller knows how deep a search goes without a second query.
--
-- The result is deliberately flat, one row per provider: the shape the app
-- uses is built in the Worker (services/providerSearch.js) from these
-- columns, so the two sources can't drift apart in two languages.
--
-- Only the filters a search actually carries reach the query, so each one
-- is a plain comparison the planner can answer from an index rather than
-- something it has to look at every row to evaluate.
--
-- Rerun-safe. Read-only: it writes nothing.


-- Name search is `ilike '%term%'`, which no b-tree can help with. A trigram
-- index can, so create one where the extension is available (Supabase has
-- it; a local Postgres build may not). Everything still works without it --
-- it is slower, nothing more.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_trgm') then
    execute 'create extension if not exists pg_trgm';
    execute 'create index if not exists idx_npi_records_name_trgm on public.npi_records using gin (name gin_trgm_ops)';
  else
    raise notice 'pg_trgm is not available here; name search will work without its index';
  end if;
end
$$;

-- Every index here is on the exact expression the search uses. State and
-- city are matched trimmed and upper-cased, so a plain column index on them
-- could never be used; taxonomy needs one of its own because a search by
-- specialty alone carries no state, and as the second column of a composite
-- index it would be unreachable.
create index if not exists idx_npi_records_state_taxonomy
  on public.npi_records (upper(btrim(address_state)), taxonomy_code);
create index if not exists idx_npi_records_taxonomy_code
  on public.npi_records (taxonomy_code);
create index if not exists idx_npi_records_city
  on public.npi_records (upper(btrim(address_city)));
create index if not exists idx_npi_records_lastupdated
  on public.npi_records (lastupdated);

-- Fresh statistics, so the planner uses the indexes above from the first
-- search rather than after autovacuum gets round to the table.
analyze public.npi_records;

-- What a taxonomy code is called. npi_records only ever stored the code, so
-- without this a result has no specialty to show and a specialty filter
-- matches nothing. public.taxonomies holds duplicate and blank-coded rows,
-- hence btrim and the single-row pick.
create or replace function public.taxonomy_description_for(p_code text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(nullif(btrim(t.description), ''), nullif(btrim(t.facility_type), ''))
    from public.taxonomies t
   where btrim(t.code) = btrim(p_code)
     and coalesce(nullif(btrim(t.description), ''), nullif(btrim(t.facility_type), '')) is not null
   order by t.description
   limit 1
$$;

-- p_criteria keys, all optional:
--   npi                  exact NPI; when present every other filter is ignored
--   state, city          exact, case-insensitive
--   taxonomyCode         exact
--   taxonomyDescription  contains
--   organizationName     starts with ('*' works as a wildcard, as in NPPES)
--   nameContains         array; a provider matching ANY term is kept
--   excludeKeywords      array; a provider matching ANY term is dropped
--   lastUpdatedYears     array of 'YYYY'
--   includeInactive      true keeps deactivated providers (default false)
--   includeIndividuals   true keeps NPI-1 providers (default false)
create or replace function public.search_providers(
  p_criteria jsonb default '{}'::jsonb,
  p_limit integer default 20,
  p_skip integer default 0)
returns table (
  npi text,
  name text,
  enumeration_type text,
  status text,
  is_organization boolean,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country_code text,
  phone text,
  taxonomy_code text,
  taxonomy_description text,
  official_first_name text,
  official_last_name text,
  official_credential text,
  official_title text,
  official_phone text,
  last_updated text,
  deactivation_date text,
  medicare_total_claims numeric,
  medicare_total_services numeric,
  medicare_total_beneficiaries numeric,
  medicare_payment numeric,
  medicare_allowed numeric,
  total_count bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_j jsonb := coalesce(p_criteria, '{}'::jsonb);
  v_lim integer := least(greatest(coalesce(p_limit, 20), 1), 200);
  v_skip integer := greatest(coalesce(p_skip, 0), 0);
  v_npi text := nullif(btrim(coalesce(v_j->>'npi', '')), '');
  v_where text[] := '{}';
  v_terms text[];
begin
  -- The predicates are built as text rather than written as one static
  -- query with "(:param is null or column = :param)" for each filter,
  -- because that idiom hides the comparison from the planner: against
  -- 394k providers it means a sequential scan every time, and a search by
  -- specialty alone timed out at 8s. Built this way, each filter that is
  -- actually present becomes a plain comparison the planner can answer
  -- from an index. Every value goes through quote_literal (%L) -- nothing
  -- from the caller is ever interpolated raw.
  if v_npi is not null then
    -- An exact NPI lookup ignores every other filter, as the mirror's does.
    v_where := array_append(v_where, format('r.npi = %L', v_npi));
  else
    if not coalesce((v_j->>'includeIndividuals')::boolean, false) then
      v_where := array_append(v_where, 'coalesce(r.isorganization, r.enumerationtype = ''NPI-2'', true)');
    end if;

    if not coalesce((v_j->>'includeInactive')::boolean, false) then
      v_where := array_append(v_where, 'r.deactivation_date is null');
      v_where := array_append(v_where, 'upper(coalesce(r.status, ''A'')) in (''A'', ''ACTIVE'')');
    end if;

    if nullif(btrim(coalesce(v_j->>'state', '')), '') is not null then
      v_where := array_append(v_where, format('upper(btrim(r.address_state)) = %L', upper(btrim(v_j->>'state'))));
    end if;

    if nullif(btrim(coalesce(v_j->>'city', '')), '') is not null then
      v_where := array_append(v_where, format('upper(btrim(r.address_city)) = %L', upper(btrim(v_j->>'city'))));
    end if;

    if nullif(btrim(coalesce(v_j->>'taxonomyCode', '')), '') is not null then
      v_where := array_append(v_where, format('r.taxonomy_code = %L', btrim(v_j->>'taxonomyCode')));
    end if;

    -- npi_records carries the taxonomy CODE; the description lives in
    -- public.taxonomies (the column has never been populated -- see
    -- repos/taxonomiesRepo.js), so filtering on the column alone matched
    -- nothing at all. Resolving the text to codes first keeps this an
    -- indexed comparison instead of a function call per row.
    if nullif(btrim(coalesce(v_j->>'taxonomyDescription', '')), '') is not null then
      select array_agg(distinct btrim(t.code))
        into v_terms
        from public.taxonomies t
       where nullif(btrim(t.code), '') is not null
         and coalesce(t.description, t.facility_type) ilike '%' || btrim(v_j->>'taxonomyDescription') || '%';
      if v_terms is null or cardinality(v_terms) = 0 then
        v_where := array_append(v_where, 'false');
      else
        v_where := array_append(v_where, format('r.taxonomy_code = any (%L::text[])', v_terms));
      end if;
    end if;

    if nullif(btrim(coalesce(v_j->>'organizationName', '')), '') is not null then
      v_where := array_append(v_where,
        format('r.name ilike %L', replace(btrim(v_j->>'organizationName'), '*', '%') || '%'));
    end if;

    select array_agg('%' || btrim(t.term) || '%')
      into v_terms
      from jsonb_array_elements_text(coalesce(v_j->'nameContains', '[]'::jsonb)) t(term)
     where btrim(t.term) <> '';
    if v_terms is not null and cardinality(v_terms) > 0 then
      v_where := array_append(v_where, format('r.name ilike any (%L::text[])', v_terms));
    end if;

    select array_agg('%' || btrim(t.term) || '%')
      into v_terms
      from jsonb_array_elements_text(coalesce(v_j->'excludeKeywords', '[]'::jsonb)) t(term)
     where btrim(t.term) <> '';
    if v_terms is not null and cardinality(v_terms) > 0 then
      v_where := array_append(v_where, format('not (r.name ilike any (%L::text[]))', v_terms));
    end if;

    select array_agg(btrim(t.term))
      into v_terms
      from jsonb_array_elements_text(coalesce(v_j->'lastUpdatedYears', '[]'::jsonb)) t(term)
     where btrim(t.term) <> '';
    if v_terms is not null and cardinality(v_terms) > 0 then
      v_where := array_append(v_where, format('to_char(r.lastupdated, ''YYYY'') = any (%L::text[])', v_terms));
    end if;
  end if;

  return query execute format($q$
    with matched as (
      select r.npi, count(*) over () as total_count
        from public.npi_records r
       where %s
       -- NPI order is the only stable one here, and paging needs a stable
       -- one: a row that moves between pages is a lead seen twice or never.
       order by r.npi
       limit %s offset %s
    )
    select r.npi::text,
           r.name::text,
           coalesce(r.enumerationtype, case when r.isorganization then 'NPI-2' else 'NPI-1' end)::text,
           r.status::text,
           coalesce(r.isorganization, r.enumerationtype = 'NPI-2', true),
           r.address_line1::text,
           r.address_line2::text,
           r.address_city::text,
           r.address_state::text,
           r.address_postalcode::text,
           r.address_countrycode::text,
           r.phone::text,
           r.taxonomy_code::text,
           coalesce(public.taxonomy_description_for(r.taxonomy_code), r.taxonomy_description)::text,
           r.authorizedofficial_firstname::text,
           r.authorizedofficial_lastname::text,
           null::text,
           r.authorizedofficial_title::text,
           r.authorizedofficial_phone::text,
           to_char(r.lastupdated, 'YYYY-MM-DD')::text,
           to_char(r.deactivation_date, 'YYYY-MM-DD')::text,
           e.total_claims,
           e.total_services,
           e.total_beneficiaries,
           e.medicare_payment,
           e.medicare_allowed,
           m.total_count
      from matched m
      join public.npi_records r on r.npi = m.npi
      left join public.npi_cms_enrichment e on e.npi = r.npi
     order by r.npi
  $q$, coalesce(nullif(array_to_string(v_where, ' and '), ''), 'true'), v_lim, v_skip);
end
$fn$;

revoke all on function public.search_providers(jsonb, integer, integer) from public, anon, authenticated;
grant execute on function public.search_providers(jsonb, integer, integer) to service_role;
revoke all on function public.taxonomy_description_for(text) from public, anon, authenticated;
grant execute on function public.taxonomy_description_for(text) to service_role;


-- Verification (read-only):
-- select count(*) from public.search_providers('{"state":"VA"}'::jsonb, 5, 0);
--   -> 5 rows (or fewer if VA has fewer), each with the same total_count.
--
-- select npi, name, city, state, total_count
--   from public.search_providers('{"state":"VA","nameContains":["medical"]}'::jsonb, 5, 0);
--
-- Paging is stable -- these two must not share an NPI:
-- select npi from public.search_providers('{"state":"VA"}'::jsonb, 5, 0)
-- intersect
-- select npi from public.search_providers('{"state":"VA"}'::jsonb, 5, 5);
--   -> 0 rows.
--
-- Specialties resolve from the taxonomies table, since npi_records only has
-- the code -- this must not be null for a code that is on file:
-- select taxonomy_code, public.taxonomy_description_for(taxonomy_code)
--   from public.npi_records where taxonomy_code is not null limit 5;
--
-- Did the name index get built?
-- select indexname from pg_indexes where tablename = 'npi_records' order by indexname;

commit;

-- ---------------------------------------------------------------------------
-- Verification (read-only). Run these after the commit above.
-- ---------------------------------------------------------------------------

-- 1. The functions this file should have created or replaced.
select p.proname as object, pg_get_function_identity_arguments(p.oid) as arguments
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('reset_lead_sync', 'search_providers')
 order by p.proname;
--   -> 2 rows.

-- 1b. Search reads from our own copy. This must return rows, and the same
--     total_count on each:
select npi, name, city, state, total_count
  from public.search_providers('{"state":"VA"}'::jsonb, 5, 0);

--     Paging must not repeat a provider (0 rows):
select npi from public.search_providers('{"state":"VA"}'::jsonb, 5, 0)
intersect
select npi from public.search_providers('{"state":"VA"}'::jsonb, 5, 5);

-- 2. Releases that were applied but never reached claimed leads. Each one
--    needs `python -m nppes_ingest --sync-run <id>`.
select id, started_at, row_count, metadata->>'run_type' as run_type
  from public.refresh_runs
 where source = 'nppes' and metadata->>'apply_state' = 'applied'
   and metadata->>'lead_sync_state' is null
 order by started_at;

-- 3. Runs that claim to hold staged rows but don't -- candidates for an abort.
select r.id, r.source, r.status, r.row_count,
       case r.source when 'nppes'
            then (select count(*) from public.nppes_refresh_staging s where s.refresh_run_id = r.id)
            else (select count(*) from public.medicare_refresh_staging s where s.refresh_run_id = r.id) end as staged_now
  from public.refresh_runs r
 where r.status = 'staged'
 order by r.started_at desc;
