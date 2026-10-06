# Plans & Specifications Directory

**Directory:** `documentation/plans/`  
**Parent Index:** [`documentation/README.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/README.md)  
**Live Status Checklist:** [`checklist.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/checklist.md)  
**Execution History:** [`documentation/operations/WORKLOG.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/operations/WORKLOG.md)

---

## Overview

This directory contains **authoritative feature plans, system roadmaps, and integration protocols** for the DME Desk Prospector.

While [`architecture/`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/architecture/) documents the system as it currently runs in production, the documents in this directory define the **approved target architecture and workflows**.

---

## Directory Navigation by Functional Domain

### 1. 🔍 Discovery & Prospect Search
- **[`SEARCH_INSIGHTS_PLAN.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/SEARCH_INSIGHTS_PLAN.md)** `[✅ Live]`  
  Architecture of the modern prospect search engine: cutover to the internal `dmedesk` provider table, live availability scanning, territory map caching (`sql/025`), removal of legacy lead scoring (`sql/024`), and pagination bug resolutions.

### 2. 📞 Call Mode & Sales Meetings
- **[`MEETINGS_PLAN.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/MEETINGS_PLAN.md)** `[✅ Live]`  
  Upcoming meeting scheduler on claimed leads: opener notes, privacy protection triggers on reassignment, browser reminder badges, and Today screen meeting outcome tracking (`sql/020`).
- **[`FEATURE_PLAN.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/FEATURE_PLAN.md)** `[📋 Approved / Ready to Implement]`  
  Five confirmed features ported from the DME Dialer: unified call mode with one-tap prospect claim on disposition click, lead local time display, shuffle queue toggle, admin default taxonomy (`sql/028`), and "9am States" calling-window indicator.

### 3. 🏢 Lead Identity Grouping & Ownership
- **[`MASTER_PLAN.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/MASTER_PLAN.md)** `[🟡 In Progress Roadmap]`  
  The 7-phase master roadmap governing lead grouping, NPI consolidation, claim conflict resolution, and provider data updates.
- **[`LEAD_INTAKE_AND_GROUPING_GUIDE.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/LEAD_INTAKE_AND_GROUPING_GUIDE.md)** `[🟡 Foundation Applied]`  
  Technical overview of `lead_groups`, `lead_group_members`, and group-aware ownership constraints (`public.claim_leads`).
- **[`PROVIDER_CHANGE_TRACKING_PLAN.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/PROVIDER_CHANGE_TRACKING_PLAN.md)** `[🟡 Foundation Applied]`  
  Data model and staging workflow for tracking CMS/NPPES monthly updates and provider legal name changes without overwriting sales rep notes (`sql/015`).
- **[`PHONE_DELETION_AND_DISCONNECTED_GROUP_HANDLING.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/PHONE_DELETION_AND_DISCONNECTED_GROUP_HANDLING.md)** `[📝 Draft / RFC]`  
  Rules for archiving deleted/non-working provider phone numbers and cascading `Disconnected` lead statuses across branch locations sharing a `group_id`.
- **[`NAME_CHANGE_OWNERSHIP_PLAN_DRAFT.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/NAME_CHANGE_OWNERSHIP_PLAN_DRAFT.md)** & **[`MASTER_PLAN_NAME_HISTORY_ADDENDUM.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/MASTER_PLAN_NAME_HISTORY_ADDENDUM.md)** `[📝 Draft / RFC]`  
  Architecture for distinguishing between company renames, trade names, and successor corporate entities (`npi_aliases`, `npi_successor_links`).

### 4. 📊 Google Sheets Sync & Ingestion Protocols
- **[`SHEET_LEAD_IMPORT_PROTOCOL.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/SHEET_LEAD_IMPORT_PROTOCOL.md)** `[✅ Executed Standard]`  
  The standardized protocol for qualifying, deduplicating, and claiming leads from BD Google Sheets/CSVs (e.g. Onboarded batches), respecting ownership preservation and campaign filters.
- **[`BD_MEETINGS_SYNC_BRIDGE_PLAN.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/BD_MEETINGS_SYNC_BRIDGE_PLAN.md)** `[📋 Approved / Ready to Implement]`  
  Automated live bridge connecting the `BD MEETINGS 2026` Google Spreadsheet to Prospector via Apps Script using `bd-meetings-bot` and `/admin/claim-for-user`.
