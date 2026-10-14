# Lead Quality Scoring System — Master Plan

> **Status:** Draft — not yet implemented.  
> **Covers:** Data archaeology, enrichment pipeline, calibration, SQL scoring function, UI integration.  
> **Prerequisite work still pending:** Exclusion audit & filtering fixes (see `exclusion_audit_and_filtering_plan.md`).

---

## Part 1 — What We Have (Data Archaeology)

Before we can score anything we need to understand every dataset we hold and what each one tells us.

### 1.1 Source Inventory

| File / Sheet | What it is | Key columns | Ground-truth label |
| :--- | :--- | :--- | :--- |
| **BD MEETINGS 2026.xlsx → `Onboarded` tab** | Confirmed paying clients | NPI, Company, Opener, Sub (ORT/CGM/LYMPH), Date Added, Close %, Opener Summary, Closer Notes | ✅ Positive (converted) |
| **BD MEETINGS 2026.xlsx → `Contract Sent`** | Hot pipeline — not yet live | Same structure | ⚠️ Near-positive |
| **BD MEETINGS 2026.xlsx → `Dead Leads` / `DISQUALIFIED` / `CANCELLED`** | Failed or disqualified | Same | ❌ Negative (churned/refused) |
| **BD MEETINGS 2026.xlsx → `New Meetings` / `Follow Ups`** | Active pipeline | Same | Neutral (in-progress) |
| **BD MEETINGS 2026.xlsx → `Call Logs`** | Full Ultatel call log | Call Date, Agent, Outcome, Duration (sec), Notes | Disposition signal |
| **(Defunct) BD Meetings 2025.xlsx → `Trial/Onboarding`** | Earlier cohort of onboarded | Vertical, Opener, Status, Deal Probability, Meeting notes | ✅ Positive (older) |
| **(Defunct) BD Meetings 2025.xlsx → `Dead Leads`** | 2025 losses | Same | ❌ Negative |
| **BD DME Leads 2025.xlsx → `Main` / per-rep tabs** | Dialing sheet (NPPES-enriched) | NAME DUP, NUM DUP, Auth Num, Owner, Email, Comments, UpdateDate, Legalbusinessname, State, OfficePhone, AuthOfficialName, AuthPhone, Position, NPI, Taxonomy, Creation Date | Raw call activity |
| **BD DME 2026 - before issues.xlsx → `MAIN` / `LABS`** | Current dialing sheet | Same schema as 2025 Main | Raw call activity |
| **BD DME 2026 → `Disconnected`** | Dead numbers confirmed by reps | Same | ❌ Unreachable |
| **BD DME 2026 → `NI Not Eligible`** | Not interested / not eligible | Same | ❌ Negative |
| **BD DME 2026 → `DNC`** | Do Not Call | Same | ❌ Hard negative |
| **Prospector Claimed sheets** (`Claimed - <Rep>`) | Leads exported from DMEDesk tool | NPI, Score, Medicare Claims, Status, Notes | Mixed (status column = disposition) |
| **Prospector Disconnected tab** | Dead from Prospector tool | NPI | ❌ Unreachable |
| **`npi_records` + `npi_cms_enrichment`** (Supabase) | The live search database | Every NPPES field, Medicare claims/payment/beneficiaries, taxonomy | Source of truth for enrichment |

### 1.2 The NPI Is the Join Key

The dialing sheets (`BD DME 2025/2026`) have an `NPI` column, and the BD Meetings sheet has an `NPI` column too (though some rows are blank). Everything joins on NPI to `npi_records` and `npi_cms_enrichment`.

---

## Part 2 — Enrichment Pipeline (Fill the Gaps)

Many leads in the dialing sheets have blank NPI, missing Medicare data, or stale NPPES details. The dialer app (`npi_hub.py`) already has two enrichment engines we can use:

- **`enrich_task()`**: Matches rows by phone/name against the local `nppes.db` SQLite file, fills in NPI, address, taxonomy.
- **`enrich_fakenpi_task()`**: Pushes enriched rows back to the Supabase `npi_records` table via upsert.

