# DME Desk Prospector Master Plan

**Last updated: 2026-09-02**

---

## Current objective

Build stable lead identity grouping and provider change tracking so that
duplicate claims, ownership conflicts, name changes, phone changes, and
Medicare data updates are all caught, logged, and surfaced for review —
before any new import or reassignment happens.

---

## How this is being built

**Build each piece first, connect it to the live app second.**

The database foundation for identity grouping and audit history is already
installed and populated in production, and no application code reads it
yet. That is intentional, not an unfinished step. Each layer gets built and
proven in isolation, and wiring it into the running app is always a
separate, reviewable change.

What that means in practice:

- Schema changes are **additive first**: new tables and nullable columns,
  no drops, no renames, no changes to existing indexes or uniqueness rules.
- Data is **backfilled and verified** before any code depends on it.
- The app **keeps running on the old path** until the new path is proven.
- Constraints get **tightened last** — e.g. `leads.group_id` stays nullable
  until verification proves every lead has a valid group.

So a phase below can be "done" in the database and still show no change in
the app. That is the expected state during this work, and the status table
in each phase says which half is which.

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
- All Supabase changes are delivered as reviewed SQL files and executed manually; read-only verification follows every mutating step.

---

## Phase status at a glance

| Phase | Scope | Database | Application |
|---|---|---|---|
| 1 | File organization | — | ✅ done |
| 2 | BD Meetings reconciliation | — | ✅ done |
| 3 | NPI data consolidation | ✅ `npi_records` copied over | ⬜ Worker still uses fakeNPI |
| 4 | Lead identity grouping | ✅ schema + Tier 1 backfill applied | ⬜ nothing reads it yet |
| 5 | Claim flow hardening | 🟡 conflict-resolution RPC written, not run | 🟡 admin conflict queue built |
| 6 | NPPES & Medicare refresh tracking | 🟡 NPPES staging written, not run; apply step missing | 🟡 NPPES ingestion CLI built |
| 7 | Preflight & import | ⬜ not started | ⬜ not started |

---

## Phases

### Phase 1 — File organization ✅ DONE

Move working CSV/Python artifacts into `temp/`; keep `PIS_TO_RESOLVE.csv`
in the root as the active manual-resolution file.

**Completed 2026-08-25:** moved audit SQL files, `BD_MEETINGS_AUDIT.md`,
`findings.md`, `progress.md` to `temp/`.

**Extended 2026-09-02:** project Markdown reorganized per
`MARKDOWN_ORGANIZATION_PLAN.md` — feature plans to `documentation/plans/`,
reviews to `documentation/reviews/`, operational logs to
`documentation/operations/`, historical notes to `temp/archive/`, audits to
`temp/audits/`. Canonical entry points and the active planning files
(`task_plan.md`, `findings.md`, `progress.md`) stay at the root.

### Phase 2 — BD Meetings reconciliation ✅ DONE

Resolve duplicate workbook rows and owner conflicts using the meeting
owner. 319 source rows reconciled: 191 resolved, 86 unresolved, 42
ignored. Remaining cases documented in `PIS_TO_RESOLVE.csv`.

### Phase 3 — NPI data consolidation 🟡 DATA DONE, CUTOVER PENDING

Migrate `npi_records` from the fakeNPI project into the dmedesk-prospector
Supabase project so all data lives in one place.

**Done:** `npi_records` exists in the DME Desk project
(`pcvyrkisvvtiteoiuplg`) using fakeNPI-compatible column names, and the
identity columns the grouping work depends on were verified present: `npi`,
`name`, `address_state`, `authorizedofficial_firstname`,
`authorizedofficial_lastname`, `phone`, `authorizedofficial_phone`.

**Not done — the application cutover.** `worker/src/services/nppes.js`
still queries the fakeNPI Edge Function on the *separate* fakeNPI project
via `FAKENPI_BASE_URL`. Until that changes, the app's data and the app's
provider search live in two different Supabase projects.

Remaining work:

- Add a Worker repository that queries same-project `npi_records` directly
  through the existing service-role client.
- Preserve the current normalized provider/search response shape so
  `docs/app.js` needs no rewrite.
- Account for what fakeNPI's Edge Function currently does for us — notably
  joining `npi_cms_enrichment` into every result, which is why
  `services/cms.js` is no longer a live lookup.
- Retire the cross-project dependency once search is proven against the
  local table.

