# Supabase SQL bundle

These files are ordered and intended for manual execution in the Supabase SQL
Editor by the project owner. The agent does not execute them against Supabase.

Required manual sequence:

```text
001_identity_schema.sql
002_identity_backfill_safe.sql
003_identity_verification.sql
004_nppes_refresh_staging.sql
005_ownership_conflict_resolution.sql
006_resolve_known_conflicts.sql
007_nppes_refresh_lifecycle.sql   (only before an NPPES apply; needs 004)
008_identity_match_tiers.sql
009_identity_match_review.sql
010_group_aware_claim.sql
011_claim_for_user.sql
012_medicare_refresh.sql          (before the first Medicare load)
013_release_claimed_leads.sql     (Return to Prospect)
014_claim_preflight.sql           (before "Send to Sheet" can refuse anything)
015_provider_change_alerts.sql    (before the first NPPES apply; needs 007)
016_refresh_run_recovery.sql      (abort a Medicare run; abort a 'complete' run)
017_lead_sync_restart.sql         (run a claimed-lead sync again from the start)
018_provider_search.sql           (before search can read from this project)
```

**Outstanding: `017` and `018`.** The bundle described next always holds
whatever that is.

**Everything still outstanding is bundled into one file:**
[`RUN_PENDING.sql`](./RUN_PENDING.sql) — regenerated whenever the backlog
changes, currently `015` (re-run) and `016`, unchanged apart from their own
`begin`/`commit` and wrapped in a single transaction, so a failure anywhere
leaves the database untouched. Paste the whole file with nothing selected (a
partial selection cuts a dollar-quoted function body in half), then run the
verification queries at its bottom — they also list any release that was
applied without reaching claimed leads, and any run stuck in `staged` with no
rows. Running the files individually, in order, does exactly the same thing.

Run each file in the Supabase SQL Editor, save its read-only verification
output, and stop if verification reports an error. No SQL is executed
automatically by the repository tools.

Run one file at a time, in order, and stop if its verification query reports
an error. Read-only verification queries live at the bottom of each file (or
in `003`); save their output with the run.

| File | Purpose | Status |
|---|---|---|
| `000_schema_checkpoint.sql` | Read-only check of required tables, columns, indexes | Executed 2026-08-31 |
| `001_identity_schema.sql` | Identity, audit, and refresh-run tables | Executed 2026-08-31 |
| `002_identity_backfill.sql` | First draft of the backfill | **Superseded — do not run** |
| `002_identity_backfill_safe.sql` | Safe identity + historical-claim backfill | Executed 2026-08-31 |
| `003_identity_verification.sql` | Read-only validation queries | Executed 2026-08-31 |
| `004_nppes_refresh_staging.sql` | Staging table written by `scripts/nppes_ingest` | Executed 2026-09-17 (in the bundle) |
| `005_ownership_conflict_resolution.sql` | `resolve_ownership_conflict()` + `ownership_conflicts` view | Executed 2026-09-16 |
| `006_resolve_known_conflicts.sql` | Applies the two approved owner decisions | Executed 2026-09-16 (approver: Ben Arthur) |
| `007_nppes_refresh_lifecycle.sql` | Recover/abort staging, `nppes_apply_column_map()`, batched schema-adaptive `apply_nppes_refresh_batch()` + `finish_nppes_apply()` | Executed 2026-09-17 (in the bundle) |
| `008_identity_match_tiers.sql` | Three-tier identity keys, regroup of existing leads, `conflict_detected` events, `identity_review_candidates` view | Executed 2026-09-16 |
| `009_identity_match_review.sql` | `identity_match_decisions`, `identity_review_queue` view, `resolve_identity_match()` for the admin Possible duplicates screen | Executed 2026-09-16 |
| `010_group_aware_claim.sql` | Identity helpers, `owned_group_npis()` for search, `assign_lead_groups()`, `identity_claim_requests`, extended `identity_review_queue`, backfill of ungrouped leads (`claim_leads()` now lives in 011) | Executed 2026-09-16 (Worker deployed after) |
| `011_claim_for_user.sql` | `app_users.can_claim_for_others`; `claim_leads()` redefined with an optional actor for claims on behalf of another user | Executed 2026-09-16 (Worker deployed after) |
| `012_medicare_refresh.sql` | `medicare_refresh_staging` + `apply_medicare_refresh()`: CMS DMEPOS by-Supplier data into `npi_cms_enrichment`, with history and claim-drop alerts | Executed 2026-09-17; re-run 2026-09-17 with the narrowed duplicate guard, so the 9,292 suppliers skipped on the first load can be picked up by the next `--apply` |
| `013_release_claimed_leads.sql` | `release_claimed_leads()`: "Return to Prospect" as a soft release with a `released` event | Executed 2026-09-17 (Worker deployed after) |
| `014_claim_preflight.sql` | `identity_group_lookup()` + `claim_leads(..., p_dry_run)`: the claim rules with nothing written, so "Send to Sheet" refuses what claiming would refuse | Executed 2026-09-17 (Worker deployed after) |
| `015_provider_change_alerts.sql` | `apply_provider_changes_to_leads()`: refreshes claimed leads from an applied release and raises `provider_data_changed` alerts; `provider_change_queue` + `resolve_provider_change()` for the admin queue | Executed 2026-09-17, re-run the same day with the lead-scoped sync |
| `016_refresh_run_recovery.sql` | `abort_medicare_refresh()`, and `abort_nppes_refresh()` relaxed to accept a `complete` run: closing out a staged run whose staging is gone | Executed 2026-09-17 (used to close out the empty Medicare run) |
| `017_lead_sync_restart.sql` | `reset_lead_sync()`: clears the sync cursor so a run that has been synced can be synced again | **Not yet run — needed for `--sync-run --restart`** |
| `018_provider_search.sql` | `search_providers()` + its indexes: provider search against this project's own `npi_records`, every filter in SQL | **Not yet run — needed before `NPI_SOURCE=dmedesk`** |

