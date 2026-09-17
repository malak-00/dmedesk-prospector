# NPPES ingestion CLI

Loads an NPPES release into `npi_records` in two deliberate steps:

1. **Stage** — stream the release into `nppes_refresh_staging` under one
   `refresh_runs` row, with validation, a source checksum, and a manifest.
2. **Apply** — copy the staged rows into `npi_records` in short batches via
   reviewed SQL (`sql/007_nppes_refresh_lifecycle.sql`), recording every real
   change in `provider_field_history`.

Every input is an argument, taxonomy codes come from the database, and
credentials come from the environment.

## What it writes

- Staging writes **only** `refresh_runs` and `nppes_refresh_staging`. A
  truncated or failed release is rolled back and never reaches `npi_records`.
- Apply writes `npi_records` and `provider_field_history`, and only for a
  run whose staging is `complete` with matching counts. It never touches
  `leads`.

How apply behaves (all in `sql/007`):

- **Schema-adaptive.** It writes only columns that exist in both staging and
  the live `npi_records` (and maps `address_postal_code` to
  `address_postalcode` if that is the live spelling). Check the exact mapping
  first with `select * from public.nppes_apply_column_map();`.
- **Real changes only.** Values are compared in canonical form, so
  `555-123-4567` vs `5551234567`, `A` vs `active`, or `08/01/2026` vs
  `2026-08-01` are not changes. New providers get one `record_created`
  history row; changed fields get one row each with old and new values.
- **Batched and resumable.** Each batch is its own short transaction and
  marks its rows `applied_at`. If an apply is interrupted, run
  `--apply-run <id>` again and it continues where it stopped.
- **Guarded.** The same source file (by checksum) can't be applied twice
  unless `refresh_runs.metadata.operator_override` is set to `"true"`.
- **Adds two columns** to `npi_records`: `deactivation_date` and
  `taxonomy_codes` (every code, for secondary-specialty search). Existing
  rows get `taxonomy_codes` filled on the next apply without a history row.
- **Deactivation files** only change `status` and `deactivation_date` on
  providers already in `npi_records`, and never create one. A monthly full
  file never deactivates anything by omission.

## Setup

No third-party dependencies — Python 3.11+ and the standard library.

Credentials come from the environment, or from `scripts/.env` (gitignored):

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key>
```

The service-role key bypasses RLS. Never commit it, and never paste it into
a shell that logs history.

Before the first real run, install `sql/004_nppes_refresh_staging.sql` and
then `sql/007_nppes_refresh_lifecycle.sql` (manual, in the Supabase SQL
Editor), and take a database backup.

## Usage

Run from the `scripts/` directory (or add `scripts/` to `PYTHONPATH`).

```powershell
# 1. Validate the release; nothing is written to Supabase
python -m nppes_ingest "\\GGO-FILESERVER\FileServer\BD\npidata_pfile_20050523-20260809.csv" `
  --run-type monthly-full --release-date 2026-08-09 --label 2026-08-full --dry-run

# 2. Stage and apply in one command
python -m nppes_ingest "\\GGO-FILESERVER\FileServer\BD\npidata_pfile_20050523-20260809.csv" `
  --run-type monthly-full --release-date 2026-08-09 --label 2026-08-full `
  --expect-rows 9726865 --apply

# ...or stage first, look at the run, then apply it separately
python -m nppes_ingest --apply-run <refresh_run_id>

# Deactivation file (NPI + deactivation date only)
python -m nppes_ingest "<path>\NPPES_Deactivated_NPI_Report.csv" `
  --run-type deactivation --release-date 2026-09-08 --apply
