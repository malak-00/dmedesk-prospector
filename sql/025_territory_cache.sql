-- BD Lead Prospector: make the Territory map load without timing out.
-- MANUAL ONLY: review against the live schema before execution. The agent
-- never executes SQL against Supabase.
-- Run after 021. Rerun-safe. Creates one small table (a few thousand rows,
-- well under 1 MB) and replaces search_territory(); nothing else is touched.
--
-- Why it timed out: search_territory() counted EVERY enabled specialty in one
-- statement. The state is not in the specialty index, so each of those providers
-- cost a visit to the table, and "is it claimed" was tested per row. On a Nano
-- instance that adds up to far longer than a request may take.
--
-- What changes:
--   * territory_totals keeps "how many active organizations of this specialty
--     are in this state". That only changes when NPPES is refreshed.
--   * refresh_territory_code(code) recounts ONE specialty (one short statement).
--     The Worker refreshes a few at a time, and only the ones that are missing
--     or older than a week.
--   * search_territory() now reads the small table and subtracts the claimed and
--     disconnected leads live (a few thousand rows joined by primary key), so
--     "unclaimed" is always current.
--
-- A specialty with no providers anywhere is stored as one marker row
-- (state = '') so it is not recounted every time.

begin;

create table if not exists public.territory_totals (
  state text not null,
  taxonomy_code text not null,
  total bigint not null default 0,
  refreshed_at timestamptz not null default now(),
  primary key (taxonomy_code, state)
);

-- Derived data for the service role only.
alter table public.territory_totals enable row level security;
revoke all on table public.territory_totals from public, anon, authenticated;

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

-- Which of these specialties still need counting (never counted, or older than p_max_age_hours).
create or replace function public.territory_stale_codes(p_codes text[], p_max_age_hours integer default 168)
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(c), '{}'::text[])
    from unnest(coalesce(p_codes, '{}'::text[])) as c
   where not exists (
     select 1 from public.territory_totals t
      where t.taxonomy_code = c
        and t.refreshed_at > now() - make_interval(hours => greatest(coalesce(p_max_age_hours, 168), 1)));
$$;

-- Same result shape as before: (state, taxonomy_code, total, unclaimed).
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
revoke all on function public.territory_stale_codes(text[], integer) from public, anon, authenticated;
revoke all on function public.search_territory(text[]) from public, anon, authenticated;
grant execute on function public.refresh_territory_code(text) to service_role;
grant execute on function public.territory_stale_codes(text[], integer) to service_role;
grant execute on function public.search_territory(text[]) to service_role;

commit;

-- Verification (read-only):
-- select public.territory_stale_codes(array['332B00000X'], 168);
-- Counting one specialty (writes the small table; run once per code, or let the app do it):
-- select public.refresh_territory_code('332B00000X');
-- select * from public.search_territory(array['332B00000X']) order by unclaimed desc limit 10;
