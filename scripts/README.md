# NPPES ingestion CLI

Loads an NPPES release into the `nppes_refresh_staging` table under a single
`refresh_runs` row, with validation, a source checksum, and a manifest.

Replaces the hardcoded `nppes_filter.py` that lived on one developer's
machine: every input is an argument, taxonomy codes come from the database
rather than a second copy of the list, and credentials come from the
environment.

## The boundary this tool will not cross

It writes **only** `refresh_runs` and `nppes_refresh_staging`.

It never writes `npi_records`, and never writes `leads`. Applying staged
data to the live provider record — comparing canonical values, writing
`provider_field_history` *before* any overwrite, and raising review alerts —
is a separate transactional SQL step that does not exist yet. Staging a
release is safe on its own precisely because nothing downstream happens
until that step is built and run deliberately.

## Setup

No third-party dependencies — Python 3.11+ and the standard library.

Credentials come from the environment, or from `scripts/.env` (gitignored):

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key>
```

The service-role key bypasses RLS. Never commit it, and never paste it into
a shell that logs history.

Before the first real run, install the staging table:
`sql/004_nppes_refresh_staging.sql` (manual, in the Supabase SQL editor).

## Usage

```bash
# Validate a release without credentials and without writing anything
python3 -m nppes_ingest ~/Downloads/npidata_pfile_20260901.csv \
  --run-type monthly-full --all-taxonomies --dry-run

# Stage the monthly full file, keeping only enabled taxonomies (from the
# `taxonomies` table) and a few states
python3 -m nppes_ingest ~/Downloads/npidata_pfile_20260901.csv \
  --run-type monthly-full \
  --release-date 2026-09-01 \
  --states VA,CT,CA \
  --expect-rows 8600000 \
  --label 2026-09-full

# Weekly incremental
python3 -m nppes_ingest ~/Downloads/npidata_pfile_20260908_20260914.csv \
  --run-type weekly-incremental --release-date 2026-09-14

# Deactivation file (NPI + deactivation date only)
python3 -m nppes_ingest ~/Downloads/npidata_deactivation_20260901.csv \
  --run-type deactivation --release-date 2026-09-01
```

Run it from the `scripts/` directory (or add `scripts/` to `PYTHONPATH`).

### Run types

| `--run-type` | Source | Notes |
|---|---|---|
| `monthly-full` | Monthly full dissemination | Reconciliation run; compare counts against the weekly state |
| `weekly-incremental` | Weekly update file | Same columns as the full file |
| `deactivation` | Monthly deactivation file | Only NPI + deactivation date; name and taxonomy filters are skipped, since the file has neither |

### Filters

Taxonomy filtering defaults to the enabled codes in `public.taxonomies`, so
a taxonomy enabled in the admin UI is automatically in scope for the next
import. Override with `--taxonomy-codes 332B00000X` (repeatable) or skip it
with `--all-taxonomies`. `--states VA,CT` narrows by practice location.

### Safety guards

- `--expect-rows N` with `--row-count-tolerance PCT` (default 5%) refuses a
  release whose row count is outside the expected range. A truncated
  download that is otherwise structurally fine is the dangerous case: it
  would read as "thousands of providers changed" rather than "the file was
  cut short". The guard runs on raw source rows, before any of our own
  filters.
- Every NPI is checked against the **CMS check digit** (Luhn over the 80840
  issuer prefix), not just "is it 10 digits" — a transposition typo would
  otherwise create a phantom provider that never matches anything.
- Duplicate NPIs within one release are rejected after the first.
- If staging fails partway, the run's rows are deleted and the run is
  marked `failed`, so a half-loaded release can never be mistaken for a
  complete one.

## Output

Written to `--output-dir` (default `scripts/out/`, gitignored):

- `<label>.manifest.json` — run type, source path, SHA-256 checksum, byte
  size, filters, row counts, and rejections broken down by reason. The same
  content is stored on `refresh_runs.metadata`.
- `<label>.rejects.csv` — every rejected row with its source row number,
  NPI, reason code, and detail. Row numbers are 1-based including the
  header, so they line up with what a spreadsheet shows.

Reason codes: `missing_npi`, `bad_npi_format`, `bad_npi_checksum`,
`duplicate_npi_in_release`, `missing_name`, `state_not_selected`,
`taxonomy_not_enabled`.

Filtered rows and malformed rows are counted separately on purpose — "12,000
rows filtered out by state" and "3 rows were malformed" mean very different
things when a release looks unexpectedly small.

## Tests

```bash
python3 -m unittest discover -s scripts/tests -t scripts
```

24 tests covering NPI check-digit validation, phone/date/postal
normalization, header mapping (including primary-taxonomy selection and
deactivate-vs-reactivate ordering), the row-count guard, and full ingest
runs against a fixture — staging contents, manifest and rejects output, dry
run, and rollback when staging fails partway.

## Layout

```
nppes_ingest/
  cli.py             argparse entry point
  config.py          env/dotenv credentials
  ingest.py          orchestration + the refresh_runs/staging boundary
  mapping.py         NPPES headers -> staging columns
  normalize.py       canonical values (phone, name, dates, postal)
  supabase_rest.py   minimal PostgREST client (stdlib only)
  taxonomies.py      enabled taxonomy codes from the database
  validate.py        NPI check digit, duplicates, filters, row-count guard
  manifest.py        checksum + run manifest
tests/
  test_ingest.py     the suite above
  fixtures/          small NPPES-shaped CSVs
```
