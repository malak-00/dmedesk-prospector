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
```

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
| `004_nppes_refresh_staging.sql` | Staging table written by `scripts/nppes_ingest` | **Not yet run** |
| `005_ownership_conflict_resolution.sql` | `resolve_ownership_conflict()` + `ownership_conflicts` view | Executed 2026-09-16 |
| `006_resolve_known_conflicts.sql` | Applies the two approved owner decisions | Executed 2026-09-16 (approver: Ben Arthur) |
| `007_nppes_refresh_lifecycle.sql` | Finalize, abort, and transactional NPPES apply functions | **Not yet run — after 004 and read-only verification** |
| `008_identity_match_tiers.sql` | Three-tier identity keys, regroup of existing leads, `conflict_detected` events, `identity_review_candidates` view | Executed 2026-09-16 |
| `009_identity_match_review.sql` | `identity_match_decisions`, `identity_review_queue` view, `resolve_identity_match()` for the admin Possible duplicates screen | Executed 2026-09-16 |
| `010_group_aware_claim.sql` | `claim_leads()` (group-aware atomic claim), `owned_group_npis()` for search, `assign_lead_groups()`, `identity_claim_requests`, extended `identity_review_queue`, backfill of ungrouped leads | **Not yet run — back up first; run after 009, then deploy the Worker** |

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

**`006`** carries the two approved owner decisions from 2026-09-02. The
usernames at the top are filled in: Ben Arthur approves, Rick Nelson receives
1FOOT 2FOOT, and Nora Atkins receives Advanced Home Medical Supplies. The
groups are found by NPI, so the other current owner (Kaity James) and users
not involved need no entry. All three usernames are checked for exactly one
match, and the approver must be an admin; it raises rather than guessing. It
is one transaction and is safe to re-run — once a group has a single owner
there is nothing left to reassign.

The table above records the current execution state: 000, 001, safe 002, and
003 were executed on 2026-08-31; 005, 006, 008, and 009 on 2026-09-16 (006 and
008 were first fixed for the Supabase SQL Editor in PR #31). 004 and 007 are
still manual and are only needed before the NPPES ingest applies a release.
The agent never executes SQL against Supabase. Verify after every step.

The future staged-to-live apply must reject any run unless status is staged,
staging_state is complete, expected and recorded staged counts match, and the
database staging count matches those recorded counts. A hard process
termination can leave separate REST calls incomplete; it cannot be rolled
back by REST alone, so apply preflight must reject uploading and failed runs.

