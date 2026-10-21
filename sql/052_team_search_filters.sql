-- BD Lead Prospector: Prospect search filters that use what the team knows.
-- MANUAL ONLY: review against the live schema before execution. The agent
-- never executes SQL against Supabase without being told to run this file.
-- Rerun-safe. Needs sql/049 (lead_comments, lead_tags), sql/050 (lead_intel) and sql/029 (call_taps).
--
-- New optional search filters (criteria keys, all off unless sent):
--   newSupplier          NPI registered within the last 2 years
--   establishedSupplier  NPI registered 15 or more years ago
--   untouched            nobody on the team has claimed it, called it, noted it or tagged it
--   tag                  has this team tag (sql/049)
--   objection            has this objection recorded in call intel (sql/050)
--
-- HOW: the existing filter builder, provider_filter_sql(jsonb), is renamed to provider_filter_sql_base and a thin
-- wrapper with the old name adds the clauses above to whatever the base returns. search_providers_v2 and the
-- search-insights functions call it by name, so they pick the filters up without being touched. A lookup by NPI,
-- phone or name is left exactly as the base builds it. With none of the new keys the wrapper returns the base's
-- text unchanged, so every search made before this file behaves as it did.
--
-- ROLLBACK (if ever needed):
--   drop function public.provider_filter_sql(jsonb);
--   alter function public.provider_filter_sql_base(jsonb) rename to provider_filter_sql;

begin;

do $do$
begin
  if to_regprocedure('public.provider_filter_sql_base(jsonb)') is null then
    alter function public.provider_filter_sql(jsonb) rename to provider_filter_sql_base;
  end if;
end
$do$;

create or replace function public.provider_filter_sql(p_criteria jsonb)
returns text
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $f$
declare
  v_base text := public.provider_filter_sql_base(p_criteria);
  v_j jsonb := coalesce(p_criteria, '{}'::jsonb);
  v_extra text[] := '{}';
  v_tag text := nullif(lower(btrim(coalesce(v_j->>'tag', ''))), '');
  v_obj text := nullif(lower(btrim(coalesce(v_j->>'objection', ''))), '');
begin
  -- A lookup by NPI, phone or name finds one business wherever it is: leave it exactly as the base builds it.
  if nullif(btrim(coalesce(v_j->>'npi', '')), '') is not null
     or length(right(regexp_replace(coalesce(v_j->>'phone', ''), '\D', '', 'g'), 10)) = 10
     or nullif(btrim(coalesce(v_j->>'q', '')), '') is not null then
    return v_base;
  end if;

  if coalesce((v_j->>'newSupplier')::boolean, false) then
    v_extra := array_append(v_extra, 'r.enumeration_date >= current_date - interval ''2 years''');
  end if;
  if coalesce((v_j->>'establishedSupplier')::boolean, false) then
    v_extra := array_append(v_extra, 'r.enumeration_date <= current_date - interval ''15 years''');
  end if;
  if coalesce((v_j->>'untouched')::boolean, false) then
    v_extra := array_append(v_extra,
      'not exists (select 1 from public.leads l where l.npi = r.npi and (l.claimed_by is not null or coalesce(l.is_disconnected, false) or lower(coalesce(l.status, ''new'')) <> ''new'' or nullif(btrim(coalesce(l.notes, '''')), '''') is not null))'
      || ' and not exists (select 1 from public.lead_comments c where c.npi = r.npi)'
      || ' and not exists (select 1 from public.lead_tags tg where tg.npi = r.npi)'
      || ' and not exists (select 1 from public.call_taps ct where ct.npi = r.npi)');
  end if;
  if v_tag is not null then
    v_extra := array_append(v_extra, format('exists (select 1 from public.lead_tags tg where tg.npi = r.npi and tg.tag = %L)', v_tag));
  end if;
  if v_obj is not null then
    v_extra := array_append(v_extra, format('exists (select 1 from public.lead_intel li where li.npi = r.npi and li.objection = %L)', v_obj));
  end if;

  if cardinality(v_extra) = 0 then
    return v_base;
  end if;
  return '(' || v_base || ') and ' || array_to_string(v_extra, ' and ');
end
$f$;

-- Same access as the original: only the service role (the Worker) may run them.
revoke all on function public.provider_filter_sql(jsonb) from public, anon, authenticated;
revoke all on function public.provider_filter_sql_base(jsonb) from public, anon, authenticated;
grant execute on function public.provider_filter_sql(jsonb) to service_role;
grant execute on function public.provider_filter_sql_base(jsonb) to service_role;

commit;

-- Verification (read-only): with the filters off the text is the base's; with one on it gains a clause.
-- select public.provider_filter_sql('{"states":["FL"]}') = public.provider_filter_sql_base('{"states":["FL"]}') as unchanged;
-- select public.provider_filter_sql('{"states":["FL"],"newSupplier":true}');
-- select total_count from public.search_providers_v2('{"states":["FL"],"activeMedicare":true,"includeCount":true}', 1, 0);  -- was 2752 before this file
