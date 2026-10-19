-- 045_registry_review_speed.sql
-- Fix statement timeouts in duplicate match reviews for both registry and leads scopes.
--
-- Causes of statement timeout:
-- 1. registry_match_candidates has a primary key on (left_npi, right_npi), but lacked an index on
--    (tier, left_npi, right_npi). Filtering on tier (e.g. tier 3) forced Postgres into an index scan across
--    all candidate rows in PK order, evaluating joins on each row until timeout.
-- 2. The generic condition `(p_tier is null or c.tier = p_tier)` prevented the query planner from using a
--    tier index directly. Splitting into explicit branches allows index scans on (tier, left_npi, right_npi).
-- 3. identity_pair_decided() scanned identity_match_decisions without using index lookups unless 040 was run.
-- 4. identity_review_queue (leads scope) pushed the decided check into candidate joins without OFFSET 0 fencing.
--
-- Safe to re-run. No existing data is changed.

begin;

-- 1. Index on candidates for fast tier filtering in key order
create index if not exists idx_registry_match_candidates_tier_left_right
  on public.registry_match_candidates (tier, left_npi, right_npi);

-- 2. Fast identity_pair_decided (replaces full scan with two direct index lookups)
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

-- 3. Fast identity_review_queue (leads scope)
create or replace view public.identity_review_queue as
select c.tier, c.matched_keys,
       c.left_npi, c.left_name, c.left_group_id,
       c.right_npi, c.right_name, c.right_group_id,
       'leads'::text as source,
       null::uuid as requested_by,
       null::text as requested_npi,
       null::jsonb as request_snapshot
  from (select * from public.identity_review_candidates offset 0) c
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

-- 4. Fast registry_review_page with planner-optimized tier branching
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
  if p_tier is not null then
    with cheap as (
      select c.left_npi, c.right_npi, c.tier, c.matched_keys, c.first_build_id,
             lm.group_id as gl, rm.group_id as gr
        from public.registry_match_candidates c
        left join public.lead_group_members lm on lm.npi = c.left_npi
        left join public.lead_group_members rm on rm.npi = c.right_npi
       where c.tier = p_tier
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
  else
    with cheap as (
      select c.left_npi, c.right_npi, c.tier, c.matched_keys, c.first_build_id,
             lm.group_id as gl, rm.group_id as gr
        from public.registry_match_candidates c
        left join public.lead_group_members lm on lm.npi = c.left_npi
        left join public.lead_group_members rm on rm.npi = c.right_npi
       where (p_after_left is null or (c.left_npi, c.right_npi) > (p_after_left, coalesce(p_after_right, '')))
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
  end if;

  return jsonb_build_object('rows', v_rows, 'hasMore', v_has_more, 'next', v_next);
end;
$$;

revoke all on function public.registry_review_page(integer, text, text, integer) from public, anon, authenticated;
grant execute on function public.registry_review_page(integer, text, text, integer) to service_role;

commit;
