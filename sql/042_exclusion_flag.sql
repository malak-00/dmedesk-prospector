-- DME Desk Prospector: hide providers matching the team's exclusion keywords,
-- without touching the NPPES-owned status / deactivation_date fields.
-- MANUAL ONLY: review against the live schema before execution. The agent
-- never executes SQL against Supabase.
-- Run after 041 (this file contains 041's provider_filter_sql plus ONE added
-- line). Rerun-safe. Plan: documentation/plans/exclusion_audit_and_filtering_plan.md.
--
-- What it does:
--   1. Adds npi_records.excluded_reason (text, null = shown). A nullable column
--      with no default is a catalog-only change: no table rewrite.
--   2. provider_filter_sql() adds "r.excluded_reason is null" with the other
--      active-provider conditions, so every search, count and page hides them.
--      "Include inactive" shows them again. A direct NPI lookup still finds them.
--   3. apply_exclusion_keywords(terms, dry_run, batch) sets / clears the flag.
--      It NEVER flags a provider that a rep currently holds (leads.claimed_by),
--      and it never changes status, deactivation_date, leads or any other table.
--      The default is a dry run that only counts.
--
-- Why a column and not status = 'X': status / deactivation_date come from NPPES,
-- feed change alerts and provider_field_history, and the monthly refresh would
-- overwrite them. The monthly refresh never writes excluded_reason, so the flag
-- survives it; re-run apply_exclusion_keywords after a refresh to catch renames.
--
-- Undo everything: select public.apply_exclusion_keywords('{}', false);  (clears all)

begin;

alter table public.npi_records add column if not exists excluded_reason text;

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
  v_years text;
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
    -- Providers the team's exclusion keywords removed (sql/042). Shown again by
    -- includeInactive, like deactivated ones, so they can still be reviewed.
    v_where := array_append(v_where, 'r.excluded_reason is null');
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
    -- One value is written as plain equality: the (state, specialty, npi) index
    -- then hands rows back already in NPI order and a page stops after its own rows.
    -- With = any('{...}') the planner reads every match and sorts them.
    if cardinality(v_terms) = 1 then
      v_where := array_append(v_where, format('upper(btrim(r.address_state)) = %L', v_terms[1]));
    else
      v_where := array_append(v_where, format('upper(btrim(r.address_state)) = any (%L::text[])', v_terms));
    end if;
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
    if cardinality(v_terms) = 1 then
      v_where := array_append(v_where, format('r.taxonomy_code = %L', v_terms[1]));
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
    -- Whole calendar years as plain date ranges, so idx_npi_records_lastupdated
    -- can serve them; to_char() on every row cannot. A value that is not a
    -- year matches nothing, as it did before.
    select string_agg(format('(r.lastupdated >= date ''%1$s-01-01'' and r.lastupdated < date ''%2$s-01-01'')', y, y::int + 1), ' or ')
      into v_years
      from unnest(v_terms) as y
     where y ~ '^(19|20)[0-9]{2}$';
    v_where := array_append(v_where, coalesce('(' || v_years || ')', 'false'));
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

revoke all on function public.provider_filter_sql(jsonb) from public, anon, authenticated;
grant execute on function public.provider_filter_sql(jsonb) to service_role;


create or replace function public.apply_exclusion_keywords(
  p_terms text[],
  p_dry_run boolean default true,
  p_batch integer default 20000
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_terms text[];
  v_patterns text[];
  v_to_exclude bigint;
  v_rep_held bigint;
  v_to_release bigint;
  v_excluded bigint := 0;
  v_released bigint := 0;
begin
  -- Same match rule as search: name ILIKE '%term%'. % and _ in a term are literal.
  select array_agg(distinct lower(btrim(t))) into v_terms
    from unnest(coalesce(p_terms, '{}')) t where btrim(t) <> '';
  v_terms := coalesce(v_terms, '{}');
  select array_agg('%' || replace(replace(t, '%', ''), '_', '') || '%') into v_patterns from unnest(v_terms) t;
  v_patterns := coalesce(v_patterns, '{}');

  select count(*) into v_to_release
    from public.npi_records r
   where r.excluded_reason is not null and not (r.excluded_reason = any (v_terms));

  select count(*) filter (where not exists (select 1 from public.leads l where l.npi = r.npi and l.claimed_by is not null)),
         count(*) filter (where exists (select 1 from public.leads l where l.npi = r.npi and l.claimed_by is not null))
    into v_to_exclude, v_rep_held
    from public.npi_records r
   where r.excluded_reason is null and r.name ilike any (v_patterns);

  if not p_dry_run then
    -- Terms dropped from the list release their providers.
    update public.npi_records r set excluded_reason = null
     where r.excluded_reason is not null and not (r.excluded_reason = any (v_terms));
    get diagnostics v_released = row_count;

    -- One batch per call: run again until remaining_to_exclude is 0.
    with pick as (
      select r.npi,
             (select t from unnest(v_terms) t where r.name ilike '%' || replace(replace(t, '%', ''), '_', '') || '%'
               order by length(t) desc, t limit 1) as term
        from public.npi_records r
       where r.excluded_reason is null
         and r.name ilike any (v_patterns)
         and not exists (select 1 from public.leads l where l.npi = r.npi and l.claimed_by is not null)
       limit greatest(coalesce(p_batch, 20000), 1)
    )
    update public.npi_records r set excluded_reason = pick.term
      from pick where r.npi = pick.npi;
    get diagnostics v_excluded = row_count;
  end if;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'to_exclude', v_to_exclude,
    'skipped_rep_held', v_rep_held,
    'to_release', v_to_release,
    'excluded_this_call', v_excluded,
    'released_this_call', v_released,
    'remaining_to_exclude', case when p_dry_run then v_to_exclude else greatest(v_to_exclude - v_excluded, 0) end
  );
end
$fn$;

revoke all on function public.apply_exclusion_keywords(text[], boolean, integer) from public, anon, authenticated;
grant execute on function public.apply_exclusion_keywords(text[], boolean, integer) to service_role;

commit;

-- Verification (read-only):
--   select column_name from information_schema.columns
--    where table_name = 'npi_records' and column_name = 'excluded_reason';
--   select public.provider_filter_sql('{"state":"FL"}'::jsonb);   -- contains r.excluded_reason is null
--   select public.apply_exclusion_keywords(array['hospital','pharmacy']);  -- dry run: counts only
--
-- Apply (only after reviewing the dry run; repeat until remaining_to_exclude = 0):
--   select public.apply_exclusion_keywords(array[ ...terms from scripts/nppes_ingest/exclude_keywords.txt... ], false);
