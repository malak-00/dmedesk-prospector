-- DME Desk Prospector: a fast page of registry matches for the Admin list.
-- MANUAL ONLY: review against the live schema before execution.
-- Run after 030 and 036.
--
-- Symptom: after thousands of merges the "All providers" list, and "Merge
-- selected" (which re-reads the list when it finishes), hung or timed out. Both
-- read registry_review_queue, a view that calls identity_pair_decided() on every
-- pair it scans; that function expands both pairs' whole groups, which are now
-- large. See sql/036 for the same problem in "Merge all eligible".
--
-- registry_review_page() pages straight through registry_match_candidates in
-- key order using only cheap indexed tests (not already one group, no decision
-- recorded for that exact pair), takes one page, and only THEN applies the
-- expensive group-level "already decided" test, to at most p_limit pairs. A
-- page can therefore come back short; `next` is the key of the last pair
-- scanned, so the caller continues from there (a cursor, not an offset).
--
-- Read-only. registry_review_queue is left in place.

begin;

create or replace function public.registry_review_page(
  p_tier integer default null,
  p_after_left text default null,
  p_after_right text default null,
  p_limit integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
  v_rows jsonb;
  v_has_more boolean;
  v_next jsonb;
begin
  with cheap as (
    select c.left_npi, c.right_npi, c.tier, c.matched_keys, c.first_build_id,
           lm.group_id as gl, rm.group_id as gr
      from public.registry_match_candidates c
      left join public.lead_group_members lm on lm.npi = c.left_npi
      left join public.lead_group_members rm on rm.npi = c.right_npi
     where (p_tier is null or c.tier = p_tier)
       and (p_after_left is null or (c.left_npi, c.right_npi) > (p_after_left, coalesce(p_after_right, '')))
       and (lm.group_id is null or rm.group_id is null or lm.group_id <> rm.group_id)
       and not exists (
         select 1 from public.identity_match_decisions d
          where d.left_npi = c.left_npi and d.right_npi = c.right_npi)
     order by c.left_npi, c.right_npi
     limit v_limit + 1
  ), page as (
    select * from cheap order by left_npi, right_npi limit v_limit
  ), shown as (
    select p.* from page p where not public.identity_pair_decided(p.left_npi, p.right_npi)
  )
  select
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'tier', s.tier,
               'matched_keys', s.matched_keys,
               'left_npi', s.left_npi,
               'left_name', lr.name,
               'left_group_id', s.gl,
               'right_npi', s.right_npi,
               'right_name', rr.name,
               'right_group_id', s.gr,
               'left_is_lead', exists (select 1 from public.leads l where l.npi = s.left_npi and not l.is_disconnected),
               'right_is_lead', exists (select 1 from public.leads l where l.npi = s.right_npi and not l.is_disconnected),
               'first_seen_at', b.finished_at)
             order by s.left_npi, s.right_npi)
        from shown s
        left join public.npi_records lr on lr.npi = s.left_npi
        left join public.npi_records rr on rr.npi = s.right_npi
        left join public.registry_match_builds b on b.id = s.first_build_id
    ), '[]'::jsonb),
    (select count(*) from cheap) > v_limit,
    (select jsonb_build_object('leftNpi', q.left_npi, 'rightNpi', q.right_npi)
       from page q order by q.left_npi desc, q.right_npi desc limit 1)
  into v_rows, v_has_more, v_next;

  return jsonb_build_object('rows', v_rows, 'hasMore', v_has_more, 'next', v_next);
end;
$$;

revoke all on function public.registry_review_page(integer, text, text, integer) from public, anon, authenticated;
grant execute on function public.registry_review_page(integer, text, text, integer) to service_role;

commit;

-- Verification (read-only): should return quickly.
-- select jsonb_array_length(public.registry_review_page(null, null, null, 25)->'rows');
