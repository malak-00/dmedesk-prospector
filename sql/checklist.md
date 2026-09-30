# Supabase SQL Checklist

Manual checklist for the DME Desk Supabase project. Nothing in this file is
executed automatically. Run read-only checks first and record the results.

## Internal provider-search cutover

- [ ] Confirm `public.npi_records` contains the expected provider data and that
      claimed-lead coverage has been reviewed.
- [ ] Run [`018_provider_search.sql`](./018_provider_search.sql) in the DME
      Desk Supabase SQL Editor.
- [ ] Run the read-only verification queries at the bottom of
      `018_provider_search.sql`.
- [ ] Run `VACUUM (ANALYZE) public.npi_records;` separately after the migration.
- [ ] Verify internal search and stable paging with a state/taxonomy search.
- [ ] Compare internal search against the mirror in Admin → Search source.
- [ ] Set the Cloudflare Worker variable `NPI_SOURCE=dmedesk`.
- [ ] Manually test search, Search more, exact NPI lookup, taxonomy filtering,
      and claimed-lead coverage.
- [ ] Keep `NPI_SOURCE=mirror` available as rollback until verification passes.
- [ ] Remove the fakeNPI dependency/secrets only after the rollback window is
      complete.

## Current application SQL dependencies

- [ ] Run [`019_conflict_unclaim.sql`](./019_conflict_unclaim.sql) before using
      Admin → Ownership conflicts → Unclaim selected.
- [ ] Verify `unclaim_conflict_leads()` and the two active-claim indexes using
      the read-only queries at the bottom of the migration.
- [ ] Run [`017_lead_sync_restart.sql`](./017_lead_sync_restart.sql) only if a
      completed provider-change sync must be restarted.
- [ ] Do not run `002_identity_backfill.sql`; it is superseded. Use
      `002_identity_backfill_safe.sql` only when a fresh environment requires
      the identity backfill.

## Storage inspection and cleanup

- [ ] Run the table-size query from
      [`018_provider_history_storage_optimization.sql`](./018_provider_history_storage_optimization.sql).
- [ ] Inspect `refresh_runs` and staged-row counts before deleting anything.
- [ ] Confirm no NPPES or Medicare refresh is staged, applying, or awaiting
      recovery.
- [ ] Export or otherwise preserve `provider_field_history` before considering
      any retention deletion.
- [ ] Approve an explicit retention cutoff date.
- [ ] Delete only old rows from `nppes_refresh_staging` belonging to verified
      `applied` or `failed` runs.
- [ ] Delete only old rows from `medicare_refresh_staging` belonging to
      verified `applied` or `failed` runs.
- [ ] Run `VACUUM (ANALYZE)` on cleaned staging tables.
- [ ] Re-run the table-size query and confirm the quota has recovered.

## Never delete as storage cleanup

- `npi_records` — canonical provider registry.
- `leads` — active and historical sales records.
- `lead_ownership_events` — append-only ownership audit history.
- `provider_field_history` — append-only provider-change history unless an
  explicit retention policy and export have been approved.
- `lead_groups` and `lead_group_members` — identity and ownership grouping.

## Not part of the cutover

- [`019_provider_history_compact_insert_trigger.sql`](./019_provider_history_compact_insert_trigger.sql)
  is an optional future-write optimization, not a cleanup migration.
- [`RUN_PENDING.sql`](./RUN_PENDING.sql) is not the authoritative checklist;
  review individual files because it may not include newer migrations.
