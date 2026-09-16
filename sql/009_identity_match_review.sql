-- DME Desk Prospector: admin decisions on Tier 2/3 identity review flags.
-- MANUAL ONLY: review against the live schema before execution.
-- Run after 008_identity_match_tiers.sql.
--
-- Every flagged pair in public.identity_review_candidates waits for one of
-- two admin decisions:
--
--   merged     Same business. The two NPIs' groups become one group. If that
--              puts claims held by different users together, each of those
--              claims gets a pending 'conflict_detected' event and the group
--              shows in the Admin tab's Ownership conflicts panel. Ownership
--              itself never changes here.
--   dismissed  Not the same business. Nothing moves; the pair stops showing.
--
-- Like 005, this is one database function rather than a sequence of REST
-- calls, so the membership moves, the lead updates, the audit events and the
-- decision row are a single transaction with the affected rows locked.

begin;

create table if not exists public.identity_match_decisions (
  id uuid primary key default gen_random_uuid(),
  left_npi text not null,
  right_npi text not null,
  decision text not null check (decision in ('merged', 'dismissed')),
  tier integer,
  matched_keys text,
  reason text not null check (btrim(reason) <> ''),
  decided_by uuid not null references public.app_users(id),
  decided_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  check (left_npi < right_npi),
  unique (left_npi, right_npi)
);

create index if not exists idx_identity_match_decisions_decided_at
  on public.identity_match_decisions(decided_at desc);

alter table public.identity_match_decisions enable row level security;
revoke all on public.identity_match_decisions from anon, authenticated;

-- Pairs still waiting for a decision.
create or replace view public.identity_review_queue as
select c.*
  from public.identity_review_candidates c
 where not exists (
   select 1 from public.identity_match_decisions d
    where d.left_npi = c.left_npi
      and d.right_npi = c.right_npi);

revoke all on public.identity_review_queue from anon, authenticated;

comment on view public.identity_review_queue is
  'Tier 2/3 identity review pairs that have not been merged or dismissed yet.';

