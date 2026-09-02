# DME Desk Prospector Master Plan

**Last updated: 2026-08-25**

---

## Current objective

Build stable lead identity grouping and provider change tracking so that
duplicate claims, ownership conflicts, name changes, phone changes, and
Medicare data updates are all caught, logged, and surfaced for review —
before any new import or reassignment happens.

---

## Working rules

- Do not import a lead until its NPI passes duplicate and owner preflight.
- Do not reassign an existing claim without an explicit approved owner decision.
- Ignore rows with `SUB = SUB`, Entourage Me UAE, George, and Russ according to the audit rules.
- Jane maps to Kaity James.
- Normalize phone fields by extracting the first valid 10-digit number from mixed text or multi-phone cells.
- Treat same NPI as a definite duplicate; treat same identity group as a review signal.
- A fuzzy name match alone is never enough to auto-group — it requires at least one corroborating signal (phone, authorized official, or address).
- Every ownership change (claim, reassign, release) must produce an auditable event.
- Every provider field change from an NPPES or Medicare refresh must be logged before the field is overwritten.

---

## Phases

### Phase 1 — File organization ✅ DONE

Move working CSV/Python artifacts into `temp/`; keep `PIS_TO_RESOLVE.csv`
in the root as the active manual-resolution file.

**Completed 2026-08-25:** moved audit SQL files, `BD_MEETINGS_AUDIT.md`,
`findings.md`, `progress.md` to `temp/`.

### Phase 2 — BD Meetings reconciliation ✅ DONE

Resolve duplicate workbook rows and owner conflicts using the meeting
owner. 319 source rows reconciled: 191 resolved, 86 unresolved, 42
ignored. Remaining cases documented in `PIS_TO_RESOLVE.csv`.

### Phase 3 — NPI data consolidation ✅ IN PROGRESS

Migrate `npi_records` from the fakeNPI project into the dmedesk-prospector
Supabase project so all data lives in one place.

**Status:** migration script (`scripts/migrate_npi_records.py`) running.

### Phase 4 — Lead identity grouping (NEXT)

Create a stable identity group per real-world provider entity that
persists across name changes, phone changes, and NPI reassignments.

**Data model (4 new tables + 1 alter):**

| Table | Purpose |
|---|---|
| `lead_groups` | One row per real-world provider entity |
| `lead_group_members` | Links NPIs to a group (`primary`, `alias`, `possible_duplicate`, `possible_successor`, `confirmed_successor`) |
| `lead_ownership_events` | Append-only audit log — claim, reassign, release, provider_data_changed |
| `provider_field_history` | Append-only log of every field change from every NPPES/Medicare refresh |
| `leads.group_id` (new column) | FK to `lead_groups` |

**Grouping algorithm — two tiers:**

1. **Tier 1 (auto-group):** strict normalized key — `normalized_name + state + authorized_official + first_10_digit_phone`. High confidence, no review needed.
2. **Tier 2 (flag for review):** RapidFuzz `token_sort_ratio ≥ 88` on stripped names, gated by at least one corroborating signal (phone, official, or address). Flagged as `possible_duplicate`.

**One-time migration steps:**
1. Compute identity keys against `npi_records` in our Supabase project.
2. Create `lead_groups` rows — one per unique identity key among NPIs in `leads`.
3. Populate `lead_group_members` — link each `leads.npi` to its group.
4. Backfill `leads.group_id`.
5. Backfill `lead_ownership_events` — one `claimed` event per existing `leads` row.
6. Run Tier 2 fuzzy matching, write `possible_duplicate` entries for review.

### Phase 5 — Claim flow hardening

Update the Worker so every claim, reassign, and release writes auditable
events and respects group-level conflict checks.

**Claim (`POST /leads/:npi/claim`):**
- Look up or create a `lead_groups` row.
- Check if any NPI in the same group is already claimed by a different user → block and surface for review.
- Write a `lead_ownership_events` row.

