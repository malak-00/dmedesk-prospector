-- DME Desk Prospector: the Territory map ignores keyword-excluded providers.
-- MANUAL ONLY: review against the live schema before execution. The agent
-- never executes SQL against Supabase.
-- Run after 042 (needs npi_records.excluded_reason). Rerun-safe. Replaces ONLY
-- refresh_territory_code() and search_territory(), each 025's version plus one
-- "r.excluded_reason is null" line. No table, index or provider data changes.
--
-- Why: search, counts and quick picks already hide flagged providers because
-- they all go through provider_filter_sql() (sql/042). The Territory map does
-- not: it reads the territory_totals cache, which counted every active
-- organisation, and it subtracts claimed / disconnected leads from that cache.
-- Without this, the map would still show ~120k excluded providers, and a
-- disconnected lead that was flagged would be subtracted from a total that no
-- longer contains it.
--
-- The cache is rebuilt per specialty by the Worker, but only when older than a
-- week. The last statement marks every row stale (refreshed_at = epoch) so the
-- next map load recounts. Run this file again after apply_exclusion_keywords
-- has finished, so the recount sees the final flags.

begin;

create or replace function public.refresh_territory_code(p_code text)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_rows integer;
begin
  if nullif(btrim(coalesce(p_code, '')), '') is null then
    return 0;
  end if;

  delete from public.territory_totals where taxonomy_code = p_code;

  insert into public.territory_totals (state, taxonomy_code, total, refreshed_at)
  select upper(btrim(r.address_state)), p_code, count(*)::bigint, now()
    from public.npi_records r
   where r.taxonomy_code = p_code
     and r.deactivation_date is null
     and upper(coalesce(r.status, 'A')) in ('A', 'ACTIVE')
     and r.excluded_reason is null
     and coalesce(r.isorganization, r.enumerationtype = 'NPI-2', true)
     and nullif(btrim(coalesce(r.address_state, '')), '') is not null
   group by 1;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    insert into public.territory_totals (state, taxonomy_code, total, refreshed_at)
    values ('', p_code, 0, now());
  end if;
  return v_rows;
end
$fn$;

create or replace function public.search_territory(p_codes text[])
returns table (state text, taxonomy_code text, total bigint, unclaimed bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with taken as (
    select upper(btrim(r.address_state)) as st, r.taxonomy_code as code, count(*)::bigint as n
      from public.leads l
      join public.npi_records r on r.npi = l.npi
     where (l.claimed_by is not null or l.is_disconnected)
       and r.taxonomy_code = any (coalesce(p_codes, '{}'::text[]))
       and r.deactivation_date is null
       and upper(coalesce(r.status, 'A')) in ('A', 'ACTIVE')
       and r.excluded_reason is null
       and coalesce(r.isorganization, r.enumerationtype = 'NPI-2', true)
     group by 1, 2
  )
  select t.state::text,
         t.taxonomy_code::text,
         t.total,
         greatest(t.total - coalesce(k.n, 0), 0)::bigint
    from public.territory_totals t
    left join taken k on k.st = t.state and k.code = t.taxonomy_code
   where t.taxonomy_code = any (coalesce(p_codes, '{}'::text[]))
     and t.state <> ''
$$;

revoke all on function public.refresh_territory_code(text) from public, anon, authenticated;
revoke all on function public.search_territory(text[]) from public, anon, authenticated;
grant execute on function public.refresh_territory_code(text) to service_role;
grant execute on function public.search_territory(text[]) to service_role;

-- Derived cache only (a few thousand rows); marking it stale loses nothing.
update public.territory_totals set refreshed_at = 'epoch'::timestamptz;

commit;

-- Verification (read-only):
--   select pg_get_functiondef('public.refresh_territory_code(text)'::regprocedure) like '%excluded_reason%';  -- t
--   select pg_get_functiondef('public.search_territory(text[])'::regprocedure)     like '%excluded_reason%';  -- t
--   select public.territory_stale_codes(array['332B00000X'], 168);   -- returns the code until the map recounts it
