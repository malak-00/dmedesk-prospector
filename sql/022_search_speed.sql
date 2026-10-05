-- DME Desk Prospector: make the 021 search functions cheaper.
-- MANUAL ONLY: review against the live schema before execution. The agent
-- never executes SQL against Supabase.
-- Run after 021. Rerun-safe. Read-only: no table is created, altered or written.
--
-- Three changes, none of which alters what a search finds:
--
--   1. search_insights() now counts in ONE pass over the matching providers
--      instead of three. The "matched", "not yet claimed" and "left for you"
--      figures all come from the same scan. Because they now share one scan
--      capped at 5,000 matches, a search with more than 5,000 matches reports
--      all three as "5,000 or more" (the Worker marks them with a "+"): they
--      are lower bounds, not independent counts.
--   2. search_quick_counts() answers the four quick-pick counts in one call
--      instead of four separate round trips.
--   3. search_providers_v2() no longer looks up each row's specialty name in
--      SQL (taxonomy_description_for, once per row). The Worker already fills
--      in a missing specialty name for every result in one batched lookup
--      (companyService.attachTaxonomyDescriptionsSafe), so the per-row work
--      was pure repetition. search_providers() (018) is untouched.

begin;

create or replace function public.search_insights(
  p_criteria jsonb default '{}'::jsonb,
  p_seen text[] default '{}')
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_where text := public.provider_filter_sql(p_criteria);
  v_cap constant integer := 5000;
  v_seen text[] := coalesce(p_seen, '{}');
  v_out jsonb;
begin
  execute format($q$
    with m as (
      select r.npi,
             exists (select 1 from public.leads l
                      where l.npi = r.npi and (l.claimed_by is not null or l.is_disconnected)) as taken
        from public.npi_records r
        left join public.npi_cms_enrichment e on e.npi = r.npi
       where %1$s
       limit %2$s
    ), seen as (
      select unnest(%3$L::text[]) as npi
    )
    select jsonb_build_object(
      'matched',   (select count(*) from m),
      'unclaimed', (select count(*) from m where not taken),
      'left',      (select count(*) from m where not taken and m.npi not in (select npi from seen)),
      'cap',       %2$s)
  $q$, v_where, v_cap, v_seen) into v_out;
  return v_out;
end
$fn$;

-- p_picks: [{"id": "...", "criteria": { ...same keys as search_insights... }}, ...]
-- returns: [{"id": "...", "unclaimed": n, "capped": bool}, ...]
create or replace function public.search_quick_counts(p_picks jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_cap constant integer := 5000;
  v_pick jsonb;
  v_n bigint;
  v_out jsonb := '[]'::jsonb;
begin
  for v_pick in select * from jsonb_array_elements(coalesce(p_picks, '[]'::jsonb)) loop
    execute format($q$
      select count(*) from (
        select 1
          from public.npi_records r
          left join public.npi_cms_enrichment e on e.npi = r.npi
         where %1$s
           and not exists (select 1 from public.leads l
                            where l.npi = r.npi and (l.claimed_by is not null or l.is_disconnected))
         limit %2$s) c
    $q$, public.provider_filter_sql(coalesce(v_pick->'criteria', '{}'::jsonb)), v_cap) into v_n;
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_pick->>'id', 'unclaimed', v_n, 'capped', v_n >= v_cap));
  end loop;
  return v_out;
end
$fn$;

-- search_providers_v2(): identical to 021 except for the specialty name column.
create or replace function public.search_providers_v2(
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
  v_where text := public.provider_filter_sql(v_j);
  v_score text := public.provider_score_sql(v_j);
  v_sort text := lower(coalesce(v_j->>'sortBy', ''));
  v_k1 text := '0';
  v_k2 text := '0';
  v_kt text := 'null::text';
  v_count_cap constant integer := 5000;
begin
  if v_sort = 'score' then
    v_k1 := v_score;
    v_k2 := 'coalesce(e.total_claims, 0)';
  elsif v_sort = 'medicare' then
    v_k1 := 'coalesce(e.total_claims, 0)';
    v_k2 := v_score;
  elsif v_sort = 'updated' then
    v_k1 := 'coalesce(extract(epoch from r.lastupdated), 0)';
    v_k2 := v_score;
  elsif v_sort = 'name' then
    v_kt := 'r.name::text';
  end if;

  return query execute format($q$
    with counted as (
      select case when %5$L then (
        select count(*) from (
          select 1 from public.npi_records r
            left join public.npi_cms_enrichment e on e.npi = r.npi
           where %1$s limit %4$s) capped
      ) end as n
    ), matched as (
      select r.npi, (%6$s)::numeric as k1, (%7$s)::numeric as k2, (%8$s)::text as kt
        from public.npi_records r
        left join public.npi_cms_enrichment e on e.npi = r.npi
       where %1$s
       order by k1 desc, k2 desc, kt asc nulls last, r.npi
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
           c.n,
           coalesce(c.n >= %4$s, false)
      from matched m
      join public.npi_records r on r.npi = m.npi
      cross join counted c
      left join public.npi_cms_enrichment e on e.npi = r.npi
     order by m.k1 desc, m.k2 desc, m.kt asc nulls last, m.npi
  $q$, v_where, v_lim, v_skip, v_count_cap,
       coalesce((v_j->>'includeCount')::boolean, false),
       v_k1, v_k2, v_kt);
end
$fn$;

revoke all on function public.search_insights(jsonb, text[]) from public, anon, authenticated;
revoke all on function public.search_quick_counts(jsonb) from public, anon, authenticated;
revoke all on function public.search_providers_v2(jsonb, integer, integer) from public, anon, authenticated;
grant execute on function public.search_insights(jsonb, text[]) to service_role;
grant execute on function public.search_quick_counts(jsonb) to service_role;
grant execute on function public.search_providers_v2(jsonb, integer, integer) to service_role;

commit;

-- Verification (read-only):
-- select public.search_insights('{"states":["VA"]}'::jsonb, '{}');
-- select public.search_quick_counts('[{"id":"a","criteria":{"states":["VA"],"hasPhone":true}}]'::jsonb);
--
-- To see where a slow search spends its time, time the page query on its own,
-- twice (the second run is the warm one):
-- explain (analyze, buffers)
-- select npi from public.search_providers_v2('{"states":["VA"],"sortBy":"score","includeCount":false}'::jsonb, 200, 0);