The one-off loader referenced during this phase
(`scripts/migrate_npi_records.py`) is gitignored and not part of the
repository; recurring imports are Phase 6's ingestion CLI, not that script.

### Phase 4 — Lead identity grouping 🟡 DATABASE DONE, UNUSED BY THE APP

Create a stable identity group per real-world provider entity that
persists across name changes, phone changes, and NPI reassignments.

**Data model (5 new tables + 1 alter) — ✅ applied via `sql/001_identity_schema.sql`:**

| Table | Purpose |
|---|---|
| `lead_groups` | One row per real-world provider entity |
| `lead_group_members` | Links NPIs to a group (`primary`, `alias`, `possible_duplicate`, `possible_successor`, `confirmed_successor`) |
| `lead_ownership_events` | Append-only audit log — claim, reassign, release, provider_data_changed, conflict_detected |
| `provider_field_history` | Append-only log of every field change from every NPPES/Medicare refresh |
| `refresh_runs` | One row per import/apply run; stamped onto history rows |
| `leads.group_id` (new column) | Nullable FK to `lead_groups` |

Applied alongside it: supporting indexes, RLS on all five new tables,
`anon`/`authenticated` revoked, and `BEFORE UPDATE OR DELETE` triggers that
make both history tables genuinely append-only.

**Grouping algorithm — two tiers:**

1. **Tier 1 (auto-group) — ✅ implemented in SQL and executed.** Strict
   normalized key: `normalized_name + state + authorized_official +
   first_10_digit_phone`. High confidence, no review needed. Where any
   signal is missing it creates a singleton group (`singleton:<npi>`)
   rather than guessing.
2. **Tier 2 (flag for review) — ⬜ not started.** RapidFuzz
   `token_sort_ratio ≥ 88` on stripped names, gated by at least one
   corroborating signal (phone, official, or address). Writes
   `possible_duplicate` rows for review only; never auto-groups.

**One-time migration steps — ✅ steps 1–5 done via `sql/002_identity_backfill_safe.sql`:**

1. ✅ Compute identity keys against `npi_records` in our Supabase project.
2. ✅ Create `lead_groups` rows — one per unique identity key among NPIs in `leads`.
3. ✅ Populate `lead_group_members` — link each `leads.npi` to its group.
4. ✅ Backfill `leads.group_id`.
5. ✅ Backfill `lead_ownership_events` — one `claimed` event per existing claimed `leads` row.
6. ⬜ Run Tier 2 fuzzy matching, write `possible_duplicate` entries for review.

The backfill is rerun-safe: it uses `ON CONFLICT (npi) DO NOTHING` so a
reviewed membership decision is never overwritten. The earlier draft,
`sql/002_identity_backfill.sql`, is **superseded — do not run it.**

**Still to do in this phase:**

- Tier 2 fuzzy review generation (RapidFuzz 3.14.3 is installed).
- A reusable grouping/preflight implementation rather than a one-time SQL
  backfill, with tests against the Genome Insight → Inocras
  possible-successor case and the Jane → Kaity James mapping.
- Resolve the two group-level ownership conflicts the backfill surfaced
  (see *Current known state*).
- Only after verification holds: consider making `leads.group_id` NOT NULL.

### Phase 5 — Claim flow hardening 🟡 CONFLICT REVIEW BUILT, CLAIM PATH NOT STARTED

Update the Worker so every claim, reassign, and release writes auditable
events and respects group-level conflict checks.

**Done — the admin conflict review queue (2026-09-02).** Group-level
ownership conflicts now surface in the Admin tab and can be resolved there:

- `GET /admin/conflicts` lists identity groups whose active claims are split
  across more than one person. It aggregates in the Worker from tables that
  already exist, so it works whether or not the SQL below is installed.
- `POST /admin/conflicts/resolve` assigns a group to one owner. It calls
  `public.resolve_ownership_conflict()`
  (`sql/005_ownership_conflict_resolution.sql`) so the conflict check, the
  reassignment and the audit events are one transaction — the approving
  admin comes from the session, and a reason is required.
- No owner is pre-selected in the UI: choosing one *is* the decision, and a
  default would quietly become the answer.
- Claims that move keep their `claimed_at`, status, notes and reminders; only
  `claimed_by` changes, and every move writes a `reassigned` event carrying
  the approver and the reason.

**Still not started — the claim path itself.**

