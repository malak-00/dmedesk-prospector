-- DME Desk Prospector: everything still to run, in one file.
--
-- MANUAL ONLY: review against the live schema before execution.
-- Generated from the three files below, unchanged apart from their own
-- begin/commit -- running them individually, in this order, does the same
-- thing. Keep doing that for anything added later; this file exists so the
-- backlog can be cleared in one paste.
--
--   sql/004_nppes_refresh_staging.sql
--     The staging table the ingest CLI writes into.
--   sql/007_nppes_refresh_lifecycle.sql
--     Recover/abort a staging run, and apply a staged run to npi_records in batches.
--   sql/015_provider_change_alerts.sql
--     Carry an applied release through to claimed leads, and alert their owners.
--
-- All three are wrapped in a single transaction: if anything fails, nothing
-- is applied and the error names the statement. Every file is rerun-safe on
-- its own, so re-running this one is safe too.
--
-- Paste the WHOLE file into the Supabase SQL Editor with nothing selected --
-- a partial selection cuts a dollar-quoted function body in half and fails
-- with "unterminated dollar-quoted string".
--
-- Verification queries are at the bottom. Run them after, and keep the
-- output with the run.

begin;

-- ========================================================================
-- sql/004_nppes_refresh_staging.sql
-- ========================================================================

-- DME Desk Prospector: NPPES refresh staging.
-- MANUAL ONLY: review against the live schema before execution.
--
-- Staging is deliberately separate from `npi_records`. A malformed,
-- truncated, or partial release must never be able to partially overwrite
-- the live provider source -- it lands here first, gets counted and
-- verified, and only then does a separate transactional apply step compare
-- canonical values, write `provider_field_history`, and update
-- `npi_records`.
--
-- Written by: scripts/nppes_ingest (see scripts/README.md).
-- Columns mirror that tool's staging row exactly; the names follow the
-- fakeNPI-compatible names already used by `npi_records` so the eventual
-- apply step is close to a 1:1 copy.

create table if not exists public.nppes_refresh_staging (
  refresh_run_id uuid not null references public.refresh_runs(id) on delete cascade,
  npi text not null,
  source_row_number integer,

  -- Identity
  name text,
  normalized_name text,
  enumerationtype text,
  isorganization boolean,
  status text,
  replacement_npi text,

  -- Practice location
  address_line1 text,
  address_line2 text,
  address_city text,
  address_state text,
  address_postal_code text,
  phone text,
  fax text,

  -- Taxonomy: the primary code plus every populated slot, so a later
  -- re-filter doesn't need the source file again.
  taxonomy_code text,
  taxonomy_codes text[] not null default '{}'::text[],

  -- Authorized official (a Tier 1 identity-grouping signal)
  authorizedofficial_firstname text,
  authorizedofficial_lastname text,
  authorizedofficial_title text,
  authorizedofficial_phone text,

  -- Dates
  enumeration_date date,
  lastupdated date,
  deactivation_date date,
  reactivation_date date,
  certification_date date,

  created_at timestamptz not null default now(),
  -- Set by apply_nppes_refresh_batch (sql/007) once this row is applied, so
  -- a large release is applied in resumable batches.
  applied_at timestamptz,

  -- One row per NPI per run. The ingestion CLI already rejects duplicate
  -- NPIs within a release; this makes that a database guarantee rather
  -- than a promise the loader keeps.
  primary key (refresh_run_id, npi)
);

create index if not exists idx_nppes_refresh_staging_npi
  on public.nppes_refresh_staging(npi);
create index if not exists idx_nppes_refresh_staging_run
  on public.nppes_refresh_staging(refresh_run_id);
-- Supports the apply step's "which NPIs in this run are already known"
-- join against npi_records.
create index if not exists idx_nppes_refresh_staging_run_state
  on public.nppes_refresh_staging(refresh_run_id, address_state);
-- Finds the next batch of not-yet-applied rows in a run.
create index if not exists idx_nppes_refresh_staging_unapplied
  on public.nppes_refresh_staging(refresh_run_id, npi) where applied_at is null;

comment on table public.nppes_refresh_staging is
  'Normalized NPPES release rows awaiting comparison/apply. Written by scripts/nppes_ingest; never read by the app at runtime.';
comment on column public.nppes_refresh_staging.status is
  'active | deactivated, derived from the deactivation/reactivation dates in the release.';
comment on column public.nppes_refresh_staging.phone is
  'First valid 10-digit number from the source cell, matching the identity-grouping phone rule.';

-- Same posture as the identity tables: the service-role Worker/CLI path is
-- the only intended access route; browser roles get nothing.
alter table public.nppes_refresh_staging enable row level security;
revoke all on public.nppes_refresh_staging from anon, authenticated;

