# ⚠️ ATTENTION: Read Before Modifying This Codebase

> **CRITICAL DIRECTIVE FOR DEVELOPERS AND AI AGENTS**  
> (Claude, Codex, Antigravity, Cursor, Human Contributors)  
>
> **Do not write speculative code or assume workflows in this repository.**  
> Every major domain in this system—lead claiming, identity grouping, dialing/Call Mode, Google Sheets synchronization, and NPPES ingestion—is governed by an approved, active architectural plan located in [`documentation/plans/`](documentation/plans/).
>
> **Before proposing or implementing changes, verify your approach against the relevant plan below.**

---

## 🗺️ Master Plan Index & Active Roadmaps

All architectural specifications live in [`documentation/plans/`](documentation/plans/) (see [`documentation/plans/README.md`](documentation/plans/README.md) and [`documentation/plans/checklist.md`](documentation/plans/checklist.md) for live execution status).

### 1. 📞 Call Mode & Dialer Performance
* **[`documentation/plans/CALL_MODE_DISPOSITION_LATENCY_FIX_PLAN.md`](documentation/plans/CALL_MODE_DISPOSITION_LATENCY_FIX_PLAN.md)**  
  Fix for disposition click latency during dialing. Explains the 4-request network waterfall and defines the plan for optimistic UI navigation (<50ms perceived latency), single-request claim enrichment, and the unified `POST /leads/disposition` route.
* **[`documentation/plans/FEATURE_PLAN.md`](documentation/plans/FEATURE_PLAN.md)**  
  Confirmed dialer capabilities ported from DME Dialer: unified call mode with one-tap prospect claim on disposition click, lead local time display, shuffle queue toggle, and "9am States" calling-window indicator.
* **[`documentation/plans/MEETINGS_PLAN.md`](documentation/plans/MEETINGS_PLAN.md)**  
  Architecture for scheduling meetings on claimed leads, opener notes, privacy protection triggers on reassignment, and Today screen meeting outcome tracking (`sql/020`).

---

### 2. 📊 Google Sheets Sync & Ingestion Protocols
* **[`documentation/plans/BD_MEETINGS_SYNC_BRIDGE_PLAN.md`](documentation/plans/BD_MEETINGS_SYNC_BRIDGE_PLAN.md)**  
  Automated live bridge connecting the `BD MEETINGS 2026` Google Spreadsheet to Prospector via Apps Script using `bd-meetings-bot` and `/admin/claim-for-user`.  
  *Includes Section 8: Root cause diagnosis and fix for the 279-row pending sync stall (Apps Script execution timeout, missing UI feedback, statement timeouts, and log-aware checks).*
* **[`documentation/plans/SHEET_LEAD_IMPORT_PROTOCOL.md`](documentation/plans/SHEET_LEAD_IMPORT_PROTOCOL.md)**  
  The approved standard for qualifying, deduplicating, and claiming leads from external spreadsheets and CSVs without corrupting ownership.
* **[`documentation/plans/BD_MAIN_MIGRATION_PLAN.md`](documentation/plans/BD_MAIN_MIGRATION_PLAN.md)**  
  Migration blueprint for ingesting historical BD Main lead archives through staging.

---

### 3. 🏢 Lead Grouping, Identity & Ownership Constraints
* **[`documentation/plans/MASTER_PLAN.md`](documentation/plans/MASTER_PLAN.md)**  
  The 7-phase master roadmap governing lead grouping, NPI consolidation, claim conflict resolution, and provider data updates.
* **[`documentation/plans/LEAD_INTAKE_AND_GROUPING_GUIDE.md`](documentation/plans/LEAD_INTAKE_AND_GROUPING_GUIDE.md)**  
  Authoritative technical reference on `lead_groups`, `lead_group_members`, and group-aware ownership constraints (`public.claim_leads`).
* **[`documentation/plans/PROVIDER_CHANGE_TRACKING_PLAN.md`](documentation/plans/PROVIDER_CHANGE_TRACKING_PLAN.md)**  
  Staging workflow for tracking CMS/NPPES monthly updates and provider legal name changes without overwriting sales rep notes (`sql/015`).
* **[`documentation/plans/PHONE_DELETION_AND_DISCONNECTED_GROUP_HANDLING.md`](documentation/plans/PHONE_DELETION_AND_DISCONNECTED_GROUP_HANDLING.md)**  
  Rules for archiving deleted/non-working provider phone numbers and cascading `Disconnected` lead statuses across branch locations sharing a `group_id`.
* **[`documentation/plans/DISCONNECTED_PHONE_SEARCH_FILTERING_PLAN.md`](documentation/plans/DISCONNECTED_PHONE_SEARCH_FILTERING_PLAN.md)**  
  Filtering disconnected phone numbers and bad provider records out of search results.

---

### 4. 🧬 NPPES Ingestion, Data Cleaning & Lead Scoring
* **[`documentation/plans/NPPES_CLI_ENRICHMENT_PLAN.md`](documentation/plans/NPPES_CLI_ENRICHMENT_PLAN.md)**  
  CLI upgrade plan for `python -m nppes_ingest`: phone/fuzzy company matching, single-letter spaced token defragmentation (`C A R E` → `CARE`), legal suffix stripping, and Medicare claims enrichment.
* **[`documentation/plans/LEAD_SCORING_PLAN.md`](documentation/plans/LEAD_SCORING_PLAN.md)**  
  Lead scoring algorithm and conversion feedback model based on historical call logs, claims volume, and provider specialization.

---

### 5. 🔍 Discovery & Prospect Search
* **[`documentation/plans/SEARCH_INSIGHTS_PLAN.md`](documentation/plans/SEARCH_INSIGHTS_PLAN.md)**  
  Architecture of the modern prospect search engine: cutover to the internal `dmedesk` provider table, live availability scanning, and territory map caching (`sql/025`).

---

## 🛠️ Operating Guidelines for Changes
1. **Check Live Status First:** Always consult [`documentation/plans/checklist.md`](documentation/plans/checklist.md) to see if a feature or migration is `[✅ Live]`, `[🟡 In Progress]`, or `[📋 Approved / Ready]`.
2. **Review Codebase Performance Audits:** Check [`documentation/reviews/2026-10-09-backend-performance-audit.md`](documentation/reviews/2026-10-09-backend-performance-audit.md) before modifying backend worker routes or Supabase queries.
3. **Preserve Database Invariants:** Never bypass the PostgreSQL RPCs (`claim_leads`, `assign_lead_groups`) with direct table inserts; doing so breaks the multi-tier identity grouping and audit trail.
