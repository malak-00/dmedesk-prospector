# Plans Execution Status & Checklist

**Last Updated:** 2026-10-06  
**Directory:** [`documentation/plans/`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/)  
**Reference Source:** [`documentation/operations/WORKLOG.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/operations/WORKLOG.md)

---

## 1. Status Overview

| Status Category | Count | Plans Included |
|---|---|---|
| ✅ **DONE (Live / Deployed / Fully Executed)** | 3 | [SEARCH_INSIGHTS_PLAN.md](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/SEARCH_INSIGHTS_PLAN.md), [MEETINGS_PLAN.md](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/MEETINGS_PLAN.md), [SHEET_LEAD_IMPORT_PROTOCOL.md](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/SHEET_LEAD_IMPORT_PROTOCOL.md) |
| 🟡 **PARTIALLY DONE / FOUNDATION APPLIED** | 4 | [MASTER_PLAN.md](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/MASTER_PLAN.md), [LEAD_INTAKE_AND_GROUPING_GUIDE.md](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/LEAD_INTAKE_AND_GROUPING_GUIDE.md), [BD_MAIN_MIGRATION_PLAN.md](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/BD_MAIN_MIGRATION_PLAN.md), [PROVIDER_CHANGE_TRACKING_PLAN.md](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/PROVIDER_CHANGE_TRACKING_PLAN.md) |
| 📋 **CONFIRMED / APPROVED (Ready for Implementation)** | 2 | [FEATURE_PLAN.md](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/FEATURE_PLAN.md), [BD_MEETINGS_SYNC_BRIDGE_PLAN.md](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/BD_MEETINGS_SYNC_BRIDGE_PLAN.md) |
| 📝 **DRAFT / RFC (Under Architectural Review)** | 3 | [PHONE_DELETION_AND_DISCONNECTED_GROUP_HANDLING.md](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/PHONE_DELETION_AND_DISCONNECTED_GROUP_HANDLING.md), [NAME_CHANGE_OWNERSHIP_PLAN_DRAFT.md](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/NAME_CHANGE_OWNERSHIP_PLAN_DRAFT.md), [MASTER_PLAN_NAME_HISTORY_ADDENDUM.md](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/MASTER_PLAN_NAME_HISTORY_ADDENDUM.md) |
| 💡 **BACKLOG / UNCONFIRMED SUGGESTIONS** | 1 | [UNCONFIRMED_SUGGESTIONS.md](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/UNCONFIRMED_SUGGESTIONS.md) |

---

## 2. Detailed Plan Checklist

### ✅ Done (Live & Operating in Production)

- [x] **[`SEARCH_INSIGHTS_PLAN.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/SEARCH_INSIGHTS_PLAN.md)** — **Prospect Search & Provider Source Cutover**
  - **What is done:**
    - Switched provider source to internal DME Desk Supabase database (`NPI_SOURCE = "dmedesk"` via `worker/src/services/providerSearch.js` and `search_providers_v2()`).
    - Deployed live availability count, empty-search suggestions, territory explorer (`sql/025_territory_cache.sql`), and quick-pick filters.
    - Completely excised lead scoring system (`sql/024_drop_scoring.sql`, removed `worker/src/lib/scoring.js`, UI cards cleaned up).
    - Fixed "Search more" pagination drop bug where only 20 of 200 fetched rows advanced bookmarks (2026-10-06 WORKLOG).
  - **Verification:** Verified live in production and documented in [`WORKLOG.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/operations/WORKLOG.md) (2026-10-05 and 2026-10-06).

- [x] **[`MEETINGS_PLAN.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/MEETINGS_PLAN.md)** — **Meetings for Claimed Leads**
  - **What is done:**
    - Schema: Applied `sql/020_lead_meetings.sql` adding meeting timing, opener notes, and privacy wipe trigger on reassignment.
    - Worker API: Deployed `POST /leads/meeting` endpoint with validation in `worker/src/lib/meetings.js`.
    - Frontend UI: Deployed meeting booking dialog, opener notes box, reminder badges in Claimed view, pre-filled `mailto:` confirmations, and Today screen "How did it go?" outcome logging (`held` / `no-show` / `reschedule`).
  - **Verification:** Worker deployed, database migrated, frontend live in `docs/today.js` and `docs/app.js`.

- [x] **[`SHEET_LEAD_IMPORT_PROTOCOL.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/SHEET_LEAD_IMPORT_PROTOCOL.md)** — **Sheet Lead Import Protocol**
  - **What is done:**
    - Established standardized protocol for extracting, filtering, qualifying, and claiming batch leads from BD Google Sheets/CSVs into `public.leads`.
    - Enforced invariants: preserve existing ownership, filter campaigns (`SUB: Solar`), exclude specific reps (George), and execute 1-by-1 claims via `claim_leads` RPC to link `group_id` without PostgREST timeouts.
  - **Verification:** Successfully executed for `BD MEETINGS 2026 - Onboarded (2).csv` on 2026-10-06 (13 new leads claimed, 24 existing leads preserved, Solar and George rows excluded; logged in [`WORKLOG.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/operations/WORKLOG.md)).

---

### 🟡 Partially Done / Foundation Applied