-- Read-only verification. Run after every ingest; every count should be 0
-- except the last, which should match the manifest's staged_rows.
--
-- 1. Duplicate NPIs within a run (should be impossible -- the PK enforces it)
-- select refresh_run_id, npi, count(*)
--   from public.nppes_refresh_staging group by 1, 2 having count(*) > 1;
--
-- 2. Rows with an unusable NPI
-- select count(*) from public.nppes_refresh_staging
--   where npi !~ '^[0-9]{10}$';
--
-- 3. Staged rows not attached to a run
-- select count(*) from public.nppes_refresh_staging s
--   left join public.refresh_runs r on r.id = s.refresh_run_id
--   where r.id is null;
--
-- 4. Row count per run, newest first -- compare against the manifest
-- select r.id, r.source, r.source_version, r.status, r.row_count,
--        count(s.npi) as staged_rows, r.started_at
--   from public.refresh_runs r
--   left join public.nppes_refresh_staging s on s.refresh_run_id = r.id
--  where r.source = 'nppes'
--  group by r.id order by r.started_at desc limit 10;
--
-- 5. Apply preflight: only rows returned here are eligible for a future
--    staged-to-live apply procedure.
-- select r.id, r.status, r.row_count,
--        (r.metadata ->> 'staging_state') as staging_state,
--        (r.metadata ->> 'expected_staged_rows')::integer as expected_staged_rows,
--        (r.metadata ->> 'staged_rows')::integer as recorded_staged_rows,
--        count(s.npi) as actual_staged_rows
--   from public.refresh_runs r
--   left join public.nppes_refresh_staging s on s.refresh_run_id = r.id
--  where r.source = 'nppes'
--  group by r.id
--  having r.status = 'staged'
--     and r.metadata ->> 'staging_state' = 'complete'
--     and r.row_count = (r.metadata ->> 'expected_staged_rows')::integer
--     and (r.metadata ->> 'expected_staged_rows')::integer =
--         (r.metadata ->> 'staged_rows')::integer
--     and count(s.npi) = (r.metadata ->> 'staged_rows')::integer;

-- ========================================================================
-- sql/007_nppes_refresh_lifecycle.sql
-- ========================================================================

-- DME Desk Prospector: NPPES refresh lifecycle -- recover, abort, and a
-- batched, schema-adaptive apply of a staged release into npi_records.
-- MANUAL ONLY. Run after 004_nppes_refresh_staging.sql.
--
-- Driven by the ingest CLI:
--   python -m nppes_ingest --apply-run <refresh_run_id>
-- which calls apply_nppes_refresh_batch() until nothing is left, then
-- finish_nppes_apply(). Each batch is its own short transaction, so a full
-- release never hits a statement timeout, and an interrupted apply resumes
-- where it stopped (rows are marked applied_at as they go).
--
-- Schema-adaptive: only columns that exist in BOTH nppes_refresh_staging and
-- the live npi_records are written, cast to npi_records' own types.
-- address_postal_code also maps to address_postalcode when that is the live
-- spelling. Run `select * from public.nppes_apply_column_map();` to see the
-- exact mapping before applying anything.
--
-- Per batch:
--   * NPIs new to npi_records are inserted (never on a deactivation run) with
--     one provider_field_history row ('record_created').
--   * For NPIs already there, one provider_field_history row per field whose
--     value really changed. Values are compared in canonical form
--     (nppes_canonical_value), so formatting-only differences such as
--     "555-123-4567" vs "5551234567" or "A" vs "active" are not changes.
--   * Rows are updated only where a stored value differs; untouched rows
--     are counted as unchanged.
--   * A deactivation run only touches status and deactivation_date, and
--     never inserts. A monthly full file never deactivates anything by
--     omission.


-- Two columns the live npi_records doesn't have yet (checked 2026-09-16):
--   deactivation_date -- when NPPES deactivated the provider, not just status.
--   taxonomy_codes    -- every taxonomy code, so search can match secondary
--                        specialties. Existing rows start null and are filled
--                        by the next apply WITHOUT a history row (that first
--                        fill is not a provider change); later differences are
--                        recorded as usual.
alter table public.npi_records add column if not exists deactivation_date date;
alter table public.npi_records add column if not exists taxonomy_codes text[];

alter table public.nppes_refresh_staging
  add column if not exists applied_at timestamptz;
create index if not exists idx_nppes_refresh_staging_unapplied
  on public.nppes_refresh_staging(refresh_run_id, npi) where applied_at is null;

-- ---- recovery -----------------------------------------------------------------

