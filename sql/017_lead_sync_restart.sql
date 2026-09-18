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

begin;

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

commit;

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
