# Phone Deletion & Disconnected Group Handling Specification

**Status:** Implementation Specification  
**Last Reviewed:** 2026-09-21  
**Target Areas:** Database (`sql/`), Worker Repository (`worker/src/repos/`), Frontend UI (`docs/app.js`), Ingestion (`scripts/nppes_ingest/`)

---

## 1. Executive Summary

This document defines the rules, schema changes, and application logic for two critical lead data scenarios in the DME Desk Prospector:

1. **Phone Deletion / Non-Working Phone Updates:**  
   If an NPI originally had a valid working phone number, and an incoming update (such as a monthly NPPES refresh, CMS update, or batch import) replaces that phone with anything that is **not a working phone** (e.g., `NULL`, empty string, dummy digits, or invalid format), the system must **not** discard or erase the previous working phone. Instead, it must **keep the deleted phone on the account**, archive it in historical tracking, and clearly mark it as **"phone deleted from account"**.
2. **Disconnected Numbers & Grouped Lead Handling:**  
   - When a phone number is marked disconnected (dead), all grouped leads (other branch locations belonging to the same organization/`group_id`) must also be moved to disconnected.
   - When checking, searching, or claiming leads, the system must inspect grouped leads to verify if any branch in the group **already has a disconnected number**, preventing reps from dialing dead organizations.

---

## 2. Scenario 1: Phone Deleted from Account

### 2.1 Definition of "Working Phone" vs. "Non-Working Phone"
- **Working Phone:** A valid 10-digit North American Numbering Plan (NANP) phone number matching regex `^1?[2-9][0-9]{2}[2-9][0-9]{6}$` (e.g. valid area code and exchange, extracting 10 numeric digits), where all digits are not identical repetitions (e.g., not `0000000000` or `9999999999`).
- **Non-Working / Deleted Phone:**
  - `NULL`, empty string `""`, or whitespace.
  - Fewer than 10 digits (e.g., `"555-1212"`, truncated numbers).
  - Repetitive dummy numbers (`"000-000-0000"`, `"111-111-1111"`, `"999-999-9999"`).
  - Placeholder strings (`"N/A"`, `"NONE"`, `"DISCONNECTED"`, `"UNKNOWN"`, `"NO PHONE"`).

