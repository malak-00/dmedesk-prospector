# Supabase SQL bundle

These files are ordered and intended for manual execution in the Supabase SQL
Editor by the project owner. The agent does not execute them against Supabase.

Run one file at a time, in order, and stop if its verification query reports
an error. Read-only verification queries live at the bottom of each file (or
in `003`); save their output with the run.

| File | Purpose | Status |
|---|---|---|
| `000_schema_checkpoint.sql` | Read-only check of required tables, columns, indexes | Executed 2026-08-31 |
| `001_identity_schema.sql` | Identity, audit, and refresh-run tables | Executed 2026-08-31 |
| `002_identity_backfill.sql` | First draft of the backfill | **Superseded — do not run** |
| `002_identity_backfill_safe.sql` | Safe identity + historical-claim backfill | Executed 2026-08-31 |
| `003_identity_verification.sql` | Read-only validation queries | Executed 2026-08-31 |
| `004_nppes_refresh_staging.sql` | Staging table written by `scripts/nppes_ingest` | **Not yet run** |
| `005_ownership_conflict_resolution.sql` | `resolve_ownership_conflict()` + `ownership_conflicts` view | **Not yet run** |
| `006_resolve_known_conflicts.sql` | Applies the two approved owner decisions | **Not yet run — edit the approver username first** |

## Notes on individual files

**`002_identity_backfill.sql` is superseded.** It could overwrite a
previously reviewed NPI membership on a rerun. Use
`002_identity_backfill_safe.sql`, which preserves an existing membership.

**Before `002_*`,** confirm `public.npi_records` has the columns referenced
there. The repository's existing audit SQL confirms `npi`, `name`,
`address_state`, `authorizedofficial_firstname`,
`authorizedofficial_lastname`, `phone`, and `authorizedofficial_phone`; the
backfill also uses optional address fields only through a separately marked
adaptation point.

**`004`** must be installed before the ingestion CLI can stage a real
release. The CLI's staging row and this table's columns are written to match
each other exactly — change one and you must change the other.

**`005`** is what the admin UI's "Resolve" button calls. Until it is
installed, the Admin tab still *lists* ownership conflicts (the Worker
aggregates those from tables that already exist), but resolving one returns
a clear "isn't installed yet" message instead of moving anything.

**`006`** carries the two approved owner decisions from 2026-09-02. Edit
`v_approver_username` at the top to a real admin username before running it;
it raises rather than guessing. It is one transaction and is safe to re-run —
once a group has a single owner there is nothing left to reassign.
