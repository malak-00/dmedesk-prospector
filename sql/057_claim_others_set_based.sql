-- DME Desk Prospector: make claim_leads() work out "other reps' leads" in one pass instead of one function call per lead.
-- MANUAL ONLY: review against the live schema before execution. The agent never executes SQL against Supabase
-- unless told to.
--
-- DO NOT RUN THIS until sql/audit_claim_cost.sql has been run and
--   (a) query 4 shows only_in_current = 0 and only_in_set_based = 0, and
--   (b) query 3 is clearly faster than query 2.
-- If either fails, stop: this file changes nothing you cannot see, but it is only safe when they hold.
--
-- Why: step 3 of claim_leads() (also used by the "Send to Sheet" check, p_dry_run = true) rebuilds the matching
-- keys of EVERY active lead held by another rep, one identity_candidate_keys() call per lead, on every claim.
-- That grows with the team's claimed leads. On 2026-10-27..29 the live Worker log showed 24 of 50 claims
-- (48%) and 6 of 9 Send-to-Sheet checks failing with "canceling statement due to statement timeout", up from
-- about 3% on 2026-10-19. This replaces only that step with the same inputs and the same four key functions,
-- computed set-wise (one join to npi_records instead of a function call per lead). The keys, the rows and the
-- decisions are meant to be identical; audit query 4 is the proof.
--
-- How it is applied: it does NOT paste a copy of claim_leads(). It reads the LIVE definition, swaps exactly the
-- two fragments below, and re-creates the function (same owner, same settings, same grants). If either fragment is
-- not found exactly once (someone changed claim_leads since sql/014), it stops with an error and changes nothing,
-- because everything runs in one transaction.
--
-- Rerun-safe: a second run finds the fragments already replaced and stops with a clear message, changing nothing.
-- To undo: re-run the claim_leads definition from sql/014_claim_preflight.sql.

begin;

do $patch$
declare
  v_oid oid;
  v_def text;
  v_old_cols constant text :=
    E'           l.npi, l.claimed_by, l.group_id, l.company_name, k.name_key, k.state_key, k.official_key, k.phone_key\n'
    || E'      from public.leads l\n'
    || E'     cross join lateral public.identity_candidate_keys(jsonb_build_object(\n'
    || E'       ''npi'', l.npi, ''name'', l.company_name, ''state'', l.state, ''phone'', l.phone,\n'
    || E'       ''officialName'', case when l.contact_source = ''nppes'' then l.contact_name end,\n'
    || E'       ''officialPhone'', case when l.contact_source = ''nppes'' then l.contact_phone end)) k\n';
  v_new_cols constant text :=
    E'           l.npi, l.claimed_by, l.group_id, l.company_name,\n'
    || E'           public.identity_name_key(s.name) as name_key,\n'
    || E'           public.identity_state_key(s.state) as state_key,\n'
    || E'           public.identity_official_key(s.first_name, s.last_name) as official_key,\n'
    || E'           public.identity_phone_key(s.phone, s.official_phone) as phone_key\n'
    || E'      from public.leads l\n'
    || E'      left join public.npi_records nr on nr.npi = btrim(coalesce(l.npi, ''''))\n'
    || E'     cross join lateral (select\n'
    || E'             case when nr.npi is not null then nr.name else l.company_name end as name,\n'
    || E'             case when nr.npi is not null then nr.address_state else l.state end as state,\n'
    || E'             case when nr.npi is not null then nr.authorizedofficial_firstname\n'
    || E'                  else case when l.contact_source = ''nppes'' then l.contact_name end end as first_name,\n'
    || E'             case when nr.npi is not null then nr.authorizedofficial_lastname else null end as last_name,\n'
    || E'             case when nr.npi is not null then nr.phone else l.phone end as phone,\n'
    || E'             case when nr.npi is not null then nr.authorizedofficial_phone\n'
    || E'                  else case when l.contact_source = ''nppes'' then l.contact_phone end end as official_phone) s\n';
begin
  if (select count(*) from pg_proc where proname = 'claim_leads' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'expected exactly one public.claim_leads; found a different number. Nothing changed.';
  end if;
  select oid into v_oid from pg_proc where proname = 'claim_leads' and pronamespace = 'public'::regnamespace;

  -- The live text keeps Windows line endings from when it was pasted; drop them so the match is exact.
  v_def := replace(pg_get_functiondef(v_oid), E'\r', '');

  if position(v_new_cols in v_def) > 0 then
    raise exception 'claim_leads already uses the set-based step. Nothing changed.';
  end if;
  if (length(v_def) - length(replace(v_def, v_old_cols, ''))) <> length(v_old_cols) then
    raise exception 'claim_leads is not the sql/014 text (the step to replace was not found exactly once). Nothing changed.';
  end if;

  execute replace(v_def, v_old_cols, v_new_cols);
end
$patch$;

commit;

-- Verification (read-only):
--   select position('identity_name_key(s.name)' in prosrc) > 0 as patched from pg_proc
--    where proname = 'claim_leads' and pronamespace = 'public'::regnamespace;   -- expect true
-- Then claim a test lead as a normal rep, and compare the pg_stat_statements means (audit query 1) after a few days.
