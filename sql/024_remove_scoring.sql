-- DME Desk Prospector: remove fit scoring from search.
-- MANUAL ONLY: review against the live schema before execution. The agent
-- never executes SQL against Supabase.
-- Run after 021 and 022. Rerun-safe. It only replaces and drops FUNCTIONS: no
-- table is created, altered or written, and no data changes.
--
-- Leads are no longer scored, so search no longer computes, filters or sorts by a
-- "fit score". This file:
--
--   * replaces provider_filter_sql() with the same function minus the
--     minimum-score filter (every other filter is untouched);
--   * replaces search_providers_v2() with a version that has no score: the
--     default order is NPI order (an index scan, fast on a small database), and
--     sortBy accepts medicare (most claims first), updated (most recently
--     updated first) and name (A to Z). Anything else, including the old
--     "score", falls back to NPI order, so an old browser tab cannot break search;
--   * drops provider_score_sql(), which nothing refers to any more.
--
-- The score_value and score_percentage columns on public.leads are LEFT IN
-- PLACE with their old data (dropping a column cannot be undone); nothing reads
-- or writes them any more.
--
-- search_insights(), search_quick_counts(), search_territory() and
-- search_features() are unchanged: they only call provider_filter_sql().

begin;

create or replace function public.provider_filter_sql(p_criteria jsonb)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_j jsonb := coalesce(p_criteria, '{}'::jsonb);
  v_where text[] := '{}';
  v_terms text[];
  v_npi text := nullif(btrim(coalesce(v_j->>'npi', '')), '');
  v_phone text := right(regexp_replace(coalesce(v_j->>'phone', ''), '\D', '', 'g'), 10);
  v_q text := nullif(btrim(coalesce(v_j->>'q', '')), '');
  v_zip text := regexp_replace(coalesce(v_j->>'zip', ''), '\D', '', 'g');
begin
  if v_npi is not null then
    return format('r.npi = %L', v_npi);
  end if;

  if not coalesce((v_j->>'includeIndividuals')::boolean, false) then
    v_where := array_append(v_where, 'coalesce(r.isorganization, r.enumerationtype = ''NPI-2'', true)');
  end if;
  if not coalesce((v_j->>'includeInactive')::boolean, false) then
    v_where := array_append(v_where, 'r.deactivation_date is null');
    v_where := array_append(v_where, 'upper(coalesce(r.status, ''A'')) in (''A'', ''ACTIVE'')');
  end if;

  -- A phone number finds one business wherever it is, like an NPI does.
  if length(v_phone) = 10 then
    v_where := array_append(v_where, format(
      '(right(regexp_replace(coalesce(r.phone, ''''), ''\D'', '''', ''g''), 10) = %1$L or right(regexp_replace(coalesce(r.authorizedofficial_phone, ''''), ''\D'', '''', ''g''), 10) = %1$L)', v_phone));
    return array_to_string(v_where, ' and ');
  end if;

  -- Free text finds a business by its name or by its owner's name, anywhere.
  if v_q is not null then
    v_where := array_append(v_where, format(
      '(r.name ilike %1$L or (coalesce(r.authorizedofficial_firstname, '''') || '' '' || coalesce(r.authorizedofficial_lastname, '''')) ilike %1$L)',
      '%' || replace(replace(v_q, '%', ''), '_', '') || '%'));
    return array_to_string(v_where, ' and ');
  end if;

  select array_agg(distinct upper(btrim(t.term)))
    into v_terms
    from (
      select jsonb_array_elements_text(coalesce(v_j->'states', '[]'::jsonb)) as term
      union all
      select nullif(btrim(coalesce(v_j->>'state', '')), '')
    ) t
   where t.term is not null and btrim(t.term) <> '';
  if v_terms is not null and cardinality(v_terms) > 0 then
    v_where := array_append(v_where, format('upper(btrim(r.address_state)) = any (%L::text[])', v_terms));
  end if;

  if nullif(btrim(coalesce(v_j->>'city', '')), '') is not null then
    v_where := array_append(v_where, format('upper(btrim(r.address_city)) = %L', upper(btrim(v_j->>'city'))));
  end if;

  select array_agg(distinct btrim(t.term))
    into v_terms
    from (
      select jsonb_array_elements_text(coalesce(v_j->'taxonomyCodes', '[]'::jsonb)) as term
      union all
      select nullif(btrim(coalesce(v_j->>'taxonomyCode', '')), '')
    ) t
   where t.term is not null and btrim(t.term) <> '';
  if v_terms is not null and cardinality(v_terms) > 0 then
    v_where := array_append(v_where, format('r.taxonomy_code = any (%L::text[])', v_terms));
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

  -- Quality filters.
  if coalesce((v_j->>'hasPhone')::boolean, false) then
    v_where := array_append(v_where, 'nullif(btrim(coalesce(r.phone, '''')), '''') is not null');
  end if;
  if coalesce((v_j->>'hasDecisionMaker')::boolean, false) then
    v_where := array_append(v_where, 'nullif(btrim(coalesce(r.authorizedofficial_lastname, '''')), '''') is not null');
  end if;
  if coalesce((v_j->>'activeMedicare')::boolean, false) then
    v_where := array_append(v_where, 'coalesce(e.total_claims, 0) > 0');
  end if;
  if nullif(v_j->>'minMedicareClaims', '') is not null then
    v_where := array_append(v_where, format('coalesce(e.total_claims, 0) >= %L::numeric', v_j->>'minMedicareClaims'));
  end if;
  if length(v_zip) between 3 and 5 then
    v_where := array_append(v_where, format(
      'left(regexp_replace(coalesce(r.address_postalcode, ''''), ''\D'', '''', ''g''), %s) = %L', length(v_zip), v_zip));
  end if;

  return coalesce(nullif(array_to_string(v_where, ' and '), ''), 'true');
