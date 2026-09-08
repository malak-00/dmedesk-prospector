-- DME Desk Prospector: group-level ownership conflict resolution.
-- MANUAL ONLY: review against the live schema before execution.
--
-- A "conflict" is one identity group whose NPIs are actively claimed by
-- more than one person. Resolving it means giving the whole group to one
-- owner and recording every move as an auditable event.
--
-- This is a database function rather than a sequence of REST calls on
-- purpose. The Worker talks to Supabase through PostgREST, which has no
-- multi-request transaction: a read-then-write resolve could interleave
-- with a concurrent claim and leave the group half-moved with a partial
-- audit trail. Inside this function the whole thing is one transaction,
-- and the affected rows are locked before anything is written.

-- Ownership changes are approved decisions, not automatic ones: the caller
-- must supply who approved it and why, and both land on every event.
create or replace function public.resolve_ownership_conflict(
  p_group_id uuid,
  p_to_user_id uuid,
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
  v_reassigned integer := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_moved jsonb := '[]'::jsonb;
begin
  if p_group_id is null or p_to_user_id is null or p_approved_by is null then
    raise exception 'group id, target user, and approver are all required';
  end if;
  if v_reason is null then
    raise exception 'a reason is required: ownership changes must record why they were approved';
  end if;

  if not exists (select 1 from public.lead_groups where id = p_group_id) then
    raise exception 'lead group % does not exist', p_group_id;
  end if;
  if not exists (select 1 from public.app_users where id = p_to_user_id) then
    raise exception 'target user % does not exist', p_to_user_id;
  end if;
  if not exists (select 1 from public.app_users where id = p_approved_by) then
    raise exception 'approving user % does not exist', p_approved_by;
  end if;

  -- Lock every active claim in the group before deciding anything, so a
  -- concurrent claim or resolve cannot slip in between the read and write.
  for v_lead in
    select l.id, l.npi, l.claimed_by, l.company_name
      from public.leads l
     where l.group_id = p_group_id
       and l.is_disconnected = false
       and l.claimed_by is not null
       and l.claimed_by <> p_to_user_id
     order by l.npi
     for update
  loop
    -- The active-claim uniqueness rule is a partial unique index on
    -- (npi, claimed_by) where not is_disconnected. If the target owner
    -- already holds this NPI, moving it would collide -- record it and
    -- leave the row alone rather than failing the whole resolution.
    if exists (
      select 1 from public.leads existing
       where existing.npi = v_lead.npi
         and existing.claimed_by = p_to_user_id
         and existing.is_disconnected = false
    ) then
      v_skipped := v_skipped || jsonb_build_object(
        'npi', v_lead.npi,
        'lead_id', v_lead.id,
        'reason', 'target user already has an active claim on this NPI'
      );
      continue;
    end if;

    -- History before the change, always.
    insert into public.lead_ownership_events (
      lead_id, npi, group_id, event_type, from_user_id, to_user_id,
      reason, source, approved_by, requires_review, review_status, metadata
    ) values (
      v_lead.id, v_lead.npi, p_group_id, 'reassigned', v_lead.claimed_by, p_to_user_id,
      v_reason, 'admin_conflict_resolution', p_approved_by, false, 'not_required',
      jsonb_build_object('company_name', v_lead.company_name)
    );

    -- Ownership only. claimed_at keeps the original claim time (the event
    -- log records when the reassignment happened), and status, notes,
    -- reminders and disconnect state are untouched.
    update public.leads
       set claimed_by = p_to_user_id
     where id = v_lead.id;

    v_reassigned := v_reassigned + 1;
    v_moved := v_moved || jsonb_build_object(
      'npi', v_lead.npi,
      'lead_id', v_lead.id,
      'from_user_id', v_lead.claimed_by,
      'company_name', v_lead.company_name
    );
  end loop;

  return jsonb_build_object(
    'group_id', p_group_id,
    'to_user_id', p_to_user_id,
    'approved_by', p_approved_by,
    'reassigned_count', v_reassigned,
    'moved', v_moved,
    'skipped', v_skipped
  );
end;
$$;

-- The Worker calls this with the service-role key; nothing else should be
-- able to move ownership.
revoke all on function public.resolve_ownership_conflict(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_ownership_conflict(uuid, uuid, uuid, text) to service_role;

comment on function public.resolve_ownership_conflict(uuid, uuid, uuid, text) is
  'Assigns every active claim in one identity group to a single owner, writing a reassigned event per move. Atomic; never touches status, notes, reminders, or claimed_at.';


-- Read-only view of current conflicts: identity groups whose active claims
-- are split across more than one owner. The admin UI aggregates this in the
-- Worker so it works before this file is installed, but the view is the
-- authoritative definition and is what verification queries should use.
create or replace view public.ownership_conflicts as
select
  g.id                                as group_id,
  g.canonical_name                    as group_name,
  g.state                             as group_state,
  g.identity_key,
  count(distinct l.claimed_by)        as owner_count,
  count(*)                            as active_lead_count,
  array_agg(distinct l.npi order by l.npi) as npis,
  array_agg(distinct u.display_name)  as owners
  from public.leads l
  join public.lead_groups g on g.id = l.group_id
  left join public.app_users u on u.id = l.claimed_by
 where l.is_disconnected = false
   and l.claimed_by is not null
 group by g.id, g.canonical_name, g.state, g.identity_key
having count(distinct l.claimed_by) > 1;

revoke all on public.ownership_conflicts from anon, authenticated;

comment on view public.ownership_conflicts is
  'Identity groups with active claims held by more than one user. Each row needs an explicit approved owner decision.';

-- Verification (read-only):
-- select * from public.ownership_conflicts order by group_name;
-- select event_type, count(*) from public.lead_ownership_events group by 1 order by 1;
