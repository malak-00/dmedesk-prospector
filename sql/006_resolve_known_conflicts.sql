-- DME Desk Prospector: apply the two approved owner decisions.
-- MANUAL ONLY. Run sql/005_ownership_conflict_resolution.sql first.
--
-- These are the two group-level ownership conflicts the identity backfill
-- surfaced on 2026-08-31. Neither was created by the backfill; both are
-- pre-existing splits that needed a human decision. The decisions recorded
-- here were made by the project owner on 2026-09-02:
--
--   1FOOT 2FOOT Centre for Foot and Ankle Care, PC (VA)  -> Rick Nelson
--     NPIs 1548921265 (Rick Nelson), 1831477868 (Kaity James)
--
--   Advanced Home Medical Supplies Inc. (CT)             -> Nora Atkins
--     NPIs 1598747552 (Nora Atkins), 1891506093 (Rick Nelson)
--
-- Groups are located by their member NPIs, not by name, so this cannot
-- resolve the wrong group if two groups share a similar name.
--
-- The whole block is one transaction: either both decisions apply with
-- their audit events, or nothing changes. Re-running it is safe -- once a
-- group has a single owner there is nothing left to reassign and the call
-- reports 0 moves.

-- =========================================================================
-- EDIT THIS: the username of the admin approving these decisions.
-- =========================================================================
do $$
declare
  v_approver_username text := 'REPLACE_WITH_APPROVING_ADMIN_USERNAME';

  v_approver_id  uuid;
  v_group_id     uuid;
  v_to_user_id   uuid;
  v_result       jsonb;
begin
  select id into v_approver_id
    from public.app_users
   where lower(username) = lower(btrim(v_approver_username));

  if v_approver_id is null then
    raise exception
      'Approving admin % not found. Edit v_approver_username at the top of this file to a real app_users.username.',
      v_approver_username;
  end if;
  if not exists (select 1 from public.app_users where id = v_approver_id and is_admin) then
    raise exception 'User % is not an admin; ownership decisions must be approved by an admin.', v_approver_username;
  end if;

  -- ---- 1FOOT 2FOOT Centre for Foot and Ankle Care, PC (VA) -> Rick Nelson
  select distinct m.group_id into v_group_id
    from public.lead_group_members m
   where m.npi in ('1548921265', '1831477868');

  if v_group_id is null then
    raise exception 'No identity group found for NPIs 1548921265 / 1831477868. Was the identity backfill run?';
  end if;

  select id into v_to_user_id from public.app_users where display_name = 'Rick Nelson';
  if v_to_user_id is null then
    raise exception 'Target owner "Rick Nelson" not found in app_users.';
  end if;

  v_result := public.resolve_ownership_conflict(
    v_group_id,
    v_to_user_id,
    v_approver_id,
    'Approved owner decision 2026-09-02: 1FOOT 2FOOT Centre for Foot and Ankle Care, PC (VA) assigned to Rick Nelson.'
  );
  raise notice '1FOOT 2FOOT -> Rick Nelson: %', v_result;

  -- ---- Advanced Home Medical Supplies Inc. (CT) -> Nora Atkins
  select distinct m.group_id into v_group_id
    from public.lead_group_members m
   where m.npi in ('1598747552', '1891506093');

  if v_group_id is null then
    raise exception 'No identity group found for NPIs 1598747552 / 1891506093. Was the identity backfill run?';
  end if;

  select id into v_to_user_id from public.app_users where display_name = 'Nora Atkins';
  if v_to_user_id is null then
    raise exception 'Target owner "Nora Atkins" not found in app_users.';
  end if;

  v_result := public.resolve_ownership_conflict(
    v_group_id,
    v_to_user_id,
    v_approver_id,
    'Approved owner decision 2026-09-02: Advanced Home Medical Supplies Inc. (CT) assigned to Nora Atkins.'
  );
  raise notice 'Advanced Home Medical Supplies -> Nora Atkins: %', v_result;
end $$;

-- =========================================================================
-- Verification (read-only) -- run these after the block above.
-- =========================================================================

-- 1. Both groups should be gone from the conflict list.
--    Any rows still returned are OTHER conflicts, which belong in the
--    admin UI's review queue rather than in this file.
-- select * from public.ownership_conflicts order by group_name;

-- 2. Current owners of the four NPIs. Expect Rick Nelson for the first two
--    and Nora Atkins for the second two, with claimed_at unchanged.
-- select l.npi, l.company_name, u.display_name as owner, l.claimed_at, l.status
--   from public.leads l
--   join public.app_users u on u.id = l.claimed_by
--  where l.npi in ('1548921265','1831477868','1598747552','1891506093')
--    and l.is_disconnected = false
--  order by l.npi;

-- 3. The audit trail for the two moves.
-- select e.created_at, e.npi, e.event_type,
--        f.display_name as from_owner, t.display_name as to_owner,
--        a.display_name as approved_by, e.reason
--   from public.lead_ownership_events e
--   left join public.app_users f on f.id = e.from_user_id
--   left join public.app_users t on t.id = e.to_user_id
--   left join public.app_users a on a.id = e.approved_by
--  where e.source = 'admin_conflict_resolution'
--  order by e.created_at desc;

-- 4. Nothing else moved: total active claims per user before/after should
--    differ only by the two reassignments recorded above.
-- select u.display_name, count(*) as active_claims
--   from public.leads l join public.app_users u on u.id = l.claimed_by
--  where l.is_disconnected = false
--  group by u.display_name order by u.display_name;
