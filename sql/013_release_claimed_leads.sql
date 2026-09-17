-- DME Desk Prospector: release a claimed lead back to Prospect.
-- MANUAL ONLY: review against the live schema before execution.
-- Run after 001 and 010/011.
--
-- "Return to Prospect" used to DELETE the lead row. Since claiming started
-- writing a 'claimed' ownership event (sql/010/011), that delete fails: the
-- foreign key tries to null lead_ownership_events.lead_id and the append-only
-- trigger rejects it ("append-only audit table ... is immutable"). Deleting
-- was also the wrong shape -- releasing a lead is an ownership transition,
-- not the erasure of one.
--
-- release_claimed_leads() instead, in one transaction per call:
--   * writes a 'released' event (from the current owner, no new owner);
--   * clears claimed_by / claimed_at / reminder_at and resets status to 'new'.
--
-- The row stays, so its history stays attached. Everything that decides
-- ownership already tests `claimed_by is not null` (owned_group_npis,
-- ownership_conflicts, claim_leads), so a released lead:
--   * no longer blocks anyone from claiming that NPI or its identity group,
--     unless the same owner still holds another NPI in the group;
--   * is claimed again as a fresh lead row (notes and status of the old claim
--     stay with the released row, not visible to the next owner).

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
           claimed_at = null,
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

comment on function public.release_claimed_leads(uuid, text[]) is
  'Returns the caller''s claimed leads to Prospect: writes a released event and clears claimed_by, keeping the lead row and its history.';

commit;

-- Verification (read-only):
-- select event_type, count(*) from public.lead_ownership_events group by 1 order by 1;
-- select count(*) as released_rows from public.leads where claimed_by is null and not is_disconnected;
