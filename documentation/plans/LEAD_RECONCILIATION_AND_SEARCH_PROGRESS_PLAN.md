# Lead Reconciliation, Search Progress, and Audit Separation Plan

**Date:** 2026-10-05  
**Status:** Current working plan

---

## 1. Executive Summary

This plan addresses three core items:
1. **Reconciling `fixlag` with recent `main` commits by the lead (Malak)**, including migration numbering and deployment alignment.
2. **Technical architecture and behavior of the "Start over from the beginning" button (`resetProgress`)**, detailing why and how it functions as a safe, non-destructive detour.
3. **Separating the dual audits into two dedicated documents**:
   - **Sheet Intake Audit** (external BD Meetings spreadsheet intake, missing NPIs/states, internal sheet duplicates, unmapped openers).
   - **Onboarded Database Audit** (3,930+ live leads in Supabase, NPI collisions, cross-agent ownership conflicts, and onboarded completeness).

---

## 2. Reconciling `fixlag` with `main`

### A. Recent Commits on `main` (The Lead's Work)
- **Meetings Feature (SQL + Worker + UI):** Added [`sql/020_lead_meetings.sql`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/sql/020_lead_meetings.sql), `POST /leads/meeting` endpoint, `worker/src/lib/meetings.js`, and calendar booking card in `docs/app.js`.
- **Lead Cards v2 & Dashboard Refresh:** Modern collapsible card UI, merged "Log this call" action, quick filters, saved searches.
- **Lookup Field Enhancement:** Top search field accepts a 10-digit NPI or company name (dispatches `nameContainsTerms`).

### B. Changes in `fixlag`
- **Fixed `seen_npis` wipe bug on "Search more"**: `companyService.js` now merges `progress.seenNpis` instead of overwriting with only the latest batch.
- **Enhanced `fingerprint()`**: Deterministic inclusion of `taxonomyCodes`, `requireCmsClaims`, and `minMedicareClaims` in `searchProgressRepo.js`.
- **Increased Buffer**: Raised `MAX_SEEN_NPIS` from 4,000 to 20,000 and deduplicated before saving.
- **Unit Tests**: Full test coverage in `worker/test/searchProgress.test.js` (22/22 passing).

### C. Reconciliation & Merge Actions
1. **Renumber Migration Conflict**:
   - `main` has `019_provider_history_compact_insert_trigger.sql` and `020_lead_meetings.sql`.
   - `fixlag` contains `019_conflict_unclaim.sql`.
   - **Action:** Renumber `019_conflict_unclaim.sql` &rarr; `021_conflict_unclaim.sql` to eliminate naming collisions.
2. **Merge `main` into `fixlag`**:
   - Fast-forward / merge the lead's UI and meeting routes into the branch.
3. **Deploy Worker from `fixlag`**:
   - Deploy the Worker so production receives the `seen_npis` fix and deterministic fingerprinting.

---

## 3. How the "Start Over from the Beginning" Button Works

The "Start over from the beginning" control (`resetProgress`) is designed as a **self-contained, non-destructive detour**.

### User Interaction & Flow
1. **Location in UI**: Checkbox located in the search filter panel (`docs/index.html` line 175).
2. **Trigger**: When checked, `params.resetProgress = "true"` is appended to `/api/search/companies`.

### Execution in `companyService.js`
```javascript
const resetProgress = Boolean(options.resetProgress);
let effectiveCriteria = criteria;

if (options.clientProvidedVariantSkips) {
  // Paging forward during a session...
} else if (resetProgress) {
  // Detour starts from skip 0 with no excluded NPIs:
  effectiveCriteria = Object.assign({}, criteria, { variantSkips: {}, excludeNpis: [] });
} else if (trackProgress) {
  // Normal flow: loads saved bookmark from DB
  const progress = await getSearchProgressSafe(supabase, options.userId, criteria);
  ...
}
```

### Persistence Guard
```javascript
if (trackProgress && !resetProgress) {
  await saveSearchProgressSafe(supabase, options.userId, criteria, fetchResult.variantSkips, combinedSeenNpis);
}
```

### Why it Works this Way
- **Safe Exploration**: A rep can restart a search from the top of the registry without erasing their stored progress.
- **Zero Database Mutation**: When `resetProgress` is active, it **neither reads nor writes** to `public.search_progress`. The user's real bookmark in the database remains intact.
- **"Search more" Continuity**: If the rep clicks "Search more" while in a reset session, the browser passes `clientProvidedVariantSkips` from the previous page of the detour. This allows paging forward through the detour without overwriting the permanent database bookmark.
- **Clean Resumption**: In any subsequent search where "Start over" is unchecked, the search automatically resumes from the saved bookmark.

---

## 4. Separation of Audits

The audit in `temp/audits/BD_MEETINGS_AUDIT.md` previously intermingled external sheet intake with internal Supabase database validation. They are now separated into two dedicated documents:

1. **[`documentation/operations/SHEET_INTAKE_AND_CLAIM_AUDIT.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/operations/SHEET_INTAKE_AND_CLAIM_AUDIT.md)**:
   - Scope: `BD MEETINGS 2026.xlsx` tabs (`New Meetings`, `Follow Ups`, `Contract Sent`, etc.).
   - Issues: Missing State and NPI columns in spreadsheet tabs; unmapped openers (`Jane`, `George`, `Russ`); internal spreadsheet duplicate pairs.
   - Purpose: Rules and enrichment required before importing spreadsheet rows into DME Desk.

2. **[`documentation/operations/ONBOARDED_LEADS_DATABASE_AUDIT.md`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/documentation/operations/ONBOARDED_LEADS_DATABASE_AUDIT.md)**:
   - Scope: 3,930+ claimed leads currently residing in Supabase `public.leads`.
   - Issues: 102 duplicate-NPI groups; cross-rep ownership collisions (e.g., Rick vs. Nora, Kaity vs. Jasmine); completeness of onboarded records (missing contact or Medicare enrichment).
   - Purpose: Direct database cleanup, identity grouping resolution, and preflight enforcement.