### Step-by-step Enrichment Plan

```
Step E1 — Compile the Master Historical Lead List
  Input:  BD DME 2025.xlsx (Main tab), BD DME 2026 before issues.xlsx (MAIN + LABS tabs)
  Output: master_leads_raw.csv
  Action: Python script — openpyxl → read all sheets → deduplicate on NPI/phone →
          write to CSV with columns: [npi, company_name, phone, auth_name, state, taxonomy,
          creation_date, update_date, owner, comments, source_file, source_tab]

Step E2 — NPI Lookup for Blank-NPI Rows
  Input:  master_leads_raw.csv (rows where npi is null/blank)
  Tool:   npi_hub.py enrich_task() OR NPPES public API (api.cms.gov/provider-data)
  Match:  Phone number → exact match on OfficePhone or AuthPhone in nppes.db
          Company name → fuzzy match (Levenshtein ≤ 2) against Legalbusinessname
  Output: master_leads_enriched.csv (npi filled wherever possible)
  Flag:   Rows still missing NPI → mark npi_confidence = 'unresolved' for manual review

Step E3 — Pull CMS Medicare Data for Each NPI
  Input:  master_leads_enriched.csv (rows with valid NPI)
  Source: Supabase npi_cms_enrichment table (already populated from CMS refresh)
  Join:   LEFT JOIN npi_cms_enrichment ON npi → add total_claims, medicare_payment,
          total_beneficiaries, hcpcs_codes
  Output: master_leads_full.csv

Step E4 — Compile Outcomes (Ground Truth Labels)
  Input:  BD MEETINGS 2026.xlsx (all tabs), (Defunct) BD Meetings 2025.xlsx (all tabs)
  Output: outcomes.csv with columns:
    [npi, company_name, outcome_label, source_file, source_tab, date_added,
     sub_product (ORT/CGM/LYMPH/Solar), close_probability, opener]
  Labels:
    'converted'    → Onboarded tabs (both years)
    'hot'          → Contract Sent tab
    'dead'         → Dead Leads, DISQUALIFIED, CANCELLED, DNC tabs
    'unreachable'  → Disconnected tabs (both dialing sheets + Prospector)
    'not_interested' → NI tabs

Step E5 — Build Calibration Dataset
  Join: master_leads_full.csv LEFT JOIN outcomes.csv ON npi
  Output: calibration_dataset.csv (~600–1500 rows depending on coverage)
  Script: scripts/build_calibration_dataset.py  (to be created)
```

---

## Part 3 — Score Factor Design

The score replaces the old data-completeness score (removed Oct 2026). Every factor below maps to a measurable field from `npi_records` or `npi_cms_enrichment`.

**Max possible raw score: 100 points.**

### Category A — Medicare Activity (max 40 pts)

> The single strongest observed predictor: every confirmed-onboarded DME from the BD
> Meetings sheets that had an NPI had active Medicare claims.

| Factor | Points | Condition |
| :--- | :---: | :--- |
| Any Medicare claims on record | 15 | `total_claims > 0` |
| High-volume biller | +10 | `total_claims >= 100` |
| Payment tier: $10k–$100k | +10 | `medicare_payment BETWEEN 10000 AND 100000` |
| Payment tier: >$100k | +15 | `medicare_payment > 100000` (replaces the $10k tier) |

### Category B — NPPES Record Freshness (max 15 pts)

> Disconnected tab analysis shows strong correlation: stale NPPES records → dead phones.

| Factor | Points | Condition |
| :--- | :---: | :--- |
| Updated within 12 months | 15 | `last_updated >= NOW() - INTERVAL '1 year'` |
| Updated 1–3 years ago | 8 | `last_updated BETWEEN NOW()-3yr AND NOW()-1yr` |
| Older than 3 years | 0 | (default) |

### Category C — Contact Reachability (max 20 pts)