create or replace function public.finalize_nppes_staging(p_run_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.refresh_runs%rowtype; actual integer; expected integer;
begin
  select * into r from public.refresh_runs where id=p_run_id for update;
  if not found then raise exception 'refresh run % does not exist', p_run_id; end if;
  if r.status <> 'staged' or coalesce(r.metadata->>'staging_state','') <> 'uploading' then
    raise exception 'refresh run % is not uploading', p_run_id;
  end if;
  expected := coalesce((r.metadata->>'expected_staged_rows')::integer, r.row_count, -1);
  select count(*) into actual from public.nppes_refresh_staging where refresh_run_id=p_run_id;
  if expected < 0 or actual <> expected then
    raise exception 'refresh run % count mismatch: expected %, actual %', p_run_id, expected, actual;
  end if;
  update public.refresh_runs set row_count=actual,
    completed_at=now(), metadata=metadata || jsonb_build_object('staging_state','complete','staged_rows',actual)
    where id=p_run_id;
  return jsonb_build_object('run_id',p_run_id,'status','complete','staged_rows',actual);
end $$;

create or replace function public.abort_nppes_refresh(p_run_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.refresh_runs%rowtype; removed integer;
begin
  if nullif(trim(p_reason),'') is null then raise exception 'abort reason is required'; end if;
  select * into r from public.refresh_runs where id=p_run_id for update;
  if not found then raise exception 'refresh run % does not exist', p_run_id; end if;
  if r.status not in ('staged','failed') or coalesce(r.metadata->>'staging_state','') = 'complete' then
    raise exception 'refresh run % cannot be aborted in status %', p_run_id, r.status;
  end if;
  delete from public.nppes_refresh_staging where refresh_run_id=p_run_id;
  get diagnostics removed = row_count;
  update public.refresh_runs set status='failed', completed_at=now(),
    metadata=metadata || jsonb_build_object('staging_state','failed','failure_reason',trim(p_reason),'aborted_rows',removed)
    where id=p_run_id;
  return jsonb_build_object('run_id',p_run_id,'status','failed','deleted_rows',removed);
end $$;

-- ---- apply --------------------------------------------------------------------

-- Canonical form used only to decide whether a value really changed.
create or replace function public.nppes_canonical_value(p_column text, p_value text)
returns text
language plpgsql immutable parallel safe
as $$
declare
  v text := btrim(coalesce(p_value, ''));
  digits text;
begin
  if v = '' or v = '{}' then
    return null;
  end if;
  if p_column ~ '(phone|fax)' then
    digits := regexp_replace(regexp_replace(v, '\.0+$', ''), '[^0-9]', '', 'g');
    return nullif(coalesce((regexp_match(digits, '^1?([0-9]{10})'))[1], digits), '');
  end if;
  if p_column ~ 'postal' then
    digits := regexp_replace(regexp_replace(v, '\.0+$', ''), '[^0-9]', '', 'g');
    -- The existing copy stored ZIPs as numbers somewhere along the way, so
    -- New England/NJ ZIPs lost their leading zero ("75062332" = 07506-2332).
    if length(digits) in (4, 8) then
      digits := '0' || digits;
    end if;
    return nullif(digits, '');
  end if;
  if p_column ~ '(date|lastupdated)' then
    if v ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then
      return left(v, 10);
    end if;
    if v ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' then
      return split_part(v, '/', 3) || '-' || lpad(split_part(v, '/', 1), 2, '0') || '-' || lpad(split_part(v, '/', 2), 2, '0');
    end if;
    return upper(v);
  end if;
  if p_column = 'status' then
    return case lower(v) when 'a' then 'active' when 'd' then 'deactivated' else lower(v) end;
  end if;
  if p_column = 'isorganization' then
    return case when lower(v) in ('true','t','y','yes','1') then 'true'
                when lower(v) in ('false','f','n','no','0') then 'false'
                else lower(v) end;
  end if;
  if p_column = 'taxonomy_codes' then
    return (select string_agg(code, ',' order by code)
              from unnest(string_to_array(regexp_replace(upper(v), '[{}" ]', '', 'g'), ',')) as code
             where code <> '');
  end if;
  return upper(regexp_replace(v, '\s+', ' ', 'g'));
end $$;

-- Which staging columns an apply would write, and into which npi_records
-- column/type. Read-only; run it to check the live schema before applying.
create or replace function public.nppes_apply_column_map()
returns table (staging_column text, target_column text, target_type text, on_deactivation_run boolean)
language sql stable
set search_path = public, pg_temp
as $$
  with staging as (
    select a.attname::text as col, a.attnum
      from pg_attribute a
     where a.attrelid = 'public.nppes_refresh_staging'::regclass
       and a.attnum > 0 and not a.attisdropped
       and a.attname not in ('refresh_run_id', 'source_row_number', 'created_at', 'applied_at')
  ), target as (
    select a.attname::text as col, format_type(a.atttypid, a.atttypmod) as typ
      from pg_attribute a
     where a.attrelid = 'public.npi_records'::regclass
       and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
  )
  select s.col,
         t.col,
         t.typ,
         s.col in ('npi', 'status', 'deactivation_date')
    from staging s
    join target t
      on t.col = s.col
      or (s.col = 'address_postal_code' and t.col = 'address_postalcode'
          and not exists (select 1 from target t2 where t2.col = 'address_postal_code'))
   order by s.attnum
$$;

-- Applies up to p_batch_size not-yet-applied staged rows of one run.
create or replace function public.apply_nppes_refresh_batch(p_run_id uuid, p_batch_size integer default 1000)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.refresh_runs%rowtype;
  v_deactivation boolean;
  v_batch text[];
  v_map record;
  v_target_cols text := '';
  v_select_cols text := '';
  v_set_list text := '';
  v_differs text := '';
  v_count integer;
  v_inserted integer := 0;
  v_skipped integer := 0;
  v_updated integer := 0;
  v_changed_fields integer := 0;
  v_remaining integer;
  v_staged integer;
begin
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 20000 then
    raise exception 'batch size must be between 1 and 20000';
  end if;

  select * into v_run from public.refresh_runs where id = p_run_id for update;
  if not found then raise exception 'refresh run % does not exist', p_run_id; end if;
  if v_run.source <> 'nppes' or v_run.status <> 'staged' or coalesce(v_run.metadata->>'staging_state', '') <> 'complete' then
    raise exception 'refresh run % must be a staged, complete NPPES run to apply', p_run_id;
  end if;

  if coalesce(v_run.metadata->>'apply_state', '') = '' then
    -- First batch: the preflight checks, then the run is marked applying.
    select count(*) into v_staged from public.nppes_refresh_staging where refresh_run_id = p_run_id;
    if v_staged <> coalesce(v_run.row_count, -1) then
      raise exception 'refresh run % staging count changed after finalization (% staged, % recorded)', p_run_id, v_staged, v_run.row_count;
    end if;
    if exists (select 1 from public.refresh_runs x
                where x.id <> p_run_id and x.source = 'nppes'
                  and x.metadata->>'source_checksum' = v_run.metadata->>'source_checksum'
                  and (x.status = 'applied' or coalesce(x.metadata->>'apply_state', '') = 'applying'))
       and coalesce(v_run.metadata->>'operator_override', 'false') <> 'true' then
      raise exception 'this source file (checksum %) was already applied; set metadata.operator_override to re-apply', v_run.metadata->>'source_checksum';
    end if;
    v_run.metadata := v_run.metadata || jsonb_build_object('apply_state', 'applying', 'apply_started_at', now(),
      'apply_inserted', 0, 'apply_updated', 0, 'apply_unchanged', 0, 'apply_skipped', 0, 'apply_changed_fields', 0);
  elsif v_run.metadata->>'apply_state' <> 'applying' then
    raise exception 'refresh run % is already %', p_run_id, v_run.metadata->>'apply_state';
  end if;

  v_deactivation := coalesce(v_run.metadata->>'run_type', '') = 'deactivation';

  select array_agg(npi order by npi) into v_batch
    from (select npi from public.nppes_refresh_staging
           where refresh_run_id = p_run_id and applied_at is null
           order by npi limit p_batch_size) b;

  if v_batch is not null then
    -- Column map for this run type.
    for v_map in
      select * from public.nppes_apply_column_map()
       where not v_deactivation or on_deactivation_run
    loop
      v_target_cols := v_target_cols || case when v_target_cols = '' then '' else ', ' end || quote_ident(v_map.target_column);
      v_select_cols := v_select_cols || case when v_select_cols = '' then '' else ', ' end
                       || format('s.%I::%s', v_map.staging_column, v_map.target_type);
      if v_map.staging_column <> 'npi' then
        v_set_list := v_set_list || case when v_set_list = '' then '' else ', ' end
                      || format('%I = s.%I::%s', v_map.target_column, v_map.staging_column, v_map.target_type);
        v_differs := v_differs || case when v_differs = '' then '' else ' or ' end
                     || format('r.%I::text is distinct from (s.%I::%s)::text', v_map.target_column, v_map.staging_column, v_map.target_type);

        -- History: one row per really-changed field on existing NPIs.
        execute format(
          'insert into public.provider_field_history (npi, field_name, old_value, new_value, source, refresh_run_id)
           select s.npi, %L, to_jsonb(r.%I), to_jsonb(s.%I::%s), ''nppes'', $1
             from public.nppes_refresh_staging s
             join public.npi_records r on r.npi = s.npi
            where s.refresh_run_id = $1 and s.npi = any ($2)
              and public.nppes_canonical_value(%L, r.%I::text)
                  is distinct from public.nppes_canonical_value(%L, (s.%I::%s)::text)%s',
          v_map.target_column, v_map.target_column, v_map.staging_column, v_map.target_type,
          v_map.staging_column, v_map.target_column, v_map.staging_column, v_map.staging_column, v_map.target_type,
          -- First fill of the newly added column is not a provider change.
          case when v_map.target_column = 'taxonomy_codes' then ' and r.taxonomy_codes is not null' else '' end)
          using p_run_id, v_batch;
        get diagnostics v_count = row_count;
        v_changed_fields := v_changed_fields + v_count;
      end if;
    end loop;

    if v_set_list = '' then
      raise exception 'no staging columns match npi_records -- check nppes_apply_column_map()';
    end if;

    -- Existing rows: update only where a stored value actually differs.
    execute format(
      'update public.npi_records r set %s
         from public.nppes_refresh_staging s
        where s.refresh_run_id = $1 and s.npi = any ($2) and r.npi = s.npi and (%s)',
      v_set_list, v_differs)
      using p_run_id, v_batch;
    get diagnostics v_updated = row_count;

    if v_deactivation then
      -- Never create a provider from a deactivation notice.
      select count(*) into v_skipped
        from public.nppes_refresh_staging s
       where s.refresh_run_id = p_run_id and s.npi = any (v_batch)
         and not exists (select 1 from public.npi_records r where r.npi = s.npi);
    else
      insert into public.provider_field_history (npi, field_name, old_value, new_value, source, refresh_run_id)
      select s.npi, 'record_created', null,
             to_jsonb(s) - 'refresh_run_id' - 'source_row_number' - 'created_at' - 'applied_at',
             'nppes', p_run_id
        from public.nppes_refresh_staging s
       where s.refresh_run_id = p_run_id and s.npi = any (v_batch)
         and not exists (select 1 from public.npi_records r where r.npi = s.npi);

      execute format(
        'insert into public.npi_records (%s)
         select %s from public.nppes_refresh_staging s
          where s.refresh_run_id = $1 and s.npi = any ($2)
            and not exists (select 1 from public.npi_records r where r.npi = s.npi)',
        v_target_cols, v_select_cols)
        using p_run_id, v_batch;
      get diagnostics v_inserted = row_count;
    end if;

    update public.nppes_refresh_staging set applied_at = now()
     where refresh_run_id = p_run_id and npi = any (v_batch);
  end if;

  select count(*) into v_remaining
    from public.nppes_refresh_staging where refresh_run_id = p_run_id and applied_at is null;

  update public.refresh_runs
     set metadata = v_run.metadata || jsonb_build_object(
           'apply_inserted', (v_run.metadata->>'apply_inserted')::integer + v_inserted,
           'apply_updated', (v_run.metadata->>'apply_updated')::integer + v_updated,
           'apply_unchanged', (v_run.metadata->>'apply_unchanged')::integer
                              + coalesce(array_length(v_batch, 1), 0) - v_inserted - v_updated - v_skipped,
           'apply_skipped', (v_run.metadata->>'apply_skipped')::integer + v_skipped,
           'apply_changed_fields', (v_run.metadata->>'apply_changed_fields')::integer + v_changed_fields,
           'apply_remaining', v_remaining)
   where id = p_run_id;

  return jsonb_build_object(
    'run_id', p_run_id,
    'processed', coalesce(array_length(v_batch, 1), 0),
    'inserted', v_inserted,
    'updated', v_updated,
    'unchanged', coalesce(array_length(v_batch, 1), 0) - v_inserted - v_updated - v_skipped,
    'skipped', v_skipped,
    'changed_fields', v_changed_fields,
    'remaining', v_remaining);
end $$;

-- Marks a fully applied run as applied.
create or replace function public.finish_nppes_apply(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.refresh_runs%rowtype;
  v_remaining integer;
begin
  select * into r from public.refresh_runs where id = p_run_id for update;
  if not found then raise exception 'refresh run % does not exist', p_run_id; end if;
  if coalesce(r.metadata->>'apply_state', '') <> 'applying' then
    raise exception 'refresh run % is not being applied (apply_state %)', p_run_id, coalesce(r.metadata->>'apply_state', 'none');
  end if;
  select count(*) into v_remaining
    from public.nppes_refresh_staging where refresh_run_id = p_run_id and applied_at is null;
  if v_remaining > 0 then
    raise exception 'refresh run % still has % unapplied rows', p_run_id, v_remaining;
  end if;

  update public.refresh_runs
     set status = 'applied', completed_at = now(),
         metadata = metadata || jsonb_build_object('apply_state', 'applied', 'apply_finished_at', now(), 'apply_remaining', 0)
   where id = p_run_id
  returning * into r;

  return jsonb_build_object(
    'run_id', p_run_id, 'status', 'applied',
    'inserted', (r.metadata->>'apply_inserted')::integer,
    'updated', (r.metadata->>'apply_updated')::integer,
    'unchanged', (r.metadata->>'apply_unchanged')::integer,
    'skipped', (r.metadata->>'apply_skipped')::integer,
    'changed_fields', (r.metadata->>'apply_changed_fields')::integer);
end $$;

-- ---- permissions ----------------------------------------------------------------

revoke all on function public.finalize_nppes_staging(uuid) from public, anon, authenticated;
revoke all on function public.abort_nppes_refresh(uuid, text) from public, anon, authenticated;
revoke all on function public.nppes_apply_column_map() from public, anon, authenticated;
revoke all on function public.apply_nppes_refresh_batch(uuid, integer) from public, anon, authenticated;
revoke all on function public.finish_nppes_apply(uuid) from public, anon, authenticated;
grant execute on function public.finalize_nppes_staging(uuid) to service_role;
grant execute on function public.abort_nppes_refresh(uuid, text) to service_role;
grant execute on function public.nppes_apply_column_map() to service_role;
grant execute on function public.apply_nppes_refresh_batch(uuid, integer) to service_role;
grant execute on function public.finish_nppes_apply(uuid) to service_role;

-- The single-transaction apply from the first draft of this file is replaced
-- by the batched functions above.
drop function if exists public.apply_nppes_refresh(uuid);


-- Verification (read-only):
-- select * from public.nppes_apply_column_map();
-- select id, status, row_count, metadata->>'apply_state' apply_state,
--        metadata->>'apply_inserted' inserted, metadata->>'apply_updated' updated,
--        metadata->>'apply_unchanged' unchanged, metadata->>'apply_changed_fields' changed_fields,
--        metadata->>'apply_remaining' remaining
--   from public.refresh_runs where source = 'nppes' order by started_at desc limit 5;
-- select field_name, count(*) from public.provider_field_history
--  where refresh_run_id = '<run id>' group by 1 order by 2 desc;

-- ========================================================================
-- sql/015_provider_change_alerts.sql
-- ========================================================================

-- DME Desk Prospector: what a monthly NPPES refresh means for claimed leads.
-- MANUAL ONLY: review against the live schema before execution.
-- Run after 007 (and 001). Safe to run before the first refresh.
--
-- 007 updates npi_records and records every changed field in
-- provider_field_history. It deliberately stops there: it never touches
-- leads. This file is the second half of a refresh --
-- apply_provider_changes_to_leads(run_id) --
--
--   * refreshes the provider-owned snapshot on active leads (company name,
--     phone, address, specialty, NPPES last-updated, and the contact only
--     when it came from NPPES). It never touches claimed_by, claimed_at,
--     status, notes, reminder_at or is_disconnected -- the rep's own work.
--   * raises one pending 'provider_data_changed' review event per claimed
--     lead whose provider changed in a way a rep has to know about: phone,
--     authorized official, organization name, city/state, status or
--     deactivation. Everything else stays in provider_field_history.
--   * flags the events where the identity keys themselves moved (name,
--     phone, official) with metadata.group_review, because the lead's group
--     may no longer be right. Groups are never re-cut silently: an admin
--     decides, the same way they decide a Tier 2/3 match.
--
-- Batched and resumable like the apply itself: each call takes the next
-- p_batch_size NPIs in NPI order and records how far it got on the run, so
-- an interrupted sync continues where it stopped and a finished one is a
-- no-op. Re-running it never raises the same alert twice.
--
-- It only ever looks at NPIs somebody holds a lead for -- a first load
-- records a history row for every provider in the release, and there is
-- nothing to do for the ones nobody has claimed.
--
-- It can be run long after the apply: an applied run whose lead_sync_state
-- is null (a release applied before this file existed) is brought up to date
-- by calling it, or by `python -m nppes_ingest --sync-run <run id>`.


-- Which lead column mirrors which npi_records column. Both sides are probed
-- against the live schema, because npi_records has gone through more than
-- one column spelling (address_postalcode vs address_postal_code) and a
-- lead column may simply not be there.
create or replace function public.nppes_lead_snapshot_map()
returns table (lead_column text, record_column text, lead_type text)
language sql
stable
set search_path = public, pg_temp
as $$
  with wanted (lead_column, candidates) as (
    values
      ('company_name', array['name']),
      ('phone', array['phone']),
      ('address_line1', array['address_line1']),
      ('city', array['address_city']),
      ('state', array['address_state']),
      ('postal_code', array['address_postal_code', 'address_postalcode']),
      ('specialty', array['taxonomy_description']),
      ('nppes_last_updated', array['lastupdated'])
  ), lead_cols as (
    select attname, format_type(atttypid, atttypmod) as coltype from pg_attribute
     where attrelid = 'public.leads'::regclass and attnum > 0 and not attisdropped
  ), record_cols as (
    select attname from pg_attribute
     where attrelid = 'public.npi_records'::regclass and attnum > 0 and not attisdropped
  )
  select w.lead_column,
         (select c from unnest(w.candidates) c where c in (select attname from record_cols) limit 1),
         (select lc.coltype from lead_cols lc where lc.attname = w.lead_column)
    from wanted w
   where w.lead_column in (select attname from lead_cols)
     and exists (select 1 from unnest(w.candidates) c where c in (select attname from record_cols))
$$;

-- The changes a rep is told about. Everything else is history only.
create or replace function public.nppes_escalating_fields()
returns text[]
language sql
immutable
as $$
  select array['name', 'phone', 'authorizedofficial_firstname', 'authorizedofficial_lastname',
               'authorizedofficial_title', 'authorizedofficial_phone', 'address_city', 'address_state',
               'status', 'deactivation_date', 'replacement_npi']
$$;

-- The subset that changes how a lead groups, so the group needs a look.
create or replace function public.nppes_regrouping_fields()
returns text[]
language sql
immutable
as $$
  select array['name', 'phone', 'authorizedofficial_firstname', 'authorizedofficial_lastname',
               'authorizedofficial_phone']
$$;

-- An admin's decision about an alert. It lives here rather than on the event
-- because lead_ownership_events is append-only -- the same reason identity
-- decisions have their own table (sql/009). The event records what NPPES
-- did; this records what we did about it.
create table if not exists public.provider_change_decisions (
  event_id uuid primary key references public.lead_ownership_events(id) on delete cascade,
  decision text not null check (decision in ('approved', 'dismissed')),
  note text,
  decided_by uuid not null references public.app_users(id),
  decided_at timestamptz not null default now()
);

create index if not exists idx_provider_change_decisions_decided_at
  on public.provider_change_decisions(decided_at desc);

alter table public.provider_change_decisions enable row level security;
revoke all on public.provider_change_decisions from anon, authenticated;

-- One alert per lead per refresh run, so a resumed or repeated sync can't
-- raise the same thing twice.
create unique index if not exists idx_lead_ownership_events_provider_change_once
  on public.lead_ownership_events (npi, source_ref)
  where event_type = 'provider_data_changed' and source = 'nppes_refresh';

create or replace function public.apply_provider_changes_to_leads(p_run_id uuid, p_batch_size integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.refresh_runs%rowtype;
  v_batch text[];
  v_map record;
  v_set_list text := '';
  v_updated integer := 0;
  v_alerts integer := 0;
  v_remaining integer;
  v_cursor text;
begin
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 20000 then
    raise exception 'batch size must be between 1 and 20000';
  end if;

  select * into v_run from public.refresh_runs where id = p_run_id for update;
  if not found then raise exception 'refresh run % does not exist', p_run_id; end if;
  if v_run.source <> 'nppes' then
    raise exception 'refresh run % is not an NPPES run', p_run_id;
  end if;
  -- npi_records has to be up to date first: the snapshot is copied from it.
  if coalesce(v_run.metadata->>'apply_state', '') <> 'applied' then
    raise exception 'refresh run % has not finished applying (apply_state %)',
      p_run_id, coalesce(v_run.metadata->>'apply_state', 'none');
  end if;

  v_cursor := coalesce(v_run.metadata->>'lead_sync_last_npi', '');

  -- Only NPIs somebody actually holds: a first load writes a
  -- 'record_created' history row for every provider in the release, and
  -- walking hundreds of thousands of them to touch nothing would take hours.
  -- Nothing here can affect an NPI without an active lead.
  select array_agg(npi order by npi) into v_batch
    from (select distinct h.npi from public.provider_field_history h
           where h.refresh_run_id = p_run_id
             and h.npi > v_cursor
             and exists (select 1 from public.leads l where l.npi = h.npi and not l.is_disconnected)
           order by h.npi limit p_batch_size) b;

  if v_batch is null then
    update public.refresh_runs
       set metadata = metadata || jsonb_build_object('lead_sync_state', 'complete', 'lead_sync_finished_at', now())
     where id = p_run_id;
    return jsonb_build_object('processed', 0, 'leads_updated', 0, 'alerts', 0, 'remaining', 0, 'done', true);
  end if;

  -- 1. The provider-owned snapshot, and nothing else.
  for v_map in select * from public.nppes_lead_snapshot_map()
  loop
    v_set_list := v_set_list || case when v_set_list = '' then '' else ', ' end
                  || format('%I = r.%I::text::%s', v_map.lead_column, v_map.record_column, v_map.lead_type);
  end loop;

  if v_set_list <> '' then
    execute format(
      'update public.leads l set %s
         from public.npi_records r
        where r.npi = l.npi and l.npi = any($1) and not l.is_disconnected', v_set_list)
      using v_batch;
    get diagnostics v_updated = row_count;
  end if;

  -- The scraped contact is someone the rep found; only an NPPES-sourced one
  -- is the authorized official and follows the release.
  update public.leads l
     set contact_name = nullif(btrim(concat_ws(' ', r.authorizedofficial_firstname, r.authorizedofficial_lastname)), ''),
         contact_title = r.authorizedofficial_title,
         contact_phone = r.authorizedofficial_phone
    from public.npi_records r
   where r.npi = l.npi
     and l.npi = any(v_batch)
     and not l.is_disconnected
     and l.contact_source = 'nppes';

  -- 2. Alerts, for claimed leads only: an unclaimed lead has nobody to tell.
  with changes as (
    select h.npi,
           jsonb_agg(jsonb_build_object('field', h.field_name, 'oldValue', h.old_value, 'newValue', h.new_value)
                     order by h.field_name) as fields,
           array_agg(distinct h.field_name) as field_names
      from public.provider_field_history h
     where h.refresh_run_id = p_run_id
       and h.npi = any(v_batch)
       and h.field_name = any(public.nppes_escalating_fields())
     group by h.npi
  )
  insert into public.lead_ownership_events
    (lead_id, npi, group_id, event_type, reason, source, source_ref, requires_review, review_status, metadata)
  select l.id, l.npi, l.group_id, 'provider_data_changed',
         'NPPES changed ' || array_to_string(c.field_names, ', ') || ' for a claimed lead',
         'nppes_refresh', p_run_id::text, true, 'pending',
         jsonb_build_object(
           'changes', c.fields,
           'fields', to_jsonb(c.field_names),
           'group_review', exists (select 1 from unnest(c.field_names) f
                                    where f = any(public.nppes_regrouping_fields())),
           'owner_user_id', l.claimed_by,
           'refresh_run_id', p_run_id)
    from changes c
    join public.leads l on l.npi = c.npi and not l.is_disconnected and l.claimed_by is not null
   where not exists (
     select 1 from public.lead_ownership_events e
      where e.npi = c.npi and e.source_ref = p_run_id::text
        and e.event_type = 'provider_data_changed' and e.source = 'nppes_refresh');
  get diagnostics v_alerts = row_count;

  v_cursor := v_batch[array_length(v_batch, 1)];
  select count(distinct h.npi) into v_remaining
    from public.provider_field_history h
   where h.refresh_run_id = p_run_id
     and h.npi > v_cursor
     and exists (select 1 from public.leads l where l.npi = h.npi and not l.is_disconnected);

  update public.refresh_runs
     set metadata = metadata || jsonb_build_object(
           'lead_sync_state', case when v_remaining = 0 then 'complete' else 'syncing' end,
           'lead_sync_last_npi', v_cursor,
           'lead_sync_alerts', coalesce((metadata->>'lead_sync_alerts')::integer, 0) + v_alerts,
           'lead_sync_leads_updated', coalesce((metadata->>'lead_sync_leads_updated')::integer, 0) + v_updated)
       || case when v_remaining = 0 then jsonb_build_object('lead_sync_finished_at', now()) else '{}'::jsonb end
   where id = p_run_id;

  return jsonb_build_object(
    'processed', array_length(v_batch, 1),
    'leads_updated', v_updated,
    'alerts', v_alerts,
    'remaining', v_remaining,
    'done', v_remaining = 0);
end;
$$;

-- What an admin sees: one row per pending provider change, newest first,
-- with the owner it affects and the lead as it stands now.
create or replace view public.provider_change_queue as
select e.id as event_id,
       e.npi,
       e.group_id,
       e.created_at,
       e.reason,
       e.metadata->'changes' as changes,
       coalesce((e.metadata->>'group_review')::boolean, false) as group_review,
       l.id as lead_id,
       l.company_name,
       l.city,
       l.state,
       l.status as lead_status,
       l.claimed_by as owner_user_id,
       u.display_name as owner_display_name,
       e.source_ref as refresh_run_id
  from public.lead_ownership_events e
  left join public.leads l on l.id = e.lead_id
  left join public.app_users u on u.id = l.claimed_by
 where e.event_type = 'provider_data_changed'
   and e.requires_review
   and e.review_status = 'pending'
   and not exists (select 1 from public.provider_change_decisions d where d.event_id = e.id)
 order by e.created_at desc;

-- Acknowledging a change is a decision, so it is recorded as one.
-- 'dismissed' means "seen, no action"; 'approved' means the admin acted on it
-- (reassigned, regrouped, released). The alert itself is never edited or
-- deleted -- it leaves the queue because a decision now exists beside it.
create or replace function public.resolve_provider_change(
  p_event_id uuid, p_reviewer_id uuid, p_decision text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.lead_ownership_events%rowtype;
  v_decision public.provider_change_decisions%rowtype;
begin
  if p_decision not in ('approved', 'dismissed') then
    raise exception 'decision must be approved or dismissed, not %', p_decision;
  end if;
  if not exists (select 1 from public.app_users where id = p_reviewer_id and is_admin) then
    raise exception 'user % is not an admin', p_reviewer_id;
  end if;

  select * into v_event from public.lead_ownership_events
   where id = p_event_id and event_type = 'provider_data_changed';
  if not found then raise exception 'provider change event % does not exist', p_event_id; end if;

  select * into v_decision from public.provider_change_decisions where event_id = p_event_id;
  if found then
    return jsonb_build_object('eventId', p_event_id, 'decision', v_decision.decision,
                             'decidedBy', v_decision.decided_by, 'alreadyDecided', true);
  end if;

  insert into public.provider_change_decisions (event_id, decision, note, decided_by)
  values (p_event_id, p_decision, nullif(btrim(coalesce(p_note, '')), ''), p_reviewer_id)
  on conflict (event_id) do nothing;

  select * into v_decision from public.provider_change_decisions where event_id = p_event_id;
  return jsonb_build_object('eventId', p_event_id, 'decision', v_decision.decision,
                            'decidedBy', v_decision.decided_by,
                            'alreadyDecided', v_decision.decided_by is distinct from p_reviewer_id);
end;
$$;

revoke all on function public.apply_provider_changes_to_leads(uuid, integer) from public, anon, authenticated;
grant execute on function public.apply_provider_changes_to_leads(uuid, integer) to service_role;
revoke all on function public.resolve_provider_change(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.resolve_provider_change(uuid, uuid, text, text) to service_role;
revoke all on public.provider_change_queue from public, anon, authenticated;
grant select on public.provider_change_queue to service_role;
grant select, insert on public.provider_change_decisions to service_role;


-- Verification (read-only):
-- select lead_column, record_column, lead_type from public.nppes_lead_snapshot_map();
-- select count(*) from public.provider_change_queue;
-- select decision, count(*) from public.provider_change_decisions group by decision;
-- select id, metadata->>'lead_sync_state' as sync, metadata->>'lead_sync_alerts' as alerts
--   from public.refresh_runs where source = 'nppes' order by started_at desc limit 5;

commit;

-- ---------------------------------------------------------------------------
-- Verification (read-only). Run these after the commit above.
-- ---------------------------------------------------------------------------

-- 1. Every function and view this file should have created.
select p.proname as object,
       pg_get_function_identity_arguments(p.oid) as arguments
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('finalize_nppes_staging', 'abort_nppes_refresh', 'nppes_canonical_value',
                     'nppes_apply_column_map', 'apply_nppes_refresh_batch', 'finish_nppes_apply',
                     'nppes_lead_snapshot_map', 'apply_provider_changes_to_leads', 'resolve_provider_change')
 order by p.proname;
--   -> 9 rows.

-- 2. The staging table and the admin queue.
select to_regclass('public.nppes_refresh_staging') as staging_table,
       to_regclass('public.provider_change_queue') as provider_change_queue,
       to_regclass('public.provider_change_decisions') as provider_change_decisions;
--   -> three non-null names.

-- 3. npi_records gained the two columns the refresh needs, and the lead
--    snapshot map resolved against the live column spellings.
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'npi_records'
   and column_name in ('deactivation_date', 'taxonomy_codes')
 order by column_name;
--   -> deactivation_date, taxonomy_codes.

select lead_column, record_column, lead_type from public.nppes_lead_snapshot_map() order by lead_column;
--   -> one row per lead column that will follow the release; record_column
--      must not be null on any row.

-- 4. Nothing was applied by installing this: no run changed state.
select id, source, status, metadata->>'apply_state' as apply_state,
       metadata->>'lead_sync_state' as lead_sync_state
  from public.refresh_runs order by started_at desc limit 5;
