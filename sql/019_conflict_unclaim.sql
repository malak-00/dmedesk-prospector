-- DME Desk Prospector: selectively release active claims from an ownership conflict.
-- MANUAL ONLY: review against the live schema before execution.
-- Run after sql/001_identity_schema.sql and sql/013_release_claimed_leads.sql.

begin;

create or replace function public.unclaim_conflict_leads(
  p_group_id uuid,
  p_npis text[],
  p_approved_by uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_lead record;
  v_released text[] := '{}';
begin
  if p_group_id is null or p_approved_by is null then
    raise exception 'group id and approver are required';
  end if;
  if v_reason is null then
    raise exception 'a reason is required: ownership changes must record why they were approved';
  end if;
  if not exists (select 1 from public.lead_groups where id = p_group_id) then
    raise exception 'lead group % does not exist', p_group_id;
  end if;
  if not exists (select 1 from public.app_users where id = p_approved_by and is_admin) then
    raise exception 'approving user % is not an admin', p_approved_by;
  end if;
  if p_npis is null or array_length(p_npis, 1) is null then
    raise exception 'at least one NPI is required';
  end if;

  for v_lead in
    select l.id, l.npi, l.group_id, l.claimed_by, l.company_name
      from public.leads l
     where l.group_id = p_group_id
       and l.npi = any (p_npis)
       and l.is_disconnected = false
       and l.claimed_by is not null
     order by l.npi
       for update
  loop
    insert into public.lead_ownership_events
      (lead_id, npi, group_id, event_type, from_user_id, to_user_id,
       reason, source, approved_by, metadata)
    values
      (v_lead.id, v_lead.npi, p_group_id, 'released', v_lead.claimed_by, null,
       v_reason, 'admin_conflict_unclaim', p_approved_by,
       jsonb_build_object('company_name', v_lead.company_name));

    update public.leads
       set claimed_by = null,
           claimed_at = null,
           reminder_at = null,
           status = 'new',
           status_updated_by = p_approved_by,
           status_updated_at = now()
     where id = v_lead.id;

    v_released := v_released || v_lead.npi;
  end loop;

  return jsonb_build_object(
    'group_id', p_group_id,
    'released_npis', to_jsonb(v_released),
    'released_count', coalesce(array_length(v_released, 1), 0),
    'not_found', to_jsonb(array(select n from unnest(p_npis) n where not (n = any (v_released)))));
end;
$$;

revoke all on function public.unclaim_conflict_leads(uuid, text[], uuid, text) from public, anon, authenticated;
grant execute on function public.unclaim_conflict_leads(uuid, text[], uuid, text) to service_role;

-- The claim RPC derives identity keys for every active lead. These partial
-- indexes keep its ownership and group lookups bounded to claimable rows.
create index if not exists idx_leads_active_claimed_npi
  on public.leads(npi, claimed_by)
  where is_disconnected = false and claimed_by is not null;
create index if not exists idx_leads_active_claimed_group
  on public.leads(group_id, claimed_by)
  where is_disconnected = false and claimed_by is not null;

commit;

-- Verification (read-only):
-- select proname, pg_get_function_identity_arguments(oid)
--   from pg_proc where proname = 'unclaim_conflict_leads';
-- select indexname from pg_indexes
--  where indexname in ('idx_leads_active_claimed_npi', 'idx_leads_active_claimed_group');
