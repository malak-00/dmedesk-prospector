-- DME Desk Prospector: "Merge all eligible" for registry-wide identity matches.
-- MANUAL ONLY: review against the live schema before execution.
-- Run after 009, 010 and 030.
--
-- Two functions behind the Admin tab's "Merge all eligible" button:
--
--   registry_merge_preview(p_keys)       counts the pairs the rules would merge
--                                        and how many are held back (read-only)
--   merge_identity_pair_if_safe(...)     merges ONE pair, but only if at most one
--                                        agent owns anything in either group
--
-- "Eligible" here is stricter than the manual bulk-merge checkbox. That one
-- looks only at the two NPIs' own leads. This looks at every active claim in
-- the two groups the merge would join, because merging two groups that are
-- each owned by a different agent would create an ownership conflict. The
-- check and the merge happen in one transaction under one lock, so two merges
-- running together can't each look safe and together join X's group to Y's.
--
-- The merge itself is resolve_identity_match (sql/009, extended in 030), so
-- every merge still writes its decision row and group evidence. Ownership
-- never changes here.

begin;

create or replace function public.registry_merge_preview(p_keys text[])
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with c as (
    select left_npi, right_npi
      from public.registry_match_candidates
     where matched_keys = any (p_keys)
       and not exists (
         select 1 from public.identity_match_decisions d
          where d.left_npi = registry_match_candidates.left_npi
            and d.right_npi = registry_match_candidates.right_npi)
  ), cg as (
    select c.left_npi, c.right_npi, lm.group_id as gl, rm.group_id as gr
      from c
      left join public.lead_group_members lm on lm.npi = c.left_npi
      left join public.lead_group_members rm on rm.npi = c.right_npi
     where lm.group_id is null or rm.group_id is null or lm.group_id <> rm.group_id
  ), own as (
    select npi, group_id, claimed_by from public.leads
     where not is_disconnected and claimed_by is not null
  ), pair_owner as (
    select cg.left_npi, cg.right_npi, o.claimed_by from cg join own o on o.npi = cg.left_npi
    union
    select cg.left_npi, cg.right_npi, o.claimed_by from cg join own o on o.npi = cg.right_npi
    union
    select cg.left_npi, cg.right_npi, o.claimed_by from cg join own o on o.group_id = cg.gl
    union
    select cg.left_npi, cg.right_npi, o.claimed_by from cg join own o on o.group_id = cg.gr
  ), owner_counts as (
    select left_npi, right_npi, count(*) as n from pair_owner group by 1, 2
  )
  select jsonb_build_object(
    'total', (select count(*) from cg),
    'blocked', (select count(*) from owner_counts where n > 1),
    'mergeable', (select count(*) from cg) - (select count(*) from owner_counts where n > 1)
  )
$$;

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
  -- One safe-merge at a time: the ownership check below must not race another
  -- merge that is joining one of the same groups.
  perform pg_advisory_xact_lock(hashtext('merge_identity_pair_if_safe'));

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

revoke all on function public.registry_merge_preview(text[]) from public, anon, authenticated;
revoke all on function public.merge_identity_pair_if_safe(text, text, uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.registry_merge_preview(text[]) to service_role;
grant execute on function public.merge_identity_pair_if_safe(text, text, uuid, text, integer, text) to service_role;

commit;

-- Verification (read-only):
-- select public.registry_merge_preview(array['name+state+phone','name+state+official','state+official+phone','official+phone']);
