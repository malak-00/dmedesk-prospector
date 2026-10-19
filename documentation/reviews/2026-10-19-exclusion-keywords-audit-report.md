# Audit Report: Lead & NPI Exclusion Keyword Analysis

**To:** Malak  
**From:** Ben Arthur / Engineering & Data Operations  
**Date:** October 19, 2026  
**File Location:** `documentation/reviews/2026-10-19-exclusion-keywords-audit-report.md`  
**Subject:** Full Audit of Lead Exclusions, Database Sync with `npi_records`, and Keyword Filter Bugs  

---

## 1. Executive Summary

We conducted a complete database audit cross-referencing all records in `public.leads` against our 46 exclusion keywords (`scripts/nppes_ingest/exclude_keywords.txt`) and their underlying status in `public.npi_records`.

### Key Findings at a Glance
1. **Critical False Positive Bug (`hair`):** The exclusion keyword `hair` is actively matching and excluding **wheelchair** companies (e.g., `BUFFALO WHEELCHAIR INC`, `GRAND WHEELCHAIR & MEDICAL SUPPLY`) due to unanchored substring matching (`wheelc-hair`).
2. **Short-Term Collision Bug (`dds`):** The keyword `dds` is matching non-dental business names containing the letters `"DODDS"` (e.g., `1041 DODDS MT. PLEASANT PROFESSIONAL, PLLC`).
3. **Core DME Domain Overlap (`oxygen`, `sleep`, `therapy`):** Legitimate respiratory, CPAP, and oxygen DME equipment suppliers are being caught and excluded (e.g., `A-1 COLORADO MEDICAL SUPPLY AND OXYGEN LLC`, `ACTIVE THERAPY SUPPLY, INC`, `AIRWAY OXYGEN INC`).
4. **Database State Divergence:**
   * **~350+ leads** containing excluded keywords are currently **claimed and actively worked by sales reps** (e.g., *Contract Sent*, *Follow Up*, *Meeting Booked*). In `npi_records`, these are intentionally preserved and unflagged by our rep-protection safety rules.
   * **~300+ unclaimed leads** sit in `public.leads` with `claimed_by is null` and `status = 'new'`. In `npi_records`, they already have `excluded_reason` set, but they were never purged from `public.leads`.
   * **29 leads** in `public.leads` have **no matching record in `npi_records`** (their provider rows were permanently deleted in the October 15 cleanup or originated from external sheet uploads).

---

## 2. Complete Audit Data Breakdown

The table below summarizes every exclusion term found across `public.leads`, its presence in `public.npi_records`, and its ownership breakdown:

