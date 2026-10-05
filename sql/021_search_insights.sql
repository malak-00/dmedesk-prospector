-- DME Desk Prospector: search insights, quality filters and sorting.
-- MANUAL ONLY: review against the live schema before execution. The agent
-- never executes SQL against Supabase.
-- Run after 018 (it reads public.npi_records, public.npi_cms_enrichment,
-- public.taxonomies and public.leads). Rerun-safe. Everything here is
-- read-only: no table is created, altered or written.
--
-- What it adds, and why a new file rather than a change to 018:
--
--   search_features()      tells the app these functions exist, so the
--                          screen can hide what isn't installed instead of
--                          failing.
--   search_insights()      "412 match, 137 unclaimed, 96 left for you" for a
--                          set of filters, without fetching a single row.
--   search_territory()     unclaimed providers by state and specialty: the
--                          map of where the leads are.
--   search_providers_v2()  search_providers() plus the filters a rep asked
--                          for (has phone, has a decision maker, active
--                          Medicare biller, minimum fit score, ZIP) and
--                          sorting BEFORE paging, so page one is the best
--                          page. search_providers() itself is untouched and
--                          still answers every search that uses none of
--                          these, so nothing that works today can change.
--
-- The fit score is computed here from the same four facts the Worker's
-- lib/scoring.js uses (a phone, a complete address, an authorized official,
-- Medicare claims). The weights are passed in by the Worker (scoreWeights) so
-- they live in one place; the defaults below only apply if none are sent.
--
-- "Unclaimed" means no row in public.leads that is claimed or disconnected,
-- the same test the search itself uses. A teammate's identity-group
-- ownership (sql/010) is not counted, so "unclaimed" can read a little high.

begin;

-- ---------------------------------------------------------------------------
-- Shared pieces. Both build SQL text, with every value through %L, exactly as
-- search_providers() does, so each present filter stays a plain comparison the
-- planner can answer from an index.
-- ---------------------------------------------------------------------------

-- The fit-score expression over alias r (npi_records) and e (npi_cms_enrichment).
create or replace function public.provider_score_sql(p_criteria jsonb)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $fn$
declare
  v_w jsonb := coalesce(p_criteria->'scoreWeights', '{}'::jsonb);
  v_phone integer := coalesce(nullif(v_w->>'hasPhone', '')::integer, 25);
  v_addr integer := coalesce(nullif(v_w->>'completeAddress', '')::integer, 20);
  v_dm integer := coalesce(nullif(v_w->>'hasDecisionMaker', '')::integer, 30);
  v_med integer := coalesce(nullif(v_w->>'medicareActive', '')::integer, 25);
begin
  return format($s$(
      (case when nullif(btrim(coalesce(r.phone, '')), '') is not null then %1$s else 0 end)
    + (case when nullif(btrim(coalesce(r.address_line1, '')), '') is not null
             and nullif(btrim(coalesce(r.address_city, '')), '') is not null
             and nullif(btrim(coalesce(r.address_state, '')), '') is not null
             and nullif(btrim(coalesce(r.address_postalcode, '')), '') is not null then %2$s else 0 end)
    + (case when nullif(btrim(coalesce(r.authorizedofficial_lastname, '')), '') is not null then %3$s else 0 end)
    + (case when coalesce(e.total_claims, 0) > 0 then %4$s else 0 end)
  )$s$, v_phone, v_addr, v_dm, v_med);
end
$fn$;

-- The WHERE clause for a set of criteria. p_criteria keys, all optional:
--   npi                  exact NPI; every other filter is ignored (as in 018)
--   phone                10 digits; matches the company or official phone;
--                        other location/specialty filters are ignored
--   q                    free text: company name OR authorized official's name
--   state / states[]     exact, case-insensitive
--   city                 exact, case-insensitive
--   taxonomyCode / taxonomyCodes[]
--   organizationName     starts with
--   nameContains[]       any term matches the company name
--   excludeKeywords[]    drop a company whose name contains any term
--   lastUpdatedYears[]   'YYYY'
--   hasPhone, hasDecisionMaker, activeMedicare   booleans
--   minMedicareClaims    number
--   minScore             0-100 (percent), needs scoreWeights to be exact
--   zip                  digits, 3 to 5; matches the start of the postal code
--   includeInactive, includeIndividuals          as in 018
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
  v_min_score integer := nullif(v_j->>'minScore', '')::integer;
  v_w jsonb := coalesce(v_j->'scoreWeights', '{}'::jsonb);
  v_max integer;
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
  if v_min_score is not null and v_min_score > 0 then
    -- minScore is a percentage of the best possible score.
    v_max := coalesce(nullif(v_w->>'hasPhone', '')::integer, 25) + coalesce(nullif(v_w->>'completeAddress', '')::integer, 20)
           + coalesce(nullif(v_w->>'hasDecisionMaker', '')::integer, 30) + coalesce(nullif(v_w->>'medicareActive', '')::integer, 25);
    v_where := array_append(v_where, format('%s * 100 >= %s * %L::integer',
      public.provider_score_sql(v_j), v_max, least(v_min_score, 100)));
  end if;

  return coalesce(nullif(array_to_string(v_where, ' and '), ''), 'true');
