-- DME Desk Prospector: make "Merge all eligible" fast after many merges.
-- MANUAL ONLY: review against the live schema before execution.
-- Run after 035.
--
-- Symptom: after ~9,000 merges, running "Merge all eligible" again kept timing
-- out. The Worker read each batch from registry_review_queue, a view that
-- calls identity_pair_decided() on every candidate pair it scans. That
-- function expands BOTH pairs' whole groups and compares them with every
-- decision, so merged groups getting bigger made every row slower, and each
-- rerun started from the top and scanned past everything already handled.
--
-- registry_merge_next_batch() selects the next pairs straight from
-- registry_match_candidates in primary-key order (so it can stop after one
-- batch) using only cheap indexed tests: not already in one group, and no
-- decision recorded for that exact pair. The group-wide "an admin already said
-- these two businesses are different" check, which is the expensive part, now
-- runs once per pair inside merge_identity_pair_if_safe, i.e. for the 25 pairs
-- of a batch rather than for every pair scanned.
--
-- Nothing here changes how a merge works or who owns what.

begin;

create or replace function public.registry_merge_next_batch(
  p_keys text[],
  p_after_left text default null,
  p_after_right text default null,
  p_limit integer default 25
)
returns table (left_npi text, right_npi text, tier integer, matched_keys text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.left_npi, c.right_npi, c.tier, c.matched_keys
    from public.registry_match_candidates c
    left join public.lead_group_members lm on lm.npi = c.left_npi
    left join public.lead_group_members rm on rm.npi = c.right_npi
   where c.matched_keys = any (p_keys)
     and (p_after_left is null or (c.left_npi, c.right_npi) > (p_after_left, coalesce(p_after_right, '')))
     and (lm.group_id is null or rm.group_id is null or lm.group_id <> rm.group_id)
     and not exists (
       select 1 from public.identity_match_decisions d
        where d.left_npi = c.left_npi and d.right_npi = c.right_npi)
   order by c.left_npi, c.right_npi
   limit greatest(1, least(coalesce(p_limit, 25), 200))
$$;

-- 035's merge function, plus the group-level "already decided" test that the
-- old view applied to every row.
create or replace function public.merge_identity_pair_if_safe(
  p_left_npi text,
  p_right_npi text,
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
  v_owners integer;
begin
  perform pg_advisory_xact_lock(hashtext('merge_identity_pair_if_safe'));

  -- An admin already decided between these two businesses (any NPI of one
  -- group against any NPI of the other): leave it alone.
  if public.identity_pair_decided(p_left_npi, p_right_npi) then
    return jsonb_build_object('skipped', true, 'reason', 'Already decided.');
  end if;

  select count(distinct l.claimed_by) into v_owners
    from public.leads l
   where not l.is_disconnected
     and l.claimed_by is not null
     and (l.npi in (p_left_npi, p_right_npi)
          or l.group_id in (select m.group_id from public.lead_group_members m
                             where m.npi in (p_left_npi, p_right_npi)));

  if v_owners > 1 then
    return jsonb_build_object(
      'skipped', true,
      'reason', 'Different agents own these NPIs or others in their groups; review manually.');
  end if;

  return public.resolve_identity_match(
           p_left_npi, p_right_npi, 'merged', p_decided_by, p_reason, p_tier, p_matched_keys)
         || jsonb_build_object('skipped', false);
end;
$$;

revoke all on function public.registry_merge_next_batch(text[], text, text, integer) from public, anon, authenticated;
revoke all on function public.merge_identity_pair_if_safe(text, text, uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.registry_merge_next_batch(text[], text, text, integer) to service_role;
grant execute on function public.merge_identity_pair_if_safe(text, text, uuid, text, integer, text) to service_role;

commit;

-- Verification (read-only): should return quickly even after many merges.
-- select * from public.registry_merge_next_batch(array['name+state+phone','name+state+official','state+official+phone','official+phone']);