**Prerequisite — an atomic database-side operation.** Claiming today is a
read-then-insert in `worker/src/repos/leadsRepo.js`
(`exportCompaniesToLeads`), so two concurrent requests can both pass the
pre-check before either inserts. That is survivable for the exact-NPI rule
because the partial unique index `idx_leads_npi_claimed_by_active`
backstops it in the database. A group-level check has no such backstop, so
it must be one SQL function/RPC that does conflict check + insert + event
write in a single transaction — not another sequence of REST calls.

**Claim (`POST /leads/:npi/claim`):**
- Look up or create a `lead_groups` row.
- Check if any NPI in the same group is already claimed by a different user → block and surface for review.
- Write a `lead_ownership_events` row.

**Reassign:**
- Admin only. Require `approved_by` on the event.
- Write `lead_ownership_events` with `from_user_id` and `to_user_id`.

**Release / Disconnect:**
- Write `lead_ownership_events` with `event_type = 'released'`.
- Decide explicitly how the existing `/leads/disconnect` and
  `/leads/return-to-prospect` behaviour maps onto release events —
  return-to-prospect currently *deletes* the row, which loses history.

**New endpoints:**

| Route | Purpose |
|---|---|
| `GET /leads/:npi/group` | Group members + ownership history |
| `GET /groups/:id/history` | Full event log for a group |
| `POST /groups/:id/members` | Admin: manually link/confirm/dismiss a group member |

**Compatibility requirements while this lands:**
- Existing routes must keep working with `group_id` null.
- A group conflict must return an explicit, reviewable error — never a
  silent claim failure and never an automatic reassignment.
- New admin endpoints are server-side gated on `session.isAdmin`; hiding a
  frontend tab is not an authorization control.

### Phase 6 — NPPES & Medicare refresh tracking 🟡 INGESTION BUILT, APPLY STEP MISSING

Track all provider field changes from weekly NPPES updates and monthly
Medicare DMEPOS releases.

**Already in place:** `refresh_runs`, `provider_field_history`, and
`lead_ownership_events` (which carries the review alerts). Both history
tables are append-only at the database level.

**Done — NPPES ingestion (2026-09-02).** `scripts/nppes_ingest` is a
repository-owned, dependency-free Python CLI replacing the hardcoded
personal-machine `nppes_filter.py`. It handles all three NPPES run types,
reads enabled taxonomy codes from `public.taxonomies`, validates every NPI
against the CMS check digit, rejects duplicates, guards against a truncated
release, checksums the source, writes a manifest and a rejects report, and
stages rows under one `refresh_runs` row — rolling the run back and marking
it `failed` if staging breaks partway. Its staging table is
`sql/004_nppes_refresh_staging.sql`. 24 tests cover it. See
[`scripts/README.md`](./scripts/README.md).

The CLI writes **only** `refresh_runs` and `nppes_refresh_staging`. It never
writes `npi_records` and never writes `leads` — that boundary is the whole
point of staging.

**Not in place:** the transactional apply step (compare → history → update),
the Medicare current-data model, and Medicare staging/ingestion. No monthly
import should touch `npi_records` or claimed-lead snapshots until they
exist; staging a release on its own is safe precisely because nothing
downstream happens automatically.

**Update cadence:**

| Source | Frequency | Content |
|---|---|---|
| NPPES weekly update | Weekly (Mon) | Any field on existing NPIs + new NPIs |
| NPPES monthly full dissemination | Monthly | Complete dataset — reconciliation run |
| NPPES deactivation file | Monthly | Deactivated NPIs, handled as its own source type |
| Medicare DMEPOS supplier file | Monthly | Claims, beneficiaries, payment |

**How a refresh run works:**
1. Create a `refresh_runs` row (source, version, checksum, row count) with status `staged`.
2. Load new data into a staging table — never straight into `npi_records`.
3. Compare each tracked field against `npi_records` using canonical values (trimmed, case-folded, first valid 10-digit phone, dates as dates, numerics as numerics, null and empty text treated consistently) so formatting-only changes create no false history.
4. For changed fields: write a `provider_field_history` row, *then* update `npi_records`.
5. For new NPIs: insert into `npi_records`, write history with `old_value = null`.
6. Update only provider-owned snapshot fields on affected active `leads`.
7. Tag every row with the `refresh_run_id`; mark the run `applied` only after all checks pass.

Steps 3–7 must run in one transaction. On any failure, roll back and mark
the run `failed`.

**The import must never touch** `claimed_by`, `claimed_at`, `status`,
`notes`, `reminder_at`, or `is_disconnected`. A name or phone change
requests group re-evaluation as a review operation; it must never silently
move a lead between groups.