```

Use single backslashes in UNC paths; PowerShell doesn't treat `\` as an
escape character.

### Run types

| `--run-type` | Source | Notes |
|---|---|---|
| `monthly-full` | Monthly full dissemination | Inserts new providers and updates changed ones in scope |
| `weekly-incremental` | Weekly update file | Same columns as the full file |
| `deactivation` | Monthly deactivation file | Only NPI + deactivation date; name and taxonomy filters are skipped, since the file has neither |

### Filters

Taxonomy filtering defaults to the enabled codes in `public.taxonomies`, so
a specialty enabled in the admin UI is automatically in scope for the next
refresh. A provider is kept if **any** of its taxonomy codes is enabled.
Override with `--taxonomy-codes 332B00000X` (repeatable) or skip it with
`--all-taxonomies`. `--states VA,CT` narrows by practice location.

**Organizations only by default.** Search and leads only use organizations
(NPI type 2), and several enabled specialties (Internal Medicine, Dental,
Pharmacy) are mostly individual clinicians, so individuals are rejected as
`individual_provider`. Pass `--include-individuals` to keep them.
Deactivation files carry no entity type and are never filtered this way.

### Safety guards

- `--expect-rows N` with `--row-count-tolerance PCT` (default 5%) refuses a
  release whose row count is outside the expected range. It is checked from a
  line count before anything is staged, and again against the parsed rows.
  With `--skip-checksum` there is no line count, so only the second check
  runs: a truncated file is staged and then rolled back rather than refused
  up front.
- Every NPI is checked against the **CMS check digit** (Luhn over the 80840
  issuer prefix).
- Duplicate NPIs within one release are rejected after the first.
- If staging fails partway, the run's rows are deleted and the run is marked
  `failed`. A run is created only once there is a first batch to stage.
- A run starts with `metadata.staging_state = uploading` and becomes
  `complete` only after every batch and the final count update succeed.
  Apply refuses anything else. An interrupted upload can be finalized with
  `--recover-run <id>` (if its counts match) or discarded with
  `--abort-run <id> --reason "..."`.

### Medicare (CMS DMEPOS by Supplier)

```powershell
python -m nppes_ingest.medicare --dry-run   # read + validate, writes nothing
python -m nppes_ingest.medicare --apply     # stage, then apply into npi_cms_enrichment
```

Pages the free CMS data API (about 60,000 suppliers) into
`medicare_refresh_staging`, then `sql/012`'s `apply_medicare_refresh()`
updates `npi_cms_enrichment`, writes `provider_field_history`, and raises a
review alert when a claimed lead's claims fall by more than half. It finds
the newest data year in the CMS catalog automatically (falling back to the
last known version; `--dataset-id` pins one) and prints which one it used. A
release shorter than the row count CMS reports is refused and rolled back.
Identical content is refused by the database unless it has providers that
are now in `npi_records` but weren't loaded before — so run it **after** the
NPPES refresh each month, and suppliers for newly added providers get their
Medicare data. Install `sql/012_medicare_refresh.sql` first.

### What happens to claimed leads

Applying a release updates `npi_records` and records every changed field in
`provider_field_history`. Immediately after that, the same command runs
`sql/015`'s `apply_provider_changes_to_leads`, which brings the provider
snapshot on claimed leads up to date and raises one review alert per lead
whose phone, authorized official, name, city/state or status changed. Reps
see the alert as a "Provider data changed" badge in Claimed leads; admins
work through them under Provider changes. Nothing the rep owns (status,
notes, reminders, ownership) is touched, and no lead is moved between
identity groups — a name or phone change is flagged for an admin instead.

`--skip-lead-sync` leaves that step out. To run it later — for a release
applied before this step existed, or after installing `sql/015` — use:

```powershell
python -m nppes_ingest --sync-run <refresh run id>
```

`--apply-run <id>` on a run that is already applied does the same thing
rather than failing, since there are no staged rows left to apply. The sync
reads `provider_field_history`, not staging, so it works for any applied run.

It resumes from a cursor on the run, so a run that has been synced before
reports "nothing to sync" — that message and `--restart` (needs `sql/017`)
are how to run it again from the beginning:

```powershell
python -m nppes_ingest --sync-run <refresh run id> --restart
```

Re-running is safe: the snapshot copy is idempotent, and an alert for one
lead in one run can only be raised once.

Find the runs that never had it:

```sql
select id, started_at, metadata->>'run_type' as run_type
  from public.refresh_runs
 where source = 'nppes' and metadata->>'apply_state' = 'applied'
   and metadata->>'lead_sync_state' is null
 order by started_at;
