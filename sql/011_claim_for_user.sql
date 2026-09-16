-- DME Desk Prospector: claim on behalf of another user.
-- MANUAL ONLY: review against the live schema before execution.
-- Run after 010.
--
-- Lets a trusted integration (e.g. BD MEETINGS, signed in as its own
-- non-admin account) claim leads for a named teammate without that
-- teammate's password:
--
--   1. app_users.can_claim_for_others -- the one extra permission such an
--      account needs. Admins can also claim on behalf of others.
--   2. claim_leads(p_user_id, p_leads, p_actor_id) -- the 010 claim, now with
--      an optional actor. Every ownership / review rule is unchanged; the
--      lead is owned by p_user_id. When p_actor_id is someone else, the
--      'claimed' event gets source 'claim_for_user', approved_by = actor and
--      metadata.actor_user_id, and the database itself refuses an actor who
--      is neither an admin nor allowed to claim for others.
--
-- claim_leads now lives only in this file (010 no longer defines it), so
-- re-running 010 can never recreate the old two-argument overload beside
-- this one -- that would make every claim fail as "not unique". Rerun-safe.

begin;

alter table public.app_users
  add column if not exists can_claim_for_others boolean not null default false;

comment on column public.app_users.can_claim_for_others is
  'Allows this account to claim leads on behalf of other users (POST /admin/claim-for-user). Grant to integration accounts, not people.';

-- The 010 signature. Dropped so exactly one claim_leads exists.
drop function if exists public.claim_leads(uuid, jsonb);

-- p_leads: [{ npi, identity: {name, state, officialName, phone, officialPhone},
--             lead: {<public.leads columns>} }]
-- p_actor_id: who performed the claim when it isn't the owner (claim on
-- behalf of p_user_id). Must be an admin or have can_claim_for_others.
-- Returns { claimed: [...], blocked: [...], held: [...], skipped: [...] }.
create or replace function public.claim_leads(p_user_id uuid, p_leads jsonb, p_actor_id uuid default null)
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
  v_on_behalf boolean := p_actor_id is not null and p_actor_id is distinct from p_user_id;
  v_claimed jsonb := '[]'::jsonb;
  v_blocked jsonb := '[]'::jsonb;
  v_held jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
begin
  if p_user_id is null or not exists (select 1 from public.app_users where id = p_user_id) then
    raise exception 'claiming user % does not exist', p_user_id;
  end if;
  -- Claiming for someone else is checked here too, not only in the Worker.
  if v_on_behalf and not exists (
    select 1 from public.app_users
     where id = p_actor_id and (is_admin or can_claim_for_others)) then
    raise exception 'user % is not allowed to claim on behalf of other users', p_actor_id;
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
      select v_npi, p_user_id, m->>'npi', (m->>'tier')::integer, m->>'matchedKeys',
             v_entry->'identity' || case when v_on_behalf then jsonb_build_object('requestedVia', p_actor_id) else '{}'::jsonb end
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

    -- On-behalf claims record the actor as approved_by and in metadata, so the
    -- history shows who actually performed the claim.
    insert into public.lead_ownership_events (lead_id, npi, group_id, event_type, to_user_id, source, approved_by, metadata)
    values (v_lead_id, v_npi, v_group_id, 'claimed', p_user_id,
            case when v_on_behalf then 'claim_for_user' else 'claim_leads' end,
            case when v_on_behalf then p_actor_id end,
            jsonb_build_object('company_name', v_lead->>'company_name')
              || case when v_on_behalf then jsonb_build_object('actor_user_id', p_actor_id) else '{}'::jsonb end);

    v_claimed := v_claimed || jsonb_build_object('npi', v_npi, 'leadId', v_lead_id, 'groupId', v_group_id);
  end loop;

  return jsonb_build_object('claimed', v_claimed, 'blocked', v_blocked, 'held', v_held, 'skipped', v_skipped);
end;
$$;

revoke all on function public.claim_leads(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.claim_leads(uuid, jsonb, uuid) to service_role;

commit;

-- Verification (read-only):
-- select pg_get_function_identity_arguments(oid) from pg_proc where proname = 'claim_leads';
--   -> exactly one row: p_user_id uuid, p_leads jsonb, p_actor_id uuid
-- select username, is_admin, can_claim_for_others from public.app_users order by username;
-- select source, count(*) from public.lead_ownership_events where event_type = 'claimed' group by 1;