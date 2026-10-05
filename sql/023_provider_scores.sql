-- DME Desk Prospector: a stored fit score, so "best fit first" does not have to
-- score every provider in a state on every search.
-- MANUAL ONLY: review against the live schema before execution. The agent
-- never executes SQL against Supabase.
-- Run after 022. Rerun-safe. It creates two small tables, indexes, triggers and
-- functions; it never writes to npi_records, npi_cms_enrichment or leads.
--
-- WHY. A sorted search (the default, "best fit first") computes each matching
-- provider's score from npi_records and npi_cms_enrichment and then keeps the
-- top 200. For a 8,000-provider state that means reading 8,000 wide rows
-- (npi_records is ~180 MB) on every search. On a small database machine that is
-- the difference between 0.2 s when the data is in memory and several seconds
-- when it is not.
--
-- WHAT. public.provider_scores holds one narrow row per ACTIVE ORGANIZATION
-- with only what a sorted search needs: state, city, specialty code, ZIP, the
-- last-updated year, has-phone, has-decision-maker, Medicare claims and the
-- score itself. An index ordered by score turns "top 200 in Virginia" into
-- reading about 200 index entries.
--
-- IT NEVER SERVES A STALE ANSWER. The stored rows are used only when ALL of
-- these hold, and otherwise the search runs exactly as before (sql/021/022):
--   * the table is marked fresh (a statement-level trigger on npi_records and
--     npi_cms_enrichment marks it stale the moment either table changes);
--   * it was built with the same score weights the search is asking for;
--   * the search uses only filters the narrow table can answer exactly:
--     states, city, specialty, last-updated years, ZIP, minimum score, has a
--     phone, has a decision maker, active Medicare biller, minimum Medicare
--     claims. Company-name text, exclude keywords, owner-name, phone and NPI
--     lookups, and inactive/individual providers use the live path;
--   * the sort is "score".
-- The score is computed by the same SQL expression the live search uses
-- (provider_score_sql), so the two paths cannot disagree.
--
-- AFTER EACH MONTHLY DATA LOAD run:   select public.refresh_provider_scores();
-- Until you do, searches are simply back to the live (slower) path.
-- If one call is too long for the SQL editor, rebuild by state, then mark fresh:
--   select public.refresh_provider_scores(null, array['VA','NY']);   -- repeat for other groups
--   select public.finish_provider_scores_refresh();

begin;

-- ---------------------------------------------------------------------------
-- The narrow table, and the one-row freshness record.
-- ---------------------------------------------------------------------------
create table if not exists public.provider_scores (
  npi           text primary key,
  state_u       text,
  city_u        text,
  taxonomy_code text,
  zip_digits    text,
  updated_year  text,
  has_phone     boolean not null default false,
  has_dm        boolean not null default false,
  claims_n      numeric not null default 0,
  score         smallint not null default 0
);

create index if not exists idx_provider_scores_state_tax_score
  on public.provider_scores (state_u, taxonomy_code, score desc, claims_n desc, npi);
create index if not exists idx_provider_scores_state_score
  on public.provider_scores (state_u, score desc, claims_n desc, npi);
create index if not exists idx_provider_scores_tax_score
  on public.provider_scores (taxonomy_code, score desc, claims_n desc, npi);

create table if not exists public.provider_scores_state (
  id          integer primary key check (id = 1),
  stale       boolean not null default true,
  stale_since timestamptz default now(),
  built_at    timestamptz,
  weights     jsonb,
  row_count   bigint
);
insert into public.provider_scores_state (id) values (1) on conflict (id) do nothing;

-- Nothing here is for the browser: no one reads these through the API.
alter table public.provider_scores enable row level security;
alter table public.provider_scores_state enable row level security;
revoke all on public.provider_scores from public, anon, authenticated;
revoke all on public.provider_scores_state from public, anon, authenticated;
grant select, insert, update, delete on public.provider_scores to service_role;
grant select, insert, update, delete on public.provider_scores_state to service_role;