end
$fn$;

-- ---------------------------------------------------------------------------
-- Which of these functions are installed.
-- ---------------------------------------------------------------------------
create or replace function public.search_features()
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$ select jsonb_build_object('version', 1, 'insights', true, 'territory', true, 'search', true) $$;

-- ---------------------------------------------------------------------------
-- How many leads a set of filters holds, and how many are left for this rep.
-- p_seen is the NPIs this rep has already been shown for this exact search.
-- Each count stops at the cap, as search_providers()'s does, so the work is
-- bounded however broad the filters are.
-- ---------------------------------------------------------------------------
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
    select jsonb_build_object(
      'matched', (select count(*) from (
          select 1 from public.npi_records r
            left join public.npi_cms_enrichment e on e.npi = r.npi
           where %1$s limit %2$s) a),
      'unclaimed', (select count(*) from (
          select 1 from public.npi_records r
            left join public.npi_cms_enrichment e on e.npi = r.npi
           where %1$s
             and not exists (select 1 from public.leads l
                              where l.npi = r.npi and (l.claimed_by is not null or l.is_disconnected))
           limit %2$s) b),
      'left', (select count(*) from (
          select 1 from public.npi_records r
            left join public.npi_cms_enrichment e on e.npi = r.npi
           where %1$s
             and not exists (select 1 from public.leads l
                              where l.npi = r.npi and (l.claimed_by is not null or l.is_disconnected))
             and r.npi not in (select unnest(%3$L::text[]))
           limit %2$s) c),
      'cap', %2$s)
  $q$, v_where, v_cap, v_seen) into v_out;
  return v_out;
end
$fn$;

-- ---------------------------------------------------------------------------
-- Unclaimed providers by state and specialty, for the specialties given.
-- ---------------------------------------------------------------------------
create or replace function public.search_territory(p_codes text[])
returns table (state text, taxonomy_code text, total bigint, unclaimed bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with taken as (
    select l.npi from public.leads l where l.claimed_by is not null or l.is_disconnected
  )
  select upper(btrim(r.address_state))::text as state,
         r.taxonomy_code::text,
         count(*)::bigint as total,
         (count(*) filter (where r.npi not in (select npi from taken)))::bigint as unclaimed
    from public.npi_records r
   where r.taxonomy_code = any (coalesce(p_codes, '{}'::text[]))
     and r.deactivation_date is null
     and upper(coalesce(r.status, 'A')) in ('A', 'ACTIVE')
     and coalesce(r.isorganization, r.enumerationtype = 'NPI-2', true)
     and nullif(btrim(coalesce(r.address_state, '')), '') is not null
   group by 1, 2
$$;

-- ---------------------------------------------------------------------------
-- search_providers() with the extra filters and a sort that happens BEFORE
-- paging. Same result columns as search_providers(), so the Worker reads both
-- the same way. sortBy: score | medicare | updated | name; anything else is
-- NPI order, exactly as 018.
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
  -- Ties always fall back to NPI so a page boundary never moves.

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
     order by m.k1 desc, m.k2 desc, m.kt asc nulls last, m.npi
  $q$, v_where, v_lim, v_skip, v_count_cap,
       coalesce((v_j->>'includeCount')::boolean, false),
       v_k1, v_k2, v_kt);
end
$fn$;

revoke all on function public.provider_score_sql(jsonb) from public, anon, authenticated;
revoke all on function public.provider_filter_sql(jsonb) from public, anon, authenticated;
revoke all on function public.search_features() from public, anon, authenticated;
revoke all on function public.search_insights(jsonb, text[]) from public, anon, authenticated;
revoke all on function public.search_territory(text[]) from public, anon, authenticated;
revoke all on function public.search_providers_v2(jsonb, integer, integer) from public, anon, authenticated;
grant execute on function public.provider_score_sql(jsonb) to service_role;
grant execute on function public.provider_filter_sql(jsonb) to service_role;
grant execute on function public.search_features() to service_role;
grant execute on function public.search_insights(jsonb, text[]) to service_role;
grant execute on function public.search_territory(text[]) to service_role;
grant execute on function public.search_providers_v2(jsonb, integer, integer) to service_role;

commit;

-- Verification (read-only):
-- select public.search_features();
-- select public.search_insights('{"states":["VA"]}'::jsonb, '{}');
--   -> {"matched": n, "unclaimed": n, "left": n, "cap": 5000}; each stops at 5,000.
-- select npi, name, total_count from public.search_providers_v2(
--   '{"states":["VA"],"sortBy":"score","hasPhone":true}'::jsonb, 5, 0);
--   -> five rows, best fit score first.
-- select * from public.search_territory(array(select code from public.taxonomies limit 3)) limit 10;
