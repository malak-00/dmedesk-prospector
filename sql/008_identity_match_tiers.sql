-- DME Desk Prospector: three-tier identity matching + regroup of existing leads.
-- MANUAL ONLY: review against the live schema before execution.
-- Run after 001, 002_safe, 005 and 006 (006 expects its two known conflict
-- groups to still have exactly two members). Take a fresh backup first --
-- this moves group memberships.
--
-- Keys (legal suffixes stripped from the name in every tier):
--   N = organization name   S = state   O = authorized official (first + last,
--   middle names/initials ignored)   P = phone (location first, authorized
--   official phone as fallback)
--
--   Tier 1  N+S+O+P                  auto-group
--   Tier 2  N+O+P                    auto-group (same business across states)
--   Tier 2  N+S+P | N+S+O | S+O+P    flag for review
--   Tier 3  O+P | N+P | N+O          flag for review
--
-- Tier 1 is a subset of N+O+P, so one group key without state
-- ('group:<name>|<official>|<phone>') implements both auto-group tiers.
--
-- The normalization below mirrors worker/src/services/leadPreflight.js.
-- Change one and you must change the other. (JS additionally strips accents;
-- NPPES names are plain ASCII, so the two agree on real data.) Fuzzy name
-- matching lives only in the Worker; the review view here uses exact keys.
--
-- What this file does:
--   1. Installs the key functions.
--   2. Allows grouping_tier = 'cross_state'.
--   3. Recomputes every lead's group key and moves memberships that were
--      assigned automatically. Memberships a person reviewed (reviewed_by
--      set) or marked as anything other than 'primary' are never moved.
--   4. Writes one pending 'conflict_detected' event per active claim in every
--      group that regrouping newly split across more than one owner. Those
--      groups show up in the Admin tab's Ownership conflicts panel.
--      Steps 3 and 4 run as one DO block, so they don't depend on the SQL
--      Editor keeping separate statements in one session.
--   5. Creates public.identity_review_candidates, the Tier 2/3 review pairs.
--
-- Old groups left with no members are kept (audit events reference them).
-- Rerun-safe: a second run moves nothing and writes no duplicate events.

begin;

do $$
begin
  if not exists (select 1 from public.npi_records limit 1) then
    raise exception 'public.npi_records is empty or unavailable; stop before regrouping';
  end if;
end $$;

-- ---- 1. key functions -------------------------------------------------------

create or replace function public.identity_normalize_text(p_value text)
returns text
language sql immutable parallel safe
as $$
  select btrim(regexp_replace(
    lower(regexp_replace(coalesce(p_value, ''), '[.'']', '', 'g')),
    '[^a-z0-9]+', ' ', 'g'))
$$;

create or replace function public.identity_name_key(p_name text)
returns text
language sql immutable parallel safe
as $$
  select coalesce(array_to_string(array(
    select u.token
      from unnest(string_to_array(public.identity_normalize_text(p_name), ' ')) with ordinality as u(token, pos)
     where u.token <> ''
       and u.token <> all (array['inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation',
                                 'co', 'company', 'pc', 'pllc', 'lp', 'llp'])
     order by u.pos
  ), ' '), '')
$$;

create or replace function public.identity_official_key(p_first text, p_last text)
returns text
language sql immutable parallel safe
as $$
  select coalesce(array_to_string(array(
    select u.token
      from unnest(string_to_array(public.identity_normalize_text(concat_ws(' ', p_first, p_last)), ' ')) with ordinality as u(token, pos)
     where length(u.token) > 1
     order by u.pos
  ), ' '), '')
$$;

create or replace function public.identity_phone_key(p_phone text, p_official_phone text)
returns text
language sql immutable parallel safe
as $$
  select coalesce(
    (regexp_match(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '^1?([0-9]{10})'))[1],
    (regexp_match(regexp_replace(coalesce(p_official_phone, ''), '[^0-9]', '', 'g'), '^1?([0-9]{10})'))[1],
    ''
  )
$$;

create or replace function public.identity_state_key(p_state text)
returns text
language sql immutable parallel safe
as $$
  select upper(regexp_replace(coalesce(p_state, ''), '[^A-Za-z]', '', 'g'))
$$;

revoke all on function public.identity_normalize_text(text) from public, anon, authenticated;
revoke all on function public.identity_name_key(text) from public, anon, authenticated;
revoke all on function public.identity_official_key(text, text) from public, anon, authenticated;
revoke all on function public.identity_phone_key(text, text) from public, anon, authenticated;
revoke all on function public.identity_state_key(text) from public, anon, authenticated;

-- ---- 2. grouping tier values -----------------------------------------------

alter table public.lead_groups drop constraint if exists lead_groups_grouping_tier_check;
alter table public.lead_groups add constraint lead_groups_grouping_tier_check
  check (grouping_tier in ('strict', 'cross_state', 'singleton', 'review'));

-- ---- 3 + 4. regroup and flag newly conflicted groups -----------------------
--
-- One DO block on purpose: its temp tables live inside a single statement, so
-- this works even when the SQL Editor does not keep separate statements in one
-- session/transaction (or when only part of the file is run).