-- ---------------------------------------------------------------------------
-- Staleness: one cheap update per STATEMENT, and at most one per second.
-- ---------------------------------------------------------------------------
create or replace function public.provider_scores_mark_stale()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Stamped at most once a second, so a bulk load does not hammer one row, yet
  -- a change that lands while a rebuild is running is still seen (the rebuild
  -- only marks itself fresh if nothing changed since it started).
  update public.provider_scores_state
     set stale = true, stale_since = now()
   where id = 1 and (not stale or stale_since is null or stale_since < now() - interval '1 second');
  return null;
end $$;

drop trigger if exists provider_scores_stale_npi on public.npi_records;
create trigger provider_scores_stale_npi
  after insert or update or delete on public.npi_records
  for each statement execute function public.provider_scores_mark_stale();
drop trigger if exists provider_scores_stale_npi_truncate on public.npi_records;
create trigger provider_scores_stale_npi_truncate
  after truncate on public.npi_records
  for each statement execute function public.provider_scores_mark_stale();

drop trigger if exists provider_scores_stale_cms on public.npi_cms_enrichment;
create trigger provider_scores_stale_cms
  after insert or update or delete on public.npi_cms_enrichment
  for each statement execute function public.provider_scores_mark_stale();
drop trigger if exists provider_scores_stale_cms_truncate on public.npi_cms_enrichment;
create trigger provider_scores_stale_cms_truncate
  after truncate on public.npi_cms_enrichment
  for each statement execute function public.provider_scores_mark_stale();

-- ---------------------------------------------------------------------------
-- The score weights, normalised the way provider_score_sql defaults them.
-- ---------------------------------------------------------------------------
create or replace function public.provider_score_weights(p_criteria jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'hasPhone',         coalesce(nullif(p_criteria->'scoreWeights'->>'hasPhone', '')::integer, 25),
    'completeAddress',  coalesce(nullif(p_criteria->'scoreWeights'->>'completeAddress', '')::integer, 20),
    'hasDecisionMaker', coalesce(nullif(p_criteria->'scoreWeights'->>'hasDecisionMaker', '')::integer, 30),
    'medicareActive',   coalesce(nullif(p_criteria->'scoreWeights'->>'medicareActive', '')::integer, 25))
$$;

-- ---------------------------------------------------------------------------
-- Rebuild. Upserts every active organization with a freshly computed score and
-- removes rows that no longer qualify. With p_states it rebuilds only those
-- states and leaves the table marked stale until finish_provider_scores_refresh().
-- ---------------------------------------------------------------------------
create or replace function public.refresh_provider_scores(
  p_weights jsonb default null,
  p_states text[] default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_w jsonb := public.provider_score_weights(jsonb_build_object('scoreWeights', coalesce(p_weights, '{}'::jsonb)));
  v_score text := public.provider_score_sql(jsonb_build_object('scoreWeights', v_w));
  v_states text[];
  v_rows bigint;
  v_removed bigint := 0;
  v_started timestamptz := now();   -- transaction start: anything stamped after this changed the data mid-rebuild
  v_fresh boolean := false;
begin
  if p_states is not null then
    select array_agg(distinct upper(btrim(x))) into v_states from unnest(p_states) x where btrim(x) <> '';
  end if;

  -- The score expression is the live search's own (alias r = npi_records,
  -- e = npi_cms_enrichment), so stored and live scores cannot drift apart.
  execute format($q$
    insert into public.provider_scores as s
      (npi, state_u, city_u, taxonomy_code, zip_digits, updated_year, has_phone, has_dm, claims_n, score)
    select r.npi,
           upper(btrim(r.address_state)),
           upper(btrim(r.address_city)),
           r.taxonomy_code,
           regexp_replace(coalesce(r.address_postalcode, ''), '\D', '', 'g'),
           to_char(r.lastupdated, 'YYYY'),
           nullif(btrim(coalesce(r.phone, '')), '') is not null,
           nullif(btrim(coalesce(r.authorizedofficial_lastname, '')), '') is not null,
           coalesce(e.total_claims, 0),
           (%1$s)::smallint
      from public.npi_records r
      left join public.npi_cms_enrichment e on e.npi = r.npi
     where coalesce(r.isorganization, r.enumerationtype = 'NPI-2', true)
       and r.deactivation_date is null
       and upper(coalesce(r.status, 'A')) in ('A', 'ACTIVE')
       and (%2$L::text[] is null or upper(btrim(r.address_state)) = any (%2$L::text[]))
    on conflict (npi) do update set
      state_u = excluded.state_u, city_u = excluded.city_u, taxonomy_code = excluded.taxonomy_code,
      zip_digits = excluded.zip_digits, updated_year = excluded.updated_year, has_phone = excluded.has_phone,
      has_dm = excluded.has_dm, claims_n = excluded.claims_n, score = excluded.score
  $q$, v_score, v_states);
  get diagnostics v_rows = row_count;

  -- Providers that were deactivated, reclassified or removed since the last build.
  delete from public.provider_scores s
   where (v_states is null or s.state_u = any (v_states))
     and not exists (
       select 1 from public.npi_records r
        where r.npi = s.npi
          and coalesce(r.isorganization, r.enumerationtype = 'NPI-2', true)
          and r.deactivation_date is null
          and upper(coalesce(r.status, 'A')) in ('A', 'ACTIVE'));
  get diagnostics v_removed = row_count;

  update public.provider_scores_state set weights = v_w where id = 1;
  if p_states is null then
    v_fresh := coalesce((public.finish_provider_scores_refresh(v_started)->>'fresh')::boolean, false);
  end if;

  return jsonb_build_object('upserted', v_rows, 'removed', v_removed, 'full', p_states is null, 'fresh', v_fresh);