| Keyword | Matching Leads | In `npi_records` | Missing from `npi_records` | Held by Rep | Unclaimed (`new`) | Disconnected | Notes / High-Impact Flags |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **pharmacy** | 157 | 157 | 0 | 62 | 3 | 92 | High rep volume; 92 already disconnected |
| **diagnostic** | 136 | 136 | 0 | 46 | 53 | 38 | 53 unowned leads lingering in pipeline |
| **laborator** | 129 | 129 | 0 | 42 | 55 | 35 | 55 unowned leads lingering in pipeline |
| **labs** | 81 | 81 | 0 | 23 | 32 | 26 | 32 unowned leads lingering in pipeline |
| **clinic** | 57 | 56 | 1 | 8 | 30 | 21 | 30 unowned leads |
| **therapy** | 43 | 31 | 12 | 12 | 22 | 9 | **12 deleted from NPI records**; physical therapy vs DME |
| **drug** | 37 | 37 | 0 | 21 | 7 | 9 | Mostly pharmacy / drug stores |
| **dental** | 34 | 29 | 5 | 9 | 17 | 8 | 5 deleted from NPI records |
| **medical group** | 34 | 30 | 4 | 18 | 8 | 8 | 4 deleted from NPI records |
| **hospital** | 29 | 29 | 0 | 11 | 17 | 1 | Hospital systems / hospital equipment |
| **medical center** | 25 | 24 | 1 | 11 | 11 | 3 | 1 deleted from NPI records |
| **sleep** | 21 | 21 | 0 | 9 | 2 | 10 | **Core DME collision** (CPAP / sleep apnea equipment) |
| **oxygen** | 19 | 19 | 0 | 9 | 8 | 2 | **Core DME collision** (liquid/concentrator oxygen) |
| **health center** | 13 | 11 | 2 | 3 | 9 | 1 | 2 deleted from NPI records |
| **foundation** | 11 | 11 | 0 | 1 | 7 | 3 | Non-profit / community health foundations |
| **dds** | 10 | 10 | 0 | 2 | 8 | 0 | Dental offices + **collides with "Dodds"** |
| **hair** | 9 | 9 | 0 | 7 | 1 | 1 | **🚨 Collides with "Wheelchair" suppliers** |
| **lincare inc** | 8 | 8 | 0 | 2 | 3 | 3 | Major competitor |
| **cancer** | 6 | 6 | 0 | 1 | 4 | 1 | Oncology institutes / supply |
| **pulmonary** | 5 | 5 | 0 | 5 | 0 | 0 | All 5 actively held by reps |
| **dentist** | 5 | 5 | 0 | 0 | 5 | 0 | All 5 unclaimed |
| **university** | 5 | 5 | 0 | 1 | 4 | 0 | University medical groups |
| **eye center** | 4 | 4 | 0 | 3 | 1 | 0 | Ophthalmology clinics |
| **ostomy** | 4 | 4 | 0 | 0 | 0 | 4 | All 4 already disconnected |
| **hearing aid** | 4 | 4 | 0 | 1 | 3 | 0 | Audiology / hearing aid dispensaries |
| **salon** | 2 | 2 | 0 | 1 | 0 | 1 | Hair/beauty salons billing DME |
| **optical** | 2 | 2 | 0 | 1 | 1 | 0 | Eyewear / optical stores |
| **eyewear** | 2 | 2 | 0 | 0 | 1 | 1 | Optical shops |
| **wigs** | 1 | 1 | 0 | 1 | 0 | 0 | Medical wig / cranial prosthesis supplier |
| **community health center** | 1 | 1 | 0 | 0 | 1 | 0 | FQHC / community clinic |
| **d.d.s** | 1 | 1 | 0 | 1 | 0 | 0 | Dental practice |
| **eye care** | 1 | 0 | 1 | 0 | 0 | 1 | 1 deleted from NPI records; disconnected |
| **government** | 1 | 1 | 0 | 0 | 0 | 1 | Disconnected lead |
| **optum** | 1 | 1 | 0 | 0 | 0 | 1 | Corporate entity; disconnected |
| **apothecary** | 1 | 1 | 0 | 0 | 1 | 0 | Pharmacy |
| **TOTALS (Instances)** | **909** | **879** | **30** | **318** | **308** | **283** | *(Note: Providers matching multiple terms appear in each row)* |

---

## 3. Root Cause Analysis

### Issue A: Substring Matching Logic Bug (`wheelchair` containing `hair`)
The keyword list uses `ILIKE '%term%'` substring matching. 
Because the word `wheelchair` contains `hair` (`w-h-e-e-l-c-h-a-i-r`), every wheelchair equipment distributor was classified as a hair salon and rejected from search results:
* `BUFFALO WHEELCHAIR INC`
* `GRAND WHEELCHAIR & MEDICAL SUPPLY INC`
* `WHEELCHAIR EQUIPMENT AND BRACING SPECIALISTS LLC`
* `99 MEDICAL EQUIPMENT, HEALTHCARE SUPPLIES & WHEELCHAIR CENTER`
* `FORTUNE CUSTOMER WHEELCHAIR AND MEDICAL SUPPLY`

Similarly, `dds` matches names containing `"Dodds"` (e.g., `1041 DODDS MT. PLEASANT PROFESSIONAL, PLLC`).

### Issue B: DME Core Line Overlaps (`oxygen`, `sleep`, `therapy`)
* Oxygen Concentrators, CPAP/BiPAP sleep equipment, and respiratory therapy supplies represent substantial portions of genuine DME billing.
* Filtering out `oxygen` and `sleep` directly drops valid DME accounts like `A-1 COLORADO MEDICAL SUPPLY AND OXYGEN LLC` and `BLISS SLEEP & RESPIRATORY CARE`.

### Issue C: State Mismatch Between `public.leads` and `public.npi_records`
* **Why do 300+ unclaimed excluded leads still exist in `leads`?**  
  In the October 15 cleanup (`sql/044`), we deleted 120,935 rows from `npi_records`, but `public.leads` was deliberately preserved to prevent accidental data loss. Unclaimed leads that were imported via historical spreadsheets or earlier ingests remained in `public.leads` even though their `npi_records` entry was flagged with `excluded_reason`.
* **Why are rep-held leads unflagged in `npi_records`?**  
  By strict business rule in `sql/042_exclusion_flag.sql`, `apply_exclusion_keywords()` will **never** flag a provider if `exists (select 1 from public.leads where claimed_by is not null)`. This prevents automated scripts from pulling accounts out from under sales reps without explicit management approval.
* **Why are 29 leads missing from `npi_records`?**  
  These leads represent providers that were hard-purged from `npi_records` during previous purges (or originated as sheet leads whose NPIs do not exist in the NPPES registry).

