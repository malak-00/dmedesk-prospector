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
-- Rerun-safe. Read-only: it writes nothing.

begin;

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

-- The filters searches actually combine: state and taxonomy first, since
-- every variant of every search carries them.
create index if not exists idx_npi_records_state_taxonomy
  on public.npi_records (address_state, taxonomy_code);
create index if not exists idx_npi_records_city
  on public.npi_records (address_city);
create index if not exists idx_npi_records_lastupdated
  on public.npi_records (lastupdated);

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
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with c as (
    select coalesce(p_criteria, '{}'::jsonb) as j,
           least(greatest(coalesce(p_limit, 20), 1), 200) as lim,
           greatest(coalesce(p_skip, 0), 0) as skp
  ), matched as (
    select r.npi, count(*) over () as total_count
      from public.npi_records r, c
     where case
       when nullif(btrim(coalesce(c.j->>'npi', '')), '') is not null
         then r.npi = btrim(c.j->>'npi')
       else
            (coalesce((c.j->>'includeIndividuals')::boolean, false)
             or coalesce(r.isorganization, r.enumerationtype = 'NPI-2', true))
        and (coalesce((c.j->>'includeInactive')::boolean, false)
             or (r.deactivation_date is null
                 and upper(coalesce(r.status, 'A')) in ('A', 'ACTIVE')))
        and (c.j->>'state' is null or upper(r.address_state) = upper(c.j->>'state'))
        and (c.j->>'city' is null or upper(r.address_city) = upper(c.j->>'city'))
        and (c.j->>'taxonomyCode' is null or r.taxonomy_code = c.j->>'taxonomyCode')
        and (c.j->>'taxonomyDescription' is null
             or r.taxonomy_description ilike '%' || (c.j->>'taxonomyDescription') || '%')
        and (c.j->>'organizationName' is null
             or r.name ilike replace(c.j->>'organizationName', '*', '%') || '%')
        and (c.j->'nameContains' is null
             or exists (select 1 from jsonb_array_elements_text(c.j->'nameContains') t(term)
                         where btrim(t.term) <> '' and r.name ilike '%' || t.term || '%'))
        and (c.j->'excludeKeywords' is null
             or not exists (select 1 from jsonb_array_elements_text(c.j->'excludeKeywords') t(term)
                             where btrim(t.term) <> '' and r.name ilike '%' || t.term || '%'))
        and (c.j->'lastUpdatedYears' is null
             or to_char(r.lastupdated, 'YYYY') in
                (select t.term from jsonb_array_elements_text(c.j->'lastUpdatedYears') t(term)))
     end
     -- NPI order is the only stable one here, and paging needs a stable one:
     -- the app walks a search with skip, and a row that moves between pages
     -- is a lead seen twice or never.
     order by r.npi
     limit (select lim from c) offset (select skp from c)
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
         r.taxonomy_description::text,
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
$$;

revoke all on function public.search_providers(jsonb, integer, integer) from public, anon, authenticated;
grant execute on function public.search_providers(jsonb, integer, integer) to service_role;

commit;

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
-- Did the name index get built?
-- select indexname from pg_indexes where tablename = 'npi_records' order by indexname;
