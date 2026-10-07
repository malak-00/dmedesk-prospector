-- DME Desk Prospector: registry-wide identity matching over npi_records.
-- MANUAL ONLY: review against the live schema, and try it on a Supabase branch
-- before production. Run after 008, 009, 010. Plan:
-- documentation/plans/REGISTRY_WIDE_IDENTITY_MATCHING_PLAN.md
--
-- sql/008 and sql/010 flag Tier 2/3 pairs only between ACTIVE LEADS. This adds
-- the same comparison over every organization NPI in npi_records, so a pair
-- like two NPIs run by the same official shows up before anyone claims them.
--
-- Differences from the lead-only view, all deliberate:
--   * Phone matches on EITHER number: an NPI's location phone or its
--     authorized official's phone. 008's identity_phone_key uses the location
--     phone and only falls back to the official's, so two NPIs with the same
--     official and official phone but different location phones never matched.
--   * Pairs are precomputed (this file) and rebuilt after each monthly NPPES
--     refresh, because a live self-join over the registry is not viable.
--   * A key bucket larger than the cap (default 25 NPIs) is not paired. A
--     billing company's phone or a common name would otherwise make thousands
--     of meaningless pairs. Skipped buckets are listed in
--     registry_match_big_buckets.
--
-- Tier rules are exactly 008's:
--   Tier 1 / Tier 2 auto-group  name+official+phone   not a review pair
--   Tier 2 review               name+state+phone | name+state+official | state+official+phone
--   Tier 3 review               official+phone | name+phone | name+official
--
-- Nothing here changes ownership, groups or leads. The only existing object
-- replaced is resolve_identity_match (section 6), which behaves as before for
-- NPIs that already have a group.
--
-- Every function is batched/sharded so each PostgREST call stays well under
-- the statement timeout; scripts/nppes_ingest/registry_match.py drives them.

begin;

-- ---- 1. keys, one row per qualifying organization NPI ---------------------------

