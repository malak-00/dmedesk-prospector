-- DME Desk Prospector: Medicare (CMS DMEPOS "by Supplier") refresh.
-- MANUAL ONLY: review against the live schema before execution.
-- Run after 001 and 007.
--
-- Loaded by: python -m nppes_ingest.medicare [--apply]
-- which pages the CMS data API into medicare_refresh_staging under one
-- refresh_runs row (source 'medicare'), then calls apply_medicare_refresh().
--
-- apply_medicare_refresh() in one transaction (the file is ~60k rows):
--   * only NPIs present in npi_records are applied (others are counted as
--     skipped) -- search joins this table to npi_records;
--   * new NPIs are inserted into npi_cms_enrichment with one
--     provider_field_history 'record_created' row;
--   * existing NPIs get one history row per field whose value changed, then
--     the row is updated (unchanged rows are left alone);
--   * a claimed lead whose total_claims fell by more than half gets a pending
--     'provider_data_changed' review event;
--   * an NPI missing from the new release is NOT cleared -- nothing is
--     inferred from omission;
--   * the same release content (checksum) is refused only when it has no
--     newly eligible providers to load (e.g. after an NPPES refresh added
--     NPIs it is accepted), unless refresh_runs.metadata.operator_override = 'true'.
-- CMS publishes this data once a year, so most monthly runs apply no changes.

begin;

create table if not exists public.medicare_refresh_staging (
  refresh_run_id uuid not null references public.refresh_runs(id) on delete cascade,
  npi text not null,
  total_claims numeric,
  total_services numeric,
  total_beneficiaries numeric,
  medicare_payment numeric,
  medicare_allowed numeric,
  created_at timestamptz not null default now(),
  primary key (refresh_run_id, npi)
);

alter table public.medicare_refresh_staging enable row level security;
revoke all on public.medicare_refresh_staging from anon, authenticated;

comment on table public.medicare_refresh_staging is
  'CMS DMEPOS by-Supplier rows awaiting apply_medicare_refresh(). Written by scripts/nppes_ingest/medicare.py.';