end
$fn$;

-- ---------------------------------------------------------------------------
-- search_providers_v2() without scoring. Same result columns as before.
-- ---------------------------------------------------------------------------
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
  v_sort text := lower(coalesce(v_j->>'sortBy', ''));
  v_k1 text := '0';
  v_kt text := 'null::text';
  v_inner text := 'r.npi';
  v_outer text := 'm.npi';
  v_count_cap constant integer := 5000;
begin
  -- Ties always fall back to NPI, so a page boundary never moves. With no sort
  -- the order is plain NPI order, which the active-state index can serve
  -- without reading every match.
  if v_sort = 'medicare' then
    v_k1 := 'coalesce(e.total_claims, 0)';
    v_inner := 'k1 desc, r.npi';
    v_outer := 'm.k1 desc, m.npi';
  elsif v_sort = 'updated' then
    v_k1 := 'coalesce(extract(epoch from r.lastupdated), 0)';
    v_inner := 'k1 desc, r.npi';
    v_outer := 'm.k1 desc, m.npi';
  elsif v_sort = 'name' then
    v_kt := 'r.name::text';
    v_inner := 'kt asc nulls last, r.npi';
    v_outer := 'm.kt asc nulls last, m.npi';
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
      select r.npi, (%6$s)::numeric as k1, (%7$s)::text as kt
        from public.npi_records r
        left join public.npi_cms_enrichment e on e.npi = r.npi
       where %1$s
       order by %8$s
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
     order by %9$s
  $q$, v_where, v_lim, v_skip, v_count_cap,
       coalesce((v_j->>'includeCount')::boolean, false),
       v_k1, v_kt, v_inner, v_outer);
end
$fn$;

-- Nothing refers to the score expression any more.
drop function if exists public.provider_score_sql(jsonb);

revoke all on function public.provider_filter_sql(jsonb) from public, anon, authenticated;
revoke all on function public.search_providers_v2(jsonb, integer, integer) from public, anon, authenticated;
grant execute on function public.provider_filter_sql(jsonb) to service_role;
grant execute on function public.search_providers_v2(jsonb, integer, integer) to service_role;

commit;

-- Verification (read-only):
-- select npi, name from public.search_providers_v2('{"states":["VA"],"includeCount":false}'::jsonb, 5, 0);
--   -> five rows in NPI order.
-- select npi, medicare_total_claims from public.search_providers_v2('{"states":["VA"],"sortBy":"medicare","includeCount":false}'::jsonb, 5, 0);
--   -> five rows, most Medicare claims first.
-- select to_regprocedure('public.provider_score_sql(jsonb)');   -- null: the score function is gone