### 2.2 Current Gap
In [`sql/015_provider_change_alerts.sql`](../../sql/015_provider_change_alerts.sql#L176), `apply_provider_changes_to_leads` blindly updates the snapshot:
```sql
update public.leads l set phone = r.phone ...
```
If `r.phone` in `npi_records` is now null or invalid, `leads.phone` is overwritten. The sales rep loses the only contact number previously recorded for that business.

### 2.3 Required Logic & Architecture

```
Incoming Provider Update (NPPES / Ingestion)
               │
               ▼
   Does lead currently have a valid 10-digit working phone?
               │
      ┌────────┴────────┐
     YES                NO
      │                  │
      ▼                  ▼
Is new value a valid    Accept new value as-is.
10-digit phone?
      │
      ├──────────────────────────────┐
     YES                             NO (Empty / Dummy / Invalid)
      │                              │
      ▼                              ▼
Normal phone update.           1. DO NOT blank out or lose old phone.
                               2. Archive old phone in `leads.deleted_phones`.
                               3. Prepend system note: 
                                  "[System]: Phone (XXX) XXX-XXXX was deleted from account".
                               4. Update `phone_status` to 'deleted_from_account'.
                               5. Display strike-through + badge in UI: 
                                  "<s>(XXX) XXX-XXXX</s> (Phone deleted from account)".
```

### 2.4 Database Schema Changes

```sql
-- Migration: Add phone status and archive tracking to public.leads
alter table public.leads
  add column if not exists deleted_phones jsonb not null default '[]'::jsonb,
  add column if not exists phone_status text not null default 'active'
    check (phone_status in ('active', 'deleted_from_account', 'disconnected'));

comment on column public.leads.deleted_phones is
  'Historical list of valid phones removed or replaced by non-working values: [{ phone, deleted_at, reason, source }]';
```

### 2.5 Update Trigger / Sync Logic in `sql/015`

When updating `public.leads` during an NPPES sync (`apply_provider_changes_to_leads`):
```sql
-- If existing phone was valid 10 digits, and incoming phone is invalid/empty:
update public.leads l
   set deleted_phones = l.deleted_phones || jsonb_build_array(jsonb_build_object(
         'phone', l.phone,
         'deleted_at', now(),
         'reason', 'deleted_from_account',
         'source', 'nppes_refresh'
       )),
       phone_status = 'deleted_from_account',
       notes = case 
         when coalesce(l.notes, '') = '' then 
           to_char(now(), 'YYYY-MM-DD HH24:MI') || ' — System: Phone ' || l.phone || ' was deleted from account'
         else 
           to_char(now(), 'YYYY-MM-DD HH24:MI') || ' — System: Phone ' || l.phone || ' was deleted from account' || E'\n' || l.notes
       end
  from public.npi_records r
 where r.npi = l.npi
   and l.npi = any(v_batch)
   and not l.is_disconnected
   and length(public.identity_phone_key(l.phone, null)) = 10
   and length(public.identity_phone_key(r.phone, null)) < 10;
```

---

## 3. Scenario 2: Disconnected Numbers & Grouped Leads

### 3.1 Part A: Moving the Grouped Lead When a Number is Disconnected

#### Current Behavior
[`leadsRepo.moveClaimedLeadsToDisconnected`](../../worker/src/repos/leadsRepo.js#L595) only updates the single row matching the exact `npis` passed in the request. Sibling branches in the same `group_id` remain active (`is_disconnected = false`).

#### Required Behavior
When any lead in a group is disconnected, all associated leads in that group (or sharing that disconnected number) must also be moved to disconnected:

1. **Worker API (`worker/src/repos/leadsRepo.js`)**:
   ```javascript
   export async function moveClaimedLeadsToDisconnected(supabase, npis, session) {
     npis = (npis || []).map(String).filter(Boolean);
     if (npis.length === 0) throw httpError(400, "At least one NPI is required");

     // 1. Identify targeted leads and their group_ids / phones
     const { data: targets, error: findErr } = await supabase
       .from("leads")
       .select("npi, group_id, phone")
       .eq("claimed_by", session.id)
       .eq("is_disconnected", false)
       .in("npi", npis);
     if (findErr) throw httpError(500, "Failed to look up leads: " + findErr.message);

     const targetGroupIds = [...new Set((targets || []).map(t => t.group_id).filter(Boolean))];

     // 2. Disconnect selected leads AND all sibling leads in those groups
     const now = new Date().toISOString();
     const query = supabase
       .from("leads")
       .update({
         is_disconnected: true,
         status: "disconnected",
         phone_status: "disconnected",
         status_updated_by: session.id,
         status_updated_at: now
       })
       .eq("claimed_by", session.id)
       .eq("is_disconnected", false);

     if (targetGroupIds.length > 0) {
       query.or(`npi.in.(${npis.join(",")}),group_id.in.(${targetGroupIds.join(",")})`);
     } else {
       query.in("npi", npis);
     }

     const { data: updated, error: updateErr } = await query.select("npi");
     if (updateErr) throw httpError(500, "Failed to disconnect leads: " + updateErr.message);

     return { movedCount: (updated || []).length, npis: (updated || []).map(r => r.npi) };
   }
   ```

2. **Frontend UI Confirmation (`docs/app.js`)**:
   When a user clicks "Send to Disconnected", check if any selected lead has grouped locations (`lead.branches.length > 0`). If so, confirm:
   > *"Warning: Moving this lead to Disconnected will also move its associated branch location(s) to Disconnected. Continue?"*

---

### 3.2 Part B: Checking Grouped Leads for Existing Disconnected Numbers

#### Current Behavior
- [`leadsRepo.getClaimedNpisAmong`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/worker/src/repos/leadsRepo.js#L117) only filters candidate NPIs themselves.
- [`sql/010_group_aware_claim.sql:363`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/sql/010_group_aware_claim.sql#L363) (`owned_group_npis`) and [`sql/014_claim_preflight.sql:151`](file:///c:/Users/ben.arthur/Desktop/dmedesk-prospector/sql/014_claim_preflight.sql#L151) explicitly filter `where not l.is_disconnected`.
- As a result, candidates belonging to an identity group that already had a number marked disconnected are **not detected** and can be claimed blindly.

#### Required Behavior
1. **Search Query Check (`worker/src/repos/leadsRepo.js`)**:
   Add a group disconnection check `getDisconnectedGroupNpisAmong`:
   ```javascript
   export async function getDisconnectedGroupNpisAmong(supabase, candidates) {
     const list = (candidates || []).filter(c => c && c.npi);
     if (list.length === 0) return new Set();

     const { data, error } = await supabase.rpc("disconnected_group_npis", {
       p_candidates: list
     });
     if (error) {
       console.warn("Failed to check disconnected groups: " + error.message);
       return new Set();
     }
     return new Set((data || []).map(String));
   }
   ```

2. **SQL Procedure (`sql/019_disconnected_group_check.sql`)**:
   ```sql
   create or replace function public.disconnected_group_npis(p_candidates jsonb)
   returns text[]
   language sql stable
   security definer
   set search_path = public, pg_temp
   as $$
     select coalesce(array_agg(distinct c.npi), '{}')
       from (
         select k.npi, coalesce(m.group_id, g.id) as group_id, k.phone_key
           from jsonb_array_elements(coalesce(p_candidates, '[]'::jsonb)) e
          cross join lateral public.identity_candidate_keys(e.value) k
           left join public.lead_group_members m on m.npi = k.npi
           left join public.lead_groups g on g.identity_key = k.identity_key
       ) c
      where exists (
        select 1 from public.leads l
         where (l.group_id = c.group_id or public.identity_phone_key(l.phone, null) = c.phone_key)
           and l.is_disconnected = true
      );
   $$;
   ```

3. **Frontend Warnings (`docs/app.js`)**:
   - **In Prospect Search:**  
     Flag companies whose group already has a disconnected number:
     ```html
     <span class="badge badge-danger" title="A location in this business group was previously marked disconnected">
       Disconnected Group
     </span>
     ```
     Disable or require confirmation before claiming.
   - **In Claimed Leads View:**  
     If `lead.branches` contains any branch with `ownership === "disconnected"`, display an alert banner in the detail panel:
     ```html
     <div class="warning-banner">
       ⚠️ Another location of this business has a disconnected number.
     </div>
     ```

---

## 4. Implementation Checklist

- [ ] **SQL Migration (`sql/019_phone_deletion_and_disconnected_groups.sql`)**:
  - Add `deleted_phones` and `phone_status` columns to `public.leads`.
  - Update `apply_provider_changes_to_leads` to archive old working phones when replaced by non-working values.
  - Implement `public.disconnected_group_npis(p_candidates)` RPC.
- [ ] **Worker Backend (`worker/src/repos/leadsRepo.js`)**:
  - Update `moveClaimedLeadsToDisconnected` to cascade disconnections across all sibling leads sharing `group_id`.
  - Call `getDisconnectedGroupNpisAmong` in provider search to identify leads belonging to dead groups.
- [ ] **Frontend UI (`docs/app.js`)**:
  - Display retained deleted phones with `(Phone deleted from account)`.
  - Confirm group disconnection when clicking "Send to Disconnected".
  - Display "Disconnected Group" warning badge on search results and claimed cards.
