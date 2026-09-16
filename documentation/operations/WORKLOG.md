# DME Desk Prospector Worklog

## 2026-08-31 — Identity grouping foundation

### Objective

Prepare stable provider identity grouping and ownership history without
breaking the existing application flow.

### Actions completed

1. Reviewed `MASTER_PLAN.md`, architecture notes, migration notes, and current
   Worker repositories/routes.
2. Confirmed `worker/` is the active implementation.
3. Confirmed the Supabase project link was initially pointing at fakeNPI, then
   linked/used the DME Desk project containing `app_users`, `leads`, and
   `npi_records`.
4. Ran the read-only schema checkpoint.
5. Verified all required NPPES identity columns exist.
6. Manually applied `sql/001_identity_schema.sql`.
7. Verified the new tables, `leads.group_id`, indexes, RLS, and audit triggers.
8. Prepared the safe backfill SQL.
9. Manually ran `sql/002_identity_backfill_safe.sql`.
10. Ran read-only verification queries.
11. Identified two pre-existing group-level ownership conflicts for manual
    review.

### Database result

- 4,599 leads checked.
- 0 leads without a group.
- 4,495 unique NPIs and 4,495 group memberships.
- 4,168 strict groups.
- 315 singleton groups.
- 0 duplicate NPI memberships.
- 3,494 historical claim events.
- 0 claimed leads missing a historical claim event.
- 2 groups contain active claims owned by multiple users.

### Important scope clarification

The current grouping logic exists in SQL as a one-time deterministic backfill.
Reusable JavaScript grouping/preflight code has not been implemented yet.
Tier 2 RapidFuzz review generation has also not been implemented.

### Safety status

- No existing claims were reassigned.
- No leads were deleted.
- No existing provider fields, statuses, notes, reminders, or owners were
  overwritten.
- Existing Worker routes were not changed.
- Supabase schema and backfill SQL were manually executed; no application
  deployment or commit has been made by this worklog.

## 2026-09-02 — NPPES ingestion CLI and ownership-conflict resolution

### Objective

Build the NPPES ingestion tooling, record the two approved owner decisions,
and give every remaining ownership conflict a place in the admin UI.

### Actions completed

1. Built `scripts/nppes_ingest`, a dependency-free Python CLI: argparse
   entry point, canonical normalization, NPPES header mapping, CMS
   check-digit validation, duplicate/state/taxonomy filtering, row-count
   guard, source checksum, run manifest, rejects report, batched staging
   upload, and rollback on partial failure.
2. Wrote `sql/004_nppes_refresh_staging.sql`, the staging table the CLI
   targets, with its own read-only verification queries.
3. Wrote `sql/005_ownership_conflict_resolution.sql`:
   `resolve_ownership_conflict()` (transactional, row-locking, append-only
   audit) and the `ownership_conflicts` view.
4. Wrote `sql/006_resolve_known_conflicts.sql` carrying the two approved
   owner decisions, targeting groups by member NPI rather than by name.
5. Added `GET /admin/conflicts` and `POST /admin/conflicts/resolve` to the
   Worker, with the approver taken from the session.
6. Added the ownership-conflict queue and resolve modal to the Admin tab.
7. Updated `MASTER_PLAN.md`, `ARCHITECTURE.md`, and `sql/README.md`.

### Test results

- 24 unit tests pass (`python3 -m unittest discover -s scripts/tests -t scripts`).
- CLI verified end to end in `--dry-run` against a fixture: 7 source rows,
  3 accepted, 4 rejected with the expected reason codes, manifest and
  rejects report written.
- Admin UI driven in headless Chromium against mocked API responses: both
  conflicts render, no owner pre-selected, missing-owner and missing-reason
  both blocked client-side, correct resolve payload posted, modal closes.
  Empty, not-installed and API-failure states verified; light and dark.
- `node --check` clean on every changed JavaScript file.

### Database result

None. No SQL was executed against Supabase — `004`, `005` and `006` are all
awaiting manual execution by the project owner.

### Safety status

- The two conflict decisions are recorded but **not yet applied**; no claim
  has moved.
- The ingestion CLI cannot write `npi_records` or `leads` by construction.
- Listing conflicts required no new SQL, so the admin queue degrades to an
  explanatory message rather than an error if the identity schema or the
  resolution function is missing.

### Important scope note

The transactional apply step (staging → compare → `provider_field_history`
→ `npi_records`) is **not** built. Staging a release does nothing to live
provider data on its own, which is the intended safety property, but it also
means a staged release is not yet useful until that step exists.

## Next worklog entry

Run `sql/004`, `005` and `006` (editing the approver username in `006`
first), verify with the queries in each file, then build the transactional
apply step and rehearse it against a small real release.

## Older next-entry note (2026-08-31, superseded)

The next implementation should add reusable grouping/preflight code and tests,
then add atomic group-aware claiming only after the two ownership conflicts have
explicit owner decisions.


## 2026-09-09 — Local migration verification and remote history reconciliation

- Pulled the linked Supabase schema into `supabase/migrations/20260909151917_remote_schema.sql`.
- Started the local Docker Supabase stack and reset the local database with the pulled migration.
- Confirmed local migration history and direct local/remote schema comparison are clean; local and linked lint reported no schema errors.
- Created `supabase/backups/remote-20260909-1825.sql` before further work. This is a schema backup, not a full production data backup.
- Did not execute the pulled schema snapshot against production because it represents objects already present in the cloud database, rather than a new schema change migration.
- Reconciled the remote migration-history row `20260909151917` as applied without executing SQL against the production schema.
- Production schema was not changed in this step.

### Next implementation step

Build the reusable grouping/preflight layer and dry-run intake report. After that, create a narrowly scoped migration only for any genuinely new schema required by the intake/claim workflow, test it locally, take a full production backup, and apply it through the reviewed deployment path.