end
$fn$;

-- Marks the table fresh. A full refresh calls it with its own start time and
-- stays stale if provider or Medicare data changed while it was running. After
-- rebuilding by state, call it yourself with no argument.
create or replace function public.finish_provider_scores_refresh(p_started timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows bigint;
  v_fresh boolean;
begin
  select count(*) into v_rows from public.provider_scores;
  update public.provider_scores_state
     set stale = false, built_at = now(), row_count = v_rows
   where id = 1 and (p_started is null or stale_since is null or stale_since <= p_started);
  v_fresh := found;
  execute 'analyze public.provider_scores';
  return jsonb_build_object('fresh', v_fresh, 'rows', v_rows);
end $$;

-- ---------------------------------------------------------------------------
-- WHERE clause over provider_scores (alias s) for criteria the narrow table
-- can answer EXACTLY, or NULL when it cannot (the caller then runs the live
-- search). Each clause mirrors provider_filter_sql's.
-- ---------------------------------------------------------------------------
create or replace function public.provider_scores_filter_sql(p_criteria jsonb)
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
  v_zip text := regexp_replace(coalesce(v_j->>'zip', ''), '\D', '', 'g');
  v_min_score integer := nullif(v_j->>'minScore', '')::integer;
  v_w jsonb := public.provider_score_weights(v_j);
  v_max integer;
begin
  -- Filters only the full table can answer.
  if nullif(btrim(coalesce(v_j->>'npi', '')), '') is not null then return null; end if;
  if nullif(btrim(coalesce(v_j->>'phone', '')), '') is not null then return null; end if;
  if nullif(btrim(coalesce(v_j->>'q', '')), '') is not null then return null; end if;
  if nullif(btrim(coalesce(v_j->>'organizationName', '')), '') is not null then return null; end if;
  if coalesce((v_j->>'includeInactive')::boolean, false) or coalesce((v_j->>'includeIndividuals')::boolean, false) then return null; end if;
  if exists (select 1 from jsonb_array_elements_text(coalesce(v_j->'nameContains', '[]'::jsonb)) t where btrim(t) <> '') then return null; end if;
  if exists (select 1 from jsonb_array_elements_text(coalesce(v_j->'excludeKeywords', '[]'::jsonb)) t where btrim(t) <> '') then return null; end if;

  select array_agg(distinct upper(btrim(t.term)))
    into v_terms
    from (
      select jsonb_array_elements_text(coalesce(v_j->'states', '[]'::jsonb)) as term
      union all
      select nullif(btrim(coalesce(v_j->>'state', '')), '')
    ) t
   where t.term is not null and btrim(t.term) <> '';
  -- One value is written as a plain "=", because only that lets the planner
  -- read the score-ordered index in order and stop after the first page; the
  -- "= any (array)" form makes it fetch every match and sort them.
  if v_terms is not null and cardinality(v_terms) = 1 then
    v_where := array_append(v_where, format('s.state_u = %L', v_terms[1]));
  elsif v_terms is not null and cardinality(v_terms) > 1 then
    v_where := array_append(v_where, format('s.state_u = any (%L::text[])', v_terms));
  end if;

  if nullif(btrim(coalesce(v_j->>'city', '')), '') is not null then
    v_where := array_append(v_where, format('s.city_u = %L', upper(btrim(v_j->>'city'))));
  end if;

  select array_agg(distinct btrim(t.term))
    into v_terms
    from (
      select jsonb_array_elements_text(coalesce(v_j->'taxonomyCodes', '[]'::jsonb)) as term
      union all
      select nullif(btrim(coalesce(v_j->>'taxonomyCode', '')), '')
    ) t
   where t.term is not null and btrim(t.term) <> '';
  if v_terms is not null and cardinality(v_terms) = 1 then
    v_where := array_append(v_where, format('s.taxonomy_code = %L', v_terms[1]));
  elsif v_terms is not null and cardinality(v_terms) > 1 then
    v_where := array_append(v_where, format('s.taxonomy_code = any (%L::text[])', v_terms));
  end if;

  select array_agg(btrim(t.term))
    into v_terms
    from jsonb_array_elements_text(coalesce(v_j->'lastUpdatedYears', '[]'::jsonb)) t(term)
   where btrim(t.term) <> '';
  if v_terms is not null and cardinality(v_terms) > 0 then
    v_where := array_append(v_where, format('s.updated_year = any (%L::text[])', v_terms));
  end if;

  if coalesce((v_j->>'hasPhone')::boolean, false) then v_where := array_append(v_where, 's.has_phone'); end if;
  if coalesce((v_j->>'hasDecisionMaker')::boolean, false) then v_where := array_append(v_where, 's.has_dm'); end if;
  if coalesce((v_j->>'activeMedicare')::boolean, false) then v_where := array_append(v_where, 's.claims_n > 0'); end if;
  if nullif(v_j->>'minMedicareClaims', '') is not null then
    v_where := array_append(v_where, format('s.claims_n >= %L::numeric', v_j->>'minMedicareClaims'));
  end if;
  if length(v_zip) between 3 and 5 then
    v_where := array_append(v_where, format('left(s.zip_digits, %s) = %L', length(v_zip), v_zip));
  end if;
  if v_min_score is not null and v_min_score > 0 then
    v_max := (v_w->>'hasPhone')::integer + (v_w->>'completeAddress')::integer
           + (v_w->>'hasDecisionMaker')::integer + (v_w->>'medicareActive')::integer;
    v_where := array_append(v_where, format('s.score * 100 >= %s * %L::integer', v_max, least(v_min_score, 100)));
  end if;

  return coalesce(nullif(array_to_string(v_where, ' and '), ''), 'true');
end
$fn$;

-- May this search be answered from the stored scores?
create or replace function public.provider_scores_usable(p_criteria jsonb)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select lower(coalesce(p_criteria->>'sortBy', '')) = 'score'
     and not coalesce((p_criteria->>'forceLive')::boolean, false)
     and coalesce((select not st.stale and st.weights = public.provider_score_weights(p_criteria)
                     from public.provider_scores_state st where st.id = 1), false)
     and public.provider_scores_filter_sql(p_criteria) is not null
$$;

-- For the app: is the stored score fresh, and when was it built?
create or replace function public.search_score_index_status()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select jsonb_build_object('fresh', not st.stale, 'builtAt', st.built_at, 'staleSince', st.stale_since, 'rows', st.row_count)
                     from public.provider_scores_state st where st.id = 1),
                  jsonb_build_object('fresh', false))