create table if not exists public.npi_identity_keys (
  npi text primary key,
  name_key text not null,
  state_key text not null default '',
  official_key text not null default '',
  phones text[] not null default '{}',
  keys_hash text not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_npi_identity_keys_official on public.npi_identity_keys (official_key) where official_key <> '';
create index if not exists idx_npi_identity_keys_name on public.npi_identity_keys (name_key);

alter table public.npi_identity_keys enable row level security;
revoke all on public.npi_identity_keys from anon, authenticated;

-- Upserts keys for up to p_batch_size organization NPIs after p_after (NPI
-- order) and deletes the keys of any NPI in the batch that no longer
-- qualifies. Only rows whose keys changed are written, so a monthly pass
-- touches little. Loop until done = true, passing last_npi back as p_after.
create or replace function public.refresh_npi_identity_keys(p_after text default '', p_batch_size integer default 20000)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_processed integer;
  v_last text;
  v_written integer;
begin
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 100000 then
    raise exception 'p_batch_size must be between 1 and 100000';
  end if;

  with batch as (
    select r.npi, r.name, r.address_state, r.authorizedofficial_firstname, r.authorizedofficial_lastname,
           r.phone, r.authorizedofficial_phone
      from public.npi_records r
     where r.enumerationtype = 'NPI-2'
       and r.npi > coalesce(p_after, '')
     order by r.npi
     limit p_batch_size
  ), keyed as (
    select b.npi,
           public.identity_name_key(b.name) as name_key,
           public.identity_state_key(b.address_state) as state_key,
           public.identity_official_key(b.authorizedofficial_firstname, b.authorizedofficial_lastname) as official_key,
           array(select distinct x from unnest(array[
             public.identity_phone_key(b.phone, null),
             public.identity_phone_key(b.authorizedofficial_phone, null)]) as x
            where x <> '' order by x) as phones
      from batch b
  ), qualified as (
    select k.*,
           md5(concat_ws('|', k.name_key, k.state_key, k.official_key, array_to_string(k.phones, ','))) as keys_hash
      from keyed k
     where k.name_key <> '' and (k.official_key <> '' or cardinality(k.phones) > 0)
  ), up as (
    insert into public.npi_identity_keys as t (npi, name_key, state_key, official_key, phones, keys_hash)
    select q.npi, q.name_key, q.state_key, q.official_key, q.phones, q.keys_hash from qualified q
    on conflict (npi) do update
       set name_key = excluded.name_key, state_key = excluded.state_key,
           official_key = excluded.official_key, phones = excluded.phones,
           keys_hash = excluded.keys_hash, updated_at = now()
     where t.keys_hash is distinct from excluded.keys_hash
    returning 1
  ), del as (
    delete from public.npi_identity_keys t
     using keyed k
     where t.npi = k.npi and not exists (select 1 from qualified q where q.npi = k.npi)
    returning 1
  )
  select (select count(*) from keyed), (select max(npi) from keyed),
         (select count(*) from up) + (select count(*) from del)
    into v_processed, v_last, v_written;

  return jsonb_build_object(
    'processed', v_processed,
    'written', v_written,
    'last_npi', v_last,
    'done', v_processed < p_batch_size
  );
end;
$$;

revoke all on function public.refresh_npi_identity_keys(text, integer) from public, anon, authenticated;
grant execute on function public.refresh_npi_identity_keys(text, integer) to service_role;

-- ---- 2. candidate pairs -----------------------------------------------------------

create table if not exists public.registry_match_builds (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  max_bucket integer not null,
  pairs integer,
  new_pairs integer,
  removed_pairs integer,
  big_buckets integer
);

create table if not exists public.registry_match_candidates (
  left_npi text not null,
  right_npi text not null,
  tier integer not null check (tier in (2, 3)),
  matched_keys text not null,
  first_build_id uuid not null references public.registry_match_builds(id),
  last_build_id uuid not null references public.registry_match_builds(id),
  primary key (left_npi, right_npi),
  check (left_npi < right_npi)
);

create index if not exists idx_registry_match_candidates_right on public.registry_match_candidates (right_npi);
create index if not exists idx_registry_match_candidates_last_build on public.registry_match_candidates (last_build_id);

create table if not exists public.registry_match_big_buckets (
  build_id uuid not null references public.registry_match_builds(id),
  bucket_type text not null,
  bucket_key text not null,
  member_count integer not null,
  primary key (build_id, bucket_type, bucket_key)
);

alter table public.registry_match_builds enable row level security;
alter table public.registry_match_candidates enable row level security;
alter table public.registry_match_big_buckets enable row level security;
revoke all on public.registry_match_builds from anon, authenticated;
revoke all on public.registry_match_candidates from anon, authenticated;
revoke all on public.registry_match_big_buckets from anon, authenticated;

create or replace function public.start_registry_match_build(p_max_bucket integer default 25)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_max_bucket is null or p_max_bucket < 2 or p_max_bucket > 500 then
    raise exception 'p_max_bucket must be between 2 and 500';
  end if;
  if exists (select 1 from public.registry_match_builds
              where finished_at is null and started_at > now() - interval '6 hours') then
    raise exception 'a registry match build is already in progress; wait for it or let it expire (6 hours)';
  end if;
  insert into public.registry_match_builds (max_bucket) values (p_max_bucket) returning id into v_id;
  return v_id;
end;
$$;

-- One shard of the pair build. A bucket (official+phone, name+phone or
-- name+official) belongs to exactly one shard, so shards are independent and
-- can be run in any order or re-run. A pair found through several buckets is
-- stored once. Tier and matched keys are judged from the two NPIs' keys, not
-- from the bucket that surfaced the pair.
create or replace function public.build_registry_match_shard(
  p_build uuid, p_shard integer, p_shards integer default 64)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_max integer;
  v_pairs integer;
  v_big integer;
begin
  select max_bucket into v_max from public.registry_match_builds
   where id = p_build and finished_at is null;
  if v_max is null then
    raise exception 'build % is unknown or already finished', p_build;
  end if;
  if p_shards < 1 or p_shard < 0 or p_shard >= p_shards then
    raise exception 'shard must be in 0..shards-1';
  end if;

  with m as (
    select 'op'::text as bt, k.official_key || '|' || ph as bk, k.npi
      from public.npi_identity_keys k cross join lateral unnest(k.phones) as ph
     where k.official_key <> ''
    union all
    select 'np', k.name_key || '|' || ph, k.npi
      from public.npi_identity_keys k cross join lateral unnest(k.phones) as ph
    union all
    select 'no', k.name_key || '|' || k.official_key, k.npi
      from public.npi_identity_keys k
     where k.official_key <> ''
  ), s as (
    select * from m
     where (hashtext(bt || ':' || bk)::bigint & 2147483647) % p_shards = p_shard
  ), sized as (
    select bt, bk, count(*) as c from s group by bt, bk having count(*) > 1
  ), big as (
    insert into public.registry_match_big_buckets (build_id, bucket_type, bucket_key, member_count)
    select p_build, z.bt, z.bk, z.c from sized z where z.c > v_max
    on conflict do nothing
    returning 1
  ), pairs as (
    select distinct a.npi as l, b.npi as r
      from s a
      join s b on b.bt = a.bt and b.bk = a.bk and a.npi < b.npi
      join sized z on z.bt = a.bt and z.bk = a.bk
     where z.c <= v_max
  ), flags as (
    select p.l, p.r,
           (ka.name_key = kb.name_key) as n,
           (ka.state_key <> '' and ka.state_key = kb.state_key) as s,
           (ka.official_key <> '' and ka.official_key = kb.official_key) as o,
           (ka.phones && kb.phones) as p
      from pairs p
      join public.npi_identity_keys ka on ka.npi = p.l
      join public.npi_identity_keys kb on kb.npi = p.r
  ), ruled as (
    select f.l, f.r,
           case when n and o and p then null
                when n and s and p then 2
                when n and s and o then 2
                when s and o and p then 2
                when o and p then 3
                when n and p then 3
                when n and o then 3 end as tier,
           case when n and o and p then null
                when n and s and p then 'name+state+phone'
                when n and s and o then 'name+state+official'
                when s and o and p then 'state+official+phone'
                when o and p then 'official+phone'
                when n and p then 'name+phone'
                when n and o then 'name+official' end as matched_keys
      from flags f
  ), up as (
    insert into public.registry_match_candidates as t (left_npi, right_npi, tier, matched_keys, first_build_id, last_build_id)
    select r.l, r.r, r.tier, r.matched_keys, p_build, p_build from ruled r where r.tier is not null
    on conflict (left_npi, right_npi) do update
       set tier = excluded.tier, matched_keys = excluded.matched_keys, last_build_id = excluded.last_build_id
    returning 1
  )
  select (select count(*) from up), (select count(*) from big) into v_pairs, v_big;

  return jsonb_build_object('shard', p_shard, 'pairs', v_pairs, 'big_buckets', v_big);
end;
$$;

-- Ends a build: pairs not re-found by this build (an official or phone changed,
-- an NPI stopped qualifying) are removed, and the summary row is filled in.
-- Run only after every shard of the build has completed.
create or replace function public.finish_registry_match_build(p_build uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_removed integer;
  v_pairs integer;
  v_new integer;
  v_big integer;
begin
  if not exists (select 1 from public.registry_match_builds where id = p_build and finished_at is null) then
    raise exception 'build % is unknown or already finished', p_build;
  end if;

  delete from public.registry_match_candidates where last_build_id <> p_build;
  get diagnostics v_removed = row_count;
  delete from public.registry_match_big_buckets where build_id <> p_build;

  select count(*), count(*) filter (where first_build_id = p_build) into v_pairs, v_new
    from public.registry_match_candidates;
  select count(*) into v_big from public.registry_match_big_buckets where build_id = p_build;

  update public.registry_match_builds
     set finished_at = now(), pairs = v_pairs, new_pairs = v_new, removed_pairs = v_removed, big_buckets = v_big
   where id = p_build;

  return jsonb_build_object('pairs', v_pairs, 'new_pairs', v_new, 'removed_pairs', v_removed, 'big_buckets', v_big);
end;
$$;

revoke all on function public.start_registry_match_build(integer) from public, anon, authenticated;
revoke all on function public.build_registry_match_shard(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.finish_registry_match_build(uuid) from public, anon, authenticated;
grant execute on function public.start_registry_match_build(integer) to service_role;
grant execute on function public.build_registry_match_shard(uuid, integer, integer) to service_role;
grant execute on function public.finish_registry_match_build(uuid) to service_role;

-- ---- 3. review queue over the registry ---------------------------------------------
--
-- Same leading columns as identity_review_queue so the Worker can read either.
-- Excludes pairs an admin already decided (group-aware, via
-- identity_pair_decided) and pairs already in one group. Appended columns say
-- whether each side is an active lead and when the pair first appeared.

create or replace view public.registry_review_queue as
select c.tier, c.matched_keys,
       c.left_npi, lr.name as left_name, lm.group_id as left_group_id,
       c.right_npi, rr.name as right_name, rm.group_id as right_group_id,
       'registry'::text as source,
       exists (select 1 from public.leads l where l.npi = c.left_npi and not l.is_disconnected) as left_is_lead,
       exists (select 1 from public.leads l where l.npi = c.right_npi and not l.is_disconnected) as right_is_lead,
       b.finished_at as first_seen_at
  from public.registry_match_candidates c
  join public.registry_match_builds b on b.id = c.first_build_id
  left join public.npi_records lr on lr.npi = c.left_npi
  left join public.npi_records rr on rr.npi = c.right_npi
  left join public.lead_group_members lm on lm.npi = c.left_npi
  left join public.lead_group_members rm on rm.npi = c.right_npi
 where (lm.group_id is null or rm.group_id is null or lm.group_id <> rm.group_id)
   and not public.identity_pair_decided(c.left_npi, c.right_npi);

revoke all on public.registry_review_queue from anon, authenticated;

comment on view public.registry_review_queue is
  'Tier 2/3 identity pairs found across all organization NPIs in npi_records (rebuilt after each NPPES refresh) that no admin has decided and that are not already one group.';

-- ---- 4. resolve_identity_match for NPIs with no group yet --------------------------
--
-- Registry pairs often involve an NPI nobody has claimed, which has no
-- lead_group_members row. A merge now creates the missing membership from
-- npi_records (ensure_identity_membership, sql/010) and then merges as before.
-- Everything else in this function is unchanged from sql/009.

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

  perform pg_advisory_xact_lock(hashtext('identity_match:' || v_left || ':' || v_right));

  if exists (select 1 from public.identity_match_decisions where left_npi = v_left and right_npi = v_right) then
    raise exception 'this pair has already been decided';
  end if;

  if p_decision = 'merged' then
    -- NEW in 030: give a registry-only NPI its group so it can be merged.
    if not exists (select 1 from public.lead_group_members where npi = v_left) then
      perform public.ensure_identity_membership(jsonb_build_object('npi', v_left));
    end if;
    if not exists (select 1 from public.lead_group_members where npi = v_right) then
      perform public.ensure_identity_membership(jsonb_build_object('npi', v_right));
    end if;

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

commit;

-- First load (run from scripts/, which drives these in batches):
--   python -m nppes_ingest --match-registry
-- Manual equivalent, read-only checks afterwards:
-- select count(*) from public.npi_identity_keys;
-- select * from public.registry_match_builds order by started_at desc limit 3;
-- select tier, matched_keys, count(*) from public.registry_review_queue group by 1, 2 order by 1, 2;
-- The five NPIs from the 2026-10-07 example:
-- select * from public.registry_review_queue
--  where left_npi in ('1598576696','1902722879','1396559274','1801616321','1164310546')
--    and right_npi in ('1598576696','1902722879','1396559274','1801616321','1164310546');
