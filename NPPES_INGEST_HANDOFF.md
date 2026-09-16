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

## Step 2 — NPPES ingest dry-run (no DB writes)

This scans the 11.6 GB CSV and counts candidates. Nothing is written.

> Use **single** backslashes in the UNC path. PowerShell does not treat `\` as an escape character, so `\\\\GGO-FILESERVER\\...` is passed through literally and the file will not be found.

```powershell
cd scripts

python -m nppes_ingest.insert_new `
  "\\GGO-FILESERVER\FileServer\BD\npidata_pfile_20050523-20260809.csv" `
  --taxonomy-codes 332B00000X,291U00000X `
  --progress-every 1000
```

You'll see live progress:
```
Scanning ... for taxonomy codes: 291U00000X, 332B00000X
Scanned 1,000 rows | matches 14 | candidates 11 | 3,500 rows/sec
...
Scanned 9,726,865 rows | matches 135,548 | candidates 105,919 | ~3,800 rows/sec
{'input': 9726865, 'taxonomy_match': 135548, 'excluded': 29629, 'new_candidates': 105919, 'inserted': 0}
```

**Expected:** `new_candidates: 105919`, `inserted: 0`

> ⏱ Takes ~40–45 minutes. Do not close the terminal.

---

## Step 3 — Ingest with `--apply` (writes to `npi_records`)

Only run this after Step 1 (backup verified), Step 2 (dry-run), and Step 4a (Python tests) all pass.

```powershell
cd scripts

python -m nppes_ingest.insert_new `
  "\\GGO-FILESERVER\FileServer\BD\npidata_pfile_20050523-20260809.csv" `
  --taxonomy-codes 332B00000X,291U00000X `
  --progress-every 1000 `
  --apply
```

Final line should include `"inserted": 105919` (minus any NPIs already in the table).

> ⚠️ This writes to the **live `npi_records` table**. Only run once the backup is verified.

---

## Step 4 — Test grouping locally

There are two test suites to run, both from the **project root** (`cd ..` if you are still in `scripts\`).

### 4a — Python unit tests (NPPES ingest + normalization)

26 tests covering NPI validation, name/phone normalization, header mapping, row-count guards, and full ingest runs against fixture CSVs.

```powershell
python -m unittest discover -s scripts/tests -t scripts
```

**Expected output:**
```
..........................
----------------------------------------------------------------------
Ran 26 tests in X.XXXs

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
| `291U00000X` | Home Health Aide |

---

## Troubleshooting

| Error | Fix |
|---|---|
| `ModuleNotFoundError: No module named 'nppes_ingest.config'` | Wrong directory. `cd` into `scripts\` before running the ingest (Steps 2–3). |
| `NPPES CSV not found` | Use the full UNC path with **single** backslashes: `\\GGO-FILESERVER\FileServer\BD\...` (see Step 2). |
| `unrecognized arguments: 291U00000X` | Space after comma in `--taxonomy-codes`. Use `332B00000X,291U00000X` — no space. |
| `roles.sql`, `schema.sql` or `data.sql` still 0 bytes | Dump failed. Check Docker Desktop is running, then check `$DB_URL` — wrong password or project ID. |
| `NPPES_TEST_TMP` error in Python tests | Set the env var to a writable temp path (see Step 4a note). |
| `Cannot find module '../../worker/src/services/leadPreflight.js'` | Run the node command from the **project root**, not from `scripts\`. |
| `SyntaxError: Unexpected token '﻿'` from `preflight.mjs` | The JSON file has a byte-order mark. Re-save it as UTF-8 **without BOM** (VS Code: bottom-right encoding → "Save with Encoding" → UTF-8). |

---

## Key files

| File | Purpose |
|---|---|
| [`scripts/nppes_ingest/insert_new.py`](scripts/nppes_ingest/insert_new.py) | NPPES ingest script |
| [`scripts/tests/test_ingest.py`](scripts/tests/test_ingest.py) | Python unit tests (26 tests) |
| [`worker/src/services/leadPreflight.js`](worker/src/services/leadPreflight.js) | Grouping/preflight logic (Tier 1 / 2 / 3) |
| [`sql/008_identity_match_tiers.sql`](sql/008_identity_match_tiers.sql) | Regroups existing leads under the tier keys (manual, not yet run) |
| [`sql/009_identity_match_review.sql`](sql/009_identity_match_review.sql) | Merge/dismiss decisions behind the Admin tab's Possible duplicates panel (manual, not yet run) |
| [`worker/test/leadPreflight.test.js`](worker/test/leadPreflight.test.js) | Node preflight unit tests |
| [`scripts/lead-intake/preflight.mjs`](scripts/lead-intake/preflight.mjs) | Node CLI wrapper for preflight |
| `scripts/.env` | Supabase credentials (gitignored, not in the repo) |
| `temp/supabase-backup-2026-09-08/` | Backup destination |