do $$
begin
  drop table if exists pg_temp.regroup_candidates;
  drop table if exists pg_temp.regroup_moves;

  create temporary table regroup_candidates on commit drop as
  with source_rows as (
    select distinct on (l.npi)
      l.npi, r.name, r.address_state,
      r.authorizedofficial_firstname, r.authorizedofficial_lastname,
      r.phone, r.authorizedofficial_phone,
      (r.npi is not null) as in_npi_records,
      l.company_name as lead_name, l.state as lead_state, l.phone as lead_phone,
      case when l.contact_source = 'nppes' then l.contact_name end as lead_official,
      case when l.contact_source = 'nppes' then l.contact_phone end as lead_official_phone
    from public.leads l
    left join public.npi_records r on r.npi = l.npi
    order by l.npi, l.claimed_at desc nulls last
  ), keyed as (
    -- New keys: npi_records when the NPI is there, otherwise the lead's own
    -- columns (same identity sql/010's claim uses). The old_* keys below stay
    -- npi_records-only, exactly as 002 computed them.
    select s.*,
           public.identity_name_key(case when s.in_npi_records then s.name else s.lead_name end) as name_key,
           public.identity_state_key(case when s.in_npi_records then s.address_state else s.lead_state end) as state_key,
           case when s.in_npi_records
                then public.identity_official_key(s.authorizedofficial_firstname, s.authorizedofficial_lastname)
                else public.identity_official_key(s.lead_official, null) end as official_key,
           case when s.in_npi_records
                then public.identity_phone_key(s.phone, s.authorizedofficial_phone)
                else public.identity_phone_key(s.lead_phone, s.lead_official_phone) end as phone_key,
           -- The key sql/002_identity_backfill_safe.sql grouped this lead by.
           -- Used to tell a conflict regrouping created from one that already
           -- existed, without needing a snapshot taken earlier in this run.
           upper(regexp_replace(coalesce(s.name, ''), '[^A-Za-z0-9]', '', 'g')) as old_name_key,
           upper(regexp_replace(coalesce(s.address_state, ''), '[^A-Za-z]', '', 'g')) as old_state_key,
           upper(regexp_replace(concat_ws(' ', s.authorizedofficial_firstname, s.authorizedofficial_lastname), '[^A-Za-z0-9]', '', 'g')) as old_official_key,
           coalesce(
             (regexp_match(regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g'), '(?:^1)?([0-9]{10})'))[1],
             (regexp_match(regexp_replace(coalesce(s.authorizedofficial_phone, ''), '[^0-9]', '', 'g'), '(?:^1)?([0-9]{10})'))[1],
             '') as old_phone_key
    from source_rows s
  )
  select k.*,
         case when k.name_key <> '' and k.official_key <> '' and k.phone_key <> ''
              then 'group:' || k.name_key || '|' || k.official_key || '|' || k.phone_key
              else 'singleton:' || k.npi end as identity_key,
         case when k.old_name_key <> '' and k.old_state_key <> '' and k.old_official_key <> '' and k.old_phone_key <> ''
              then 'strict:' || k.old_name_key || ':' || k.old_state_key || ':' || k.old_official_key || ':' || k.old_phone_key
              else 'singleton:' || k.npi end as old_identity_key
  from keyed k;

  insert into public.lead_groups
    (identity_key, canonical_name, state, authorized_official, phone_key, grouping_tier)
  select c.identity_key,
         min(coalesce(c.name, c.lead_name)),
         case when count(distinct nullif(c.state_key, '')) <= 1 then min(nullif(c.state_key, '')) end,
         nullif(min(coalesce(nullif(concat_ws(' ', c.authorizedofficial_firstname, c.authorizedofficial_lastname), ''), c.lead_official)), ''),
         nullif(min(c.phone_key), ''),
         case when c.identity_key like 'singleton:%' then 'singleton'
              when count(distinct nullif(c.state_key, '')) > 1 then 'cross_state'
              else 'strict' end
  from regroup_candidates c
  group by c.identity_key
  on conflict (identity_key) do update set
    state = excluded.state,
    grouping_tier = excluded.grouping_tier,
    canonical_name = coalesce(public.lead_groups.canonical_name, excluded.canonical_name),
    authorized_official = coalesce(public.lead_groups.authorized_official, excluded.authorized_official),
    phone_key = coalesce(public.lead_groups.phone_key, excluded.phone_key),
    updated_at = now();

  create temporary table regroup_moves on commit drop as
  select m.npi, m.group_id as from_group_id, g.id as to_group_id, c.identity_key
    from public.lead_group_members m
    join regroup_candidates c on c.npi = m.npi
    join public.lead_groups g on g.identity_key = c.identity_key
   where m.group_id <> g.id
     and m.reviewed_by is null
     and m.relationship_type = 'primary';

  update public.lead_group_members m
     set group_id = mv.to_group_id,
         evidence = m.evidence || jsonb_build_object('regrouped', jsonb_build_object(
           'rule', 'identity_match_tiers_008',
           'from_group_id', mv.from_group_id,
           'identity_key', mv.identity_key,
           'at', now()))
    from regroup_moves mv
   where mv.npi = m.npi;

  insert into public.lead_group_members
    (group_id, npi, relationship_type, review_status, evidence)
  select g.id, c.npi, 'primary', 'approved',
         jsonb_build_object('backfill', true, 'rule', 'identity_match_tiers_008', 'identity_key', c.identity_key)
    from regroup_candidates c
    join public.lead_groups g on g.identity_key = c.identity_key
  on conflict (npi) do nothing;

  update public.leads l
     set group_id = m.group_id
    from public.lead_group_members m
   where m.npi = l.npi
     and l.group_id is distinct from m.group_id;

  -- Flag each active claim in a group that is conflicted now, unless all of
  -- that group's claims already shared one pre-008 group (that conflict
  -- existed before and was already visible).
  insert into public.lead_ownership_events
    (lead_id, npi, group_id, event_type, reason, source, requires_review, review_status, metadata)
  select l.id, l.npi, l.group_id, 'conflict_detected',
         'Identity regrouping placed this claim in a group with active claims held by other users',
         'identity_match_tiers_008', true, 'pending',
         jsonb_build_object('owner_user_id', l.claimed_by, 'identity_key', g.identity_key, 'grouping_tier', g.grouping_tier)
    from public.leads l
    join public.lead_groups g on g.id = l.group_id
   where not l.is_disconnected
     and l.claimed_by is not null
     and l.group_id in (
       select x.group_id from public.leads x
         join regroup_candidates c on c.npi = x.npi
        where not x.is_disconnected and x.claimed_by is not null and x.group_id is not null
        group by x.group_id
       having count(distinct x.claimed_by) > 1
          and count(distinct c.old_identity_key) > 1)
     and not exists (
       select 1 from public.lead_ownership_events e
        where e.lead_id = l.id
          and e.group_id = l.group_id
          and e.event_type = 'conflict_detected'
          and e.source = 'identity_match_tiers_008');
end $$;

-- ---- 5. Tier 2 / Tier 3 review pairs ---------------------------------------

create or replace view public.identity_review_candidates as
with active_leads as (
  select distinct on (l.npi) l.npi, l.group_id, l.company_name
    from public.leads l
   where not l.is_disconnected
   order by l.npi, l.claimed_at desc nulls last
), keyed as (
  select a.npi, a.group_id, coalesce(r.name, a.company_name) as name,
         public.identity_name_key(r.name) as name_key,
         public.identity_state_key(r.address_state) as state_key,
         public.identity_official_key(r.authorizedofficial_firstname, r.authorizedofficial_lastname) as official_key,
         public.identity_phone_key(r.phone, r.authorizedofficial_phone) as phone_key
    from active_leads a
    left join public.npi_records r on r.npi = a.npi
), pairs as (
  select a.npi as left_npi, b.npi as right_npi from keyed a join keyed b
      on a.npi < b.npi and a.phone_key <> '' and a.phone_key = b.phone_key
  union
  select a.npi, b.npi from keyed a join keyed b
      on a.npi < b.npi and a.official_key <> '' and a.official_key = b.official_key
  union
  select a.npi, b.npi from keyed a join keyed b
      on a.npi < b.npi and a.name_key <> '' and a.name_key = b.name_key
), flags as (
  select p.left_npi, p.right_npi, a.group_id as left_group_id, b.group_id as right_group_id,
         a.name as left_name, b.name as right_name,
         (a.name_key <> '' and a.name_key = b.name_key) as n,
         (a.state_key <> '' and a.state_key = b.state_key) as s,
         (a.official_key <> '' and a.official_key = b.official_key) as o,
         (a.phone_key <> '' and a.phone_key = b.phone_key) as p
    from pairs p
    join keyed a on a.npi = p.left_npi
    join keyed b on b.npi = p.right_npi
), ruled as (
  select f.*,
         case when n and o and p then null  -- Tier 1 / Tier 2 auto-group: already one group
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
)
select tier, matched_keys, left_npi, left_name, left_group_id, right_npi, right_name, right_group_id
  from ruled
 where tier is not null
   and left_group_id is distinct from right_group_id;

revoke all on public.identity_review_candidates from anon, authenticated;

comment on view public.identity_review_candidates is
  'Tier 2/3 identity matches between active leads in different groups. Review-only: nothing here is grouped automatically.';

commit;

-- Verification (read-only):
-- select grouping_tier, count(*) from public.lead_groups group by 1 order by 1;
-- select count(*) as leads_without_group from public.leads where group_id is null;
-- select * from public.ownership_conflicts order by group_name;
-- select source, review_status, count(*) from public.lead_ownership_events
--  where event_type = 'conflict_detected' group by 1, 2;
-- select tier, matched_keys, count(*) from public.identity_review_candidates group by 1, 2 order by 1, 2;