create or replace function public.resolve_identity_match(
  p_left_npi text,
  p_right_npi text,
  p_decision text,
  p_decided_by uuid,
  p_reason text,
  p_tier integer default null,
  p_matched_keys text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_left text := least(btrim(coalesce(p_left_npi, '')), btrim(coalesce(p_right_npi, '')));
  v_right text := greatest(btrim(coalesce(p_left_npi, '')), btrim(coalesce(p_right_npi, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_left_group uuid;
  v_right_group uuid;
  v_target uuid;
  v_source uuid;
  v_target_owners integer;
  v_source_owners integer;
  v_combined_owners integer;
  v_moved integer := 0;
  v_new_conflict boolean := false;
begin
  if v_left = '' or v_right = '' or v_left = v_right then
    raise exception 'two different NPIs are required';
  end if;
  if p_decision not in ('merged', 'dismissed') then
    raise exception 'decision must be merged or dismissed';
  end if;
  if v_reason is null then
    raise exception 'a reason is required: review decisions must record why they were made';
  end if;
  if p_decided_by is null or not exists (select 1 from public.app_users where id = p_decided_by) then
    raise exception 'deciding user % does not exist', p_decided_by;
  end if;

  -- Serializes concurrent decisions on the same pair.
  perform pg_advisory_xact_lock(hashtext('identity_match:' || v_left || ':' || v_right));

  if exists (select 1 from public.identity_match_decisions where left_npi = v_left and right_npi = v_right) then
    raise exception 'this pair has already been decided';
  end if;

  if p_decision = 'merged' then
    -- Lock both groups' memberships before reading anything that decides the move.
    perform 1 from public.lead_group_members m
     where m.group_id in (select group_id from public.lead_group_members where npi in (v_left, v_right))
     order by m.npi
       for update;

    select group_id into v_left_group from public.lead_group_members where npi = v_left;
    select group_id into v_right_group from public.lead_group_members where npi = v_right;
    if v_left_group is null or v_right_group is null then
      raise exception 'both NPIs must already belong to an identity group (run 002/008 first)';
    end if;

    if v_left_group <> v_right_group then
      -- Keep the larger group so fewer rows move; ties keep the left NPI's group.
      if (select count(*) from public.lead_group_members where group_id = v_right_group)
         > (select count(*) from public.lead_group_members where group_id = v_left_group) then
        v_target := v_right_group; v_source := v_left_group;
      else
        v_target := v_left_group; v_source := v_right_group;
      end if;

      select count(distinct claimed_by) into v_target_owners from public.leads
       where group_id = v_target and not is_disconnected and claimed_by is not null;
      select count(distinct claimed_by) into v_source_owners from public.leads
       where group_id = v_source and not is_disconnected and claimed_by is not null;
      select count(distinct claimed_by) into v_combined_owners from public.leads
       where group_id in (v_target, v_source) and not is_disconnected and claimed_by is not null;
      v_new_conflict := v_combined_owners > 1 and v_combined_owners > greatest(v_target_owners, v_source_owners);

      -- reviewed_by marks every moved membership as a human decision, so a
      -- rerun of 008 will never split the merged group again.
      update public.lead_group_members
         set group_id = v_target,
             review_status = 'approved',
             reviewed_by = p_decided_by,
             reviewed_at = now(),
             evidence = evidence || jsonb_build_object('merged_by_review', jsonb_build_object(
               'from_group_id', v_source, 'pair', jsonb_build_array(v_left, v_right),
               'tier', p_tier, 'matched_keys', p_matched_keys, 'at', now()))
       where group_id = v_source;
      get diagnostics v_moved = row_count;

      update public.leads set group_id = v_target where group_id = v_source;

      update public.lead_groups set review_status = 'approved', updated_at = now() where id = v_target;

      if v_new_conflict then
        insert into public.lead_ownership_events
          (lead_id, npi, group_id, event_type, reason, source, approved_by, requires_review, review_status, metadata)
        select l.id, l.npi, v_target, 'conflict_detected',
               'Review merge placed this claim in a group with active claims held by other users',
               'identity_match_review', p_decided_by, true, 'pending',
               jsonb_build_object('owner_user_id', l.claimed_by, 'pair', jsonb_build_array(v_left, v_right), 'merge_reason', v_reason)
          from public.leads l
         where l.group_id = v_target
           and not l.is_disconnected
           and l.claimed_by is not null;
      end if;
    else
      v_target := v_left_group;
    end if;
  end if;

  insert into public.identity_match_decisions
    (left_npi, right_npi, decision, tier, matched_keys, reason, decided_by, metadata)
  values
    (v_left, v_right, p_decision, p_tier, p_matched_keys, v_reason, p_decided_by,
     jsonb_build_object('target_group_id', v_target, 'source_group_id', v_source, 'moved_count', v_moved, 'new_conflict', v_new_conflict));

  return jsonb_build_object(
    'left_npi', v_left,
    'right_npi', v_right,
    'decision', p_decision,
    'target_group_id', v_target,
    'moved_count', v_moved,
    'new_conflict', v_new_conflict
  );
end;
$$;

revoke all on function public.resolve_identity_match(text, text, text, uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.resolve_identity_match(text, text, text, uuid, text, integer, text) to service_role;

comment on function public.resolve_identity_match(text, text, text, uuid, text, integer, text) is
  'Records an admin merge/dismiss decision on a Tier 2/3 identity pair. A merge combines the two groups atomically and flags any new ownership conflict; ownership never changes here.';

commit;

-- Verification (read-only):
-- select tier, matched_keys, count(*) from public.identity_review_queue group by 1, 2 order by 1, 2;
-- select decision, count(*) from public.identity_match_decisions group by 1;
-- select * from public.ownership_conflicts order by group_name;
