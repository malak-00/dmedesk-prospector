-- DME Desk Prospector: a single state / specialty is a plain equality, so the
-- state + specialty index can end a search page early.
-- MANUAL ONLY: review against the live schema before execution. The agent
-- never executes SQL against Supabase.
-- Run after 040. Rerun-safe. It only replaces ONE FUNCTION (provider_filter_sql):
-- no table or index is created, altered or written, and no data changes.
--
-- Why: with sql/040 in place a Florida DME page still read all 6,401 matching
-- rows and sorted them (5,900 buffers, a Sort node) because the filter was
-- written upper(btrim(state)) = any ('{FL}') and taxonomy_code = any ('{...}').
-- Written as = 'FL' and = '332B00000X' the same query returns the same rows in
-- index order and stops: measured 55 buffers / 0.26 ms for a first page of 80 and
-- 3,838 buffers / 7 ms for the page at offset 4000. Two or more states or
-- specialties still use = any (...), exactly as before. Every other filter in
-- the function is untouched.

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

commit;

-- Verification (read-only):
--   select public.provider_filter_sql('{"states":["FL"],"taxonomyCodes":["332B00000X"]}'::jsonb);
--   expect: ... upper(btrim(r.address_state)) = 'FL' and r.taxonomy_code = '332B00000X'
