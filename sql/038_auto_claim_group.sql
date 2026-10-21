-- DME Desk Prospector: a claimed business's whole identity group belongs to its owner.
-- MANUAL ONLY: review against the live schema before execution. Take a backup first.
-- Run after 009, 010, 030, 035 and 036.
--
-- Decision (user, 2026-10-21): when a lead is claimed, or when groups are merged and
-- one agent owns the result, every other NPI in that group becomes a claimed lead of
-- the same agent, so the group appears together in their Claimed leads and nobody
-- else sees it (Prospect already hides groups someone else owns, and claiming one is
-- blocked; see owned_group_npis / claim_leads).
--
-- Rules, all inside auto_claim_group_siblings():
--   * Only when exactly ONE agent has active claims in the group. No owner: nothing to
--     follow. Two owners: an ownership conflict, left for an admin (Ownership conflicts).
--   * Only NPIs that have no active claim, are not disconnected leads, are in
--     npi_records, and are not deactivated. Disconnected means a dead number someone
--     chose to drop; it is never re-claimed.
--   * A group with more than p_max (default 50) such NPIs is skipped whole and
--     reported as 'too_many': merged chains can be hundreds of locations, and one
--     rep must not receive them by accident. Raise p_max deliberately for one group.
--   * Each new lead row is built from npi_records and gets a 'claimed' ownership
--     event (source 'auto_claim_group') so the history says why it is theirs.
--   * Same group lock claim_leads takes, so it cannot race a claim in that group.
--
-- Wired in:
--   * claim_leads: the Worker calls auto_claim_group_siblings_for() after a claim.
--   * merges: resolve_identity_match (replaced below; otherwise identical to 030)
--     calls it after joining two groups. A failure never undoes the merge.
--
-- Existing data is NOT touched by installing this. auto_claim_existing_groups() is
-- the one-off for groups that were merged before this existed; it defaults to a dry
-- run that only counts.

begin;

create or replace function public.auto_claim_group_siblings(
  p_group_id uuid,
  p_actor uuid default null,
  p_max integer default 50,
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_count integer;
  v_owner uuid;
  v_siblings text[];
  v_npi text;
  v_lead_id uuid;
  v_claimed integer := 0;
begin
  if p_group_id is null then
    return jsonb_build_object('group_id', null, 'claimed', 0, 'skipped', 'no_group');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('lead_group:' || p_group_id::text, 0));

  select count(distinct l.claimed_by), (array_agg(distinct l.claimed_by))[1]
    into v_owner_count, v_owner
    from public.leads l
   where l.group_id = p_group_id and not l.is_disconnected and l.claimed_by is not null;

  if v_owner_count = 0 then
    return jsonb_build_object('group_id', p_group_id, 'claimed', 0, 'skipped', 'no_owner');
  elsif v_owner_count > 1 then
    return jsonb_build_object('group_id', p_group_id, 'claimed', 0, 'skipped', 'conflict');
  end if;

  select array_agg(m.npi order by m.npi) into v_siblings
    from public.lead_group_members m
   where m.group_id = p_group_id
     and not exists (select 1 from public.leads l
                      where l.npi = m.npi and (l.is_disconnected or l.claimed_by is not null))
     and exists (select 1 from public.npi_records r
                  where r.npi = m.npi and coalesce(r.deactivation_date::text, '') = '');

  if v_siblings is null then
    return jsonb_build_object('group_id', p_group_id, 'owner', v_owner, 'claimed', 0, 'skipped', 'nothing_to_claim');
  end if;
  if array_length(v_siblings, 1) > p_max then
    return jsonb_build_object('group_id', p_group_id, 'owner', v_owner, 'claimed', 0,
                              'skipped', 'too_many', 'siblings', array_length(v_siblings, 1));
  end if;
  if p_dry_run then
    return jsonb_build_object('group_id', p_group_id, 'owner', v_owner, 'claimed', 0,
                              'would_claim', array_length(v_siblings, 1));
  end if;

  foreach v_npi in array v_siblings
  loop
    v_lead_id := null;
    begin
      insert into public.leads
        (npi, claimed_by, group_id, is_disconnected, status,
         company_name, phone, address_line1, city, state, postal_code, specialty,
         contact_name, contact_title, contact_source, contact_phone, nppes_last_updated, data_sources)
      select r.npi, v_owner, p_group_id, false, 'new',
             r.name, r.phone, r.address_line1, r.address_city, r.address_state, r.address_postalcode,
             coalesce(nullif(r.taxonomy_description, ''), r.taxonomy_code),
             nullif(btrim(concat_ws(' ', r.authorizedofficial_firstname, r.authorizedofficial_lastname)), ''),
             nullif(r.authorizedofficial_title, ''),
             case when nullif(btrim(concat_ws(' ', r.authorizedofficial_firstname, r.authorizedofficial_lastname)), '') is not null
                  then 'nppes' end,
             r.authorizedofficial_phone,
             nullif(r.lastupdated::text, '')::date,
             'NPPES'
        from public.npi_records r
       where r.npi = v_npi
      returning id into v_lead_id;
    exception when unique_violation then
      continue; -- someone claimed it a moment ago
    end;

    if v_lead_id is null then continue; end if;

    insert into public.lead_ownership_events
      (lead_id, npi, group_id, event_type, to_user_id, source, approved_by, metadata)
    values
      (v_lead_id, v_npi, p_group_id, 'claimed', v_owner, 'auto_claim_group', p_actor,
       jsonb_build_object('via', 'group_sibling', 'reason', 'Joined the claimed business group'));
    v_claimed := v_claimed + 1;
  end loop;

  return jsonb_build_object('group_id', p_group_id, 'owner', v_owner, 'claimed', v_claimed);
