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

begin;

-- Name search is `ilike '%term%'`, which no b-tree can help with: without a
-- trigram index it reads every provider, which at this size is seconds.
--
-- The operator class has to be schema-qualified. Supabase installs pg_trgm
-- into its own `extensions` schema, and an unqualified `gin_trgm_ops`
-- resolves against search_path -- so the index creation fails there, which
-- is exactly how a name search ends up scanning 394k rows while everything
-- looks installed. Where the extension isn't available at all, search still
-- works; it is only slower.
do $$
declare
  v_schema text;
begin
  select n.nspname into v_schema
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pg_trgm';

  if v_schema is null and exists (select 1 from pg_available_extensions where name = 'pg_trgm') then
    execute 'create extension if not exists pg_trgm';
    select n.nspname into v_schema
      from pg_extension e join pg_namespace n on n.oid = e.extnamespace
     where e.extname = 'pg_trgm';
  end if;

  if v_schema is null then
    raise notice 'pg_trgm is not available here; name search will work without its index, slowly';
  else
    execute format(
      'create index if not exists idx_npi_records_name_trgm on public.npi_records using gin (name %I.gin_trgm_ops)',
      v_schema);
    raise notice 'name search index built with pg_trgm from schema %', v_schema;
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

-- Almost every search is "active organizations in this state / with this
-- specialty", and the expensive half of answering one is the exact match
-- count: it has to account for every matching provider, not just the fifty
-- on the page. These two carry the active-organization test in the index
-- predicate and the NPI in the index itself, so that count can be answered
-- from the index alone -- no heap visit per matching row, which is what
-- made a 24,000-match state search time out.
--
-- The predicates are written exactly as search_providers emits them; a
-- partial index is only usable when the planner can see that the query's
-- conditions imply the index's.
create index if not exists idx_npi_records_active_state
  on public.npi_records (upper(btrim(address_state)), npi)
  where deactivation_date is null
    and upper(coalesce(status, 'A')) in ('A', 'ACTIVE')
    and coalesce(isorganization, enumerationtype = 'NPI-2', true);

create index if not exists idx_npi_records_active_taxonomy
  on public.npi_records (taxonomy_code, npi)
  where deactivation_date is null
    and upper(coalesce(status, 'A')) in ('A', 'ACTIVE')
    and coalesce(isorganization, enumerationtype = 'NPI-2', true);

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

-- An exact total means accounting for every matching provider, not just the
-- fifty on the page -- 24,078 of them for a single state. That is the whole
-- cost of a search, it grows with the popularity of the search, and it is
-- the part a rep never actually reads: "24,078 matches" and "5,000+ matches"
-- lead to the same next action. Counting stops at the cap, so the work a
-- search can do is bounded no matter how big the table gets or how slow the
-- database is that day, and count_capped says when that happened.
--
-- The page itself is never capped: paging past 5,000 works exactly as before.

-- The result columns change below, which a create-or-replace can't do.
drop function if exists public.search_providers(jsonb, integer, integer);

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
--   includeCount         false skips the match count entirely (default true).
--                        A rep's search fans out into dozens of these and
--                        reads none of the counts -- it shows how many leads
--                        came back, not how many providers matched -- so the
--                        caller that doesn't need it shouldn't pay for it.
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
  total_count bigint,
  count_capped boolean)
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
  -- Above this many matches the total is reported as "this many or more".
  v_count_cap constant integer := 5000;
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
    with counted as (
      -- Stops after the cap: the planner pushes the limit into the scan, so
      -- a search over a 24,000-provider state reads 5,001 index entries.
      -- Skipped entirely when the caller said it doesn't need the number,
      -- which leaves a search as a fifty-row index scan and nothing else.
      select case when %5$L then (
        select count(*) from (select 1 from public.npi_records r where %1$s limit %4$s) capped
      ) end as n
    ), matched as (
      select r.npi
        from public.npi_records r
       where %1$s
       -- NPI order is the only stable one here, and paging needs a stable
       -- one: a row that moves between pages is a lead seen twice or never.
       order by r.npi
       limit %2$s offset %3$s
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
           c.n,
           coalesce(c.n >= %4$s, false)
      from matched m
      join public.npi_records r on r.npi = m.npi
      cross join counted c
      left join public.npi_cms_enrichment e on e.npi = r.npi
     order by r.npi
  $q$, coalesce(nullif(array_to_string(v_where, ' and '), ''), 'true'), v_lim, v_skip, v_count_cap,
       coalesce((v_j->>'includeCount')::boolean, true));
end
$fn$;

revoke all on function public.search_providers(jsonb, integer, integer) from public, anon, authenticated;
grant execute on function public.search_providers(jsonb, integer, integer) to service_role;
revoke all on function public.taxonomy_description_for(text) from public, anon, authenticated;
grant execute on function public.taxonomy_description_for(text) to service_role;

commit;

-- Verification (read-only):
-- select count(*) from public.search_providers('{"state":"VA"}'::jsonb, 5, 0);
--   -> 5 rows (or fewer if VA has fewer), each with the same total_count.
--      total_count stops at 5,000; count_capped is true when it did.
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
-- An index-only count needs the visibility map, which a bulk load leaves
-- unset. VACUUM cannot run inside a transaction, so run this once, on its
-- own, after the file above -- searches are markedly faster with it, and it
-- is worth repeating after each monthly refresh:
-- vacuum (analyze) public.npi_records;
--
-- Did the name index get built?
-- select indexname from pg_indexes where tablename = 'npi_records' order by indexname;