## Notes on individual files

**`002_identity_backfill.sql` is superseded.** It could overwrite a
previously reviewed NPI membership on a rerun. Use
`002_identity_backfill_safe.sql`, which preserves an existing membership.

**Before `002_*`,** confirm `public.npi_records` has the columns referenced
there. The repository's existing audit SQL confirms `npi`, `name`,
`address_state`, `authorizedofficial_firstname`,
`authorizedofficial_lastname`, `phone`, and `authorizedofficial_phone`; the
backfill also uses optional address fields only through a separately marked
adaptation point.

**`004`** must be installed before the ingestion CLI can stage a real
release. The CLI's staging row and this table's columns are written to match
each other exactly — change one and you must change the other.

**`007`** adds `deactivation_date` and `taxonomy_codes` to `npi_records`
(the live table, checked 2026-09-16, has neither; the first fill of
`taxonomy_codes` writes no history), then applies a staged run to
`npi_records` in batches, driven by
`python -m nppes_ingest ... --apply` (or `--apply-run <id>`). It writes only
columns present in both staging and the live `npi_records` — check with
`select * from public.nppes_apply_column_map();` before the first apply —
records a `provider_field_history` row per real change (canonical comparison,
so formatting-only differences don't count) and one `record_created` row per
new provider, refuses to apply the same source file twice without
`operator_override`, and never inserts from a deactivation file. Batches are
resumable. It replaces the earlier single-transaction draft of this file,
which was never run.

**`005`** is what the admin UI's "Resolve" button calls. Until it is
installed, the Admin tab still *lists* ownership conflicts (the Worker
aggregates those from tables that already exist), but resolving one returns
a clear "isn't installed yet" message instead of moving anything.

**`008`** changes group keys: legal suffixes are stripped from names, middle
initials are ignored, and name + official + phone auto-groups across states.
It moves automatically-assigned memberships only (never one with
`reviewed_by` set). Groups it newly splits across owners get a pending
`conflict_detected` event and appear in the Admin tab's Ownership conflicts
panel. Its key functions must stay in step with
`worker/src/services/leadPreflight.js`. Rerun-safe. Run it **after `006`**:
`006` expects each known conflict group to have exactly two members, and
regrouping can change that.

**`009`** backs the Admin tab's **Possible duplicates** list. Until it is
installed, that panel shows an "isn't installed yet" message. An admin's
"Same business — merge" combines the two NPIs' groups in one transaction
(moved memberships are marked reviewed, so a rerun of `008` never splits
them) and, if that puts different users' claims together, writes pending
`conflict_detected` events so the group appears under Ownership conflicts.
Ownership never changes here. "Not the same" records a dismissal and nothing
moves. Each pair can be decided once; both decisions require a reason.

**`010`** makes claiming group-aware. `POST /export/sheets` calls
`claim_leads()`, which for each lead (one transaction, groups locked in a
fixed order):

- skips an NPI the caller already claims;
- **blocks** an NPI whose identity group has an active claim by someone else;
- **holds for review** an NPI with an undecided Tier 2/3 match to someone
  else's active lead, recording an `identity_claim_requests` row so the pair
  shows in the Admin tab's Possible duplicates list;
- otherwise inserts the lead with its `group_id` and a `claimed` event.

A "Not the same" decision covers both businesses (every NPI in either
group), so a dismissed pair never holds a later claim. Search hides NPIs whose
group a teammate owns (`owned_group_npis()`), and Disconnected rows get a
group via `assign_lead_groups()` without an ownership check. Identity uses
`npi_records`, falling back to the search result or the lead's own columns
when the NPI isn't there — `008` now uses the same fallback, so rerunning it
keeps those groups. `010` backfills a group for every lead that has none.
Run it **before** deploying the Worker: until it exists, claiming returns an
"isn't installed yet" error instead of claiming without the check. Rerun-safe.

**`013`** fixes "Return to Prospect". It used to DELETE the lead row, which
now fails: every claim writes a `claimed` ownership event, and deleting the
lead makes Postgres null that event's `lead_id`, which the append-only
trigger rejects. `release_claimed_leads()` instead writes a `released` event
and clears `claimed_by` / `claimed_at` / `reminder_at`, resetting status to
`new`. The row and its history stay; ownership checks all test
`claimed_by is not null`, so the NPI is claimable again — though its identity
group stays protected while the same owner holds another NPI in it. Search
was also updated to stop hiding released NPIs. Install this and redeploy the
Worker together.

**`015`** is the second half of a refresh. `007` updates `npi_records` and
records every changed field in `provider_field_history`, and deliberately
stops there. `apply_provider_changes_to_leads(run_id)` then refreshes the
provider-owned snapshot on active leads (company name, phone, address,
specialty, NPPES last-updated, and the contact only when `contact_source =
'nppes'` — a scraped contact is the rep's own find) and raises one pending
`provider_data_changed` alert per claimed lead whose provider changed in a
way its rep has to know: phone, authorized official, organization name,
city/state, status, deactivation. It never touches `claimed_by`, `status`,
`notes`, `reminder_at` or `is_disconnected`, and it never moves a lead
between groups — a change to the identity keys themselves is flagged
`metadata.group_review` for an admin instead. Batched and resumable off a
cursor on the run, so an interrupted sync continues and a finished one is a
no-op; the alert for one lead in one run can only be raised once. Decisions
live in `provider_change_decisions` rather than on the event, because
`lead_ownership_events` is append-only. `python -m nppes_ingest --apply`
runs it automatically once the apply finishes (`--skip-lead-sync` opts out;
applying the same run again picks it up later). Rerun-safe.

**`018`** lets search read from this project instead of the mirror. The app
has always searched the fakeNPI project over HTTP, one page at a time, while
this project holds the same providers in `npi_records` — 387k of them after
the September refresh, covering 3,579 of the 3,611 leads people own.
`search_providers(criteria, limit, skip)` does that search here: every filter
runs in SQL, including the three the mirror can't do (name terms, excluded
keywords, last-updated years) which the Worker used to apply *after* paging —
and the specialty filter resolves through `public.taxonomies`, because
`npi_records.taxonomy_description` has never been populated (only the code
is) — against the column alone a specialty search matched nothing at all —
which is why a page of 200 could come back with three usable rows. Deactivated
providers and individuals are left out unless asked for, Medicare enrichment
is joined in the same query, and the full match count rides on every row.
Results are ordered by NPI because paging needs a stable order.

Only the filters a search actually carries reach the query. Written the
obvious way — one static query with `(:param is null or column = :param)`
per filter — the planner can't see any of the comparisons and scans all
394k rows every time: a search by specialty alone took over 8s and was
cancelled by Supabase's statement timeout. Built per search, each filter is
a plain comparison answered from an index.

The expensive half of a search is the exact match count — it has to account
for every matching provider, not just the fifty on the page — which is why a
24,000-match state search still timed out once the filters were fixed. Two
partial indexes carry the active-organization test in the index predicate and
the NPI in the index itself, so the count is answered from the index alone.
Measured on 394,755 generated providers: a 37,759-match state search takes
69ms, a 112,787-match specialty search 165ms. **Run `vacuum (analyze)
public.npi_records;` once after this file** (it can't run inside its
transaction): an index-only count needs the visibility map, which a bulk load
leaves unset. Worth repeating after each monthly refresh. Every value goes through
`quote_literal`; nothing from the caller is interpolated raw. A trigram
index for name search is created where `pg_trgm` is available; without it
search still works, just slower. The Worker picks a source with `NPI_SOURCE`
(see `worker/README.md`), so the cutover is a variable, not a deploy.
Read-only and rerun-safe.

**`017`** makes a finished lead sync runnable again. The sync resumes from a
cursor on the run, which means a run that has been synced once can never be
synced again: the cursor sits past the last NPI, the next call finds nothing
below it and reports "nothing to do". That bit — a release synced once under
the older, unscoped query left a cursor past the end, so the next run
reported 0 refreshed while 3,558 claimed leads still showed pre-refresh data.
`reset_lead_sync(run)` clears the cursor, and `--sync-run <id> --restart`
calls it. Re-running a sync is safe by construction: the snapshot copy is
idempotent, and an alert for one lead in one run can only exist once.

**`016`** closes out a run that can't go anywhere. A Medicare run was left
at `staged` / `staging_state = complete` with `row_count` 60,060 while
`medicare_refresh_staging` held none of its rows — the loader's rollback
deleted the rows and then failed to mark the run failed. Applying it is
correctly refused ("staging count changed (0 staged, 60060 recorded)"), but
nothing could close it: Medicare had no abort, and `abort_nppes_refresh`
refused any run whose `staging_state` was `complete`. Now there is an abort
per source, and the rule that matters is the one enforced — a run that is
mid-apply or applied is never abortable. The loader was fixed to mark a run
failed *before* deleting its rows, so a half-finished rollback leaves a
failed run with orphan rows (which every apply refuses) instead of a run
that still looks applyable. Rerun-safe.

**`014`** makes "Send to Sheet" ask before it copies. It used to write a
rep's search results into their `Claimed - <Name>` tab without asking the
database anything, so a lead a teammate already owned could be copied into a
second rep's spreadsheet while the app said it was someone else's. Rather
than repeat the claim rules in a second place, `claim_leads` gained a
`p_dry_run` argument: it decides every lead exactly as a real claim would and
writes nothing — no lead, no group or membership, no ownership event, no
review request, and no advisory locks, so a preflight can never hold up a
real claim. `identity_group_lookup()` is `ensure_identity_membership()` made
read-only for it. The Worker falls back to the coarser 010 checks (claimed
NPIs and teammate-owned groups, but no Tier 2/3 hold) until this is
installed. The file redefines `claim_leads` rather than adding an overload,
for the same reason `011` did. Rerun-safe.

**`012`** backs the Medicare loader (`python -m nppes_ingest.medicare`).
`npi_cms_enrichment` in DME Desk exists but was empty (checked 2026-09-16), so
search can't switch off fakeNPI until this has loaded. `apply_medicare_refresh()`
applies only NPIs present in `npi_records`, records changed values in
`provider_field_history` (source `medicare`), raises a pending
`provider_data_changed` event for a claimed lead whose claims fell by more
than half, never clears an NPI just because it's missing from a release, and refuses
identical content without `operator_override` only when there are no
newly eligible providers to load (so re-running after an NPPES refresh picks
up suppliers that were skipped before). CMS publishes one data year at a
time, so most monthly runs change little. Re-run this file to update the
function (it is rerun-safe).

**`011`** lets an integration account (e.g. BD MEETINGS) claim for a named
teammate via `POST /admin/claim-for-user` (see
`documentation/operations/BD_MEETINGS_CLAIM_FOR_USER.md`). It adds
`app_users.can_claim_for_others` and replaces `claim_leads(uuid, jsonb)` with
`claim_leads(uuid, jsonb, p_actor_id uuid default null)`: normal claims call it
exactly as before; an on-behalf claim records `source = 'claim_for_user'`,
`approved_by` and `metadata.actor_user_id`, and the database refuses an actor
that is neither an admin nor flagged. `claim_leads` is defined only in `011`
(no longer in `010`), so re-running `010` can't recreate the old overload
beside it. Rerun-safe.

**`006`** carries the two approved owner decisions from 2026-09-02. The
usernames at the top are filled in: Ben Arthur approves, Rick Nelson receives
1FOOT 2FOOT, and Nora Atkins receives Advanced Home Medical Supplies. The
groups are found by NPI, so the other current owner (Kaity James) and users
not involved need no entry. All three usernames are checked for exactly one
match, and the approver must be an admin; it raises rather than guessing. It
is one transaction and is safe to re-run — once a group has a single owner
there is nothing left to reassign.

The table above records the current execution state: 000, 001, safe 002, and
003 were executed on 2026-08-31; 005, 006, 008, 009, 010, and 011 on 2026-09-16;
012, 013, 014 and then 004, 007 and 015 (as one bundle) on 2026-09-17 (the
Worker was deployed after 013 and again after 014)
(006 and 008 were first fixed for the Supabase SQL Editor in PR #31; the Worker
with group-aware claiming was deployed after 010, and with claim-for-user after
011). 004 and 007 are
still manual and are only needed before the NPPES ingest applies a release.
The agent never executes SQL against Supabase. Verify after every step.

The future staged-to-live apply must reject any run unless status is staged,
staging_state is complete, expected and recorded staged counts match, and the
database staging count matches those recorded counts. A hard process
termination can leave separate REST calls incomplete; it cannot be rolled
back by REST alone, so apply preflight must reject uploading and failed runs.