**Fields that escalate to the admin review queue** (a
`lead_ownership_events` row with `event_type = 'provider_data_changed'`,
`requires_review = true`, `review_status = 'pending'`):
- Phone changed
- Authorized official changed (name, title, or phone)
- Organization name changed (also triggers a re-grouping review)
- NPI deactivated / status changed
- City/state changed (territory shift)
- Medicare claims dropped >50% month-over-month

All other field changes log silently to `provider_field_history`.

**Remaining work:**
- ✅ `nppes_refresh_staging` keyed by `(refresh_run_id, npi)` — `sql/004`, written, not yet run.
- ✅ The NPPES ingestion CLI and its fixture tests.
- ⬜ The transactional apply procedure: compare canonical values, insert `provider_field_history` before updating `npi_records`, update only provider-owned snapshot fields on affected active leads, raise review events, and mark the run `applied` — all in one transaction.
- ⬜ `medicare_refresh_staging`, a canonical current-Medicare model, and Medicare ingestion.
- ⬜ Reconciliation/validation queries beyond the per-file checks already in `sql/004`.
- ⬜ A first end-to-end rehearsal against a small real release before any full file is applied.

Full design: [`documentation/plans/PROVIDER_CHANGE_TRACKING_PLAN.md`](./documentation/plans/PROVIDER_CHANGE_TRACKING_PLAN.md).

### Phase 7 — Preflight & import ⬜ NOT STARTED

Check every accepted NPI from `PIS_TO_RESOLVE.csv` against the
now-hardened Supabase for existing claims, group conflicts, and owner
conflicts. Perform only explicitly approved clean imports or owner
changes, and save the import/reassignment logs in `temp/`.

`PIS_TO_RESOLVE.csv` stays untouched until its decisions are explicit.

---

## Recommended order of remaining work

1. ✅ Python NPPES ingestion CLI + fixture tests (Phase 6).
2. 🟡 Staging SQL written (`sql/004`); the transactional apply step is next, tested against a small fixture (Phase 6).
3. ⬜ Worker queries same-project `npi_records` directly, preserving response shapes (Phase 3 cutover).
4. ⬜ Refresh verification reports and provider-change review events (Phase 6).
5. 🟡 The two ownership conflicts are decided (`sql/006`, pending execution); the group-aware atomic claim is still to build (Phases 4 and 5).
6. 🟡 Admin conflict review queue is live; reassign/release and group/history endpoints remain (Phase 5).
7. ⬜ Medicare staging and monthly change tracking (Phase 6).
8. ⬜ Preflight and the approved imports from `PIS_TO_RESOLVE.csv` (Phase 7).
9. ⬜ Scheduled runs, only after manual runs are proven reliable.

---

## Current known state

**Reconciliation (Phase 2):** 319 source rows reconciled — 191 resolved, 86
unresolved, 42 ignored. Remaining decisions live in `PIS_TO_RESOLVE.csv`.
Med Supplies Express is identified as a Selene meeting with an existing
Rick claim, documented for preflight.

**Identity backfill (Phase 4), verified 2026-08-31:**

| Check | Result |
|---|---:|
| Total leads | 4,599 |
| Leads without `group_id` | 0 |
| Unique NPIs / total memberships | 4,495 / 4,495 |
| Strict groups | 4,168 |
| Singleton groups | 315 |
| Duplicate NPI memberships | 0 |
| Historical `claimed` events inserted | 3,494 |
| Claimed leads missing a historical claim event | 0 |
| Exact-NPI active ownership conflicts | 0 |
| Group-level active ownership conflicts | **2 groups** |

The gap between 4,599 leads and 4,495 NPIs is historical/disconnected rows
sharing an NPI; each NPI has exactly one membership. (An earlier
exploratory pass reported 11,684 flagged rows in 4,695 groups — that was a
pre-backfill estimate and is superseded by the figures above.)

**Ownership conflicts — decided 2026-09-02, not yet applied.** The backfill
did not create or change these; it exposed them. Both now have an explicit
approved owner decision, written as SQL in
`sql/006_resolve_known_conflicts.sql` and awaiting manual execution.

| Group | NPIs | Was | Decision |
|---|---|---|---|
| 1FOOT 2FOOT Centre for Foot and Ankle Care, PC (VA) | `1548921265`, `1831477868` | Rick Nelson; Kaity James | **Rick Nelson** |
| Advanced Home Medical Supplies Inc. (CT) | `1598747552`, `1891506093` | Nora Atkins; Rick Nelson | **Nora Atkins** |

