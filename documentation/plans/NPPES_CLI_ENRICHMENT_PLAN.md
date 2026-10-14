# NPPES CLI Enrichment & Capability Upgrade Plan

> **Status:** Draft  
> **Target Package:** `scripts/nppes_ingest/` CLI (`python -m nppes_ingest`)  
> **Source Reference:** `C:\Users\ben.arthur\Downloads\bens html\dialer_app\backend\npi_hub.py` & `ngs_pipeline.py`

---

## 1. Executive Summary & Objective

The existing `nppes_ingest` CLI handles monthly NPPES staging and batch updates into Supabase `npi_records`. However, our historical lead spreadsheets (dialing sheets from 2025/2026, BD meetings, rep sheets) contain thousands of leads that have:

- Missing NPI numbers despite having valid company names and phone numbers.
- Mangled company names from OCR or bad copy-pasting (e.g., `M E D I C A L   S U P P L Y`).
- Unstandardized phone numbers and duplicate entries.
- Missing Medicare claims and reimbursement data.

The dialer backend (`dialer_app/backend/npi_hub.py`) already contains tested routines that solve these exact operational data challenges.

This plan details how to systematically port, refactor, and expand those capabilities directly into the core `python -m nppes_ingest` CLI so that lead enrichment, name cleaning, and dialer export can be executed reliably via modular CLI subcommands.

---

## 2. Inventory of Dialer App Capabilities to Port

| Feature in `npi_hub.py`                              | Line Range               | Current Behavior                                                                                                                 | Target CLI Subcommand                    |
| :--------------------------------------------------- | :----------------------- | :------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------- |
| **`enrich_task()`**                                  | L1381–L1580              | Resolves missing NPIs using exact phone match (`OfficePhone`, `AuthPhone`) and fuzzy company name match against SQLite NPPES db. | `python -m nppes_ingest enrich`          |
| **`fix_broken_name_tokens()` & `fix_names_in_df()`** | L575–L725                | Detects and fixes single-letter spaced tokens (e.g. `C A R E` → `CARE`), strips noisy legal suffixes, fixes case.                | `python -m nppes_ingest clean-names`     |
| **`format_task()` / `dmedesk_format_task()`**        | L729–L1000 / L1583–L1870 | Re-maps messy spreadsheet columns into standard DMEDesk format, deduplicates on phone/NPI, standardizes phone format.            | `python -m nppes_ingest format-leads`    |
| **`enrich_fakenpi_task()`**                          | L1910–L2120              | Handles external non-NPPES leads, generates deterministic synthetic IDs, and upserts them to Supabase `npi_records`.             | `python -m nppes_ingest upsert-external` |
| **`ngs_pipeline.py`**                                | External                 | High-speed filtering by state, taxonomy code, and active status.                                                                 | `python -m nppes_ingest filter`          |
| **`generate_brief()`**                               | L27–L145                 | Uses Gemini to generate 5-point sales briefs for cold call preparation.                                                          | `python -m nppes_ingest brief`           |

---

## 3. Modular CLI Architecture

We will extend `scripts/nppes_ingest/cli.py` by adding modular subcommands via `argparse.add_subparsers()`:

```
python -m nppes_ingest
├── ingest            (Existing: stage and apply monthly NPPES releases)
├── enrich            (NEW: resolve NPIs from phone/company name)
├── clean-names       (NEW: fix token spacing, OCR errors, formatting)
├── format-leads      (NEW: deduplicate, clean phones, prepare for dialer)
├── cms-sync          (NEW: attach latest Medicare claims/payment data)
├── upsert-external   (NEW: safe Supabase upsert for external lead sheets)
└── brief             (NEW: batch generate Gemini 5-point sales briefs)
```

---

## 4. Subcommand Specifications

### 4.1 Subcommand: `enrich`

**Purpose:** Take any raw lead CSV/Excel with missing NPIs and fill them by querying our database or local NPPES SQLite index.

```powershell
python -m nppes_ingest enrich `
  --input "temp/BD DME 2026 - before issues.xlsx" `
  --output "scripts/out/enriched_leads_2026.csv" `
  --match-strategy phone-then-fuzzy-name `
  --min-confidence 0.85
```

