# NPPES Ingest & Grouping — Colleague Handoff

> **Date:** 2026-09-16  
> **Status:** CLI is already installed. `scripts\.env` has credentials. DB connection is verified.  
> You need to do three things: **dump → ingest → test grouping locally.**

All commands below assume PowerShell and start from the **project root** (the folder containing `scripts\` and `worker\`). Wherever you cloned the repo, `cd` there first:

```powershell
cd <path-to>\dmedesk-prospector
```

---

## 0 — Setup (already done, just verify)

Confirm Python, Node, and the Supabase CLI are reachable:

```powershell
python --version     # need 3.11+
node --version       # need 18+
supabase --version   # confirm CLI is installed
```

The `.env` file with credentials should already exist at `scripts\.env` (gitignored — it is not in the repo, so it must be copied onto your machine).

---

## Step 1 — Dump the Supabase database

> ⚠️ The backup files at `temp\supabase-backup-2026-09-08\` are **0 bytes** — the previous run created them but never wrote to them. Run the dump now.

> 🐳 `supabase db dump` runs `pg_dump` inside Docker. **Start Docker Desktop first**, or the dump fails and can leave empty files behind.

Get your **database connection URI** from:  
Supabase Dashboard → **Project Settings → Database → Connection string → URI**

It looks like:
```
postgresql://postgres:<password>@db.<project-id>.supabase.co:5432/postgres
```

Then run from the project root. A full backup is **three** files — roles, schema, and data. Without `--data-only`, `db dump` writes the schema, not the rows.

```powershell
$DB_URL = "postgresql://postgres:<password>@db.<project-id>.supabase.co:5432/postgres"

# Roles
supabase db dump --db-url $DB_URL --role-only -f "temp\supabase-backup-2026-09-08\roles.sql"

# Schema (tables, functions, RLS policies)
supabase db dump --db-url $DB_URL -f "temp\supabase-backup-2026-09-08\schema.sql"

# Data (rows)
supabase db dump --db-url $DB_URL --data-only -f "temp\supabase-backup-2026-09-08\data.sql"
```

### Verify it worked

```powershell
Get-Item "temp\supabase-backup-2026-09-08\*.sql" | Select-Object Name, Length
```

All three files (`roles.sql`, `schema.sql`, `data.sql`) must show `Length > 0`. If any is 0 bytes, **stop and fix before continuing.**

---

## Step 2 — NPPES refresh dry-run (no DB writes)

> The old `insert_new.py` loader is **deprecated**: it only inserted new NPIs, never updated changed providers, and wrote no history. Use the staged refresh below (`scripts/README.md` has the details).

This validates the 11.6 GB CSV and reports what would be staged. Nothing is written. It keeps **organizations** (NPI type 2; add `--include-individuals` to keep individuals too) in the specialties **enabled in the app's `taxonomies` table** — check that list first (and that `291U00000X`, if enabled, is really what you want: in the NUCC code set it is Clinical Medical Laboratory, not home health).

> Use **single** backslashes in the UNC path. PowerShell does not treat `\` as an escape character, so `\\\\GGO-FILESERVER\\...` is passed through literally and the file will not be found.

```powershell
cd scripts

python -m nppes_ingest "\\GGO-FILESERVER\FileServer\BD\npidata_pfile_20050523-20260809.csv" `
  --run-type monthly-full --release-date 2026-08-09 --label 2026-08-full `
  --expect-rows 9726865 --dry-run
```

It prints the source row count, accepted rows, and rejections by reason, and writes `scripts\out\2026-08-full.manifest.json`.

---

## Step 3 — Stage and apply (writes to `npi_records`)

Only run this after Step 1 (backup verified), Step 2 (dry-run), and Step 4a (Python tests) all pass, and after `sql/004_nppes_refresh_staging.sql` and `sql/007_nppes_refresh_lifecycle.sql` have been run in Supabase.

First check how staged columns map onto the live table (read-only):

```sql
select * from public.nppes_apply_column_map();
```

Then:

```powershell
cd scripts

python -m nppes_ingest "\\GGO-FILESERVER\FileServer\BD\npidata_pfile_20050523-20260809.csv" `
  --run-type monthly-full --release-date 2026-08-09 --label 2026-08-full `
  --expect-rows 9726865 --apply
```

It stages the release in batches, then applies it in batches, printing progress, and ends with the number of new providers, updated providers, and field changes recorded in `provider_field_history`. If it's interrupted during the apply, run `python -m nppes_ingest --apply-run <refresh run id>` and it continues where it stopped.

> ⚠️ This writes to the **live `npi_records` table**. Only run once the backup is verified.

---

## Step 4 — Test grouping locally

There are two test suites to run, both from the **project root** (`cd ..` if you are still in `scripts\`).

### 4a — Python unit tests (NPPES ingest + normalization)

37 tests covering NPI validation, name/phone normalization, header mapping, row-count guards, full and streaming ingest runs against fixture CSVs, the organizations-only filter, and the batched apply driver and CLI options.

```powershell
python -m unittest discover -s scripts/tests -t scripts
```

**Expected output:**
```
..........................
----------------------------------------------------------------------
Ran 37 tests in X.XXXs

OK
```

If any tests fail, read the error — do not proceed to `--apply` (Step 3) if the ingest tests fail.

> If you see an error about `C:\tmp\dmedesk-nppes-tests` not being writable, point the tests at your own temp folder first:
> ```powershell
> $env:NPPES_TEST_TMP = Join-Path $env:TEMP "dmedesk-nppes-tests"
> python -m unittest discover -s scripts/tests -t scripts
> ```

---

### 4b — Node.js grouping / preflight

`worker/src/services/leadPreflight.js` is the same code the Worker uses. There are two checks.

#### Unit tests (Tier 1 + Tier 2)

```powershell
node --test worker/test/leadPreflight.test.js
```

**Expected:** `ℹ pass 10` and `ℹ fail 0`. These cover key normalization (legal suffixes stripped, middle initials ignored, location phone before official phone), every Tier 1/2/3 rule, weak combinations that must not match, fuzzy names only flagging, and preflight ownership/review decisions. The tier rules are documented in `documentation/plans/LEAD_INTAKE_AND_GROUPING_GUIDE.md`.

#### CLI smoke test (Tier 1 / batch decisions only)

The CLI takes a JSON file of candidates and returns a preflight decision for each (`accept`, `needs_review`, `duplicate`, `owned_conflict`, `invalid`). This sample has no existing records to match against, so it only exercises batch checks and the group key — tier matching is covered by the unit tests above.

**Create a test candidates file** at `temp\test_candidates.json`.

> ⚠️ Create it in **VS Code or Notepad**, not with PowerShell `Set-Content` / `Out-File`. Windows PowerShell 5.1 adds a UTF-8 byte-order mark, and the script then fails with `Unexpected token '﻿'`.

```json
[
  {
    "npi": "1234567893",
    "name": "ABC Medical Supply LLC",
    "address_state": "VA",
    "authorizedofficial_firstname": "Jane",
    "authorizedofficial_lastname": "Smith",
    "phone": "5551234567"
  },
  {
    "npi": "1234567893",
    "name": "Duplicate NPI — should be flagged",
    "address_state": "VA",
    "authorizedofficial_firstname": "Jane",
    "authorizedofficial_lastname": "Smith",
    "phone": "5551234567"
  },
  {
    "npi": "BADNPI",
    "name": "Invalid NPI — should be flagged",
    "address_state": "TX"
  }
]
```

**Run the preflight script:**

```powershell
node scripts/lead-intake/preflight.mjs temp\test_candidates.json
```

**Expected output:**
```json
{
  "summary": {
    "total": 3,
    "accept": 1,
    "duplicate": 1,
    "invalid": 1
  },
  "results": [
    { "npi": "1234567893", "decision": "accept", "identityKey": "group:abc medical supply|jane smith|5551234567", "groupId": null },
    { "npi": "1234567893", "decision": "duplicate", "reasons": ["duplicate_in_batch"] },
    { "npi": "BADNPI",     "decision": "invalid",   "reasons": ["invalid_npi"] }
  ]
}
```

If the summary matches `accept: 1, duplicate: 1, invalid: 1` and the unit tests pass, grouping logic is working correctly.

---

## Taxonomy codes reference

| Code | Description |
|---|---|
| `332B00000X` | Durable Medical Equipment & Medical Supplies |
| `291U00000X` | Clinical Medical Laboratory (NUCC). Earlier versions of this doc called it "Home Health Aide" — confirm which specialty is intended before enabling it. |

---

## Troubleshooting

| Error | Fix |
|---|---|
| `ModuleNotFoundError: No module named 'nppes_ingest.config'` | Wrong directory. `cd` into `scripts\` before running the ingest (Steps 2–3). |
| `NPPES CSV not found` | Use the full UNC path with **single** backslashes: `\\GGO-FILESERVER\FileServer\BD\...` (see Step 2). |
| `source row count ... is outside the expected` | The file is truncated or a different release. Re-download, or adjust `--expect-rows` deliberately. |
| `this source file ... was already applied` | That exact file was applied before. Nothing to do, unless an admin intentionally sets `operator_override` on the new run. |
| `roles.sql`, `schema.sql` or `data.sql` still 0 bytes | Dump failed. Check Docker Desktop is running, then check `$DB_URL` — wrong password or project ID. |
| `NPPES_TEST_TMP` error in Python tests | Set the env var to a writable temp path (see Step 4a note). |
| `Cannot find module '../../worker/src/services/leadPreflight.js'` | Run the node command from the **project root**, not from `scripts\`. |
| `SyntaxError: Unexpected token '﻿'` from `preflight.mjs` | The JSON file has a byte-order mark. Re-save it as UTF-8 **without BOM** (VS Code: bottom-right encoding → "Save with Encoding" → UTF-8). |

---

## Key files

| File | Purpose |
|---|---|
| [`scripts/nppes_ingest/`](scripts/nppes_ingest/) | NPPES stage + apply CLI (`python -m nppes_ingest`) |
| [`sql/007_nppes_refresh_lifecycle.sql`](sql/007_nppes_refresh_lifecycle.sql) | Batched, schema-adaptive apply into `npi_records` |
| [`scripts/tests/test_ingest.py`](scripts/tests/test_ingest.py) | Python unit tests (37 tests) |
| [`worker/src/services/leadPreflight.js`](worker/src/services/leadPreflight.js) | Grouping/preflight logic (Tier 1 / 2 / 3) |
| [`sql/008_identity_match_tiers.sql`](sql/008_identity_match_tiers.sql) | Regroups existing leads under the tier keys (manual, not yet run) |
| [`sql/009_identity_match_review.sql`](sql/009_identity_match_review.sql) | Merge/dismiss decisions behind the Admin tab's Possible duplicates panel (manual, not yet run) |
| [`worker/test/leadPreflight.test.js`](worker/test/leadPreflight.test.js) | Node preflight unit tests |
| [`scripts/lead-intake/preflight.mjs`](scripts/lead-intake/preflight.mjs) | Node CLI wrapper for preflight |
| `scripts/.env` | Supabase credentials (gitignored, not in the repo) |
| `temp/supabase-backup-2026-09-08/` | Backup destination |