Any conflict found from here on — including any the next backfill or refresh
surfaces — appears in the Admin tab's ownership-conflict queue and is
resolved there, with the approver and reason recorded on every move. This
one-time SQL file exists only because these two predate that queue.

**Other:**
- Genome Insight → Inocras is the known `possible_successor` test case.
- RapidFuzz 3.14.3 is installed for Tier 2 fuzzy matching.
- No existing claim, status, note, reminder, or provider snapshot has been
  overwritten by any of this work.

---

## Completion criteria

Ticked items are verified; the rest are open.

- [ ] `PIS_TO_RESOLVE.csv` is reviewed and decisions are explicit.
- [x] Every `leads` row has a non-null `group_id`. *(Verified 2026-08-31; the column stays nullable until the app depends on it.)*
- [ ] Claiming an NPI whose group has an active claim triggers a conflict (not a silent duplicate).
- [ ] Every claim, reassign, and release produces a `lead_ownership_events` row. *(Historical claims are backfilled; live writes are Phase 5.)*
- [ ] A provider field change from an NPPES/Medicare refresh creates a `provider_field_history` row.
- [ ] High-signal changes (phone, official, name, deactivation, territory, claims cliff) surface in the admin review queue.
- [ ] Accepted NPIs have passed Supabase duplicate/owner preflight.
- [x] No unapproved claim is deleted, reassigned, or overwritten. *(Holds to date and must keep holding.)*
- [x] The two known group-level ownership conflicts have explicit approved decisions. *(Decided 2026-09-02; `sql/006` written, execution pending.)*
- [ ] Final import and reassignment logs are saved in `temp/`.

---

## Key design documents

| Document | Contents |
|---|---|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | How the live system works today — Worker + Supabase + `docs/`, and what's built but not yet connected |
| [`documentation/plans/PROVIDER_CHANGE_TRACKING_PLAN.md`](./documentation/plans/PROVIDER_CHANGE_TRACKING_PLAN.md) | Full NPPES/Medicare refresh design: staging, comparison, history-before-update, review alerts, safety gates |
| [`documentation/plans/MASTER_PLAN_NAME_HISTORY_ADDENDUM.md`](./documentation/plans/MASTER_PLAN_NAME_HISTORY_ADDENDUM.md) | Name alias, successor link, and ownership event design principles |
| [`documentation/plans/NAME_CHANGE_OWNERSHIP_PLAN_DRAFT.md`](./documentation/plans/NAME_CHANGE_OWNERSHIP_PLAN_DRAFT.md) | Earlier draft of the rename/successor model, including the open questions still worth answering |
| [`documentation/reviews/IMPLEMENTATION_REVIEW.md`](./documentation/reviews/IMPLEMENTATION_REVIEW.md) | Backward-compatibility review and the SQL/application guardrails for the rest of this work |
| [`documentation/reviews/EDIT_OVERVIEW.md`](./documentation/reviews/EDIT_OVERVIEW.md) | What was added/changed, and what was deliberately left alone |
| [`documentation/operations/WORKLOG.md`](./documentation/operations/WORKLOG.md) | Chronological record of work performed and database results |
| [`documentation/operations/CHAT_HISTORY_2026-09-02.md`](./documentation/operations/CHAT_HISTORY_2026-09-02.md) | Durable handoff: decisions, verification output, and the intended unified architecture |
| [`sql/README.md`](./sql/README.md) | SQL execution order and manual-run notes |
| [`scripts/README.md`](./scripts/README.md) | NPPES ingestion CLI: usage, run types, safety guards, and the boundary it will not cross |
| [`MIGRATION_TO_VERCEL_SUPABASE.md`](./MIGRATION_TO_VERCEL_SUPABASE.md) | Original Supabase schema and migration plan |
| [`SUPABASE_CHANGELOG.md`](./SUPABASE_CHANGELOG.md) | All Supabase changes to date |
| [`MARKDOWN_ORGANIZATION_PLAN.md`](./MARKDOWN_ORGANIZATION_PLAN.md) | Where each document lives and why |

`LEAD_GROUPING_PLAN.md` is referenced in earlier notes as holding the full
DDL and endpoint specs. It is an external working document and is **not in
this repository**; the schema it described is now in
`sql/001_identity_schema.sql`, and the endpoint specs are in Phase 5 above.