| Factor | Points | Condition |
| :--- | :---: | :--- |
| Has a phone number | 8 | `phone IS NOT NULL AND phone != ''` |
| Has a named decision-maker | 7 | `decisionMakers.length > 0` (from scrape/Foursquare) |
| Has a website | 5 | `website IS NOT NULL` |

### Category D — Organization Profile (max 15 pts)

> In BD Meetings 2025+2026 combined: 95%+ of onboarded clients were NPI-2 organizations.

| Factor | Points | Condition |
| :--- | :---: | :--- |
| Is an organization (NPI-2) | 10 | `isorganization = true OR enumerationtype = 'NPI-2'` |
| Active status, no deactivation | +5 | `status = 'A' AND deactivation_date IS NULL` |

### Category E — Product Line Fit (max 10 pts)

> From BD Meetings: ORT+CGM dual-product providers have highest conversion. CGM-only
> had faster close cycle. Labs/solar are separate verticals.

| Factor | Points | Condition |
| :--- | :---: | :--- |
| DMEPOS core taxonomy code | 5 | `taxonomy_code` in DME/DMEPOS group (33xxxx, 32xxxx) |
| ORT/Prosthetics specialty match | +3 | Taxonomy or HCPCS L-codes |
| CGM/Diabetes specialty match | +2 | Taxonomy or HCPCS CGM codes |

### Penalty Modifiers (applied after base score, floor = 0)

| Modifier | Adjustment | Condition |
| :--- | :---: | :--- |
| Individual NPI (not organization) | −20 | `isorganization = false` |
| No phone AND no website | −10 | Both missing |
| Deactivation date is set | −30 | Provider likely defunct |
| Exclusion keyword match | Score = 0 | Name matches any user keyword |

---

## Part 4 — Calibration (Validate the Weights)

Before shipping any code, run the calibration query against the real dataset.

### Script: `scripts/calibrate_scoring.py`

```python
# Pseudocode — to be written in full
import pandas as pd
from supabase import create_client

df_calibration = pd.read_csv('calibration_dataset.csv')
# df_calibration has: npi, outcome_label, total_claims, medicare_payment,
#                     last_updated, has_phone, has_website, is_org, taxonomy_code

factors = ['has_medicare_claims', 'is_high_volume', 'updated_within_1yr',
           'has_phone', 'is_org', 'has_contact']

for factor in factors:
    positive_rate = df_calibration[df_calibration[factor]][
        df_calibration.outcome_label == 'converted'
    ].shape[0] / df_calibration[df_calibration[factor]].shape[0]
    
    baseline_rate = (df_calibration.outcome_label == 'converted').mean()
    lift = positive_rate / baseline_rate if baseline_rate > 0 else 0
    
    print(f"{factor:35s} lift = {lift:.2f}x  ({positive_rate:.1%} conversion vs {baseline_rate:.1%} base)")
```

Weights are considered **validated** if:
- Medicare factors show lift ≥ 2.0×
- Freshness (updated_within_1yr) shows lift ≥ 1.5×
- Organization flag shows lift ≥ 1.5×

If any factor shows lift < 1.2×, **drop it** from the score or reduce its weight to 0.

> [!IMPORTANT]
> We have ~80–120 confirmed onboarded leads across 2025+2026. This is a small sample.
> Treat calibration results as directional priors, not statistically robust weights.
> Re-run calibration every 6 months as the converted pool grows.

---

## Part 5 — SQL Implementation

### File: `sql/041_lead_scoring.sql`

