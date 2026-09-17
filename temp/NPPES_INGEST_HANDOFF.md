# NPPES Ingest & Grouping — Colleague Handoff

> **Date:** 2026-09-16  
> **Status:** CLI is already installed. `scripts\.env` has credentials. DB connection is verified.  
> You need to do three things: **dump → ingest → test grouping locally.**

---

## 0 — Setup (already done, just verify)

Open PowerShell and confirm Python and Node are reachable:

```powershell
python --version     # need 3.11+
node --version       # need 18+
supabase --version   # confirm CLI is installed
```

The `.env` file with credentials is already at:
```
C:\Users\ben.arthur\Desktop\dmedesk-prospector\scripts\.env
```

---

## Step 1 — Dump the Supabase database

> ⚠️ The backup files at `temp\supabase-backup-2026-09-08\` are **0 bytes** — the previous run created them but never wrote to them. Run the dump now.

Get your **database connection URI** from:  
Supabase Dashboard → **Project Settings → Database → Connection string → URI**

It looks like:
```
postgresql://postgres:<password>@db.<project-id>.supabase.co:5432/postgres
```

Then run from the project root:

```powershell
cd C:\Users\ben.arthur\Desktop\dmedesk-prospector

$DB_URL = "postgresql://postgres:<password>@db.<project-id>.supabase.co:5432/postgres"

# Dump roles
supabase db dump --db-url $DB_URL --role-only `
  -f "temp\supabase-backup-2026-09-08\roles.sql"

# Dump data
supabase db dump --db-url $DB_URL `
  -f "temp\supabase-backup-2026-09-08\data.sql"
```

### Verify it worked

```powershell
Get-Item "temp\supabase-backup-2026-09-08\*.sql" | Select-Object Name, Length
```

Both files must show `Length > 0`. If either is still 0 bytes, **stop and fix before continuing.**

---

## Step 2 — NPPES ingest dry-run (no DB writes)

This scans the 11.6 GB CSV and counts candidates. Nothing is written.

```powershell
cd C:\Users\ben.arthur\Desktop\dmedesk-prospector\scripts

python -m nppes_ingest.insert_new `
  "\\\\GGO-FILESERVER\\FileServer\\BD\\npidata_pfile_20050523-20260809.csv" `
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

Only run this after Steps 1 and 2 are confirmed.

```powershell
cd C:\Users\ben.arthur\Desktop\dmedesk-prospector\scripts

python -m nppes_ingest.insert_new `
  "\\\\GGO-FILESERVER\\FileServer\\BD\\npidata_pfile_20050523-20260809.csv" `
  --taxonomy-codes 332B00000X,291U00000X `
  --progress-every 1000 `
  --apply
```

Final line should include `"inserted": 105919` (minus any NPIs already in the table).

> ⚠️ This writes to the **live `npi_records` table**. Only run once the backup is verified.

---

## Step 4 — Test grouping locally

There are two test suites to run.

### 4a — Python unit tests (NPPES ingest + normalization)

These are 24 tests covering NPI validation, name/phone normalization, header mapping, row-count guards, and full ingest runs against fixture CSVs.

```powershell
cd C:\Users\ben.arthur\Desktop\dmedesk-prospector

python -m unittest discover -s scripts/tests -t scripts
```

**Expected output:**
```
..........................
----------------------------------------------------------------------
Ran 24 tests in X.XXXs

OK
```

If any tests fail, read the error — do not proceed to `--apply` if the ingest tests fail.

> If you see an error about `C:\tmp\dmedesk-nppes-tests` not being writable, set the env var first:
> ```powershell
> $env:NPPES_TEST_TMP = "C:\Users\ben.arthur\AppData\Local\Temp\dmedesk-nppes-tests"
> python -m unittest discover -s scripts/tests -t scripts
> ```

---

### 4b — Node.js grouping / preflight smoke test

This tests the Tier 1 + Tier 2 grouping logic in `leadPreflight.js` — the same code the Worker uses.

The script takes a JSON file of candidates and returns a preflight decision for each (`accept`, `duplicate`, `owned_conflict`, `invalid`).

**Create a test candidates file** at `temp\test_candidates.json`:

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
cd C:\Users\ben.arthur\Desktop\dmedesk-prospector

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
    { "npi": "1234567893", "decision": "accept", "identityKey": "abc medical supply llc|VA|jane smith|5551234567", "groupId": null },
    { "npi": "1234567893", "decision": "duplicate", "reasons": ["duplicate_in_batch"] },
    { "npi": "BADNPI",     "decision": "invalid",   "reasons": ["invalid_npi"] }
  ]
}
```

If the summary matches `accept: 1, duplicate: 1, invalid: 1` — grouping logic is working correctly.

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
| `ModuleNotFoundError: No module named 'nppes_ingest.config'` | Wrong directory. `cd` into `scripts\` before running Python. |
| `NPPES CSV not found` | Use full absolute path to the CSV (see Step 2). |
| `unrecognized arguments: 291U00000X` | Space after comma in `--taxonomy-codes`. Use `332B00000X,291U00000X` — no space. |
| `roles.sql` or `data.sql` still 0 bytes | Dump failed. Check `$DB_URL` — wrong password or project ID. |
| `NPPES_TEST_TMP` error in Python tests | Set the env var to a writable temp path (see Step 4a note). |
| `Cannot find module '../../worker/src/services/leadPreflight.js'` | Run the node command from the **project root**, not from `scripts\`. |

---

## Key files

| File | Purpose |
|---|---|
| [`scripts/nppes_ingest/insert_new.py`](file:///C:/Users/ben.arthur/Desktop/dmedesk-prospector/scripts/nppes_ingest/insert_new.py) | NPPES ingest script |
| [`scripts/tests/test_ingest.py`](file:///C:/Users/ben.arthur/Desktop/dmedesk-prospector/scripts/tests/test_ingest.py) | Python unit tests (24 tests) |
| [`worker/src/services/leadPreflight.js`](file:///C:/Users/ben.arthur/Desktop/dmedesk-prospector/worker/src/services/leadPreflight.js) | Grouping/preflight logic |
| [`scripts/lead-intake/preflight.mjs`](file:///C:/Users/ben.arthur/Desktop/dmedesk-prospector/scripts/lead-intake/preflight.mjs) | Node CLI wrapper for preflight |
| [`scripts/.env`](file:///C:/Users/ben.arthur/Desktop/dmedesk-prospector/scripts/.env) | Supabase credentials (gitignored) |
| [`temp/supabase-backup-2026-09-08/`](file:///C:/Users/ben.arthur/Desktop/dmedesk-prospector/temp/supabase-backup-2026-09-08/) | Backup destination |
