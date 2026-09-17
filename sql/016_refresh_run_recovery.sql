-- DME Desk Prospector: closing out a refresh run that can't go anywhere.
-- MANUAL ONLY: review against the live schema before execution.
-- Run after 007 and 012.
--
-- A Medicare run was left at status 'staged' with staging_state 'complete'
-- and row_count 60,060, while public.medicare_refresh_staging held none of
-- its rows: the loader's rollback deleted the rows and then failed to mark
-- the run failed, so what was left looks applyable and isn't. Applying it
-- fails with "staging count changed (0 staged, 60060 recorded)", which is
-- the right refusal -- but there was no way to close the run out, because
-- Medicare had no abort at all and abort_nppes_refresh refuses a run whose
-- staging_state is 'complete'.
--
--   1. abort_medicare_refresh(run, reason) -- the Medicare twin of
--      abort_nppes_refresh: deletes whatever staging is left and marks the
--      run failed, with the reason recorded on it.
--   2. abort_nppes_refresh(run, reason) -- same function, one rule relaxed:
--      a 'complete' run can now be aborted too. What must never be aborted
--      is a run being applied or already applied, and that is now what it
--      checks. Aborting a good staged release is still possible on purpose,
--      and costs a re-download -- hence the required reason.
--
-- Neither touches npi_records, npi_cms_enrichment, leads or history. A run
-- that has been applied is refused outright.
-- Rerun-safe.

begin;

create or replace function public.abort_medicare_refresh(p_run_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.refresh_runs%rowtype;
  removed integer;
begin
  if nullif(btrim(p_reason), '') is null then raise exception 'abort reason is required'; end if;
  select * into r from public.refresh_runs where id = p_run_id for update;
  if not found then raise exception 'refresh run % does not exist', p_run_id; end if;
  if r.source <> 'medicare' then
    raise exception 'refresh run % is not a Medicare run (use abort_nppes_refresh)', p_run_id;
  end if;
  if r.status = 'applied' or coalesce(r.metadata->>'apply_state', '') in ('applying', 'applied') then
    raise exception 'refresh run % has been applied and cannot be aborted', p_run_id;
  end if;

  delete from public.medicare_refresh_staging where refresh_run_id = p_run_id;
  get diagnostics removed = row_count;

  update public.refresh_runs
     set status = 'failed',
         completed_at = now(),
         metadata = metadata || jsonb_build_object(
           'staging_state', 'failed', 'failure_reason', btrim(p_reason), 'aborted_rows', removed)
   where id = p_run_id;

  return jsonb_build_object('run_id', p_run_id, 'status', 'failed', 'deleted_rows', removed);
end
$$;

-- Unchanged except for which runs it will accept: a run that is being
-- applied or has been applied is refused, and everything short of that can
-- be closed out -- including a 'complete' run whose staging is gone.
create or replace function public.abort_nppes_refresh(p_run_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.refresh_runs%rowtype;
  removed integer;
begin
  if nullif(btrim(p_reason), '') is null then raise exception 'abort reason is required'; end if;
  select * into r from public.refresh_runs where id = p_run_id for update;
  if not found then raise exception 'refresh run % does not exist', p_run_id; end if;
  if r.source <> 'nppes' then
    raise exception 'refresh run % is not an NPPES run (use abort_medicare_refresh)', p_run_id;
  end if;
  if r.status = 'applied' or coalesce(r.metadata->>'apply_state', '') in ('applying', 'applied') then
    raise exception 'refresh run % has been applied and cannot be aborted', p_run_id;
  end if;

  delete from public.nppes_refresh_staging where refresh_run_id = p_run_id;
  get diagnostics removed = row_count;

  update public.refresh_runs
     set status = 'failed',
         completed_at = now(),
         metadata = metadata || jsonb_build_object(
           'staging_state', 'failed', 'failure_reason', btrim(p_reason), 'aborted_rows', removed)
   where id = p_run_id;

  return jsonb_build_object('run_id', p_run_id, 'status', 'failed', 'deleted_rows', removed);
end
$$;

revoke all on function public.abort_medicare_refresh(uuid, text) from public, anon, authenticated;
grant execute on function public.abort_medicare_refresh(uuid, text) to service_role;
revoke all on function public.abort_nppes_refresh(uuid, text) from public, anon, authenticated;
grant execute on function public.abort_nppes_refresh(uuid, text) to service_role;

commit;

-- Verification (read-only):
-- Runs that claim to hold staging rows but don't -- each one is a candidate
-- for an abort, and each one would otherwise sit in the list for ever:
-- select r.id, r.source, r.status, r.row_count,
--        case r.source when 'nppes'
--             then (select count(*) from public.nppes_refresh_staging s where s.refresh_run_id = r.id)
--             else (select count(*) from public.medicare_refresh_staging s where s.refresh_run_id = r.id) end as staged_now
--   from public.refresh_runs r
--  where r.status = 'staged'
--  order by r.started_at desc;
--
-- To close one out (the reason is recorded on the run):
-- select public.abort_medicare_refresh('<run id>', 'staging rolled back; run is empty');