```sql
-- Lead Quality Score (LQS) function.
-- Returns 0-100 integer. Called inline from search_providers_v2().
-- All inputs come directly from the SELECT columns — no extra joins needed.

CREATE OR REPLACE FUNCTION public.provider_lead_score(
  p_is_org          boolean,
  p_status          text,
  p_deactivation    date,
  p_last_updated    date,
  p_has_phone       boolean,
  p_has_website     boolean,
  p_has_contact     boolean,   -- has at least one decision-maker record
  p_total_claims    integer,
  p_medicare_pay    numeric,
  p_taxonomy_code   text
) RETURNS integer
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS $$
DECLARE v_score integer := 0;
BEGIN
  -- A: Medicare (max 40)
  IF p_total_claims > 0    THEN v_score := v_score + 15; END IF;
  IF p_total_claims >= 100 THEN v_score := v_score + 10; END IF;
  IF    p_medicare_pay > 100000 THEN v_score := v_score + 15;
  ELSIF p_medicare_pay >  10000 THEN v_score := v_score + 10;
  ELSIF p_medicare_pay >      0 THEN v_score := v_score + 5;
  END IF;
  -- B: Recency (max 15)
  IF    p_last_updated >= CURRENT_DATE - 365  THEN v_score := v_score + 15;
  ELSIF p_last_updated >= CURRENT_DATE - 1095 THEN v_score := v_score + 8;
  END IF;
  -- C: Reachability (max 20)
  IF p_has_phone   THEN v_score := v_score + 8; END IF;
  IF p_has_website THEN v_score := v_score + 5; END IF;
  IF p_has_contact THEN v_score := v_score + 7; END IF;
  -- D: Org profile (max 15)
  IF p_is_org THEN
    v_score := v_score + 10;
    IF p_status = 'A' AND p_deactivation IS NULL THEN v_score := v_score + 5; END IF;
  END IF;
  -- E: Taxonomy fit (max 10)
  IF p_taxonomy_code LIKE '33%' OR p_taxonomy_code LIKE '32%' THEN v_score := v_score + 5; END IF;
  -- Penalties
  IF NOT COALESCE(p_is_org, false) THEN v_score := v_score - 20; END IF;
  IF NOT COALESCE(p_has_phone, false) AND NOT COALESCE(p_has_website, false)
    THEN v_score := v_score - 10; END IF;
  IF p_deactivation IS NOT NULL THEN v_score := v_score - 30; END IF;
  RETURN GREATEST(0, LEAST(100, v_score));
END;
$$;
```

**Integration into `search_providers_v2()`:**

```sql
-- In the existing SELECT inside search_providers_v2(), add:
provider_lead_score(
  r.isorganization,
  r.status,
  r.deactivation_date,
  r.last_updated::date,
  r.phone IS NOT NULL AND r.phone != '',
  r.website IS NOT NULL AND r.website != '',
  false,   -- placeholder until has_contact is stored in npi_records
  COALESCE(e.total_claims, 0)::integer,
  COALESCE(e.medicare_payment, 0)::numeric,
  COALESCE(r.taxonomy_code, '')
) AS lqs

-- New sortBy case:
WHEN p_criteria->>'sortBy' = 'score' THEN 'lqs DESC NULLS LAST'
```

---

## Part 6 — Worker & Frontend Changes

### Worker (`worker/src/`)

1. **`scoring.js`** — Restore/replace with a simple pass-through: read `lqs` from the DB row, no re-computation.
2. **`search.js`** — Include `lqs` in every provider result object.
3. **`auth.js`** — Expose `"score"` as a valid `sortBy` option (add to the allowed list).

### Frontend (`docs/`)

**`docs/app.js`:**
- Add `"Best leads first"` as a sort option alongside the existing `medicare / updated / name` chips.
- Render a score badge on each provider card:
  - 🟢 `lqs >= 70`
  - 🟡 `lqs 40–69`
  - 🔴 `lqs < 40`

**`docs/style.css`:**
- `.lqs-badge-high { background: #22c55e; }` (green)
- `.lqs-badge-mid  { background: #f59e0b; }` (amber)
- `.lqs-badge-low  { background: #ef4444; }` (red)

**`appscript/services/CsvExport.js` / `ScoringService.js`:**
- Write `lqs` into the existing `Score` column (currently written empty since `024`).
- Write tier label (`High / Mid / Low`) into `Score %` column.

---

## Part 7 — Implementation Phases

