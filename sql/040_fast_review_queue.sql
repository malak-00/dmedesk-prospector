-- 040: make the "Possible duplicates" review queue fast again.
--
-- Problem: GET /admin/match-reviews timed out. Reading identity_review_queue took ~50 s even though it
-- returns a handful of rows. Two causes, both measured with EXPLAIN ANALYZE:
--   1. identity_pair_decided() was pushed down into the candidate joins, so it ran once for every raw
--      candidate pair (~16,000 times) instead of once for each final pair.
--   2. Each call scanned identity_match_decisions (~56,000 rows) because its OR of two IN-subqueries
--      cannot use the (left_npi, right_npi) unique index.
--
-- Fix: (a) rewrite identity_pair_decided() as two index lookups (same answer: a decision exists between
-- the two groups, in either direction); (b) fence the candidates in the view with OFFSET 0 so the
-- decided check runs only on the final rows. Columns and meaning of the view are unchanged.
-- Safe to re-run. No data is changed.

create or replace function public.identity_pair_decided(p_a text, p_b text)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  with ga as (
    select p_a as npi
    union
    select m2.npi from public.lead_group_members m1
      join public.lead_group_members m2 on m2.group_id = m1.group_id
     where m1.npi = p_a
  ), gb as (
    select p_b as npi
    union
    select m2.npi from public.lead_group_members m1
      join public.lead_group_members m2 on m2.group_id = m1.group_id
     where m1.npi = p_b
  )
  select exists (select 1 from public.identity_match_decisions d
                   join ga on d.left_npi = ga.npi join gb on d.right_npi = gb.npi)
      or exists (select 1 from public.identity_match_decisions d
                   join gb on d.left_npi = gb.npi join ga on d.right_npi = ga.npi)
$$;

create or replace view public.identity_review_queue as
select c.tier, c.matched_keys,
       c.left_npi, c.left_name, c.left_group_id,
       c.right_npi, c.right_name, c.right_group_id,
       'leads'::text as source,
       null::uuid as requested_by,
       null::text as requested_npi,
       null::jsonb as request_snapshot
  from (select * from public.identity_review_candidates offset 0) c  -- offset 0 stops the planner pushing the filter below into the joins
 where not public.identity_pair_decided(c.left_npi, c.right_npi)
union all
select q.tier, q.matched_keys,
       q.left_npi, q.left_name, q.left_group_id,
       q.right_npi, q.right_name, q.right_group_id,
       'claim_request'::text, q.requested_by, q.requested_npi, q.request_snapshot
  from (
    select distinct on (least(r.npi, r.matched_npi), greatest(r.npi, r.matched_npi))
           r.tier, r.matched_keys,
           least(r.npi, r.matched_npi) as left_npi,
           case when r.npi < r.matched_npi then coalesce(cr.name, r.snapshot->>'name') else coalesce(mr.name, ml.company_name) end as left_name,
           case when r.npi < r.matched_npi then cm.group_id else mm.group_id end as left_group_id,
           greatest(r.npi, r.matched_npi) as right_npi,
           case when r.npi < r.matched_npi then coalesce(mr.name, ml.company_name) else coalesce(cr.name, r.snapshot->>'name') end as right_name,
           case when r.npi < r.matched_npi then mm.group_id else cm.group_id end as right_group_id,
           r.requested_by,
           r.npi as requested_npi,
           r.snapshot as request_snapshot
      from public.identity_claim_requests r
      left join public.npi_records cr on cr.npi = r.npi
      left join public.npi_records mr on mr.npi = r.matched_npi
      left join lateral (
        select l.company_name from public.leads l
         where l.npi = r.matched_npi order by l.claimed_at desc nulls last limit 1) ml on true
      left join public.lead_group_members cm on cm.npi = r.npi
      left join public.lead_group_members mm on mm.npi = r.matched_npi
     where not public.identity_pair_decided(r.npi, r.matched_npi)
       and exists (
             select 1 from public.leads l
              where l.npi = r.matched_npi and not l.is_disconnected
                and l.claimed_by is not null and l.claimed_by <> r.requested_by)
       and cm.group_id is distinct from mm.group_id
     order by least(r.npi, r.matched_npi), greatest(r.npi, r.matched_npi), r.created_at
  ) q;

revoke all on public.identity_review_queue from anon, authenticated;