```

### When a run gets stuck

A staged run that can't be applied (wrong dataset, a rollback that took its
rows with it) can be applied later or closed out, without downloading
anything again:

```powershell
python -m nppes_ingest.medicare --apply-run <run id>
python -m nppes_ingest.medicare --abort-run <run id> --reason "why"
python -m nppes_ingest --abort-run <run id> --reason "why"   # NPPES
```

An abort deletes whatever staging is left and marks the run failed with the
reason on it. A run that is mid-apply or already applied is refused — those
are never abortable. Needs `sql/016`. To find candidates:

```sql
select r.id, r.source, r.status, r.row_count,
       case r.source when 'nppes'
            then (select count(*) from public.nppes_refresh_staging s where s.refresh_run_id = r.id)
            else (select count(*) from public.medicare_refresh_staging s where s.refresh_run_id = r.id) end as staged_now
  from public.refresh_runs r where r.status = 'staged' order by r.started_at desc;
```

### Plumbing

`--batch-size` (default 500) sets rows per staging insert;
`--apply-batch-size` (default 1000) sets rows per apply transaction. If a
batch hits the database statement timeout, apply halves the batch size and
retries, down to 50.

`--skip-checksum` skips the SHA-256 pre-pass over the source file. That pass
reads all 11 GB before any rows are staged, which is slow over the
`\GGO-FILESERVER` share -- copy the file locally if you can, and use this
flag if you can't. The run is then identified by
`nohash:<file name>:<size>:<mtime>` instead of a content hash, so the
"same file already applied" guard still works between runs, but it can't
notice that two files with the same name and size differ in content.

## Output

Written to `--output-dir` (default `scripts/out/`, gitignored):

- `<label>.manifest.json` — run type, source path, SHA-256 checksum, byte
  size, filters, row counts, and rejections broken down by reason. The same
  content is stored on `refresh_runs.metadata`.
- `<label>.rejects.csv` — every rejected row with its source row number,
  NPI, reason code, and detail (only created if something was rejected).

Reason codes: `missing_npi`, `bad_npi_format`, `bad_npi_checksum`,
`duplicate_npi_in_release`, `missing_name`, `individual_provider`,
`state_not_selected`, `taxonomy_not_enabled`.

## Tests

```bash
python -m unittest discover -s scripts/tests -t scripts
```

46 tests: NPI check-digit validation, normalization, header mapping, the
row-count guard, full ingest runs against fixtures (staging contents,
manifest and rejects, dry run, rollback), streaming behaviour, the
organizations-only filter, the apply driver, and the `--apply` /
`--apply-run` / `--include-individuals` CLI options.

On the managed Windows workstation, tests use `NPPES_TEST_TMP` when set;
otherwise `C:\tmp\dmedesk-nppes-tests`.

## Layout

```
nppes_ingest/
  cli.py             argparse entry point
  config.py          env/dotenv credentials
  ingest.py          streaming stage into refresh_runs/staging
  apply.py           drives the batched SQL apply
  medicare.py        CMS DMEPOS by-Supplier loader (python -m nppes_ingest.medicare)
  mapping.py         NPPES headers -> staging columns
  normalize.py       canonical values (phone, name, dates, postal)
  supabase_rest.py   minimal PostgREST client (stdlib only)
  taxonomies.py      enabled taxonomy codes from the database
  validate.py        NPI check digit, duplicates, filters, row-count guard
  manifest.py        checksum + line count + run manifest
  insert_new.py      DEPRECATED insert-only loader (kept for reference)
tests/
  test_ingest.py     ingest/apply suite
  test_medicare.py   Medicare loader suite
  fixtures/          small NPPES-shaped CSVs
```