- **[`BD_MAIN_MIGRATION_PLAN.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/BD_MAIN_MIGRATION_PLAN.md)** `[🟡 Staging Ready]`  
  Migration blueprint for ingesting historical BD Main lead archives through `sql/008_lead_import_staging.sql` and `scripts/lead-intake/upload_august.py`.

### 5. 💡 Unconfirmed Ideas & Backlog
- **[`UNCONFIRMED_SUGGESTIONS.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/UNCONFIRMED_SUGGESTIONS.md)** `[💡 Backlog]`  
  Proposals under consideration: Cooldown/Suppress-Today system, Google Search shortcut, and two-way Google Sheets sync (BD Meetings claim append + BD 2026 Disconnected tab 2-way sync).

---

## File Navigation Index

| Document | Primary Focus | Current Status |
|---|---|---|
| [`checklist.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/checklist.md) | Comprehensive checklist of all plan execution statuses | **Active Tracking** |
| [`SEARCH_INSIGHTS_PLAN.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/SEARCH_INSIGHTS_PLAN.md) | Search source cutover, availability, territory explorer | **✅ Done (Live)** |
| [`MEETINGS_PLAN.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/MEETINGS_PLAN.md) | Claimed lead meeting scheduler & outcome tracking | **✅ Done (Live)** |
| [`SHEET_LEAD_IMPORT_PROTOCOL.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/SHEET_LEAD_IMPORT_PROTOCOL.md) | Standardized sheet ingestion and qualification protocol | **✅ Done (Active)** |
| [`MASTER_PLAN.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/MASTER_PLAN.md) | 7-phase master roadmap for grouping and intake | **🟡 Partially Done** |
| [`LEAD_INTAKE_AND_GROUPING_GUIDE.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/LEAD_INTAKE_AND_GROUPING_GUIDE.md) | Architecture guide for lead identity grouping | **🟡 Partially Done** |
| [`BD_MAIN_MIGRATION_PLAN.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/BD_MAIN_MIGRATION_PLAN.md) | Historical CSV import staging and `bd-main-v1` rules | **🟡 Partially Done** |
| [`PROVIDER_CHANGE_TRACKING_PLAN.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/PROVIDER_CHANGE_TRACKING_PLAN.md) | Monthly NPPES refresh tracking without sales overwrite | **🟡 Partially Done** |
| [`FEATURE_PLAN.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/FEATURE_PLAN.md) | Confirmed dialer features (unified call mode, 9am states, etc.) | **📋 Approved / Pending** |
| [`BD_MEETINGS_SYNC_BRIDGE_PLAN.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/BD_MEETINGS_SYNC_BRIDGE_PLAN.md) | Google Sheet ↔ Prospector live sync bridge specification | **📋 Approved / Pending** |
| [`PHONE_DELETION_AND_DISCONNECTED_GROUP_HANDLING.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/PHONE_DELETION_AND_DISCONNECTED_GROUP_HANDLING.md) | Deleted phone preservation and group disconnect sync | **📝 Draft / RFC** |
| [`NAME_CHANGE_OWNERSHIP_PLAN_DRAFT.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/NAME_CHANGE_OWNERSHIP_PLAN_DRAFT.md) | Name change handling and successor entity links | **📝 Draft / RFC** |
| [`MASTER_PLAN_NAME_HISTORY_ADDENDUM.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/MASTER_PLAN_NAME_HISTORY_ADDENDUM.md) | Addendum to Master Plan for aliases and name history | **📝 Draft / RFC** |
| [`UNCONFIRMED_SUGGESTIONS.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/plans/UNCONFIRMED_SUGGESTIONS.md) | Backlog of feature ideas and 2-way sheets sync concepts | **💡 Backlog** |
