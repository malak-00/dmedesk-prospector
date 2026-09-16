-- DME Desk Prospector: group-aware claiming.
-- MANUAL ONLY: review against the live schema before execution.
-- Run after 008 and 009. Take a backup first -- the backfill at the bottom
-- adds group memberships for leads created since 008 ran.
--
-- Claim rules, applied per lead inside claim_leads():
--
--   1. The caller already actively claims this NPI      -> skipped
--   2. Anyone else actively claims this NPI, or any NPI
--      in its identity group                            -> blocked
--   3. A Tier 2/3 identity match to an active lead that
--      someone else owns, with no admin decision on that
--      pair yet                                         -> held for review
--      (recorded in identity_claim_requests, so the pair shows in the
--      Admin tab's Possible duplicates list)
--   4. Otherwise                                        -> claimed
--
-- Ownership never changes here: nothing is reassigned, and a blocked or held
-- lead writes no lead row. Group membership IS recorded for every valid NPI,
-- so an admin can merge a held NPI into the owner's group.
--
-- Identity comes from public.npi_records when the NPI is there, otherwise from
-- the search result the Worker sends, using the 008 key functions so keys
-- match the existing groups exactly.
--
-- Concurrency: every group a claim touches is locked (transaction advisory
-- locks, taken in a fixed order) before its ownership is checked, so two
-- simultaneous claims on the same company cannot both succeed. Tier 2/3
-- matches span different groups and are a review signal, not a lock.

begin;

-- ---- identity helpers --------------------------------------------------------

-- Keys for one candidate. p: {npi, name, state, officialFirstName,
-- officialLastName, officialName, phone, officialPhone}. npi_records wins when
-- the NPI is present there, matching how 008 grouped existing leads.
create or replace function public.identity_candidate_keys(p jsonb)
returns table (
  npi text, name text, official text,
  name_key text, state_key text, official_key text, phone_key text,
  identity_key text
)
language sql stable
set search_path = public, pg_temp
as $$
  with c as (
    select btrim(coalesce(p->>'npi', '')) as npi, p
  ), src as (
    select c.npi,
           case when r.npi is not null then r.name else c.p->>'name' end as name,
           case when r.npi is not null then r.address_state else c.p->>'state' end as state,
           case when r.npi is not null then r.authorizedofficial_firstname
                else coalesce(nullif(c.p->>'officialFirstName', ''), c.p->>'officialName') end as first_name,
           case when r.npi is not null then r.authorizedofficial_lastname
                else nullif(c.p->>'officialLastName', '') end as last_name,
           case when r.npi is not null then r.phone else c.p->>'phone' end as phone,
           case when r.npi is not null then r.authorizedofficial_phone else c.p->>'officialPhone' end as official_phone
      from c
      left join public.npi_records r on r.npi = c.npi
  ), keyed as (
    select s.npi, s.name,
           nullif(btrim(concat_ws(' ', s.first_name, s.last_name)), '') as official,
           public.identity_name_key(s.name) as name_key,
           public.identity_state_key(s.state) as state_key,
           public.identity_official_key(s.first_name, s.last_name) as official_key,
           public.identity_phone_key(s.phone, s.official_phone) as phone_key
      from src s
  )
  select k.npi, k.name, k.official, k.name_key, k.state_key, k.official_key, k.phone_key,
         case when k.name_key <> '' and k.official_key <> '' and k.phone_key <> ''
              then 'group:' || k.name_key || '|' || k.official_key || '|' || k.phone_key
              else 'singleton:' || k.npi end
    from keyed k
$$;

-- Finds or creates the identity group for one candidate and its membership.
-- An existing membership (including one an admin reviewed or merged) always
-- wins. Returns the NPI's group id.
create or replace function public.ensure_identity_membership(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  k record;
  v_group_id uuid;
  v_group_state text;
  v_group_tier text;
begin
  select * into k from public.identity_candidate_keys(p);
  if k.npi !~ '^[0-9]{10}$' then
    raise exception 'invalid NPI: %', k.npi;
  end if;

  select group_id into v_group_id from public.lead_group_members where npi = k.npi;
  if v_group_id is not null then
    return v_group_id;
  end if;

  insert into public.lead_groups
    (identity_key, canonical_name, state, authorized_official, phone_key, grouping_tier)
  values
    (k.identity_key, k.name, nullif(k.state_key, ''), k.official, nullif(k.phone_key, ''),
     case when k.identity_key like 'singleton:%' then 'singleton' else 'strict' end)
  on conflict (identity_key) do nothing;

  select id, state, grouping_tier into v_group_id, v_group_state, v_group_tier
    from public.lead_groups where identity_key = k.identity_key;

  -- Same business showing up in a second state (the Tier 2 auto-group rule).
  if v_group_tier = 'strict' and v_group_state is not null and k.state_key <> '' and v_group_state <> k.state_key then
    update public.lead_groups
       set grouping_tier = 'cross_state', state = null, updated_at = now()
     where id = v_group_id;
  end if;

  insert into public.lead_group_members (group_id, npi, relationship_type, review_status, evidence)
  values (v_group_id, k.npi, 'primary', 'approved',
          jsonb_build_object('rule', 'group_aware_claim_010', 'identity_key', k.identity_key))
  on conflict (npi) do nothing;

  select group_id into v_group_id from public.lead_group_members where npi = k.npi;
  return v_group_id;
end;
$$;

-- Gives existing lead rows a group (membership + leads.group_id). Used for
-- "Send to Disconnected" rows and for the backfill below. Identity comes from
-- npi_records, else the lead's own columns (the contact only counts as the
-- authorized official when it came from NPPES).
create or replace function public.assign_lead_groups(p_npis text[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead record;
  v_group_id uuid;
  v_updated integer := 0;
  v_count integer;
begin
  for v_lead in
    select distinct on (l.npi) l.npi, l.company_name, l.state, l.phone,
           l.contact_name, l.contact_phone, l.contact_source
      from public.leads l
     where l.npi = any (coalesce(p_npis, '{}'))
       and l.npi ~ '^[0-9]{10}$'
     order by l.npi, l.claimed_at desc nulls last
  loop
    v_group_id := public.ensure_identity_membership(jsonb_build_object(
      'npi', v_lead.npi,
      'name', v_lead.company_name,
      'state', v_lead.state,
      'phone', v_lead.phone,
      'officialName', case when v_lead.contact_source = 'nppes' then v_lead.contact_name end,
      'officialPhone', case when v_lead.contact_source = 'nppes' then v_lead.contact_phone end));

    update public.leads set group_id = v_group_id
     where npi = v_lead.npi and group_id is distinct from v_group_id;
    get diagnostics v_count = row_count;
    v_updated := v_updated + v_count;
  end loop;
  return v_updated;
end;
$$;

-- True when an admin has already decided between these two businesses: a
-- decision on any NPI of one group against any NPI of the other covers the
-- whole pair of groups ("Not the same business" is about businesses, not
-- individual NPIs).
create or replace function public.identity_pair_decided(p_a text, p_b text)
returns boolean
language sql stable
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
  select exists (
    select 1 from public.identity_match_decisions d
     where (d.left_npi in (select npi from ga) and d.right_npi in (select npi from gb))
        or (d.left_npi in (select npi from gb) and d.right_npi in (select npi from ga)))
$$;

-- 008's Tier 2/3 view, now keyed with identity_candidate_keys so leads whose
-- NPI is missing from npi_records are matched from their own columns (the
-- same identity the claim and the regroup use). Columns are unchanged.
create or replace view public.identity_review_candidates as
with active_leads as (
  select distinct on (l.npi) l.npi, l.group_id, l.company_name, l.state, l.phone,
         l.contact_name, l.contact_phone, l.contact_source
    from public.leads l
   where not l.is_disconnected
   order by l.npi, l.claimed_at desc nulls last
), keyed as (
  select a.npi, a.group_id, coalesce(k.name, a.company_name) as name,
         k.name_key, k.state_key, k.official_key, k.phone_key
    from active_leads a
   cross join lateral public.identity_candidate_keys(jsonb_build_object(
     'npi', a.npi, 'name', a.company_name, 'state', a.state, 'phone', a.phone,
     'officialName', case when a.contact_source = 'nppes' then a.contact_name end,
     'officialPhone', case when a.contact_source = 'nppes' then a.contact_phone end)) k
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
)
select tier, matched_keys, left_npi, left_name, left_group_id, right_npi, right_name, right_group_id
  from ruled
 where tier is not null
   and left_group_id is distinct from right_group_id;

-- ---- review requests ---------------------------------------------------------

-- A claim held because of a Tier 2/3 match to someone else's lead. The pair
-- stays in the review queue until identity_match_decisions has a decision
-- for it.
create table if not exists public.identity_claim_requests (
  id uuid primary key default gen_random_uuid(),
  npi text not null,
  requested_by uuid not null references public.app_users(id),
  matched_npi text not null,
  tier integer not null,
  matched_keys text not null,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (npi, matched_npi, requested_by)
);

create index if not exists idx_identity_claim_requests_pair
  on public.identity_claim_requests (least(npi, matched_npi), greatest(npi, matched_npi));

alter table public.identity_claim_requests enable row level security;
revoke all on public.identity_claim_requests from anon, authenticated;

-- Pending review pairs: lead-vs-lead pairs (from 008/009) plus held claim
-- requests. New columns are appended so 009's column order is unchanged.
create or replace view public.identity_review_queue as
select c.tier, c.matched_keys,
       c.left_npi, c.left_name, c.left_group_id,
       c.right_npi, c.right_name, c.right_group_id,
       'leads'::text as source,
       null::uuid as requested_by,
       null::text as requested_npi,
       null::jsonb as request_snapshot
  from public.identity_review_candidates c
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
       -- Still relevant: the matched lead is actively held by someone other
       -- than the requester, and the two NPIs are not already one group.
       and exists (
             select 1 from public.leads l
              where l.npi = r.matched_npi and not l.is_disconnected
                and l.claimed_by is not null and l.claimed_by <> r.requested_by)
       and cm.group_id is distinct from mm.group_id
     order by least(r.npi, r.matched_npi), greatest(r.npi, r.matched_npi), r.created_at
  ) q;

revoke all on public.identity_review_queue from anon, authenticated;

comment on view public.identity_review_queue is
  'Tier 2/3 identity pairs awaiting an admin merge/dismiss decision: lead-vs-lead pairs and claims held for review.';

-- ---- claim -------------------------------------------------------------------

-- p_leads: [{ npi, identity: {name, state, officialName, phone, officialPhone},
--             lead: {<public.leads columns>} }]
-- Returns { claimed: [...], blocked: [...], held: [...], skipped: [...] }.
create or replace function public.claim_leads(p_user_id uuid, p_leads jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item jsonb;
  v_npi text;
  v_seen text[] := '{}';
  v_work jsonb := '[]'::jsonb;
  v_entry jsonb;
  v_group_id uuid;
  v_lock_group uuid;
  v_matches jsonb;
  v_owners jsonb;
  v_lead jsonb;
  v_cols text;
  v_lead_id uuid;
  v_claimed jsonb := '[]'::jsonb;
  v_blocked jsonb := '[]'::jsonb;
  v_held jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
begin
  if p_user_id is null or not exists (select 1 from public.app_users where id = p_user_id) then
    raise exception 'claiming user % does not exist', p_user_id;
  end if;
  if p_leads is null or jsonb_typeof(p_leads) <> 'array' or jsonb_array_length(p_leads) = 0 then
    raise exception 'p_leads must be a non-empty array';
  end if;

  -- 1. Validate, de-duplicate, and record group membership for each NPI.
  for v_item in select value from jsonb_array_elements(p_leads)
  loop
    v_npi := btrim(coalesce(v_item->>'npi', ''));
    if v_npi !~ '^[0-9]{10}$' then
      v_skipped := v_skipped || jsonb_build_object('npi', v_npi, 'reason', 'invalid_npi');
      continue;
    end if;
    if v_npi = any (v_seen) then
      v_skipped := v_skipped || jsonb_build_object('npi', v_npi, 'reason', 'duplicate_in_request');
      continue;
    end if;
    v_seen := v_seen || v_npi;

    v_group_id := public.ensure_identity_membership(
      coalesce(v_item->'identity', '{}'::jsonb) || jsonb_build_object('npi', v_npi));
    v_work := v_work || jsonb_build_object(
      'npi', v_npi,
      'group_id', v_group_id,
      'identity', coalesce(v_item->'identity', '{}'::jsonb),
      'lead', coalesce(v_item->'lead', '{}'::jsonb) || jsonb_build_object('npi', v_npi));
  end loop;

  -- 2. Lock every touched group in a fixed order before checking ownership.
  for v_lock_group in
    select distinct (e->>'group_id')::uuid from jsonb_array_elements(v_work) e order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended('lead_group:' || v_lock_group::text, 0));
  end loop;

  -- 3. Tier 2/3 matches against other users' active leads, for all candidates
  --    at once. Exact keys, same rules as identity_review_candidates.
  with cand as (
    select (e->>'group_id')::uuid as group_id, k.*
      from jsonb_array_elements(v_work) e
     cross join lateral public.identity_candidate_keys(e->'identity' || jsonb_build_object('npi', e->>'npi')) k
  ), others as (
    select distinct on (l.npi, l.claimed_by)
           l.npi, l.claimed_by, l.group_id, l.company_name, k.name_key, k.state_key, k.official_key, k.phone_key
      from public.leads l
     cross join lateral public.identity_candidate_keys(jsonb_build_object(
       'npi', l.npi, 'name', l.company_name, 'state', l.state, 'phone', l.phone,
       'officialName', case when l.contact_source = 'nppes' then l.contact_name end,
       'officialPhone', case when l.contact_source = 'nppes' then l.contact_phone end)) k
     where not l.is_disconnected
       and l.claimed_by is not null
       and l.claimed_by <> p_user_id
     order by l.npi, l.claimed_by, l.claimed_at desc nulls last
  ), flags as (
    select c.npi as cand_npi, o.npi as other_npi, o.claimed_by, o.company_name,
           (c.name_key <> '' and c.name_key = o.name_key) as n,
           (c.state_key <> '' and c.state_key = o.state_key) as s,
           (c.official_key <> '' and c.official_key = o.official_key) as o_,
           (c.phone_key <> '' and c.phone_key = o.phone_key) as p,
           c.group_id as cand_group, o.group_id as other_group
      from cand c
      join others o
        on o.npi <> c.npi
       and ((c.phone_key <> '' and c.phone_key = o.phone_key)
         or (c.official_key <> '' and c.official_key = o.official_key)
         or (c.name_key <> '' and c.name_key = o.name_key))
  ), ruled as (
    select f.*,
           case when n and o_ and p then null
                when n and s and p then 2 when n and s and o_ then 2 when s and o_ and p then 2
                when o_ and p then 3 when n and p then 3 when n and o_ then 3 end as tier,
           case when n and o_ and p then null
                when n and s and p then 'name+state+phone'
                when n and s and o_ then 'name+state+official'
                when s and o_ and p then 'state+official+phone'
                when o_ and p then 'official+phone'
                when n and p then 'name+phone'
                when n and o_ then 'name+official' end as matched_keys
      from flags f
  )
  select coalesce(jsonb_object_agg(cand_npi, matches), '{}'::jsonb) into v_matches
    from (
      select r.cand_npi,
             jsonb_agg(jsonb_build_object(
               'npi', r.other_npi,
               'companyName', coalesce(nr.name, r.company_name),
               'tier', r.tier,
               'matchedKeys', r.matched_keys,
               'ownerUserId', r.claimed_by,
               'ownerDisplayName', u.display_name,
               'groupId', r.other_group) order by r.tier, r.other_npi) as matches
        from ruled r
        left join public.npi_records nr on nr.npi = r.other_npi
        left join public.app_users u on u.id = r.claimed_by
       where r.tier is not null
         and r.cand_group is distinct from r.other_group
         and not public.identity_pair_decided(r.cand_npi, r.other_npi)
       group by r.cand_npi
    ) m;

  -- 4. Decide each lead.
  for v_entry in select value from jsonb_array_elements(v_work)
  loop
    v_npi := v_entry->>'npi';
    v_group_id := (v_entry->>'group_id')::uuid;

    if exists (select 1 from public.leads
                where npi = v_npi and claimed_by = p_user_id and not is_disconnected) then
      v_skipped := v_skipped || jsonb_build_object('npi', v_npi, 'reason', 'already_claimed_by_you');
      continue;
    end if;

    select jsonb_agg(distinct jsonb_build_object('userId', u.id, 'displayName', u.display_name))
      into v_owners
      from public.leads l
      join public.app_users u on u.id = l.claimed_by
     where not l.is_disconnected
       and l.claimed_by <> p_user_id
       and (l.npi = v_npi or l.group_id = v_group_id);

    if v_owners is not null then
      v_blocked := v_blocked || jsonb_build_object(
        'npi', v_npi,
        'companyName', coalesce(v_entry->'identity'->>'name', v_entry->'lead'->>'company_name'),
        'groupId', v_group_id,
        'groupName', (select canonical_name from public.lead_groups where id = v_group_id),
        'owners', v_owners,
        'reason', 'group_has_active_owner');
      continue;
    end if;

    if v_matches ? v_npi then
      insert into public.identity_claim_requests (npi, requested_by, matched_npi, tier, matched_keys, snapshot)
      select v_npi, p_user_id, m->>'npi', (m->>'tier')::integer, m->>'matchedKeys', v_entry->'identity'
        from jsonb_array_elements(v_matches->v_npi) m
      on conflict (npi, matched_npi, requested_by) do nothing;

      v_held := v_held || jsonb_build_object(
        'npi', v_npi,
        'companyName', coalesce(v_entry->'identity'->>'name', v_entry->'lead'->>'company_name'),
        'groupId', v_group_id,
        'matches', v_matches->v_npi,
        'reason', 'needs_review');
      continue;
    end if;

    -- Claim. Only columns that exist on public.leads are written; claimed_by,
    -- group_id and is_disconnected are always set here, never from the payload.
    v_lead := v_entry->'lead';
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
      into v_cols
      from pg_attribute a
     where a.attrelid = 'public.leads'::regclass
       and a.attnum > 0
       and not a.attisdropped
       and a.attgenerated = ''
       and a.attname in (select jsonb_object_keys(v_lead))
       and a.attname not in ('id', 'claimed_by', 'group_id', 'is_disconnected');

    begin
      execute format(
        'insert into public.leads (%1$s, claimed_by, group_id, is_disconnected)
         select %1$s, $1, $2, false from jsonb_populate_record(null::public.leads, $3)
         returning id', v_cols)
        using p_user_id, v_group_id, v_lead
        into v_lead_id;
    exception when unique_violation then
      -- A concurrent request by the same user claimed it first.
      v_skipped := v_skipped || jsonb_build_object('npi', v_npi, 'reason', 'already_claimed_by_you');
      continue;
    end;

    insert into public.lead_ownership_events (lead_id, npi, group_id, event_type, to_user_id, source, metadata)
    values (v_lead_id, v_npi, v_group_id, 'claimed', p_user_id, 'claim_leads',
            jsonb_build_object('company_name', v_lead->>'company_name'));

    v_claimed := v_claimed || jsonb_build_object('npi', v_npi, 'leadId', v_lead_id, 'groupId', v_group_id);
  end loop;

  return jsonb_build_object('claimed', v_claimed, 'blocked', v_blocked, 'held', v_held, 'skipped', v_skipped);
end;
$$;

-- ---- search ------------------------------------------------------------------

-- Of these search candidates, the NPIs whose identity group already has an
-- active claim by someone other than p_user_id. Read-only.
create or replace function public.owned_group_npis(p_user_id uuid, p_candidates jsonb)
returns text[]
language sql stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(distinct c.npi), '{}')
    from (
      select k.npi, coalesce(m.group_id, g.id) as group_id
        from jsonb_array_elements(coalesce(p_candidates, '[]'::jsonb)) e
       cross join lateral public.identity_candidate_keys(e.value) k
        left join public.lead_group_members m on m.npi = k.npi
        left join public.lead_groups g on g.identity_key = k.identity_key
    ) c
   where c.group_id is not null
     and exists (
       select 1 from public.leads l
        where l.group_id = c.group_id
          and not l.is_disconnected
          and l.claimed_by is not null
          and l.claimed_by <> p_user_id)
$$;

-- ---- permissions -------------------------------------------------------------

revoke all on function public.identity_candidate_keys(jsonb) from public, anon, authenticated;
revoke all on function public.identity_pair_decided(text, text) from public, anon, authenticated;
revoke all on function public.ensure_identity_membership(jsonb) from public, anon, authenticated;
revoke all on function public.assign_lead_groups(text[]) from public, anon, authenticated;
revoke all on function public.claim_leads(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.owned_group_npis(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.assign_lead_groups(text[]) to service_role;
grant execute on function public.claim_leads(uuid, jsonb) to service_role;
grant execute on function public.owned_group_npis(uuid, jsonb) to service_role;

-- ---- backfill ----------------------------------------------------------------

-- Leads created after 008 ran (by the old claim path) have no group yet.
select public.assign_lead_groups(array(
  select distinct l.npi from public.leads l where l.group_id is null));

commit;

-- Verification (read-only):
-- select count(*) as leads_without_group from public.leads where group_id is null;
-- select source, count(*) from public.identity_review_queue group by 1;
-- select event_type, source, count(*) from public.lead_ownership_events
--  where source = 'claim_leads' group by 1, 2;
