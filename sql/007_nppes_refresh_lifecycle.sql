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

begin;

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

commit;

-- Verification (read-only):
-- select * from public.nppes_apply_column_map();
-- select id, status, row_count, metadata->>'apply_state' apply_state,
--        metadata->>'apply_inserted' inserted, metadata->>'apply_updated' updated,
--        metadata->>'apply_unchanged' unchanged, metadata->>'apply_changed_fields' changed_fields,
--        metadata->>'apply_remaining' remaining
--   from public.refresh_runs where source = 'nppes' order by started_at desc limit 5;
-- select field_name, count(*) from public.provider_field_history
--  where refresh_run_id = '<run id>' group by 1 order by 2 desc;
