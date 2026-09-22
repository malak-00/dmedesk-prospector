# Grouping Updates and fixing

**Status:** Historical working notes; verify all implementation claims against
the architecture and worklog before relying on them.
**Original planning date:** 2026-09-17

Here is a technical audit of how merges and "Send to Sheets" currently work in the codebase, the exact gaps, and what needs to change.

---

### 1. Logic for Showing Merges in Claimed Tabs

#### How it works in the **Prospect (Search) View** today:

In Prospect search, multi-location merges already exist in memory:

1. When search results come back from NPPES, [`createBranchMerger()`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/worker/src/services/companyService.js#L107-L137) deduplicates branches sharing `(Name + Authorized Official)` or `(Phone + Authorized Official)`.
2. Matches are folded into a single company object with a `locations: [{ npi, address, phone, fax }, ...]` array.
3. The frontend in [`docs/app.js`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/docs/app.js#L1673-L1733) renders:
   - A badge: [`locationsBadge()`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/docs/app.js#L1688-L1692) &rarr; `<span class="locations-badge">N locations</span>`
   - In the expanded row: [`branchLocationsHtml()`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/docs/app.js#L1693-L1733) &rarr; lists each branch location with its address, phone, and branch NPI.

#### How it works in the **Claimed Leads Tab** today:

**There is currently NO merge or group display logic in the Claimed leads tab.**

1. **Flat DB Query**:
   - When the user opens the Claimed tab, [`loadClaimedLeads()`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/docs/app.js#L2350-L2367) calls `GET /leads/list`.
   - In [`worker/src/repos/leadsRepo.js`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/worker/src/repos/leadsRepo.js#L154-L181), `listClaimedLeads()` runs:
     ```sql
     SELECT * FROM leads WHERE claimed_by = :userId AND is_disconnected = false
     ```
   - It maps every row independently via `toLeadDTO()`. It does **not** join with `lead_groups` or `lead_group_members`, and does not group branches together.
2. **Row Rendering**:
   - In [`docs/app.js`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/docs/app.js#L2378-L2429), `renderClaimedLeads()` renders each claimed NPI as an isolated row.
   - Neither `locationsBadge` nor `branchLocationsHtml` is wired into [`claimedLeadRowHtml()`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/docs/app.js#L2399-L2429) or [`claimedDetailRowHtml()`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/docs/app.js#L2619-L2681).
3. **Identity Schema Disconnect**:
   - Even if an admin merges two groups in Admin &rarr; Identity Match Review ([`sql/009_identity_match_review.sql`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/sql/009_identity_match_review.sql)), or if a rep claims 3 branch NPIs belonging to the same organization, they display as 3 separate, unlinked rows in the Claimed view.

---

### 2. Does "Send to Sheets" Need to Also Check for Merges and Unclaimed Stuff?

**Yes, critically so.** Right now, "Send to Sheet" bypasses almost all data-integrity checks.

#### Gap A: Unclaimed / Ownership Checks

Look at [`POST /export/google-sheet`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/worker/src/index.js#L225-L229) vs [`POST /export/sheets`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/worker/src/index.js#L209-L213):

- **"Claim Lead" (`POST /export/sheets`)**:
  - Calls [`exportCompaniesToLeads()`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/worker/src/repos/leadsRepo.js#L230-L291) which executes `supabase.rpc("claim_leads", ...)`.
  - Enforces [SQL 010](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/sql/010_group_aware_claim.sql): checks if the NPI is already claimed by someone else, checks if the NPI's identity group is owned by someone else, and locks rows.
- **"Send to Sheet" (`POST /export/google-sheet`)**:
  - Calls [`GoogleSheets.exportCompaniesToSheet()`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/worker/src/services/googleSheets.js#L190-L222).
  - **Does zero checks against Supabase.**
  - **Does NOT check if already claimed:** If Teammate B already claimed NPI `1234567890`, Teammate A can still click "Send to Sheet" and write it into their personal `"Claimed - Teammate A"` sheet tab.
  - **Does NOT claim in the app:** The leads written to the spreadsheet remain **unclaimed** in the Supabase database. Minutes later, Teammate C can search and claim that exact same lead inside the app, creating an immediate ownership conflict between Google Sheets and Supabase.

#### Gap B: Merged Multi-Location Branches are Dropped

- In Prospect search, a merged result has `company.locations = [branch1, branch2, ...]`.
- When [`GoogleSheets.exportCompaniesToSheet()`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/worker/src/services/googleSheets.js#L208) exports the row, it calls [`flattenCompany(company)`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/worker/src/lib/csvExport.js#L36-L74).
- `flattenCompany` **only inspects top-level properties and completely ignores `company.locations`**.
- **Impact:** Any merged branches and secondary NPIs are silently omitted from Google Sheets. Furthermore, the system never checks whether any secondary branch NPI is already claimed or conflicts with a teammate.

---

### Audit Summary & Technical Vulnerabilities

| Area                                | Current Behavior                                                                     | Risk / Severity                                                                                                               | Required Fix                                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Claimed Tab Merges**              | Flat `SELECT * FROM leads WHERE claimed_by = :user` with 0 branch/group aggregation. | **P1 (UX / Visibility)**: Reps cannot see that multiple claimed leads belong to the same business or have branch locations.   | Group by `group_id` / join `lead_group_members` in `listClaimedLeads`, and render `locationsBadge` + branch accordion in the Claimed view. |
| **Send to Sheet: Unclaimed Status** | Appends rows to `"Claimed - <Name>"` tab without verifying claim state in Supabase.  | **P0 (Data Integrity)**: Leads in Google Sheets are not registered in Supabase, allowing teammates to claim them in parallel. | Run preflight check against `leads` + `owned_group_npis` before exporting, or atomically claim them in Supabase when sending to Sheets.    |
| **Send to Sheet: Merged Branches**  | `flattenCompany()` ignores `company.locations`.                                      | **P1 (Data Loss)**: Secondary branch NPIs and addresses merged in the search UI are dropped when exported to Sheets.          | Expand/unroll `company.locations` into the export payload (or include branch details) and validate all branch NPIs.                        |

---

### Recommended Implementation Strategy

1. **For "Send to Sheets"**:
   - In `worker/src/services/googleSheets.js` (or `leadsRepo.js`), before appending to Google Sheets:
     - Check candidate NPIs (including `company.locations[*].npi`) against active claims and identity groups via `getClaimedNpisAmongSafe` and `getOwnedGroupNpisAmongSafe`.
     - Decide whether "Send to Sheet" should also perform an active claim in Supabase (or prompt the user if any selected leads are already claimed/blocked).
     - Expand `flattenCompany` or iterate over `company.locations` so secondary branch locations are not lost.
2. **For Merges in Claimed Tab**:
   - Update `leadsRepo.listClaimedLeads()` to join `lead_groups` / `lead_group_members` so branch locations for the user's claimed leads are populated.
   - Update [`claimedLeadRowHtml`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/docs/app.js#L2399) and [`claimedDetailRowHtml`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/docs/app.js#L2619) to display the `locationsBadge` and `branchLocationsHtml`, matching the Prospect view.

### SQL (IMMUTABLE) Root Cause Analysis

The error occurs because of an architectural contradiction between **table-level deletion** and the **append-only audit trigger**:

```
[User clicks "Return to Prospect"]
       │
       ▼
[leadsRepo.returnClaimedLeadsToProspect]
       │
       ▼
DELETE FROM public.leads WHERE claimed_by = :userId AND npi IN (...)
       │
       ▼ (Foreign Key: on delete set null)
PostgreSQL tries: UPDATE public.lead_ownership_events SET lead_id = NULL
       │
       ▼ (Trigger: lead_ownership_events_append_only)
reject_audit_mutation() blocks the UPDATE:
"append-only audit table: lead_ownership_events is immutable"  💥
```

---

### Code Breakdown

1. **The Delete Call in [`worker/src/repos/leadsRepo.js`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/worker/src/repos/leadsRepo.js#L427)**:

   ```javascript
   const { error } = await supabase
     .from("leads")
     .delete()
     .eq("claimed_by", session.id)
     .in("npi", npis);
   ```

   This performs a hard `DELETE` from the `leads` table.

2. **The Foreign Key in [`sql/001_identity_schema.sql:53`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/sql/001_identity_schema.sql#L53)**:

   ```sql
   create table if not exists public.lead_ownership_events (
     id uuid primary key default gen_random_uuid(),
     lead_id uuid references public.leads(id) on delete set null,
     ...
   ```

   When a lead is deleted, PostgreSQL fires `ON DELETE SET NULL`, issuing an internal `UPDATE` on `lead_ownership_events`.

3. **The Append-Only Immutability Trigger in [`sql/001_identity_schema.sql:117-129`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/sql/001_identity_schema.sql#L117-L129)**:

   ```sql
   create or replace function public.reject_audit_mutation()
   returns trigger language plpgsql as $$
   begin
     raise exception 'append-only audit table: % is immutable', TG_TABLE_NAME;
   end;
   $$;

   create trigger lead_ownership_events_append_only
   before update or delete on public.lead_ownership_events
   for each row execute function public.reject_audit_mutation();
   ```

   Because `reject_audit_mutation()` forbids **any** `UPDATE` or `DELETE` on `lead_ownership_events`, PostgreSQL's attempt to execute `SET lead_id = NULL` is aborted immediately.

---

### Why This Matters: "Ownership Can Change Over Time"

Hard-deleting from `leads` is an anti-pattern for sales ownership:

1. **Destroying Auditability**:
   - `lead_ownership_events` was specifically created to track lifecycle events:
     ```sql
     check (event_type in ('claimed', 'reassigned', 'released', 'provider_data_changed', 'conflict_detected'))
     ```
   - Returning a lead to Prospect is a **`released`** ownership transition, not a deletion of historical reality.
2. **Orphaned / Broken Events**:
   - If the lead row is deleted, historical events (`claimed`, `reassigned`, notes history) either get severed (`lead_id = NULL`) or block the operation.
3. **Reassignment and Multi-Claim Lifecycle**:
   - As reps change territories or release accounts, a provider will be owned by Rep A &rarr; released &rarr; claimed by Rep B &rarr; reassigned by Admin to Rep C.
   - All the SQL procedures ([`sql/005`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/sql/005_ownership_conflict_resolution.sql#L59), [`sql/008`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/sql/008_identity_match_tiers.sql#L240), [`sql/010`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/sql/010_group_aware_claim.sql#L364), [`sql/011`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/sql/011_claim_for_user.sql#L121)) check active ownership using:
     ```sql
     WHERE not is_disconnected AND claimed_by IS NOT NULL
     ```
     They already treat active ownership as `claimed_by IS NOT NULL`, **not** table row existence.

---

### The Solution

Instead of hard-deleting the row from `leads`:

1. **Record the `released` Event**:
   Append an audit event into `lead_ownership_events`:

   ```sql
   INSERT INTO public.lead_ownership_events (
     lead_id, npi, group_id, event_type, from_user_id, to_user_id, reason, source
   ) VALUES (
     v_lead.id, v_lead.npi, v_lead.group_id, 'released', session.id, NULL, 'returned_to_prospect', 'user_action'
   );
   ```

2. **Soft-Release the Lead**:
   Update the lead rather than deleting it:

   ```sql
   UPDATE public.leads
      SET claimed_by = NULL,
          status = 'new',
          claimed_at = NULL,
          reminder_at = NULL
    WHERE claimed_by = :userId AND npi IN (:npis);
   ```

   _(Or implement a dedicated SQL RPC function `release_claimed_leads(p_user_id, p_npis)` that executes both atomically inside one transaction, exactly like `claim_leads` and `resolve_ownership_conflict`)._

3. **Update Prospect Search Filter in [`leadsRepo.getClaimedNpisAmong`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/worker/src/repos/leadsRepo.js#L104-L110)**:
   Update the query so released leads (`claimed_by IS NULL`) resurface in Prospect searches:
   ```javascript
   // Only exclude active claims and disconnected leads
   const { data, error } = await supabase
     .from("leads")
     .select("npi")
     .not("claimed_by", "is", null)
     .eq("is_disconnected", false)
     .in("npi", candidates);
   ```

---

The CLI (`scripts/nppes_ingest/`) handles provider updates through a **staged, compare-before-update pipeline** governed by a strict boundary: **the CLI updates registry records (`npi_records`), but never touches sales ownership (`leads.claimed_by`)**.

Here is how the CLI handles updating information and tracking name, location, and ownership changes:

---

### 1. How the CLI Updates Info (The Ingest & Apply Loop)

The process runs in two distinct stages:

```
Source CSV (NPPES / CMS)
       │
       ▼ [ingest.py]
Stage into public.nppes_refresh_staging (under one refresh_run_id)
       │
       ▼ [apply.py -> SQL: apply_nppes_refresh_batch]
Compare staged values vs public.npi_records (canonical normalization)
       ├──> Write diffs to public.provider_field_history (Audit Trail)
       └──> Update / Insert public.npi_records (Registry Source of Truth)
```

1. **Staging (`ingest.py`)**:
   - Computes SHA-256 and line count up front (protecting against truncated/partial files).
   - Validates NPIs, filters by enabled taxonomies, and normalizes headers.
   - Bulk-inserts rows into `nppes_refresh_staging` attached to a `refresh_runs` record with status `'staged'`.
2. **Batched Comparison & Apply (`apply.py` & [`sql/007_nppes_refresh_lifecycle.sql`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/sql/007_nppes_refresh_lifecycle.sql))**:
   - Executes `apply_nppes_refresh_batch(run_id, batch_size=500)`.
   - Normalizes text, whitespace, and phone formats via `nppes_canonical_value()`.
   - **Field-by-field diff**: If an incoming value differs from the existing value in `npi_records`, it inserts an audit row into `public.provider_field_history` **before** updating `npi_records`.

---

### 2. How Location and Name Changes are Handled

The CLI does not blindly overwrite records. Every change to a provider's location, name, or contacts is tracked as a distinct historical event:

- **Location Changes**:
  - Tracked columns: `address_line1`, `address_line2`, `address_city`, `address_state`, `address_postalcode`, `phone`.
  - If a supplier relocates or changes phone, a record is added to `provider_field_history`:
    ```json
    {
      "npi": "1234567890",
      "field_name": "address_city",
      "old_value": "Dallas",
      "new_value": "Fort Worth",
      "refresh_run_id": "...",
      "source": "nppes"
    }
    ```
- **Name & Contact Changes**:
  - Tracked columns: `name`, `authorizedofficial_firstname`, `authorizedofficial_lastname`, `authorizedofficial_title`, `authorizedofficial_phone`.
  - Stored identically in `provider_field_history`:
    ```json
    {
      "npi": "1234567890",
      "field_name": "name",
      "old_value": "Acme Medical Supply LLC",
      "new_value": "Acme Health Group Inc",
      "refresh_run_id": "...",
      "source": "nppes"
    }
    ```

---

### 3. How Ownership Changes and Alerts are Handled

The CLI **intentionally does not alter lead ownership**:

- `leads.claimed_by`, notes, status, and callback reminders belong to the sales reps. An external data import is never allowed to erase or reassign a rep's claim.
- Instead of silently reassigning leads, the system creates **review alerts**:
  - When high-signal changes occur on active claimed leads (organization name changes, official phone changes, deactivations, state moves, or Medicare claim volume drops > 50%), an event is logged to `lead_ownership_events`:
    ```sql
    event_type = 'provider_data_changed'
    requires_review = true
    review_status = 'pending'
    metadata = {"changed_fields": ["name", "phone"], "old_values": {...}, "new_values": {...}}
    ```

---

### 4. What is Displayed (CLI vs Database vs UI)

| Surface              | What is Displayed             | Details                                                                                                                                                                                                                         |
| -------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CLI Console**      | **Aggregate Batch Metrics**   | Shows stream progress per batch: <br>`batch 1: 500 rows (+14 new, 32 updated, 68 field changes) -- 3,500 remaining`<br>`Applied run: 120 new, 280 updated, 620 unchanged, 510 field changes recorded in provider_field_history` |
| **CLI Output Files** | **Manifest & Rejection Logs** | Writes `scripts/out/<label>-manifest.json` (checksum, duration, counts) and rejects CSV (dropped rows + reasons: invalid NPI, individual provider, non-matching taxonomy).                                                      |
| **Database Audit**   | **Full Granular Diffs**       | Full history queryable in `provider_field_history` (old vs new for each column) and `lead_ownership_events`.                                                                                                                    |
| **Web App UI**       | **Admin Review Queues**       | Provider data alerts and identity group conflicts appear in the **Admin Tab** under _Ownership conflicts_ and _Identity match review_ for manual sign-off and merging.                                                          |

### Technical Audit: Releasing Leads vs General Grouping Rules

The proposed "soft-release / return to Prospect" solution directly aligns with the identity and grouping architecture, provided four specific grouping rules are accounted for.

---

### Audit Verdict: **Compatible with Required Safeguards**

| Grouping Dimension                        | Alignment             | Severity | Rule / Edge Case                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------- | --------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Identity Immutability**              | **PASSED**            | &mdash;  | Group membership in `lead_group_members` represents real-world business entity structure. Releasing a lead does not dissolve or mutate the business group; the group identity remains intact.                                                                                                                                   |
| **2. Group-Aware Search Exclusion**       | **PASSED (with fix)** | **P0**   | `public.owned_group_npis` already filters `WHERE not l.is_disconnected AND l.claimed_by IS NOT NULL`. But `leadsRepo.getClaimedNpisAmong` in JS currently queries `leads` without checking `claimed_by IS NOT NULL`. It must be updated so released leads resurface in search.                                                  |
| **3. Partial vs Full Group Release**      | **CAUTION**           | **P1**   | If Rep A claims 2 branch NPIs in the same group and releases only 1: under [`sql/010`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/sql/010_group_aware_claim.sql#L360-L365), that group is **still owned by Rep A** (because Rep A still claims branch 2). Another rep attempting to claim branch 1 will be blocked. |
| **4. Re-Claiming Lifecycle (Uniqueness)** | **PASSED**            | **P0**   | The unique index on `leads` is `idx_leads_npi_claimed_by on leads(npi, claimed_by)`. In PostgreSQL, `NULL` values are distinct in unique indexes. Setting `claimed_by = NULL` allows the same or another rep to claim that NPI later without constraint violations.                                                             |

---

### Key Grouping Rules & Behaviors

#### Rule 1: Group Ownership Depends on `claimed_by IS NOT NULL`

In [`sql/010_group_aware_claim.sql:360-365`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/sql/010_group_aware_claim.sql#L360-L365), `owned_group_npis` checks:

```sql
WHERE l.group_id = c.group_id
  AND not l.is_disconnected
  AND l.claimed_by IS NOT NULL
  AND l.claimed_by <> p_user_id
```

- **If all leads in Group G are released (`claimed_by = NULL`)**:
  `owned_group_npis` returns empty. The entire business group is completely unowned. Any salesperson can search and claim any branch in Group G.
- **If only some leads in Group G are released**:
  As long as Rep A still holds at least one active branch in Group G with `claimed_by = Rep A`, the entire group remains protected. Rep B cannot claim the released branch.

#### Rule 2: Search Query Synchronization

Currently, in [`worker/src/repos/leadsRepo.js:107`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/worker/src/repos/leadsRepo.js#L107):

```javascript
// BROKEN if row remains in table:
const { data, error } = await supabase
  .from("leads")
  .select("npi")
  .in("npi", candidates);
```

If a released lead remains in `public.leads` with `claimed_by = NULL`, the above query still matches it and excludes it from search results.
**Must be updated to:**

```javascript
const { data, error } = await supabase
  .from("leads")
  .select("npi")
  .not("claimed_by", "is", null)
  .eq("is_disconnected", false)
  .in("npi", candidates);
```

#### Rule 3: Atomic Release Transaction (SQL RPC)

To prevent race conditions and ensure `lead_ownership_events` and `leads` are updated atomically, this should be executed as a single database function:

```sql
create or replace function public.release_claimed_leads(p_user_id uuid, p_npis text[])
returns jsonb
language plpgsql
security definer
as $$
declare
  v_lead record;
  v_released text[] := '{}';
begin
  for v_lead in
    select id, npi, group_id, company_name
      from public.leads
     where claimed_by = p_user_id
       and npi = any(p_npis)
       and not is_disconnected
     for update
  loop
    -- 1. Append immutable audit event
    insert into public.lead_ownership_events (
      lead_id, npi, group_id, event_type, from_user_id, to_user_id, reason, source
    ) values (
      v_lead.id, v_lead.npi, v_lead.group_id, 'released', p_user_id, null, 'returned_to_prospect', 'user_action'
    );

    -- 2. Soft-release active ownership
    update public.leads
       set claimed_by = null,
           status = 'new',
           claimed_at = null,
           reminder_at = null
     where id = v_lead.id;

    v_released := array_append(v_released, v_lead.npi);
  end loop;

  return jsonb_build_object('released_npis', v_released, 'count', coalesce(array_length(v_released, 1), 0));
end;
$$;
```

---

### Summary

The soft-release pattern:

1. **Preserves the audit contract**: Works with `lead_ownership_events` without violating the immutability trigger.
2. **Maintains identity groups**: Retains real-world organization mapping in `lead_group_members`.
3. **Respects group ownership**: Uses `claimed_by IS NOT NULL`, which matches existing conflict detection and claim locking.

---

## BD MEETINGS → Prospector NPI Auto-Claim Sync

### Background

BD Meetings openers sometimes dial leads outside the Prospector UI. A Google Apps Script in the **BD MEETINGS 2026** sister project (already coded and deployed) runs every 30 minutes, reads any row in the BD Meetings sheet with a 10-digit NPI in column Q and no `SYNCED` stamp in column R, and claims that lead in the Prospector under the correct opener's account.

The BD MEETINGS script logs in as a single **admin account** and calls one endpoint per opener batch — no individual opener passwords are stored anywhere.

**Current state**: 110 of 312 NPIs in the BD sheet are not yet claimed in the Prospector. The sync trigger is written and pushed but blocked on steps below.

---

### What needs to be done (3 blockers)

#### 1. Wire up `POST /admin/claim-for-user` in the Worker

**File**: [`worker/src/index.js`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/worker/src/index.js)

The SQL function `claim_leads(p_user_id, p_leads, p_actor_id)` is **already written** in [`sql/011_claim_for_user.sql`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/sql/011_claim_for_user.sql) — it just needs an HTTP route. Add after the existing `/admin/leads` route:

```javascript
// BD MEETINGS sync: claim leads on behalf of a named user.
// Actor must be admin or have can_claim_for_others = true.
app.post("/admin/claim-for-user", async (c) => {
  const session = c.get("session");
  requireAdmin(session);

  const body = await c.req.json().catch(() => ({}));
  const { companies, username } = body;
  if (!username) return c.json({ success: false, status: 400, error: "username is required" }, 400);
  if (!Array.isArray(companies) || companies.length === 0)
    return c.json({ success: false, status: 400, error: "companies array is required" }, 400);

  const supabase = supabaseFor(c);

  // Look up target user
  const { data: targetUser, error } = await supabase
    .from("app_users")
    .select("id, display_name")
    .ilike("username", String(username).trim())
    .maybeSingle();
  if (error) throw new Error("Failed to look up user: " + error.message);
  if (!targetUser)
    return c.json({ success: false, status: 404, error: `User "${username}" not found` }, 404);

  const targetSession = { id: targetUser.id, displayName: targetUser.display_name };
  const data = await leadsRepo.exportCompaniesToLeads(
    supabase, companies, targetSession, CsvExport.flattenCompany
  );
  return c.json(ok(data));
});
```

#### 2. Deploy the Worker

```bash
cd worker
wrangler deploy
```

#### 3. Update `syncNpiToProspector()` in BD MEETINGS + set Script Properties

**File**: [`BD MEETINGS 2026/src/code.js`](file:///c:/Users/ben.arthur/Desktop/BD%20MEETINGS%202026/src/code.js) — update the sync function to use admin login once + call `/admin/claim-for-user` per opener batch instead of the current per-opener login approach.

**Script Properties to set** in the BD MEETINGS Apps Script project settings:

| Property | Value |
|---|---|
| `PROSPECTOR_WORKER_URL` | Cloudflare Worker URL |
| `PROSPECTOR_ADMIN_USER` | admin username |
| `PROSPECTOR_ADMIN_PASS` | admin password |
| `PROSPECTOR_USER_Ben` | `ben` |
| `PROSPECTOR_USER_Jane` | `jane` |
| `PROSPECTOR_USER_Jimmy` | `jimmy` |
| `PROSPECTOR_USER_Selene` | `selene` |
| `PROSPECTOR_USER_Jasmine` | `jasmine` |
| `PROSPECTOR_USER_Nora` | `nora` |

Then run `setupProspectorSyncTrigger()` once from the Apps Script editor to activate the 30-min trigger.

---

## Database Storage Protection & Future Prevention Plan (Free Tier Safety)

### Why the Database Exceeded Quota
The database size reached **690 MB / 500 MB (138%)** due to two design flaws in the NPPES ingestion pipeline:
1. **Permanent Staging Retention**: Staged rows in `nppes_refresh_staging` (~256 MB with indexes) were never automatically deleted after `--apply`.
2. **Full-Row JSON Snapshots in History**: For every newly discovered NPI, `sql/007` inserted a full JSON snapshot (`field_name = 'record_created'`) into `provider_field_history`, bloating it to **~325 MB**.
3. **PostgreSQL Dead-Tuple Bloat**: Bulk UPDATEs and INSERTs left dead space that was never reclaimed to the OS via `VACUUM`.

Together, these two temporary/audit tables occupied **581 MB out of 690 MB (84% of the database)**, while the core sales pipeline (`leads`, `app_users`, `lead_groups`) took **< 10 MB**.

---

### Permanent Prevention Strategy (5 Rules to Never Exceed 500 MB)

#### 1. Auto-Purge Staging in `finish_nppes_apply()`
Staging tables must be strictly ephemeral. Once staged rows are applied to `npi_records`, they should be deleted immediately inside `finish_nppes_apply()` in [`sql/007_nppes_refresh_lifecycle.sql`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/sql/007_nppes_refresh_lifecycle.sql):

```sql
-- In finish_nppes_apply(p_run_id):
delete from public.nppes_refresh_staging where refresh_run_id = p_run_id;
```
*The source CSV and `scripts/out/<label>-manifest.json` already provide durable audit records outside the database.*

#### 2. Stop Inserting Full JSON `record_created` Snapshots
New providers already exist in full in `public.npi_records`. Storing a duplicate JSON copy in `provider_field_history` for tens of thousands of providers causes massive bloat.

- **Rule**: Only insert into `provider_field_history` when an **existing provider's field actually changes** (`name`, `phone`, `address`, `authorizedofficial`).
- **Fix**: Remove the `insert into public.provider_field_history ... select s.npi, 'record_created' ...` block from `sql/007_nppes_refresh_lifecycle.sql:285-291`.

#### 3. CLI Preflight Storage Guard (`scripts/nppes_ingest/`)
Before `python -m nppes_ingest` begins staging, it should query current database storage:
- If current DB size > **350 MB**, the CLI aborts before staging:
  ```
  ERROR: Database storage guard triggered (380 MB / 500 MB).
  Refusing to stage new release. Purge old staging or vacuum before proceeding.
  ```
- This prevents a running script from blindly pushing Supabase into read-only mode mid-ingest.

#### 4. Post-Ingest Automated Maintenance
Incorporate `VACUUM` into the post-apply step:
- After purging staging, running `VACUUM public.nppes_refresh_staging;` and `VACUUM public.npi_records;` returns reclaimed space back to PostgreSQL's free space map so subsequent runs reuse existing allocated disk without growing the physical database size.

#### 5. Strict Taxonomy Pre-Filtering Before Staging
Ensure `ingest.py` only stages providers that match targeted DMEPOS taxonomies (e.g. `332B00000X`, `333600000X`, `335E00000X`) and organization types (NPI Type 2). Never stage general/individual medical providers into Supabase Postgres.

---

### Current Status & Safe Headroom Actions (Post-Truncation)

**Current Metric**: `0.488 GB / 0.5 GB (98%)` &mdash; **Quota Violation Cleared**

> [!NOTE]
> Supabase dashboard metrics can take up to **1 hour** to reflect newly reclaimed disk space. While the restriction is lifted, 98% is close to the margin (12 MB headroom). 

#### Immediate Action to Expand Headroom to ~150 MB (30% Capacity)
To reclaim physical disk blocks back to the OS and prevent creeping back over 500 MB during regular app use, run in the **Supabase SQL Editor**:

```sql
-- 1. Reclaim physical disk from truncated tables
VACUUM FULL public.nppes_refresh_staging;
VACUUM FULL public.medicare_refresh_staging;

-- 2. Compact remaining large tables
VACUUM FULL public.npi_records;
VACUUM FULL public.provider_field_history;
```

---

## Sept 17 Implementation Master Checklist

- [x] **Database Quota Recovery**: Truncated staging tables; size dropped from 0.742 GB (148%) to 0.488 GB (98%).
- [ ] **Physical Disk Compaction**: Run `VACUUM FULL` to drop size from 98% down to ~30–40% (~150 MB).
- [ ] **SQL Immutability Fix**: Deploy `public.release_claimed_leads()` RPC to soft-release leads (`claimed_by = NULL`) and append audit event (`event_type = 'released'`) instead of hard deleting from `leads`.
- [ ] **Search Query Sync**: Update `leadsRepo.getClaimedNpisAmong()` in worker to filter `WHERE claimed_by IS NOT NULL` so released leads resurface in Prospect.
- [ ] **BD Meetings Sync Route**: Add `POST /admin/claim-for-user` in [`worker/src/index.js`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/worker/src/index.js) and deploy worker.
- [ ] **BD Meetings Script Properties**: Configure worker URL + admin credentials in Apps Script properties and activate trigger.
- [ ] **Claimed Tab Merges**: Join `lead_groups` in `listClaimedLeads()` and wire `locationsBadge` and branch locations into Claimed view.
- [ ] **Send to Sheets Validation**: Add ownership preflight checks and unroll `company.locations` so branch NPIs are not dropped.
- [ ] **NPPES Lifecycle Guard**: Update `sql/007`'s `finish_nppes_apply()` to auto-delete staging rows and remove `record_created` full-JSON snapshots.