$$;

-- ---------------------------------------------------------------------------
-- search_providers_v2(): sql/022's, plus the stored-score path for a sorted
-- search it can answer exactly. Result columns are unchanged.
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
  v_count boolean := coalesce((v_j->>'includeCount')::boolean, false);
  v_count_cap constant integer := 5000;
  v_sort text := lower(coalesce(v_j->>'sortBy', ''));
  v_counted text;
  v_matched text;
  v_where text;
  v_score text;
  v_k1 text := '0';
  v_k2 text := '0';
  v_kt text := 'null::text';
  v_narrow text;
begin
  if public.provider_scores_usable(v_j) then
    -- The stored scores answer this exactly: top-N straight from the narrow
    -- table's score-ordered index, then the full rows for just those N.
    v_narrow := public.provider_scores_filter_sql(v_j);
    v_counted := format($c$select case when %1$L then (
        select count(*) from (select 1 from public.provider_scores s where %2$s limit %3$s) capped) end as n$c$,
      v_count, v_narrow, v_count_cap);
    v_matched := format($m$select s.npi, s.score::numeric as k1, s.claims_n as k2, null::text as kt
        from public.provider_scores s
       where %1$s
       order by s.score desc, s.claims_n desc, s.npi
       limit %2$s offset %3$s$m$, v_narrow, v_lim, v_skip);
  else
    v_where := public.provider_filter_sql(v_j);
    v_score := public.provider_score_sql(v_j);
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
    v_counted := format($c$select case when %1$L then (
        select count(*) from (
          select 1 from public.npi_records r
            left join public.npi_cms_enrichment e on e.npi = r.npi
           where %2$s limit %3$s) capped) end as n$c$,
      v_count, v_where, v_count_cap);
    v_matched := format($m$select r.npi, (%1$s)::numeric as k1, (%2$s)::numeric as k2, (%3$s)::text as kt
        from public.npi_records r
        left join public.npi_cms_enrichment e on e.npi = r.npi
       where %4$s
       order by k1 desc, k2 desc, kt asc nulls last, r.npi
       limit %5$s offset %6$s$m$, v_k1, v_k2, v_kt, v_where, v_lim, v_skip);
  end if;

  return query execute format($q$
    with counted as (%1$s), matched as (%2$s)
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
           coalesce(c.n >= %3$s, false)
      from matched m
      join public.npi_records r on r.npi = m.npi
      cross join counted c
      left join public.npi_cms_enrichment e on e.npi = r.npi
     order by m.k1 desc, m.k2 desc, m.kt asc nulls last, m.npi
  $q$, v_counted, v_matched, v_count_cap);
