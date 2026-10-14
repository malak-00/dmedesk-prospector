# Call Mode Disposition Latency Fix Plan

> **Status:** Draft / Ready for Review  
> **Target Components:** `docs/callmode.js`, `docs/claimguard.js`, `worker/src/index.js`, `worker/src/repos/leadsRepo.js`  
> **Related Documentation:** [`documentation/plans/FEATURE_PLAN.md`](FEATURE_PLAN.md), [`documentation/reviews/2026-10-09-backend-performance-audit.md`](../reviews/2026-10-09-backend-performance-audit.md)

---

## 1. Problem Statement

When reps use **Call Mode** to dial leads (either from Prospect results or Claimed leads), clicking a disposition chip (e.g., *Voicemail*, *No answer*, *Gatekeeper*, *Interested*) causes a visible 1.5 to 3+ second delay. The entire UI locks (`run.busy = true`), disabling all buttons and freezing the queue drawer before advancing to the next lead.

For high-tempo outbound calling sessions, this friction interrupts dial flow, lowers rep throughput, and leads to repeated double-clicking.

---

## 2. Root Cause Analysis

Tracing disposition actions in [`docs/callmode.js`](../../docs/callmode.js) identified three compounding bottlenecks:

### A. Serial Network Request Waterfall on Every Chip Click

