# Prospector — Unconfirmed Suggestions

> These are ideas under consideration — **not yet approved for the plan.**
> Move to `FEATURE_PLAN.md` when confirmed.

---

## Suggestion A — Cooldown / Suppress-Today system

**Source:** DME Dialer §1.5 — Smart Filter / Cooldown
**Status:** Suggested (2026-10-06)

### The idea

After a rep encounters a fresh NPPES lead in Prospect mode (claims it, skips it, or just pages past it), suppress that lead from re-appearing for a configurable window — `4h / 8h / Today / Off`. Prevents a rep from accidentally dialling the same unclaimed lead twice in the same session.

### Why it is not in the plan yet

The Prospector's primary dedup mechanism is the claimed-lead system: once someone claims a lead it disappears from everyone else's Prospect results. For a solo rep, re-encountering the same unclaimed lead is possible but not frequent given NPPES result pagination. Worth revisiting if multi-rep scenarios make it a real pain point.

### Implementation sketch (if confirmed)

- Entirely client-side using `localStorage` — no Supabase changes needed.
- On each result returned, check if the NPI is in the local cooldown store.
- A settings toggle controls the window (`4h / 8h / Today / Off`).
- Key: `dmeProspectorCooldown` → `{ [npi]: expiresAtMs }`

---

## Suggestion B — Google Search shortcut per lead

**Source:** DME Dialer §1.3 — Google Search button
**Status:** Suggested (2026-10-06)

### The idea

A small "Google" icon link in each lead's detail row that opens:
`https://www.google.com/search?q=Company+Name+City+State+DME`

### Why it is not in the plan yet

The existing AI call brief (`Generate call brief`) already provides researched context on demand. The Google link is redundant for most use cases and adds visual noise to the detail row.

### Keep if

- Reps find the AI brief too slow and want a quick manual fallback.
- A detail row redesign creates space for it without clutter.

---

## Suggestion C — Google Sheets two-way sync (BD Meetings + Disconnected)

**Source:** User request 2026-10-06
**Status:** Suggested — not yet approved for plan

### The idea

Two separate sync channels between the Prospector and the shared Google Sheets workbook:

#### Channel 1 — BD Meetings claim sync (one-way: Prospector → Sheet)

When a rep claims a lead in the Prospector, automatically append it to the **BD Meetings** sheet tab (in addition to the existing per-rep "Claimed - Name" tab the current code already writes to).

- **Direction:** Prospector → Sheet (write-only)
- **Trigger:** Existing `POST /api/export/sheets` claim action
- **Target:** A shared "BD Meetings" tab in `GOOGLE_SHEET_ID` (or a second sheet ID configured as `GOOGLE_BD_MEETINGS_SHEET_ID`)
- **What it writes:** Same column layout as the existing claimed-tab export, but into a single shared tab instead of a per-rep tab

#### Channel 2 — Disconnected tab two-way sync

Keeps the Prospector's `Disconnected` status in step with the **Disconnected tab** in the BD 2026 Google Sheet.

| Direction | Trigger | Action |
|---|---|---|
| Prospector → Sheet | A lead is marked `Disconnected` in the Prospector (via `sendDisconnectedBtn` or call mode) | Append that NPI row to the Sheet's Disconnected tab |
| Sheet → Prospector | Admin/scheduled pull reads the Disconnected tab from the Sheet | Any NPI found there that isn't already `Disconnected` in Supabase is bulk-updated |

### What already exists

The Prospector already has a working OAuth-based Sheets write path in `worker/src/services/googleSheets.js`:
- `getAccessToken()` — OAuth refresh token flow
- `sheetsApi()` — generic fetch wrapper for the Sheets v4 API
- `ensureUserTab()` / `appendRows()` — tab creation + row appending
- `exportCompaniesToSheet()` / `exportLeadsToSheet()` — the two existing export functions

Reading from a sheet (Sheet → Prospector direction) is not yet implemented. The Sheets v4 `GET .../values/:range` endpoint uses the same `sheetsApi()` wrapper — it just needs a read path added.

### What needs building

**Channel 1 (BD Meetings write):**
- New env var: `GOOGLE_BD_MEETINGS_SHEET_ID` (or reuse `GOOGLE_SHEET_ID` with a fixed tab name like `"BD Meetings"`)
- New function in `googleSheets.js`: `exportClaimToBdMeetings(config, company, session)` — same as `exportCompaniesToSheet` but targets the shared BD Meetings tab
- Call it from the existing claim handler in `index.js` after the Supabase claim succeeds (best-effort — if Sheets fails, the Supabase claim still stands)

**Channel 2 (Disconnected sync):**

*Prospector → Sheet (already partially exists via `sendDisconnectedBtn`):*
- Extend the existing `POST /api/leads/send-disconnected` (or equivalent) to also `appendRows` to the Disconnected tab in the BD 2026 sheet

*Sheet → Prospector (new — pull direction):*
- New worker route: `POST /api/admin/sync/disconnected-from-sheet` (admin-only)
- Reads the Disconnected tab from the BD 2026 sheet via `GET .../values/Disconnected!A:Z`
- Parses rows, extracts NPIs
- Bulk-updates matching Supabase leads to `status = "Disconnected"` where not already set
- Returns a summary: `{ updated: N, alreadyDisconnected: M, notFound: K }`

### Open questions before approving

1. **Is the BD Meetings tab in the same spreadsheet as `GOOGLE_SHEET_ID`?** If yes, no new env var needed — just a fixed tab name. If a different spreadsheet, needs `GOOGLE_BD_MEETINGS_SHEET_ID`.
2. **Is the BD 2026 Disconnected sheet in the same spreadsheet or a different one?** Needs its own `GOOGLE_BD2026_SHEET_ID` if separate — the refresh token owner must have edit access to it.
3. **Sheet → Prospector pull frequency:** Manual admin trigger (safest), or automatic on a schedule? Automatic requires a Cloudflare Cron Trigger in `wrangler.toml`.
4. **Column mapping for the Disconnected tab:** The existing BD 2026 sheet layout may differ from the Prospector's CSV column order — needs a one-time column map before implementation.
5. **Dedup on append:** Should the write direction check if the NPI is already in the Disconnected tab before appending (to avoid duplicate rows)?

### Effort estimate

| Piece | Effort |
|---|---|
| Channel 1 BD Meetings write | Low — ~30 lines, reuses all existing Sheets infrastructure |
| Channel 2 Prospector → Sheet | Low — extend existing disconnect action |
| Channel 2 Sheet → Prospector pull | Medium — new read path + bulk Supabase update, column mapping needed |
| Cron trigger (if automatic) | Low — one line in `wrangler.toml` |
