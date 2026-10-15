-- DME Desk Prospector: permanently remove providers flagged by sql/042.
-- MANUAL ONLY: review against the live schema before execution. The agent
-- never executes SQL against Supabase.
-- Run after 042. Rerun-safe. This file only CREATES a function; nothing is
-- deleted until you call it with dry_run = false AND the confirm phrase.
-- THERE IS NO ARCHIVE AND NO UNDO: a deleted provider only comes back through
-- a new NPPES ingest, which the default keyword file now blocks.
--
-- What remove_excluded_providers() deletes, per call (one transaction, one batch):
--   * npi_records rows with excluded_reason set, and ONLY those;
--   * their npi_cms_enrichment rows (foreign key, no cascade) and
--     npi_identity_keys rows (derived matching keys);
--   * their lead_group_members rows.
--
-- What it never deletes (a flagged provider is KEPT, still hidden, if any of these):
--   * it has a leads row, call_taps, lead_ownership_events or identity_claim_requests;
--   * it shares an identity group with an NPI that has a leads row (so group-wide
--     ownership and claim rules are untouched).
-- It does not touch provider_field_history (append-only audit log), leads, call
-- history, ownership events, staging tables or any other table.
--
-- Use: 1) dry run (default) and compare with the counts below;
--      2) delete in batches, repeating until remaining = 0:
--         select public.remove_excluded_providers(false, 5000, 'delete excluded providers');
--      3) afterwards, in a separate statement: vacuum analyze public.npi_records;
--         (and public.npi_identity_keys, public.npi_cms_enrichment, public.lead_group_members).

begin;

create or replace function public.remove_excluded_providers(
  p_dry_run boolean default true,
  p_batch integer default 5000,
  p_confirm text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_batch integer := least(greatest(coalesce(p_batch, 5000), 1), 20000);
  v_removable bigint;
  v_protected bigint;
  v_picked text[];
  v_enrichment bigint := 0;
  v_keys bigint := 0;
  v_members bigint := 0;
  v_records bigint := 0;
begin
  if not p_dry_run and coalesce(p_confirm, '') <> 'delete excluded providers' then
    raise exception 'refusing to delete: pass p_confirm = ''delete excluded providers'' (or leave p_dry_run true)';
  end if;

  -- NPIs that must stay: any lead / call / ownership / claim-request record, or a
  -- shared identity group with a lead.
  create temporary table if not exists _keep_npis (npi text primary key) on commit drop;
  truncate _keep_npis;
  insert into _keep_npis
    select l.npi from public.leads l where l.npi is not null
    union select t.npi from public.call_taps t where t.npi is not null
    union select e.npi from public.lead_ownership_events e where e.npi is not null
    union select c.npi from public.identity_claim_requests c where c.npi is not null
    union select c.matched_npi from public.identity_claim_requests c where c.matched_npi is not null
    union select m.npi
            from public.lead_group_members m
            join public.lead_group_members g on g.group_id = m.group_id
            join public.leads l on l.npi = g.npi;

  select count(*) filter (where r.npi not in (select npi from _keep_npis)),
         count(*) filter (where r.npi in (select npi from _keep_npis))
    into v_removable, v_protected
    from public.npi_records r
   where r.excluded_reason is not null;

  if not p_dry_run then
    select array_agg(r.npi) into v_picked
      from (select r.npi from public.npi_records r
             where r.excluded_reason is not null
               and r.npi not in (select npi from _keep_npis)
             limit v_batch) r;

    if v_picked is not null then
      delete from public.npi_cms_enrichment where npi = any (v_picked);
      get diagnostics v_enrichment = row_count;
      delete from public.npi_identity_keys where npi = any (v_picked);
      get diagnostics v_keys = row_count;
      delete from public.lead_group_members where npi = any (v_picked);
      get diagnostics v_members = row_count;
      -- Re-check the flag in the delete itself, so an unflagged row can never go.
      delete from public.npi_records where npi = any (v_picked) and excluded_reason is not null;
      get diagnostics v_records = row_count;
    end if;
  end if;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'removable_now', v_removable,
    'kept_because_of_leads_or_groups', v_protected,
    'deleted_npi_records', v_records,
    'deleted_npi_cms_enrichment', v_enrichment,
    'deleted_npi_identity_keys', v_keys,
    'deleted_lead_group_members', v_members,
    'remaining', case when p_dry_run then v_removable else greatest(v_removable - v_records, 0) end
  );
end
$fn$;

revoke all on function public.remove_excluded_providers(boolean, integer, text) from public, anon, authenticated;
grant execute on function public.remove_excluded_providers(boolean, integer, text) to service_role;

commit;

-- Verification (read-only, deletes nothing):
--   select public.remove_excluded_providers();      -- dry run: counts only