**Reassign:**
- Require `approved_by` on the event.
- Write `lead_ownership_events` with `from_user_id` and `to_user_id`.

**Release / Disconnect:**
- Write `lead_ownership_events` with `event_type = 'released'`.

**New endpoints:**

| Route | Purpose |
|---|---|
| `GET /leads/:npi/group` | Group members + ownership history |
| `GET /groups/:id/history` | Full event log for a group |
| `POST /groups/:id/members` | Admin: manually link/confirm/dismiss a group member |

### Phase 6 — NPPES & Medicare refresh tracking

Track all provider field changes from weekly NPPES updates and monthly
Medicare DMEPOS releases. The import mechanism itself is out of scope for
this plan — this phase covers the data model and change-detection logic.

**Update cadence:**

| Source | Frequency | Content |
|---|---|---|
| NPPES weekly update | Weekly (Mon) | Any field on existing NPIs + new NPIs |
| NPPES monthly full dissemination | Monthly | Complete dataset |
| Medicare DMEPOS supplier file | Monthly | Claims, beneficiaries, payment |

**How a refresh run works:**
1. Load new data into a staging area.
2. Compare each tracked field against `npi_records`.
3. For changed fields: write a `provider_field_history` row, then update `npi_records`.
4. For new NPIs: insert into `npi_records`, write `provider_field_history` with `old_value = null`.
5. Tag every row with a `refresh_run_id`.

**Fields that escalate to the admin review queue** (create a `lead_ownership_events` alert):
- Phone changed
- Authorized official changed
- Organization name changed (also triggers re-grouping check)
- NPI deactivated
- City/state changed (territory shift)
- Medicare claims dropped >50% month-over-month

All other field changes log silently to `provider_field_history`.

### Phase 7 — Preflight & import

Check every accepted NPI from `PIS_TO_RESOLVE.csv` against the
now-hardened Supabase for existing claims, group conflicts, and owner
conflicts. Perform only explicitly approved clean imports or owner
changes.

---

## Current known state

- 319 source rows reconciled: 191 resolved, 86 unresolved, 42 ignored.
- Remaining decisions live in `PIS_TO_RESOLVE.csv`.
- Med Supplies Express identified as Selene meeting with existing Rick claim — documented for preflight.
- `npi_records` migration from fakeNPI to dmedesk-prospector Supabase project is running.
- Genome Insight → Inocras is the known `possible_successor` test case.
- Strict grouping produced 11,684 flagged rows in 4,695 groups.
- RapidFuzz 3.14.3 is installed for Tier 2 fuzzy matching.

---

## Completion criteria

- `PIS_TO_RESOLVE.csv` is reviewed and decisions are explicit.
- Every `leads` row has a non-null `group_id`.
- Claiming an NPI whose group has an active claim triggers a conflict (not a silent duplicate).
- Every claim, reassign, and release produces a `lead_ownership_events` row.
- A provider field change from an NPPES/Medicare refresh creates a `provider_field_history` row.
- High-signal changes (phone, official, name, deactivation, claims cliff) surface in the admin review queue.
- Accepted NPIs have passed Supabase duplicate/owner preflight.
- No unapproved claim is deleted, reassigned, or overwritten.
- Final import and reassignment logs are saved in `temp/`.

---

## Key design documents

| Document | Contents |
|---|---|
| `LEAD_GROUPING_PLAN.md` | Full DDL, algorithm details, Worker endpoint specs, open questions for colleague review |
| [`MASTER_PLAN_NAME_HISTORY_ADDENDUM.md`](./documentation/plans/MASTER_PLAN_NAME_HISTORY_ADDENDUM.md) | Name alias, successor link, and ownership event design principles |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Current system architecture |
| [`MIGRATION_TO_VERCEL_SUPABASE.md`](./MIGRATION_TO_VERCEL_SUPABASE.md) | Original Supabase schema and migration plan |
| [`SUPABASE_CHANGELOG.md`](./SUPABASE_CHANGELOG.md) | All Supabase changes to date |
