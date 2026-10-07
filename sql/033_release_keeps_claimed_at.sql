-- DME Desk Prospector: "Return to Prospect" no longer nulls leads.claimed_at.
-- MANUAL ONLY: review against the live schema before execution.
-- Run after 013.
--
-- Symptom: returning a lead to Prospect failed with
--   null value in column "claimed_at" of relation "leads" violates not-null constraint
-- sql/013's release_claimed_leads() set claimed_at = null, but the live
-- leads.claimed_at column is NOT NULL.
--
-- Fix: leave claimed_at alone. Ownership is decided by claimed_by (every
-- ownership check tests `claimed_by is not null`, see 013's header), so a
-- released row with an old claimed_at still counts as unowned. The value now
-- reads as "when this row was last claimed", which is also what the
-- ownership history already says. Nothing else in this function changes.
--
-- No table or constraint is altered, so no other code that expects claimed_at
-- to be present (sorting, exports, the claimed-lead DTO) is affected.

begin;

create or replace function public.release_claimed_leads(p_user_id uuid, p_npis text[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead record;
  v_released text[] := '{}';
begin
  if p_user_id is null or not exists (select 1 from public.app_users where id = p_user_id) then
    raise exception 'releasing user % does not exist', p_user_id;
  end if;
  if p_npis is null or array_length(p_npis, 1) is null then
    raise exception 'at least one NPI is required';
  end if;

  for v_lead in
    select id, npi, group_id, company_name
      from public.leads
     where claimed_by = p_user_id
       and not is_disconnected
       and npi = any (p_npis)
     order by npi
       for update
  loop
    insert into public.lead_ownership_events
      (lead_id, npi, group_id, event_type, from_user_id, to_user_id, reason, source, metadata)
    values
      (v_lead.id, v_lead.npi, v_lead.group_id, 'released', p_user_id, null,
       'Returned to Prospect by the owner', 'release_claimed_leads',
       jsonb_build_object('company_name', v_lead.company_name));

    update public.leads
       set claimed_by = null,
           reminder_at = null,
           status = 'new',
           status_updated_by = p_user_id,
           status_updated_at = now()
     where id = v_lead.id;

    v_released := v_released || v_lead.npi;
  end loop;

  return jsonb_build_object(
    'released_npis', to_jsonb(v_released),
    'released_count', coalesce(array_length(v_released, 1), 0),
    'not_found', to_jsonb(array(select n from unnest(p_npis) n where not (n = any (v_released)))));
end $$;

revoke all on function public.release_claimed_leads(uuid, text[]) from public, anon, authenticated;
grant execute on function public.release_claimed_leads(uuid, text[]) to service_role;

commit;

-- Verification (read-only), after Jasmine returns a lead:
-- select event_type, count(*) from public.lead_ownership_events group by 1 order by 1;
-- select npi, claimed_by, claimed_at, status from public.leads where claimed_by is null and not is_disconnected order by claimed_at desc limit 5;
