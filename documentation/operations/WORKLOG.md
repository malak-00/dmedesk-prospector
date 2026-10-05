# DME Desk Prospector Worklog

## 2026-10-05 — Scoring removed; search switched to DME Desk's own table for everyone

### Objective

Remove lead scoring completely (it only measured how complete a provider's data was),
read search from DME Desk's own provider table for all reps, and make sure a deploy
can never silently undo that setting.

### Actions Completed

- **Scoring removed:** Worker (`lib/scoring.js` deleted, no scoring in search, the
  call-brief prompt, lead inserts or the DTO), frontend (score column, ring, tooltip,
  badges, "High fit" and "Average score" cards, "why this lead" tags, minimum-score
  filter, "best fit first" sort, "High fit" quick pick, and the dead CSS), and SQL
  (`sql/024_remove_scoring.sql`, **not yet run**: replaces `provider_filter_sql()` and
  `search_providers_v2()` without score, drops `provider_score_sql()`; functions only).
- **Kept deliberately:** `leads.score_value` / `score_percentage` columns and data
  (dropping a column is irreversible); the Google Sheet "Score" and "Score %" columns,
  written empty, so later columns keep their positions for external readers.
- **Deleted before ever being run:** the stored-score table work (`sql/023_*`, which
  measured 125 MB, then ~47 MB, on a 500 MB free plan). No longer needed.
- **Source switch:** `worker/wrangler.toml` now has `keep_vars = true` and
  `[vars] NPI_SOURCE = "dmedesk"`. Every DME Desk search uses `search_providers_v2()`;
  a specialty with no code matches nothing; "Search more" bookmarks are kept per source
  (a rep's first DME Desk search restarts at the top but skips what they had seen; their
  mirror bookmarks are untouched, so rollback loses nothing).
- New defaults: sort is "Default order" (NPI order, fast); other sorts are Medicare
  activity, recently updated and name. Prospect gained a Specialty column.
- Tests: Worker 51 pass; SQL 44 checks (021, 022, 024 in order) on a throwaway
  Postgres; frontend linted with ESLint (no undefined or unused names).

### Database / System Result

- **No SQL was executed by the agent.** `sql/024` is functions-only and is run by the
  project owner. No data was changed or deleted.
- Worker deploy changes which source every rep's search reads from.

### Safety Status

- Claim, ownership and audit logic untouched. Old saved bookmarks are never modified.
- Rollback: set `NPI_SOURCE` to `"mirror"` in `wrangler.toml` and deploy.

## (earlier the same day) Smarter Prospect search (counts, quality filters, sorting, lookups) — live for admins (trial)

### Update 4 (same day): lean stored scores, light-theme contrast, specialty

- Free-plan size concern: the first `provider_scores` design measured 125 MB on a
  real Postgres with 380,000 realistic rows. Redesigned to ~47 MB (two small
  `(key, score)` indexes plus an exact two-step page lookup) and added
  `sql/023_provider_scores_uninstall.sql`. 023 is still **not run**. SQL tests:
  175 checks (including exact equality with the live search over ~100 filter and
  page combinations, edge pages, and the uninstall path); earlier suites still pass.
- Light theme rebuilt for contrast: tinted page/sidebar/table headers, white
  cards with visible borders and shadows, and colored text darkened until every
  pair clears the 4.5:1 readability minimum (the green status text was 3.0:1 on
  its own tint and white on the bright teal button 3.8:1). Checked numerically.
- Specialty: its own sortable column in Prospect and a visible tag in Claimed.
- No data changed; no deploy of the Worker needed (unchanged this round).

### Update 3 (same day): stored fit scores

- Measured the sorted search on the live database: 4.3 s cold, 0.18 s warm, on a
  Nano instance; the plan was correct, so the cost is scoring ~8,400 wide rows
  per search on a machine that cannot keep them cached.
- Added `sql/023_provider_scores.sql` (**not run**; optional): a narrow
  `provider_scores` table, stale-marking triggers, `refresh_provider_scores()`
  and a stored-score path inside `search_providers_v2()`. It is used only when
  fresh and only for searches it can answer exactly; otherwise nothing changes.
- Worker reports whether the stored scores are fresh (`/search/capabilities`).
  Tests: SQL 151 + 39 checks on a throwaway Postgres; Worker 50 pass.
- No data was changed. Follow-up: call `refresh_provider_scores()` from the
  monthly ingest.

### Update 2 (same day): layout, Territory and speed

- Search panel decluttered and made non-sticky (it covered the results table);
  quality filters, sort and quick picks in one collapsible section; source switch
  moved to the header; Territory redesigned with "Best bets".
- Added `sql/022_search_speed.sql` (**not run**; optional) and Worker changes that
  work with or without it: one-call quick-pick counts with a fallback, "at least"
  flags on capped counts, and a 30-second cache for identical count questions.
- SQL test: 39 checks with 021 and 022 installed on a throwaway Postgres.
  Worker tests: 48 pass.
- No data was changed.

### Update (same day)

- `sql/021` was run by the project owner. Worker deployed as version
  `b14c364c-c4f3-4887-b682-badb40849291`; frontend pushed.
- Added an **admin-only trial**: `X-Search-Source: dmedesk` is honoured for admin
  sessions only (`worker/src/lib/sourceTrial.js`), so admins can search DME Desk's
  own provider table while everyone else stays on the mirror. `NPI_SOURCE` is
  still unset on the live Worker (verified by comparing the bindings of the
  versions before and after this deploy: no plain-text variables existed).
- Worker tests: 45 pass across 6 files. No data was changed.
- Findings from the source comparison and the open items before a full switch
  are in `documentation/plans/SEARCH_INSIGHTS_PLAN.md`.

### Original entry (written before deployment)

### Objective

Stop reps guessing which filter combinations still hold leads: show how many
are left for them, explain and fix empty searches, add quality filters and
sorting that apply before paging, and widen the lookup box.

### Actions Completed

- `sql/021_search_insights.sql` (new, **not run**): read-only `search_insights()`,
  `search_territory()`, `search_providers_v2()`, `search_features()` and helpers.
  `search_providers()` (018) is untouched. Tested on a throwaway in-memory
  Postgres: `sql/tests/021_search_insights.test.mjs`, 35 checks.
- Worker: `lib/searchFilters.js`, `services/searchInsights.js`, new routes
  `GET /search/capabilities`, `/search/insights`, `/search/quickpicks`,
  `/search/territory`; `providerSearch.js` routes searches that use the new
  options to v2; `companyService.js` runs a sorted/filtered search as one query
  and keeps the database's order; phone and text lookups are one query with no
  paging memory. Searches using none of the new options take the original path.
- Search-progress fingerprints gain the new options only when set. Verified
  byte-identical to the committed version for existing-style searches.
- Frontend: availability line, suggestions, quick picks, progress bar, territory
  explorer, saved-search "new since" badges, quality-filter controls, sort
  select, and the smart lookup box (NPI / phone / ZIP / name or owner).
- Worker tests: 40 pass across 5 files (new: searchFilters, searchFlow, meetings).

### Database / System Result

- **No SQL was run and nothing was deployed.** All new database functions are
  read-only and rerun-safe; they write no table.
- Until `021` is run and searches read from DME Desk's own table
  (`NPI_SOURCE=dmedesk`), the new controls stay hidden and search is unchanged.

### Safety Status

- Claim, ownership and audit logic untouched. New functions are `security
  definer` with execute granted to `service_role` only, like 018. Every value
  reaches SQL through `%L` quoting (an injection attempt is a test case).
- Exclude keywords are never offered as a one-click "loosen" suggestion.

## 2026-10-05 — Lead cards v2, status/call-log merge, meetings (first slice)

### Objective

Make the expanded lead card useful on a call, stop status and "log call" from
repeating each other, and let reps book a meeting with a reminder, a contact
email and private opener notes.

### Actions Completed

- Prospect card: "Who to call" + "Company" with one filled Call button, the
  score as a small header badge, plain-language "why this lead" tags.
- Claimed card: "Log this call" work mode. The result chips are the lead's
  statuses, so one Save sets the status, writes the call-log entry, and can
  set a callback reminder; the table's status dropdown stays in sync.
- Meetings: `sql/020_lead_meetings.sql` (new, **not run**), Worker route
  `POST /leads/meeting`, `worker/src/lib/meetings.js` with tests, a booking
  modal, card section, Reminder-column badge, and notification. See
  `documentation/plans/MEETINGS_PLAN.md`.
- Fixed a regression from the sidebar CSS that showed the Admin tab to
  non-admins (the Worker already refused their admin requests).

### Database / System Result

- **`020` run by the project owner** in the Supabase SQL Editor, in the
  project the Worker uses (reported 2026-10-05; the agent did not run it and
  has not independently verified the result). It is additive (five nullable
  columns, check constraints, one trigger). An attempt to run it through the
  agent's Supabase connector was stopped: the only project that connector can
  see (`saleooperations`, ref `gnhwfulkkogtwqygmekg`) is a different
  application, so nothing was executed there.
- **Worker deployed 2026-10-05** (`dmedesk-prospector-api`, version
  `cabe0ccd-2edb-4668-9dbc-16e59889d338`). Until `020` is run, `POST
  /leads/meeting` answers 503 "Meetings aren't installed yet". Unauthenticated
  calls return 401 like the other lead routes.
- Worker tests: 23 pass (7 new for meeting validation).

### Safety Status

- No append-only table, claim, or ownership rule touched. Meeting data is
  cleared by trigger when ownership changes. No secrets involved.
- Frontend for cards v2 / status merge / meetings pushed after `020` was run.
  Manual browser verification of the live site is still pending.

## 2026-10-02 — Frontend UI refresh (sidebar dashboard + expanding lead cards)

### Objective

Modernize the browser UI: sidebar navigation with a dashboard feel (option B)
and card-style lead details that expand directly below the lead row (option C).

### Actions Completed

- `docs/index.html`: tabs became an icon sidebar with a Claimed count badge;
  added KPI strips (Prospect and Claimed), a collapsible filter bar with
  removable filter chips, a floating selection bar, and a Ctrl/Cmd+K quick
  actions palette. Cache-bust versions bumped (style v38, app v40).
- `docs/app.js`: lead detail rows now render as cards (header with avatar,
  call/website/brief actions; score breakdown, details, contacts, branches;
  Claimed adds reminder, meeting, call log). Existing data hooks and element
  ids (`data-brief-index`, `data-reminder-index`, `data-book-meeting-index`,
  notes handlers) are unchanged.
- `docs/style.css`: new rules appended at the end of the file; existing rules
  were left in place and layered over.
- Follow-up passes the same day: Inter + Plus Jakarta Sans typography, a
  rebuilt dark theme, cropped logo, removal of the "still being developed"
  banner, collapsible sidebar (remembered per browser), empty states, colored
  status pills, row signal icons and hover quick actions (copy phone, open
  site), saved searches and a Claimed column chooser (both stored in browser
  localStorage only), overdue-callback strip, comfortable/compact density,
  KPI skeletons and count-up, and a "last refreshed" label.

### Database / System Result

- No API, SQL, migration, or production data change. Frontend files only.
- Not deployed. Manual browser verification is still pending.

### Safety Status

- Claim/ownership logic, append-only audit behavior, and secrets untouched.
- Selection-bar and palette actions call the existing handlers; they add no
  new write paths.

## 2026-09-29 — Ownership-safe bulk merge for possible duplicates

### Objective

Allow admins to bulk-merge only possible-duplicate pairs whose current
ownership is unambiguous, while preserving an audit reason for every merge.

### Actions Completed

- Added Admin → Possible duplicates selection checkboxes and “Select all
  eligible” behavior across the full filtered queue, not only the visible page.
- Excluded cross-agent pairs from bulk selection while leaving the existing
  manual review action available.
- Added an admin-only Worker bulk-merge route that revalidates ownership on
  the server and processes pairs sequentially through the existing atomic
  `resolve_identity_match()` RPC.
- Generated automatic audit reasons for both-unclaimed, unclaimed/agent, and
  same-agent pairs; no ownership is changed by the merge.
- Added Worker unit coverage for the ownership eligibility and reason rules.
- Reconciled `MASTER_PLAN.md` with `sql/README.md`: migrations 005, 006, 008,
  009, and 010 are recorded as executed on 2026-09-16. Provider-refresh apply,
  Medicare follow-up, preflight/import, and remaining ownership APIs remain
  open work.

### Database / System Result

- No SQL migration or production data was changed.
- Each bulk pair still uses the existing append-only identity decision table
  and atomic merge function.

### Safety Status

- Server-side admin authorization and ownership revalidation are enforced.
- Cross-agent pairs are not eligible for bulk processing.
- Deployment and browser verification remain manual handoff steps.

## 2026-09-22 — Documentation structure and freshness audit

### Objective

Make the documentation tree unambiguous and distinguish current guidance from
historical planning notes, especially between `plans/` and `planning/`.

### Actions Completed

- Added `documentation/README.md` as the documentation index and status guide.
- Clarified that `plans/` holds stable specifications while `planning/` holds
  active or historical working notes.
- Updated the master plan, active checklist, and provider-refresh plan status
  dates and current search-cutover wording.
- Marked older findings, progress, and dated planning notes as historical.
- Corrected several relative links that incorrectly repeated
  `documentation/` or pointed from the wrong directory.
- Updated the repository README so the live Worker/Supabase architecture is
  no longer described as a migration in progress.

### Database / System Result

- No database, Worker, frontend, or SQL behavior changed.
- No production configuration or data was changed.

### Safety Status

- Documentation-only changes.
- Historical documents were retained rather than deleted.
- Remaining machine-specific links are confined to older historical notes and
  are tracked for a later link-cleanup pass.

## 2026-09-22 — Internal provider-search cutover handoff

### Objective

Document the remaining work needed to switch production search from the
fakeNPI HTTP mirror to the internal DME Desk provider-search implementation.

### Actions completed

- Added `documentation/operations/INTERNAL_PROVIDER_SEARCH_CUTOVER_HANDOFF.md`
  with the database, taxonomy, comparison, configuration, and rollback steps.
- Updated the Phase 3 section of `documentation/plans/MASTER_PLAN.md` to
  reflect that the internal Worker path is built and only production cutover
  remains.
- Updated `sql/README.md` so `018_provider_search.sql` is marked as awaiting
  production verification rather than describing the repository implementation
  as missing.

### Database / System Result

- No Docker commands were run.
- No SQL was executed.
- No Cloudflare variables were changed.
- Production remains on the mirror source until the laptop handoff steps are
  completed.

### Safety Status

- No data was deleted or modified.
- No production search behavior was changed.
- Rollback remains available through `NPI_SOURCE=mirror`.

## 2026-09-22 — Fix legacy taxonomy code resolution

### Objective

Prevent enabled taxonomy options shown by the frontend from being sent to
NPPES as rejected `taxonomy_description` values when their database row has a
blank Description column.

### Actions completed

- Updated `worker/src/repos/taxonomiesRepo.js` so description-to-code lookup
  falls back to `facility_type`, matching the frontend's `description ||
  facility_type` behavior.
- Kept code-based searching as the preferred path, including for legacy rows.
- Added a separate fallback lookup for unresolved facility-type labels without
  changing taxonomy data or executing SQL.

### Database / System Result

- No database records or schema were changed.
- Legacy rows with a valid code can now resolve to exact code searches instead
  of falling through to NPPES `taxonomy_description` validation.

### Safety Status

- No data was deleted or overwritten.
- The change is limited to taxonomy lookup behavior; existing non-legacy
  description lookups remain unchanged.

## 2026-08-31 — Identity grouping foundation

### Objective

Prepare stable provider identity grouping and ownership history without
breaking the existing application flow.

### Actions completed

1. Reviewed `MASTER_PLAN.md`, architecture notes, migration notes, and current
   Worker repositories/routes.
2. Confirmed `worker/` is the active implementation.
3. Confirmed the Supabase project link was initially pointing at fakeNPI, then
   linked/used the DME Desk project containing `app_users`, `leads`, and
   `npi_records`.
4. Ran the read-only schema checkpoint.
5. Verified all required NPPES identity columns exist.
6. Manually applied `sql/001_identity_schema.sql`.
7. Verified the new tables, `leads.group_id`, indexes, RLS, and audit triggers.
8. Prepared the safe backfill SQL.
9. Manually ran `sql/002_identity_backfill_safe.sql`.
10. Ran read-only verification queries.
11. Identified two pre-existing group-level ownership conflicts for manual
    review.

### Database result

- 4,599 leads checked.
- 0 leads without a group.
- 4,495 unique NPIs and 4,495 group memberships.
- 4,168 strict groups.
- 315 singleton groups.
- 0 duplicate NPI memberships.
- 3,494 historical claim events.
- 0 claimed leads missing a historical claim event.
- 2 groups contain active claims owned by multiple users.

### Important scope clarification

The current grouping logic exists in SQL as a one-time deterministic backfill.
Reusable JavaScript grouping/preflight code has not been implemented yet.
Tier 2 RapidFuzz review generation has also not been implemented.

### Safety status

- No existing claims were reassigned.
- No leads were deleted.
- No existing provider fields, statuses, notes, reminders, or owners were
  overwritten.
- Existing Worker routes were not changed.
- Supabase schema and backfill SQL were manually executed; no application
  deployment or commit has been made by this worklog.

## 2026-09-02 — NPPES ingestion CLI and ownership-conflict resolution

### Objective

Build the NPPES ingestion tooling, record the two approved owner decisions,
and give every remaining ownership conflict a place in the admin UI.

### Actions completed

1. Built `scripts/nppes_ingest`, a dependency-free Python CLI: argparse
   entry point, canonical normalization, NPPES header mapping, CMS
   check-digit validation, duplicate/state/taxonomy filtering, row-count
   guard, source checksum, run manifest, rejects report, batched staging
   upload, and rollback on partial failure.
2. Wrote `sql/004_nppes_refresh_staging.sql`, the staging table the CLI
   targets, with its own read-only verification queries.
3. Wrote `sql/005_ownership_conflict_resolution.sql`:
   `resolve_ownership_conflict()` (transactional, row-locking, append-only
   audit) and the `ownership_conflicts` view.
4. Wrote `sql/006_resolve_known_conflicts.sql` carrying the two approved
   owner decisions, targeting groups by member NPI rather than by name.
5. Added `GET /admin/conflicts` and `POST /admin/conflicts/resolve` to the
   Worker, with the approver taken from the session.
6. Added the ownership-conflict queue and resolve modal to the Admin tab.
7. Updated `MASTER_PLAN.md`, `ARCHITECTURE.md`, and `sql/README.md`.

### Test results

- 24 unit tests pass (`python3 -m unittest discover -s scripts/tests -t scripts`).
- CLI verified end to end in `--dry-run` against a fixture: 7 source rows,
  3 accepted, 4 rejected with the expected reason codes, manifest and
  rejects report written.
- Admin UI driven in headless Chromium against mocked API responses: both
  conflicts render, no owner pre-selected, missing-owner and missing-reason
  both blocked client-side, correct resolve payload posted, modal closes.
  Empty, not-installed and API-failure states verified; light and dark.
- `node --check` clean on every changed JavaScript file.

### Database result

None. No SQL was executed against Supabase — `004`, `005` and `006` are all
awaiting manual execution by the project owner.

### Safety status

- The two conflict decisions are recorded but **not yet applied**; no claim
  has moved.
- The ingestion CLI cannot write `npi_records` or `leads` by construction.
- Listing conflicts required no new SQL, so the admin queue degrades to an
  explanatory message rather than an error if the identity schema or the
  resolution function is missing.

### Important scope note

The transactional apply step (staging → compare → `provider_field_history`
→ `npi_records`) is **not** built. Staging a release does nothing to live
provider data on its own, which is the intended safety property, but it also
means a staged release is not yet useful until that step exists.

## Next worklog entry

Run `sql/004`, `005` and `006` (editing the approver username in `006`
first), verify with the queries in each file, then build the transactional
apply step and rehearse it against a small real release.

## Older next-entry note (2026-08-31, superseded)

The next implementation should add reusable grouping/preflight code and tests,
then add atomic group-aware claiming only after the two ownership conflicts have
explicit owner decisions.


## 2026-09-09 — Local migration verification and remote history reconciliation

- Pulled the linked Supabase schema into `supabase/migrations/20260909151917_remote_schema.sql`.
- Started the local Docker Supabase stack and reset the local database with the pulled migration.
- Confirmed local migration history and direct local/remote schema comparison are clean; local and linked lint reported no schema errors.
- Created `supabase/backups/remote-20260909-1825.sql` before further work. This is a schema backup, not a full production data backup.
- Did not execute the pulled schema snapshot against production because it represents objects already present in the cloud database, rather than a new schema change migration.
- Reconciled the remote migration-history row `20260909151917` as applied without executing SQL against the production schema.
- Production schema was not changed in this step.

### Next implementation step

Build the reusable grouping/preflight layer and dry-run intake report. After that, create a narrowly scoped migration only for any genuinely new schema required by the intake/claim workflow, test it locally, take a full production backup, and apply it through the reviewed deployment path.

## 2026-09-17 — Database storage quota recovery, SQL immutability audit, and BD Meetings sync plan

### Objective
Diagnose and resolve the Supabase storage quota overage (742 MB / 500 MB), diagnose the return-to-prospect SQL immutability crash, audit "Send to Sheets" and Claimed tab merges against grouping rules, and plan the BD Meetings NPI sync.

### Actions completed
1. **Database Storage Quota Diagnosis & Truncation**:
   - Identified that 84% of database storage was consumed by `provider_field_history` (294 MB data + 31 MB index) and `nppes_refresh_staging` (223 MB data + 33 MB index).
   - User truncated temporary staging tables in the Supabase SQL Editor.
   - Database size dropped from 0.742 GB (148%) to 0.488 GB (98%), clearing the immediate quota overage and lifting read-only restriction risks.
   - Formulated a 5-step permanent prevention strategy in `documentation/planning/sept17.md` (auto-purge staging in `finish_nppes_apply`, eliminate bulky `record_created` JSON dumps, add CLI preflight storage guard at 350 MB, post-apply vacuuming, strict taxonomy pre-filtering).
2. **SQL Immutability Error Diagnosis (`returnClaimedLeadsToProspect`)**:
   - Identified root cause of `Failed to return leads to Prospect: append-only audit table: lead_ownership_events is immutable`:
     - `leadsRepo.js` line 427 executed a hard `DELETE FROM leads`.
     - `lead_ownership_events.lead_id` foreign key with `on delete set null` attempted an internal `UPDATE`, tripping `lead_ownership_events_append_only` trigger (`reject_audit_mutation()`).
   - Designed atomic `release_claimed_leads()` SQL RPC to soft-release leads (`claimed_by = NULL`, `status = 'new'`) and append a `'released'` audit event instead of hard-deleting rows.
   - Verified that soft-releasing aligns with `owned_group_npis` and existing group ownership checks (`WHERE not is_disconnected AND claimed_by IS NOT NULL`).
3. **Audit of Claimed Tab Merges & Send to Sheets**:
   - Audited `docs/app.js` and `worker/`: confirmed Claimed tab currently lacks multi-location grouping; designed join with `lead_groups` to display `locationsBadge` and branch accordions.
   - Audited `POST /export/google-sheet`: documented that "Send to Sheet" currently bypasses Supabase claim checks and drops merged branch locations in `flattenCompany()`.
4. **BD Meetings Auto-Claim Integration Plan**:
   - Specified implementation of `POST /admin/claim-for-user` route in `worker/src/index.js` using `sql/011`'s `claim_leads` RPC.
   - Outlined Script Properties and 30-minute sync trigger configuration for `BD MEETINGS 2026/src/code.js`.
5. **Agent Operating Guidelines**:
   - Documented markdown and worklog maintenance protocols in `agents.md`.

### Safety status
- Core sales pipeline (`leads`, `app_users`, `lead_groups`) was untouched during staging truncation.
- Production schema was not altered during this session.
- Staging table truncation removed only temporary ingest rows, not active provider registry records (`npi_records`).

## 2026-09-22 — Meeting safeguards, booking action, and Apps Script push

### Objective

Implement the requested BD meeting warnings, correct the spreadsheet NPI/sync columns, standardize calendar hyperlinks, add immediate booking from Prospector claimed leads, and push the Apps Script changes.

### Actions Completed

- Updated `BD MEETINGS 2026/src/code.js` with a confirmation warning for `Rescheduled → NI` and cancellation when not confirmed.
- Added scheduling validation for the checkbox, valid 10-digit NPI, and meeting time; corrected Prospector sync to NPI column S and sync column T.
- Changed spreadsheet calendar labels to `EEE h:mm a` and modern `/calendar/u/0/r/eventedit/...` links.
- Added the Claimed Leads **Book meeting** action in `dmedesk-prospector/docs/app.js`.
- Documented Google Calendar secrets/scopes in `worker/README.md` and `worker/wrangler.toml`.
- Ran Node syntax checks on the changed Apps Script, Worker, repository, calendar service, and frontend files.
- Ran absolute-path clasp status and push; clasp reported `Pushed 4 files` to the configured script ID.

### Database / System Result

No database schema or production data changed. No Supabase SQL was executed. Apps Script deployment uploaded four files: `src/appsscript.json`, `src/code.js`, `src/sasa.js`, and `src/sss.js`.

### Safety Status

No destructive commands were run. No spreadsheet rows or calendar events were created by this deployment; booking remains an explicit user action and requires the Worker Google Calendar secrets to be configured.

## 2026-09-22 — Immediate NPI warning on schedule checkbox

### Objective

Warn users immediately when they check the scheduling checkbox without a valid NPI.

### Actions Completed

- Updated `BD MEETINGS 2026/src/code.js` to validate column S when the column Q checkbox is checked.
- Added a warning and automatically reset the checkbox when the NPI is missing or not 10 digits.
- Ran a Node syntax check and `git diff --check`.
- Pushed the updated Apps Script with clasp; clasp reported `Pushed 4 files`.

### Database / System Result

No database, spreadsheet row data, or calendar events were changed by the deployment.

### Safety Status

The invalid checkbox action is rejected before scheduling. No destructive commands or production SQL were executed.

## 2026-09-22 — Qualification checkbox NPI validation

### Objective

Apply the immediate NPI warning to the MEDB, PPO, and SUB qualification checkboxes, not only the scheduling checkbox.

### Actions Completed

- Updated `BD MEETINGS 2026/src/code.js` to validate NPI column S when columns A-C are checked.
- Added a warning and automatically reset the selected qualification checkbox when the NPI is missing or invalid.
- Ran the Apps Script syntax check and pushed the updated Apps Script with clasp.

### Database / System Result

No database, spreadsheet row data, or calendar events changed during deployment.

### Safety Status

Qualification selection is rejected before downstream scheduling/sync actions when the NPI is invalid. No destructive commands or production SQL were executed.

## 2026-09-22 — Expired rescheduled meeting notice

### Objective

Keep a rescheduled lead's movement cell empty with only `Cancelled` available after its meeting time passes, and notify the opener by email.

### Actions Completed

- Updated the fresh BD Meetings comparison version to email the configured opener when an expired `Rescheduled` row is restricted.
- Added a Script Properties idempotency key so the time-driven scan does not repeatedly email the same expired meeting.
- Preserved the prior BD Meetings folder for comparison.
- Ran the Apps Script syntax check and pushed the updated Apps Script with clasp.

### Database / System Result

No database, spreadsheet row data, or calendar events changed during deployment. Email delivery depends on the existing `OPENER_EMAILS` Script Property mapping and installed movement trigger.

### Safety Status

The lead remains in `New Meetings`; only the movement cell is cleared/restricted. No destructive commands or production SQL were executed.

## 2026-09-22 — Restore prematurely cleared Rescheduled statuses

### Objective

Repair rows whose `Rescheduled` status was cleared by the earlier immediate restriction, while retaining the intended expired-meeting restriction.

### Actions Completed

- Added a recovery scan to the fresh BD Meetings version.
- Restored the normal Status dropdown and `Rescheduled` value only for blank `Cancelled`-only cells whose meeting time is future or blank.
- Left rows with a passed meeting time empty and `Cancelled`-only.
- Ran the Apps Script syntax check and pushed the repair with clasp.

### Database / System Result

No database or calendar data changed during deployment. The existing time-driven movement trigger performs the spreadsheet repair after deployment.

### Safety Status

The repair targets only cells carrying the one-option `Cancelled` validation introduced by the prior rule. No destructive commands or production SQL were executed.

## 2026-09-22 — Exclude Prospector connection column from NPI warning

### Objective

Keep column Q reserved for the Sheet ↔ Prospector connection and exclude it from the qualification-checkbox warning.

### Actions Completed

- Updated `BD MEETINGS 2026/src/code.js` so only MEDB/PPO/SUB columns A-C trigger the immediate NPI warning.
- Left column Q behavior unchanged apart from documenting its connection purpose.
- Ran the Apps Script syntax check and pushed the correction with clasp.

### Database / System Result

No database, spreadsheet row data, or calendar events changed.

### Safety Status

The Prospector connection column is no longer blocked by the new validation. No destructive commands or production SQL were executed.

## 2026-09-22 — Restrict rescheduled leads to Cancelled

### Objective

Keep rescheduled leads in `New Meetings` while making `Cancelled` their only permitted next movement.

### Actions Completed

- Added `Cancelled` to the BD Meetings active-sheet allowlist and built-in destination map.
- Applied a single-option data-validation rule to the movement cell when a `Rescheduled` lead is in `New Meetings`.
- Added the same restriction to queued and batch movement paths.
- Ran the Apps Script syntax check and pushed the updated Apps Script with clasp.

### Database / System Result

No database, spreadsheet row data, or calendar events changed during deployment. The user still needs to create the `Cancelled` tab before moving rows there.

### Safety Status

Rescheduled rows remain in `New Meetings`; only their next movement choice is restricted. No destructive commands or production SQL were executed.

## 2026-09-22 — BD meeting validation, booking, and agent-instruction plan

### Objective

Plan the cross-repository changes for protected BD meeting status transitions, required schedule/NPI validation, immediate Google Calendar booking from Prospector, and compact meeting hyperlink labels. Correct copied agent instructions in both repositories.

### Actions Completed

- Inspected `BD MEETINGS 2026/src/code.js` for movement queues, scheduling, calendar matching, rich-text links, and NPI sync.
- Inspected `dmedesk-prospector/worker/`, `docs/`, and existing Google integration/configuration to identify the live API/frontend boundary.
- Added `documentation/planning/bd-meeting-validation-and-booking-plan.md` with implementation phases, assumptions, verification cases, and out-of-scope items.
- Replaced the copied instructions in `BD MEETINGS 2026/agents.md` and `dmedesk-prospector/agents.md` with repository-specific guidance.

### Database / System Result

No application code, database schema, production data, calendar events, or deployed secrets were changed. This milestone produced one planning document and updated two instruction files.

### Safety Status

No destructive commands or production SQL were executed. No spreadsheet rows, Supabase records, claims, or calendar events were modified.