#### 1. In Prospect Mode ([`prospectResult(status)`](../../docs/callmode.js#L473-L502))
Clicking a single disposition chip sequentially awaits up to **4 distinct HTTP requests**:
1. **Related check preflight:** Calls `POST /leads/related-check` via [`dmeClaimGuard.check()`](../../docs/claimguard.js#L61).
2. **Claim lead:** Calls `POST /export/sheets` to insert the company into `leads` via Postgres `claim_leads` RPC.
3. **Write status:** Calls `POST /leads/status` to update `status` on the newly claimed row.
4. **Write note:** Calls `POST /leads/notes` to append `status — note` to the call log on the newly claimed row.

#### 2. In Claimed Mode ([`saveClaimed(item)`](../../docs/callmode.js#L422-L443))
Saving a disposition with note or reminder sequentially awaits **2 to 3 HTTP requests**:
1. `POST /leads/status`
2. `POST /leads/notes`
3. `POST /leads/reminder` (if a callback chip was selected)

### B. Synchronous UI Blocking
In both modes, the client sets `run.busy = true` and disables all buttons:
```javascript
run.busy = true;
drawer.querySelectorAll(".cm-status").forEach((b) => { b.disabled = true; });
```
The drawer does not call `goTo(nextOpen(run.pos + 1))` until all HTTP calls complete. Network round-trip latency directly dictates the dialer pacing.

### C. Redundant Worker & Database Operations
* In [`worker/src/repos/leadsRepo.js:351`](../../worker/src/repos/leadsRepo.js#L351), `companyToLeadRow()` **already supports** `leadStatus` and `leadNotes`. However, `callmode.js` claims the lead with default status (`status: "new"` and empty notes) and then issues 2 additional HTTP requests (`/leads/status` and `/leads/notes`) to overwrite the row it just created.
* Each standalone endpoint (`/leads/status`, `/leads/notes`, `/leads/reminder`) separately runs `requireOwnLead()` (a redundant `SELECT` query) before executing an `UPDATE`.
* When status is changed to `onboarded`, `updateLeadStatus()` awaits `announceWin()`, running multiple team note queries and settings reads before answering the HTTP request.

---

## 3. Remediation Architecture

```
Current Flow (Prospect Call Mode):
[Click Chip] ──> (1) POST /leads/related-check ──> (2) POST /export/sheets ──> (3) POST /leads/status ──> (4) POST /leads/notes ──> [Advance Drawer (1.5-3s)]

Target Flow (Optimized):
[Click Chip] ──> [INSTANT UI ADVANCE (< 50ms)]
                      │
                      └──> (Async Background) POST /export/sheets (with leadStatus & leadNotes) [1 HTTP Call]
```

### Phase 1: Frontend Optimizations (Immediate 0ms Perceived Latency)

#### 1. Optimistic Queue Advance
* When a rep clicks any disposition chip or *Save & next*:
  - Immediately mark outcome in `run.outcome[run.pos]`.
  - Advance the drawer to the next lead instantly: `goTo(nextOpen(run.pos + 1))`.
  - Dispatch the backend persistence asynchronously in the background.
* Maintain error rollback using the existing 10-second `cm-undo` banner in `callmode.js`. If the background request fails (e.g. lead was locked or teammate claimed), display an alert toast and revert the outcome index.

#### 2. Collapse Prospect Mode Claim + Disposition into 1 Request
* When `prospectResult(status)` executes, attach `leadStatus` and `leadNotes` directly to the `company` object sent to `POST /export/sheets`:
  ```javascript
  const payload = {
    ...company,
    leadStatus: status,
    leadNotes: [status, note].filter(Boolean).join(" — ")
  };
  await apiPost("export/sheets", { companies: [payload] });
  ```
* Because `worker/src/repos/leadsRepo.js` already passes `flat.leadStatus` and `flat.leadNotes` to the SQL `claim_leads` RPC, the lead is created with the disposition and call log note in a single database transaction.
* Completely eliminates the subsequent `POST /leads/status` and `POST /leads/notes` round trips.

#### 3. Streamline `claimGuard` for Call Mode
* In Call Mode, avoid running a blocking preflight HTTP check (`POST /leads/related-check`) before claiming. The database `claim_leads` RPC already handles group collision and ownership checks atomically.

---

### Phase 2: Backend Consolidation (`POST /leads/disposition`)

#### 1. Unified Disposition Endpoint
Create a single route in `worker/src/index.js` and `worker/src/repos/leadsRepo.js`:
```http
POST /leads/disposition
Content-Type: application/json

{
  "npi": "1234567890",
  "status": "voicemail",
  "note": "Left VM with front desk",
  "reminderAt": "2026-10-15T14:00:00Z"
}
```

**Worker Implementation:**
* Performs ownership verification once (`claimed_by = session.id`).
* Updates `status`, `notes`, and `reminder_at` in a single SQL `UPDATE` statement.
* Returns `{ npi, status, notes, reminderAt }`.

**Client Adoption:**
* Use this unified endpoint in:
  - `docs/callmode.js` (`saveClaimed`)
  - `docs/today.js` (`saveOutcome`)
  - `docs/app.js` (`logCall`)
* Cuts Claimed mode disposition from 3 serial HTTP round trips down to 1.

#### 2. Asynchronous Side Effect Decoupling
* In `updateLeadStatus()` / `updateLeadDisposition()`, decouple team win announcements:
  ```javascript
  if (before && cleanStatus(before.status) !== "onboarded") {
    // Non-blocking in Cloudflare Workers
    c.executionCtx?.waitUntil?.(announceWin(supabase, session, before.company_name))
      ?? announceWin(supabase, session, before.company_name).catch(() => {});
  }
  ```
* Ensures the disposition HTTP response is returned immediately after the lead table write completes.

---

## 4. Latency & Round-Trip Comparison

| Scenario | Current Requests | Optimized Requests | Current Wall Latency | Target Perceived Latency |
| :--- | :--- | :--- | :--- | :--- |
| **Prospect Call Mode** | 4 serial round trips (`related-check`, `export/sheets`, `status`, `notes`) | **1 background request** (`export/sheets` with status/notes) | 1,200ms – 2,500ms | **< 50ms (Instant)** |
| **Claimed Call Mode** | 2–3 serial round trips (`status`, `notes`, `reminder`) | **1 background request** (`leads/disposition`) | 600ms – 1,500ms | **< 50ms (Instant)** |

---

## 5. Implementation Checklist

- [ ] **Step 1: Frontend Claim Payload Enrichment** (`docs/callmode.js`)
  - Update `claimProspect()` to accept initial `status` and `note`.
  - Pass `leadStatus` and `leadNotes` in `company` object to `apiPost("export/sheets")`.
  - Remove redundant `recordOnClaimed()` calls in `prospectResult()`.
- [ ] **Step 2: Optimistic Drawer Advancement** (`docs/callmode.js`)
  - Advance `run.pos` immediately on chip tap or *Save & next*.
  - Show quick feedback toast and keep `cm-undo` intact.
  - Handle rejection/failure by navigating back or showing alert.
- [ ] **Step 3: Backend Unified Endpoint** (`worker/src/index.js`, `worker/src/repos/leadsRepo.js`)
  - Implement `updateLeadDisposition(supabase, npi, { status, note, reminderAt }, session)`.
  - Expose `POST /leads/disposition`.
  - Use `executionCtx.waitUntil()` for `announceWin()`.
- [ ] **Step 4: Adopt Consolidated Endpoint Across Views**
  - Switch `saveClaimed()` in `docs/callmode.js` to `POST /leads/disposition`.
  - Switch `saveOutcome()` in `docs/today.js` to `POST /leads/disposition`.
  - Switch `logCall()` in `docs/app.js` to `POST /leads/disposition`.

---

## 6. Verification & Test Plan

1. **Prospect Mode Dialing:**
   - Open Call Mode on a list of prospect search results.
   - Click *Voicemail* on lead #1.
   - **Verification:** Drawer advances to lead #2 instantly without UI freeze. Network tab shows only 1 call to `POST /export/sheets`. Lead in Claimed view displays status `voicemail` and call log entry `voicemail`.
2. **Claimed Mode Dialing:**
   - Open Call Mode on a list of claimed leads.
   - Choose a status, type a note, select *Tomorrow* callback, and click *Save & next*.
   - **Verification:** Drawer advances immediately. Network tab shows a single call to `POST /leads/disposition`.
3. **Undo Safety:**
   - Click a disposition chip on a prospect.
   - Immediately click *Undo* on the bottom banner.
   - **Verification:** Lead is returned to Prospect view via `leads/return-to-prospect`, outcome reset.