```
┌─────────────────────────────────────────────────────────────────┐
│ Phase 0  Data Archaeology  (offline, no deployments)            │
│                                                                  │
│  0a. Run Step E1: compile master_leads_raw.csv                  │
│  0b. Run Step E2: NPI lookup for blank rows (npi_hub enrichment)│
│  0c. Run Step E3: pull CMS Medicare data (Supabase join)        │
│  0d. Run Step E4: compile outcomes.csv from BD Meeting sheets   │
│  0e. Run Step E5: join to calibration_dataset.csv              │
│  0f. Run calibrate_scoring.py → validate/adjust weights above   │
│                                                                  │
│  VERIFY: calibration_dataset.csv ≥ 200 labeled rows            │
│          Medicare lift ≥ 2.0×, Org flag lift ≥ 1.5×            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Phase 1  SQL Function  (manual Supabase run)                    │
│                                                                  │
│  1a. Write sql/041_lead_scoring.sql                             │
│  1b. Add lqs column to search_providers_v2() SELECT             │
│  1c. Add 'score' sortBy option in search_providers_v2()         │
│  1d. MANUAL: review SQL, run on Supabase                        │
│  1e. Verify: search returns lqs values in response              │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Phase 2  Worker                                                  │
│                                                                  │
│  2a. Restore worker/src/lib/scoring.js (pass-through from DB)   │
│  2b. Include lqs in provider result payload                      │
│  2c. Add 'score' to sortBy allowed list in auth.js              │
│  2d. Deploy to Cloudflare, verify response JSON                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Phase 3  Frontend                                                │
│                                                                  │
│  3a. Add lqs badge to provider card (docs/app.js + style.css)   │
│  3b. Add "Best leads first" sort chip                           │
│  3c. Write lqs into Score column on sheet export                │
│  (User tests in browser before each step is considered done)    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Phase 4  Dialer App Integration                                  │
│                                                                  │
│  4a. In npi_hub.py format_task(): when exporting a formatted    │
│      CSV, call provider_lead_score() logic in Python and write   │
│      'LQS' column to output CSV                                  │
│  4b. dialer.html / dialerjavascript.js: show LQS badge in the   │
│      call card next to company name                              │
│  4c. Smart filter: add "High score only (≥70)" toggle           │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Phase 5  Monitoring & Refinement  (ongoing, +3 months)          │
│                                                                  │
│  5a. Pull claimed leads where status changed to 'interested' vs  │
│      'not interested' vs 'do not call'                           │
│  5b. Re-run calibrate_scoring.py with updated outcomes          │
│  5c. Adjust weights if any factor shows drift > 20% from initial │
│      lift, re-run sql/041 migration                             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Part 8 — Open Questions

> [!NOTE]
> Answers needed before Phase 1 coding starts:

1. **PPO-only leads:** Several onboarded clients (JILANI MEDICAL, ALLIED MEDICAL) are PPO-only — they have zero Medicare claims. Should PPO providers get a separate scoring branch, or just score lower and sort behind Medicare billers?

2. **Dialer app LQS display:** Should the score appear in the dialing sheet card immediately (before the rep calls), or only after first contact is logged? Visible scores can cause reps to skip low-LQS leads that might still convert.

3. **`has_contact` storage:** The +7 pts for "named decision-maker" requires knowing if a contact exists. This data comes from Foursquare/scraping and isn't stored in `npi_records`. Do we add a `has_contact` boolean column during enrichment, or just omit this factor from the DB function for now?

4. **Call Logs tab:** BD MEETINGS 2026 has a full Ultatel call log (`Call Logs` tab) with 1000s of rows. Do we use this to build a "number of prior contacts before conversion" signal? Could be a strong predictor.

5. **Defunct 2025 cohort:** Some companies in the (Defunct) 2025 sheet (`Trial/Onboarding`) may have since churned. Should we treat the 2025 onboarded set as fully positive, or mark them separately as "converted-but-historical"?

---

## Appendix — Message to Malak (for Claude Opus)

> Copy-paste this to Malak for her Claude session.

---

**Hi Malak,**

We're building a **Lead Quality Scoring system (LQS)** for the DME Desk Prospector tool. We need your help thinking through the calibration methodology and scoring architecture. Here's the full context:

**What the tool does:**  
DME Desk Prospector is a B2B sales tool for Prime Ad Solutions. Reps search a database of ~387k NPPES-registered DME (Durable Medical Equipment) suppliers, claim leads, and pitch our patient lead generation service. The search currently sorts by Medicare activity, name, or recency — but we want to add a proper "quality score" so reps always see the most likely-to-convert leads first.

**What data we have for calibration:**

1. **Confirmed onboarded clients** (~80 rows): `BD MEETINGS 2026.xlsx → Onboarded tab` — these are companies that signed a contract and are actively working with us. Each has: NPI, company name, product vertical (ORT/CGM/LYMPH), closer's probability %, opener summary notes.

2. **Dead leads** (~50+ rows): `Dead Leads`, `DISQUALIFIED`, `CANCELLED` tabs in same file — companies that went through our pipeline and definitely didn't convert.

3. **Disconnected leads**: Companies whose phone numbers were dead on first contact — `Disconnected` tabs across multiple dialing sheets.

4. **Call logs**: The `Call Logs` tab in BD MEETINGS 2026 has Ultatel CDR data — every call made, duration, agent, outcome.

5. **Live database signals** (from Supabase `npi_records` + `npi_cms_enrichment`): Medicare total_claims, medicare_payment, total_beneficiaries, NPPES last_updated date, has_phone, has_website, taxonomy_code, is_organization.

**Current proposed scoring model (5 categories, 0–100 scale):**

| Category | Max pts | Key factors |
| A. Medicare Activity | 40 | total_claims > 0 (+15), high volume (+10), payment tier (+5–15) |
| B. NPPES Freshness | 15 | Updated within 1yr (+15), 1–3yr (+8) |
| C. Reachability | 20 | has_phone (+8), has_website (+5), has_contact (+7) |
| D. Org Profile | 15 | is_org (+10), active status (+5) |
| E. Product Fit | 10 | taxonomy matches DME/DMEPOS codes (+5–10) |

Plus penalties: −20 for individual NPI, −10 for no phone/website, −30 for deactivated provider.

**What we're asking Claude to help with:**

1. **Calibration approach:** With only ~80 confirmed positives, standard logistic regression is underpowered. What's the best way to validate these weights statistically? (Bootstrap sampling? Cohen's h for each factor? Simple lift tables?) What minimum calibration set size should we aim for before trusting the weights?

2. **Signal engineering:** Are there signals we're missing? For example:
   - **Call duration patterns** from the Ultatel logs — did longer calls → higher conversion rate?
   - **Taxonomy specificity** — are some DME taxonomy subcodes much better than others?
   - **State/jurisdiction** — are certain states overrepresented in conversions? (Several onboarded clients mentioned "All States" billing as a positive signal in opener notes.)
   - **Time-to-first-meeting** — was there a pattern in how quickly converted leads moved from first call to meeting?

3. **Score decay:** Should the LQS decay over time if a lead has been in the "called" status for > 30 days without progression? (i.e., penalize staleness in the pipeline, not just in NPPES data)

4. **PPO vs. Medicare split:** Several onboarded clients only bill PPO (Humana, BCBS, Anthem), not Medicare. The current model heavily favors Medicare billers. How should we handle PPO-only leads without over-penalizing them?

5. **Feedback loop design:** How should we structure the data pipeline so that when a rep marks a lead as "interested" or "not interested" in the claimed leads sheet, that disposition automatically feeds back into re-calibrating the model every month?

The implementation will be: a PostgreSQL function in Supabase (`provider_lead_score()`), called inline from `search_providers_v2()`, returning a 0–100 integer used for both sorting and a color-coded badge in the UI.

We're using Claude (you) to review this plan, critique the factor weights, and suggest any signal engineering we haven't thought of. The plan lives at `documentation/plans/LEAD_SCORING_PLAN.md` in the `dmedesk-prospector` repo.

Thanks!  
— Ben

---