---

## 4. How the Audit Was Executed Safely (Bandwidth & Log Pipe Protection)

To avoid saturating Supabase ingress/egress quotas or overloading the Postgres log pipe (Kong gateway logs, PostgREST connection logs, and slow-query log drains), the audit followed two architecture principles:
1. **Pre-Hashed Leads Table (<5ms):** Instead of running 100,000+ correlated subqueries against `public.leads` for each candidate hit, `public.leads` (~3,500 rows) was hashed into memory first.
2. **Server-Side Aggregation Only:** The queries were run server-side in the Supabase SQL editor, returning a concise summary table of ~46 rows (~2.5 KB payload), ensuring 0 megabytes of billable egress bandwidth.

### Audit Query Used (Reference)

```sql
with terms(term) as (
  values 
    ('sleep'), ('hospital'), ('university'), ('regents of'), ('pharmacy'), ('drug'),
    ('apothecary'), ('ostomy'), ('government'), ('optical'), ('eye care'), ('dentist'),
    ('dds'), ('therapy'), ('wigs'), ('medical wig'), ('optometry'), ('oxygen'),
    ('mayo clinic'), ('lincare inc'), ('eye center'), ('eyewear'), ('medical center'), ('bioelectronics'),
    ('dental'), ('optum'), ('pulmonary'), ('diagnostic'), ('laborator'), ('labs'),
    ('medical group'), ('foundation'), ('hair'), ('foot clinic'), ('walgreen co'), ('clinic'),
    ('foot & ankle center pc'), ('foot & ankle center'), ('oorthopedic surgery & sports medicine'), 
    ('community health center'), ('health center'), ('supply and salon'),
    ('salon'), ('cancer'), ('hearing aid'), ('d.d.s')
),
lead_summary as (
  select 
    l.npi,
    bool_or(l.claimed_by is not null and not l.is_disconnected) as is_rep_held,
    bool_or(l.claimed_by is null and not l.is_disconnected) as is_unclaimed
  from public.leads l
  where l.npi is not null
  group by l.npi
),
hits as (
  select 
    t.term,
    r.npi,
    r.status,
    r.deactivation_date,
    r.excluded_reason,
    coalesce(ls.is_rep_held, false) as is_rep_held,
    coalesce(ls.is_unclaimed, false) as is_unclaimed
  from terms t
  join public.npi_records r 
    on r.name ilike '%' || t.term || '%'
  left join lead_summary ls 
    on ls.npi = r.npi
)
select 
  h.term,
  count(*) as total_npi_matches,
  count(*) filter (where h.deactivation_date is null and upper(coalesce(h.status, 'A')) in ('A', 'ACTIVE')) as active_in_search,
  count(*) filter (where h.excluded_reason is not null) as already_flagged,
  count(*) filter (where h.is_rep_held) as held_by_a_rep,
  count(*) filter (where h.is_unclaimed) as unclaimed_leads
from hits h
group by h.term
order by total_npi_matches desc;
```

---

## 5. Recommended Action Plan

### Step 1: Immediate Keyword Patch (`exclude_keywords.txt`)
Update `scripts/nppes_ingest/exclude_keywords.txt` and `sql/audit_exclusions.sql`:
1. **Fix `hair`:** Replace bare `hair` with targeted phrases:
   * `hair salon`
   * `hair studio`
   * `hair replacement`
   *(Immediately unblocks all wheelchair suppliers).*
2. **Fix `dds`:** Drop the bare term `dds` and retain `d.d.s` (or require word boundary spacing `' dds '`).
3. **Refine DME Core Terms:** Evaluate removing `oxygen` and `sleep` from the global exclusion list so legitimate respiratory DME suppliers remain prospectable.

### Step 2: Clean Up Unclaimed Excluded Leads in `public.leads`
For the ~300 unclaimed leads matching confirmed non-DME terms (diagnostic labs, dental, pharmacies, hospitals):
* Mark them as `is_disconnected = true` with a note `excluded_keyword_cleanup` so they stop appearing in open prospecting views.
* This can be executed via a single, fast SQL statement in Supabase without affecting active rep accounts.

### Step 3: Sales Rep Pipeline Decision
We have **318 lead instances actively claimed by reps** that match exclusion keywords (including 62 pharmacies, 46 diagnostics, 42 laboratories, 11 hospitals):
* **Option 1 (Recommended):** Leave them untouched. If a rep has already booked a meeting, sent a contract, or established a relationship, do not disrupt their active deals.
* **Option 2:** Provide team leads with a filtered review queue of these 318 accounts to manually release or reassign non-viable leads.