end;
$$;

-- Many groups at once (after a claim): one call, each group isolated so one bad
-- group cannot stop the rest.
create or replace function public.auto_claim_group_siblings_for(
  p_group_ids uuid[],
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_group uuid;
  v_result jsonb;
  v_total integer := 0;
  v_skipped jsonb := '[]'::jsonb;
begin
  foreach v_group in array (select coalesce(array_agg(distinct g), '{}') from unnest(coalesce(p_group_ids, '{}')) g where g is not null)
  loop
    begin
      v_result := public.auto_claim_group_siblings(v_group, p_actor);
      v_total := v_total + coalesce((v_result->>'claimed')::integer, 0);
      if v_result->>'skipped' = 'too_many' then
        v_skipped := v_skipped || jsonb_build_array(v_result);
      end if;
    exception when others then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('group_id', v_group, 'error', sqlerrm));
    end;
  end loop;
  return jsonb_build_object('claimed', v_total, 'skipped_groups', v_skipped);
end;
$$;

-- One-off for groups merged before this existed. Walks groups with exactly one
-- owner in id order, p_limit groups per call; pass `next` back as p_after until
-- done. DRY RUN BY DEFAULT: it only counts what it would claim.
create or replace function public.auto_claim_existing_groups(
  p_after uuid default null,
  p_limit integer default 20,
  p_max integer default 50,
  p_dry_run boolean default true,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_group uuid;
  v_last uuid;
  v_seen integer := 0;
  v_result jsonb;
  v_would integer := 0;
  v_claimed integer := 0;
  v_too_many jsonb := '[]'::jsonb;
begin
  for v_group in
    select l.group_id
      from public.leads l
     where l.group_id is not null and not l.is_disconnected and l.claimed_by is not null
       and (p_after is null or l.group_id > p_after)
     group by l.group_id
    having count(distinct l.claimed_by) = 1
     order by l.group_id
     limit greatest(1, least(coalesce(p_limit, 20), 200))
  loop
    v_last := v_group;
    v_seen := v_seen + 1;
    v_result := public.auto_claim_group_siblings(v_group, p_actor, p_max, p_dry_run);
    v_would := v_would + coalesce((v_result->>'would_claim')::integer, 0);
    v_claimed := v_claimed + coalesce((v_result->>'claimed')::integer, 0);
    if v_result->>'skipped' = 'too_many' then
      v_too_many := v_too_many || jsonb_build_array(v_result);
    end if;
  end loop;

  return jsonb_build_object(
    'dry_run', p_dry_run, 'groups', v_seen, 'would_claim', v_would, 'claimed', v_claimed,
    'too_many', v_too_many, 'next', v_last, 'done', v_seen < greatest(1, least(coalesce(p_limit, 20), 200)));
end;
$$;

revoke all on function public.auto_claim_group_siblings(uuid, uuid, integer, boolean) from public, anon, authenticated;
revoke all on function public.auto_claim_group_siblings_for(uuid[], uuid) from public, anon, authenticated;
revoke all on function public.auto_claim_existing_groups(uuid, integer, integer, boolean, uuid) from public, anon, authenticated;
grant execute on function public.auto_claim_group_siblings(uuid, uuid, integer, boolean) to service_role;
grant execute on function public.auto_claim_group_siblings_for(uuid[], uuid) to service_role;
grant execute on function public.auto_claim_existing_groups(uuid, integer, integer, boolean, uuid) to service_role;

-- ---- merges: resolve_identity_match, with auto-claim after a merge ----------------
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
  v_auto jsonb := null;
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

      -- NEW in 038: if exactly one agent owns the merged group, the group's
      -- other NPIs become theirs too. A failure here never undoes the merge.
      begin
        v_auto := public.auto_claim_group_siblings(v_target, p_decided_by);
      exception when others then
        v_auto := jsonb_build_object('error', sqlerrm);
      end;
    else
      v_target := v_left_group;
    end if;
  end if;

  insert into public.identity_match_decisions
    (left_npi, right_npi, decision, tier, matched_keys, reason, decided_by, metadata)
  values
    (v_left, v_right, p_decision, p_tier, p_matched_keys, v_reason, p_decided_by,
     jsonb_build_object('target_group_id', v_target, 'source_group_id', v_source, 'moved_count', v_moved, 'new_conflict', v_new_conflict,
                        'auto_claim', v_auto));

  return jsonb_build_object(
    'left_npi', v_left,
    'right_npi', v_right,
    'decision', p_decision,
    'target_group_id', v_target,
    'moved_count', v_moved,
    'new_conflict', v_new_conflict,
    'auto_claim', v_auto
  );
end;
$$;

revoke all on function public.resolve_identity_match(text, text, text, uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.resolve_identity_match(text, text, text, uuid, text, integer, text) to service_role;

commit;

-- Verification (read-only). 1) How much would the one-off claim? Run first, repeat with
-- the returned `next` until done:
-- select public.auto_claim_existing_groups(null, 50, 50, true);
-- 2) Groups skipped as too large, to decide on by hand:
--    in the dry-run result, `too_many` lists group_id, owner and sibling count.
-- 3) Afterwards, what the auto-claim created:
-- select count(*) from public.lead_ownership_events where source = 'auto_claim_group';