end
$fn$;

revoke all on function public.provider_score_weights(jsonb) from public, anon, authenticated;
revoke all on function public.refresh_provider_scores(jsonb, text[]) from public, anon, authenticated;
revoke all on function public.finish_provider_scores_refresh(timestamptz) from public, anon, authenticated;
revoke all on function public.provider_scores_filter_sql(jsonb) from public, anon, authenticated;
revoke all on function public.provider_scores_usable(jsonb) from public, anon, authenticated;
revoke all on function public.search_score_index_status() from public, anon, authenticated;
revoke all on function public.provider_scores_mark_stale() from public, anon, authenticated;
revoke all on function public.search_providers_v2(jsonb, integer, integer) from public, anon, authenticated;
grant execute on function public.provider_score_weights(jsonb) to service_role;
grant execute on function public.refresh_provider_scores(jsonb, text[]) to service_role;
grant execute on function public.finish_provider_scores_refresh(timestamptz) to service_role;
grant execute on function public.provider_scores_filter_sql(jsonb) to service_role;
grant execute on function public.provider_scores_usable(jsonb) to service_role;
grant execute on function public.search_score_index_status() to service_role;
grant execute on function public.search_providers_v2(jsonb, integer, integer) to service_role;

commit;

-- Next step (run once, then after every monthly data load):
-- select public.refresh_provider_scores();
--
-- Verification (read-only):
-- select public.search_score_index_status();                  -- {"fresh": true, "rows": ...}
-- select public.provider_scores_usable('{"states":["VA"],"sortBy":"score"}'::jsonb);   -- true when fresh
-- explain analyze select npi from public.search_providers_v2(
--   '{"states":["VA"],"sortBy":"score","includeCount":false}'::jsonb, 200, 0);        -- milliseconds, warm or cold
--
-- Prove the stored path gives the same answer as the live one (the two lists must match):
-- select (select array_agg(npi) from public.search_providers_v2('{"states":["VA"],"sortBy":"score"}'::jsonb, 50, 0))
--      = (select array_agg(npi) from public.search_providers_v2('{"states":["VA"],"sortBy":"score","forceLive":true}'::jsonb, 50, 0)) as same;