create or replace function public.apply_medicare_refresh(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.refresh_runs%rowtype;
  v_staged integer;
  v_field text;
  v_count integer;
  v_changed_fields integer := 0;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_alerts integer := 0;
begin
  select * into v_run from public.refresh_runs where id = p_run_id for update;
  if not found then raise exception 'refresh run % does not exist', p_run_id; end if;
  if v_run.source <> 'medicare' or v_run.status <> 'staged' or coalesce(v_run.metadata->>'staging_state', '') <> 'complete' then
    raise exception 'refresh run % must be a staged, complete Medicare run to apply', p_run_id;
  end if;

  select count(*) into v_staged from public.medicare_refresh_staging where refresh_run_id = p_run_id;
  if v_staged <> coalesce(v_run.row_count, -1) then
    raise exception 'refresh run % staging count changed (% staged, % recorded)', p_run_id, v_staged, v_run.row_count;
  end if;

  -- Identical content is only refused when it would add nothing: after an
  -- NPPES refresh adds providers, re-running the same Medicare release must
  -- still load their rows (re-applying unchanged rows records nothing).
  if exists (select 1 from public.refresh_runs x
              where x.id <> p_run_id and x.source = 'medicare' and x.status = 'applied'
                and x.metadata->>'content_checksum' = v_run.metadata->>'content_checksum')
     and not exists (select 1 from public.medicare_refresh_staging s
                      where s.refresh_run_id = p_run_id
                        and exists (select 1 from public.npi_records r where r.npi = s.npi)
                        and not exists (select 1 from public.npi_cms_enrichment e where e.npi = s.npi))
     and coalesce(v_run.metadata->>'operator_override', 'false') <> 'true' then
    raise exception 'this Medicare release (checksum %) was already applied and has no new providers to load; set metadata.operator_override to re-apply', v_run.metadata->>'content_checksum';
  end if;

  select count(*) into v_skipped
    from public.medicare_refresh_staging s
   where s.refresh_run_id = p_run_id
     and not exists (select 1 from public.npi_records r where r.npi = s.npi);

  -- Review alerts first, while the old values are still in place.
  insert into public.lead_ownership_events
    (lead_id, npi, group_id, event_type, reason, source, source_ref, requires_review, review_status, metadata)
  select l.id, l.npi, l.group_id, 'provider_data_changed',
         'Medicare claims fell by more than half in the latest CMS release',
         'medicare_refresh', p_run_id::text, true, 'pending',
         jsonb_build_object(
           'field', 'total_claims',
           'old_value', e.total_claims,
           'new_value', s.total_claims,
           'drop_percent', round((1 - s.total_claims / e.total_claims) * 100, 1),
           'owner_user_id', l.claimed_by,
           'refresh_run_id', p_run_id)
    from public.medicare_refresh_staging s
    join public.npi_cms_enrichment e on e.npi = s.npi
    join public.leads l on l.npi = s.npi and not l.is_disconnected and l.claimed_by is not null
   where s.refresh_run_id = p_run_id
     and e.total_claims > 0
     and s.total_claims is not null
     and s.total_claims < e.total_claims * 0.5
     and not exists (select 1 from public.lead_ownership_events x
                      where x.lead_id = l.id and x.event_type = 'provider_data_changed'
                        and x.source = 'medicare_refresh' and x.source_ref = p_run_id::text);
  get diagnostics v_alerts = row_count;

  -- History for changed fields on existing enrichment rows.
  foreach v_field in array array['total_claims', 'total_services', 'total_beneficiaries', 'medicare_payment', 'medicare_allowed']
  loop
    execute format(
      'insert into public.provider_field_history (npi, field_name, old_value, new_value, source, refresh_run_id)
       select s.npi, %L, to_jsonb(e.%I), to_jsonb(s.%I), ''medicare'', $1
         from public.medicare_refresh_staging s
         join public.npi_cms_enrichment e on e.npi = s.npi
        where s.refresh_run_id = $1 and e.%I is distinct from s.%I',
      v_field, v_field, v_field, v_field, v_field)
      using p_run_id;
    get diagnostics v_count = row_count;
    v_changed_fields := v_changed_fields + v_count;
  end loop;

  update public.npi_cms_enrichment e
     set total_claims = s.total_claims,
         total_services = s.total_services,
         total_beneficiaries = s.total_beneficiaries,
         medicare_payment = s.medicare_payment,
         medicare_allowed = s.medicare_allowed,
         fetched_at = now()
    from public.medicare_refresh_staging s
   where s.refresh_run_id = p_run_id and e.npi = s.npi
     and (e.total_claims is distinct from s.total_claims
       or e.total_services is distinct from s.total_services
       or e.total_beneficiaries is distinct from s.total_beneficiaries
       or e.medicare_payment is distinct from s.medicare_payment
       or e.medicare_allowed is distinct from s.medicare_allowed);
  get diagnostics v_updated = row_count;

  insert into public.provider_field_history (npi, field_name, old_value, new_value, source, refresh_run_id)
  select s.npi, 'record_created', null,
         jsonb_build_object('total_claims', s.total_claims, 'total_services', s.total_services,
                            'total_beneficiaries', s.total_beneficiaries, 'medicare_payment', s.medicare_payment,
                            'medicare_allowed', s.medicare_allowed),
         'medicare', p_run_id
    from public.medicare_refresh_staging s
   where s.refresh_run_id = p_run_id
     and exists (select 1 from public.npi_records r where r.npi = s.npi)
     and not exists (select 1 from public.npi_cms_enrichment e where e.npi = s.npi);

  insert into public.npi_cms_enrichment
    (npi, total_claims, total_services, total_beneficiaries, medicare_payment, medicare_allowed, fetched_at)
  select s.npi, s.total_claims, s.total_services, s.total_beneficiaries, s.medicare_payment, s.medicare_allowed, now()
    from public.medicare_refresh_staging s
   where s.refresh_run_id = p_run_id
     and exists (select 1 from public.npi_records r where r.npi = s.npi)
     and not exists (select 1 from public.npi_cms_enrichment e where e.npi = s.npi);
  get diagnostics v_inserted = row_count;

  update public.refresh_runs
     set status = 'applied', completed_at = now(),
         metadata = metadata || jsonb_build_object(
           'apply_state', 'applied', 'apply_finished_at', now(),
           'apply_inserted', v_inserted, 'apply_updated', v_updated,
           'apply_unchanged', v_staged - v_inserted - v_updated - v_skipped,
           'apply_skipped', v_skipped, 'apply_changed_fields', v_changed_fields,
           'apply_alerts', v_alerts)
   where id = p_run_id;

  return jsonb_build_object(
    'run_id', p_run_id, 'status', 'applied',
    'inserted', v_inserted, 'updated', v_updated,
    'unchanged', v_staged - v_inserted - v_updated - v_skipped,
    'skipped', v_skipped, 'changed_fields', v_changed_fields, 'alerts', v_alerts);
end $$;

revoke all on function public.apply_medicare_refresh(uuid) from public, anon, authenticated;
grant execute on function public.apply_medicare_refresh(uuid) to service_role;

commit;

-- Verification (read-only):
-- select count(*) from public.npi_cms_enrichment;
-- select id, status, row_count, metadata->>'dataset_id' dataset, metadata->>'apply_inserted' inserted,
--        metadata->>'apply_updated' updated, metadata->>'apply_skipped' skipped, metadata->>'apply_alerts' alerts
--   from public.refresh_runs where source = 'medicare' order by started_at desc limit 5;
-- select npi, metadata from public.lead_ownership_events
--  where source = 'medicare_refresh' and review_status = 'pending' order by created_at desc;