**Matching Logic:**

1. **Tier 1 (Exact Phone):** Match cleaned 10-digit phone against `OfficePhone` or `AuthPhone`. If unique match found → assign NPI with `confidence = 1.0`.
2. **Tier 2 (Fuzzy Company Name + State):** If phone fails or is missing, normalize name (strip `LLC`, `INC`, punctuation) and compute token sort ratio against providers in the same state. If similarity ≥ 85% → assign NPI with `confidence = 0.85`.
3. **Tier 3 (Unresolved):** Mark with `confidence = 0.0` for manual inspection.

### 4.2 Subcommand: `clean-names`

**Purpose:** Fix corrupted company names across spreadsheets or database tables.

```powershell
python -m nppes_ingest clean-names `
  --input "raw_leads.csv" `
  --output "cleaned_leads.csv" `
  --column "Legalbusinessname"
```

**Transformations:**

- Token defragmentation: Reconnects spaced characters (`"A M P   M E D I C A L"` → `"AMP MEDICAL"`).
- Case normalization: Proper Title Case while preserving standard medical acronyms (`DME`, `LLC`, `CPAP`, `CGM`, `O&P`).
- DBA extraction: Parses `"LEGAL NAME DBA TRADING NAME"` into distinct legal and trade name fields.

### 4.3 Subcommand: `format-leads`

**Purpose:** Prepare raw rep spreadsheets for ingestion into the DMEDesk dialer.

```powershell
python -m nppes_ingest format-leads `
  --input "sheet.xlsx" `
  --sheet-name "MAIN" `
  --dedupe-by phone `
  --drop-disconnected
```

**Actions:**

- Phone sanitization to standard 10-digit format (`(555) 123-4567` → `5551234567`).
- Cross-references our `disconnected_numbers` registry to flag dead numbers before reps see them.
- Deduplication: Removes duplicate entries within the file and against existing active leads.

### 4.4 Subcommand: `cms-sync`

**Purpose:** Join CMS Medicare claims, payment volumes, and beneficiary counts to any lead file using NPI.

```powershell
python -m nppes_ingest cms-sync `
  --input "leads.csv" `
  --output "leads_with_medicare.csv"
```

**Output Fields Added:**

- `total_claims`: Total Medicare claims submitted.
- `medicare_payment`: Total Medicare reimbursement received ($).
- `total_beneficiaries`: Distinct Medicare patients served.
- `dme_hcpcs_summary`: High-level category flags (e.g., `CGM`, `ORT`, `O&P`, `General`).

---

## 5. Phased Implementation Roadmap

### Phase 1: Core Matching & Name Cleaning Engine

- Extract `fix_broken_name_tokens()` and normalization utilities into `scripts/nppes_ingest/normalize.py`.
- Implement `scripts/nppes_ingest/enrichment.py` providing phone and fuzzy name resolution functions.
- Unit tests validating name fixes and lookup accuracy.

### Phase 2: CLI Subcommand Integration

- Refactor `scripts/nppes_ingest/cli.py` to register `enrich`, `clean-names`, and `format-leads`.
- Add progress bars, batching, and detailed logging for large spreadsheet imports.

### Phase 3: Supabase Sync & CMS Attachment

- Implement `cms-sync` and `upsert-external` to push enriched data directly into Supabase `npi_records`.
- Add safety checks to ensure external records do not overwrite official NPPES monthly refresh fields.

### Phase 4: AI Brief Generator CLI

- Port Gemini call brief logic into `python -m nppes_ingest brief` for on-demand lead brief generation.

---

## 6. Review Points for Malak (Project Lead)

1. **Target Database for Lookups:** Should the CLI lookup prioritize querying Supabase via REST/PostgREST, or maintain a local SQLite snapshot of `nppes.db` for zero-latency batch processing? (Local SQLite is significantly faster for 100k+ rows).
2. **Confidence Threshold:** For fuzzy company name matches, is an 85% Levenshtein threshold acceptable, or should we default to 90% to avoid false NPI linkages?
3. **Execution Priority:** Should Phase 1 (`clean-names` and `enrich`) be delivered immediately to assist with building the lead scoring calibration dataset?