- [ ] **[`MASTER_PLAN.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/MASTER_PLAN.md)** — **Lead Grouping & Provider Change Tracking Master Roadmap**
  - **What is done:**
    - [x] Phase 1: File organization and documentation structure.
    - [x] Phase 2: BD Meetings reconciliation (319 source rows reconciled).
    - [x] Phase 3: NPI data consolidation & cutover to `dmedesk` internal source.
    - [x] Phase 4 (Database): `lead_groups`, `lead_group_members`, and `leads.group_id` schema and backfill applied.
    - [x] Phase 5 (Database & Partial App): `claim_leads` RPC enforces group ownership; Admin conflict resolution UI built in `docs/controls.js`.
  - **What remains:**
    - [ ] Phase 4 (Application): Surface group relationships and branch alerts across all search results.
    - [ ] Phase 5 (Database): Finalize auto-release trigger verification.
    - [ ] Phase 6: Monthly automated NPPES & Medicare refresh runner.
    - [ ] Phase 7: Automated preflight intake pipeline.

- [ ] **[`LEAD_INTAKE_AND_GROUPING_GUIDE.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/LEAD_INTAKE_AND_GROUPING_GUIDE.md)** — **Current System Architecture & Grouping Foundation**
  - **What is done:**
    - Schema foundation installed (`lead_groups`, `lead_group_members`, `lead_ownership_events`).
    - Group-aware claiming active in `claim_leads` RPC.
  - **What remains:**
    - Automated ingestion pipeline that checks group conflict preflight before leads are made available in Prospect search.

- [ ] **[`BD_MAIN_MIGRATION_PLAN.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/BD_MAIN_MIGRATION_PLAN.md)** — **BD Main Historical Migration**
  - **What is done:**
    - Staging table `lead_import_staging` created in `sql/008_lead_import_staging.sql`.
    - CSV staging uploader script `scripts/lead-intake/upload_august.py` built for dry-run and batch uploads.
  - **What remains:**
    - Implementation of versioned `bd-main-v1` ruleset (company name deduplication, phone frequency caps, exclusion keywords).
    - Review queue and safe staging-to-live promotion pipeline.

- [ ] **[`PROVIDER_CHANGE_TRACKING_PLAN.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/PROVIDER_CHANGE_TRACKING_PLAN.md)** — **Provider Information & Refresh Tracking**
  - **What is done:**
    - Database schema foundation created in `sql/015_provider_change_alerts.sql` (`refresh_runs`, `provider_field_history`, `lead_ownership_events`).
  - **What remains:**
    - Monthly ingestion runner script and automated delta comparison engine.
    - Admin UI for reviewing provider name/phone/address change alerts.

---

### 📋 Confirmed / Approved (Ready for Implementation)

- [ ] **[`FEATURE_PLAN.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/FEATURE_PLAN.md)** — **Confirmed Feature Plan (DME Dialer Ports & Enhancements)**
  - **Status:** Approved by user on 2026-10-06; awaiting implementation trigger ("edit the plans save them in repo dont execute anything yet").
  - **Features Included:**
    - [ ] Feature 1 (P1): Unified Call Mode — prospect mode gets claimed disposition chips (VM, GK, NA, NI, Disconnected); chip tap claims immediately and advances.
    - [ ] Feature 2 (P2): Lead local time indicator in call mode drawer header (`FL · 11:42 AM ET`).
    - [ ] Feature 3 (P3): Shuffle queue toggle in call mode start screen.
    - [ ] Feature 4 (P2): Admin default search taxonomy (`sql/028_default_taxonomy.sql`, Worker API, Controls UI).
    - [ ] Feature 5 (P3): "9am States" calling-window indicator on state multiselect options.

- [ ] **[`BD_MEETINGS_SYNC_BRIDGE_PLAN.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/BD_MEETINGS_SYNC_BRIDGE_PLAN.md)** — **Live Sync Bridge: Sheet ↔ Prospector**
  - **Status:** Approved architecture; awaiting Google Apps Script deployment.
  - **What is done:**
    - Integration bot `bd-meetings-bot` created and granted `can_claim_for_others` permission (`sql/011_claim_for_user.sql`).
    - Worker endpoint `POST /admin/claim-for-user` deployed and live.
  - **What remains:**
    - Update `BD MEETINGS 2026/src/code.js` with dynamic header matcher, 5-lead batching, campaign filtering, and time-driven 30-minute trigger.

---

### 📝 Draft / Architectural Proposals

- [ ] **[`PHONE_DELETION_AND_DISCONNECTED_GROUP_HANDLING.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/PHONE_DELETION_AND_DISCONNECTED_GROUP_HANDLING.md)** — **Phone Preservation & Group Disconnection**
  - **Status:** Specification drafted; needs migration (`deleted_phones jsonb`, `phone_status`) and worker disconnect cascading across `group_id`.

- [ ] **[`NAME_CHANGE_OWNERSHIP_PLAN_DRAFT.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/NAME_CHANGE_OWNERSHIP_PLAN_DRAFT.md)** & **[`MASTER_PLAN_NAME_HISTORY_ADDENDUM.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/MASTER_PLAN_NAME_HISTORY_ADDENDUM.md)** — **NPI Name & Successor Ownership Changes**
  - **Status:** RFC proposal to prevent valid business name changes from triggering duplicate false-positives while isolating ownership succession (`npi_aliases`, `npi_successor_links`).

---

### 💡 Backlog / Unconfirmed Suggestions

- [ ] **[`UNCONFIRMED_SUGGESTIONS.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/UNCONFIRMED_SUGGESTIONS.md)** — **Ideas Under Evaluation**
  - Suggestion A: Cooldown / Suppress-Today local storage filtering (4h / 8h / Today / Off).
  - Suggestion B: Google Search shortcut per lead card.
  - Suggestion C: Google Sheets two-way sync (BD Meetings claim append + BD 2026 Disconnected tab bi-directional sync).
