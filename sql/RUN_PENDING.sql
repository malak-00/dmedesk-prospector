-- DME Desk Prospector: everything still to run, in one file.
--
-- MANUAL ONLY: review against the live schema before execution.
-- Generated from the files below, unchanged apart from their own
-- begin/commit -- running them individually, in this order, does the same
-- thing. Keep doing that for anything added later; this file exists so the
-- backlog can be cleared in one paste.
--
--   sql/017_lead_sync_restart.sql
--     Let a claimed-lead sync run again from the start, instead of resuming past the end.
--
-- They are wrapped in a single transaction: if anything fails, nothing
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
-- sql/017_lead_sync_restart.sql
-- ========================================================================

-- DME Desk Prospector: run a claimed-lead sync again from the start.
-- MANUAL ONLY: review against the live schema before execution.
-- Run after 015.
--
-- apply_provider_changes_to_leads resumes from a cursor on the run
-- (metadata.lead_sync_last_npi), so an interrupted sync continues where it
-- stopped. The cost of that is a sync which has run once can never run
-- again: the cursor sits past the last NPI, the next call finds nothing
-- below it and truthfully reports "nothing to do" -- even when the pass that
-- set the cursor covered a different set of NPIs than the current one would.
--
-- That happened here. A release applied before the sync existed was synced
-- once under the old, unscoped query, which walks every NPI in the release;
-- when the query was narrowed to NPIs somebody holds a lead for, the cursor
-- left behind was already past the end, so the next run reported 0 refreshed
-- while 3,558 claimed leads were still showing pre-refresh data. Clearing
-- three metadata keys by hand fixed it -- which is not a thing anyone should
-- have to know.
--
-- reset_lead_sync(run) drops the cursor so the next sync starts from the
-- beginning. Re-running a sync is safe by construction: the snapshot copy is
-- idempotent, and an alert for one lead in one run can only exist once (a
-- unique index enforces it), so nothing is duplicated or re-raised.
-- Rerun-safe.


create or replace function public.reset_lead_sync(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.refresh_runs%rowtype;
  v_cursor text;
begin
  select * into r from public.refresh_runs where id = p_run_id for update;
  if not found then raise exception 'refresh run % does not exist', p_run_id; end if;
  if r.source <> 'nppes' then
    raise exception 'refresh run % is not an NPPES run', p_run_id;
  end if;

  v_cursor := r.metadata->>'lead_sync_last_npi';

  update public.refresh_runs
     set metadata = (metadata - 'lead_sync_last_npi' - 'lead_sync_state' - 'lead_sync_finished_at')
                    || jsonb_build_object('lead_sync_reset_at', now(), 'lead_sync_reset_from', v_cursor)
   where id = p_run_id;

  return jsonb_build_object(
    'run_id', p_run_id,
    'cleared_cursor', v_cursor,
    'was_complete', coalesce(r.metadata->>'lead_sync_state', '') = 'complete');
end
$$;

revoke all on function public.reset_lead_sync(uuid) from public, anon, authenticated;
grant execute on function public.reset_lead_sync(uuid) to service_role;


-- Verification (read-only):
-- select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and proname = 'reset_lead_sync';
--
-- What each applied release did for the people who own leads:
-- select id, started_at,
--        metadata->>'lead_sync_state' as sync_state,
--        metadata->>'lead_sync_leads_updated' as leads_refreshed,
--        metadata->>'lead_sync_alerts' as alerts_raised
--   from public.refresh_runs
--  where source = 'nppes' and metadata->>'apply_state' = 'applied'
--  order by started_at desc;

commit;

-- ---------------------------------------------------------------------------
-- Verification (read-only). Run these after the commit above.
-- ---------------------------------------------------------------------------

-- 1. The functions this file should have created or replaced.
select p.proname as object, pg_get_function_identity_arguments(p.oid) as arguments
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('reset_lead_sync', 'apply_provider_changes_to_leads')
 order by p.proname;
--   -> 2 rows.

-- 2. Releases that were applied but never reached claimed leads. Each one
--    needs `python -m nppes_ingest --sync-run <id>`.
select id, started_at, row_count, metadata->>'run_type' as run_type
  from public.refresh_runs
 where source = 'nppes' and metadata->>'apply_state' = 'applied'
   and metadata->>'lead_sync_state' is null
 order by started_at;

-- 3. Runs that claim to hold staged rows but don't -- candidates for an abort.
select r.id, r.source, r.status, r.row_count,
       case r.source when 'nppes'
            then (select count(*) from public.nppes_refresh_staging s where s.refresh_run_id = r.id)
            else (select count(*) from public.medicare_refresh_staging s where s.refresh_run_id = r.id) end as staged_now
  from public.refresh_runs r
 where r.status = 'staged'
 order by r.started_at desc;
