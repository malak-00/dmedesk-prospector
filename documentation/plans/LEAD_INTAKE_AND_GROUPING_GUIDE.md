# DME Desk Prospector: Current System and Lead Intake Plan

**Status:** implementation guide

**Last reviewed:** 2026-09-09

## Purpose

This document explains how the DME Desk Prospector works today, what the lead
identity/grouping foundation already provides, and how we will finish the
automated lead-intake and group-aware ownership workflow.

The target is not merely to import more NPI rows. The target is to make every
incoming lead pass through identity, duplicate, ownership, and data-quality
checks before it becomes available to a salesperson.

## Executive summary

The active application is a Cloudflare Worker backed by Supabase Postgres and
a browser frontend. The Worker currently supports authentication, provider
search, lead claiming, lead status/notes/reminders, admin tools, enrichment,
and exports.

The database already contains the additive identity and audit layer:

- `lead_groups` represents one real-world provider organization or practice.
- `lead_group_members` maps NPIs and aliases to a group.
- `leads.group_id` connects a sales lead to its group.
- `lead_ownership_events` records claims, releases, reassignments, conflicts,
  and provider-data alerts.
- `provider_field_history` records provider-field changes.
- `refresh_runs` identifies each provider-data import.

The local Supabase migration has been tested successfully. Local and linked
schemas compare cleanly, and both local and linked lint checks report no schema
errors.

The important limitation is that most application paths still use the old
lead workflow. The database knows about groups, but search, intake, and claim
operations do not consistently use that information yet.

## Current architecture

```text
Browser frontend (docs/)
        |
        v
Cloudflare Worker / Hono API (worker/src/index.js)
        |
        +-- custom app_users + bcrypt/JWT authentication
        +-- lead repository: search, claim, disconnect, return, status
        +-- NPPES/provider service (currently cross-project fakeNPI path)
        +-- enrichment services: CMS, Foursquare, OSM, scraper, AI brief
        +-- Google Sheets export
        |
        v
Supabase Postgres: dmedesk-prospector
        +-- app_users
        +-- leads
        +-- npi_records
        +-- identity/grouping and audit tables
        +-- NPPES staging tables
```

The Worker is the trusted server boundary. Browser clients must not receive
the Supabase service-role key and must not decide ownership or grouping on
their own.

### Existing lead lifecycle

Today, a user searches for providers, selects companies, and calls the export
or claim path. The main claim path is `POST /export/sheets`, which eventually
writes to `leads`. The current implementation performs a read-then-insert
check for the caller's existing claims and relies on the existing NPI active
claim uniqueness rule.

That is sufficient for the original NPI-level workflow, but it does not yet
protect against two NPIs belonging to the same real-world provider group.
It also leaves the import/preflight decision outside one authoritative server
transaction.

### Existing provider-data lifecycle

`npi_records` exists in the DME Desk project, but the Worker provider search
still uses the separate fakeNPI Edge Function. The NPPES ingestion CLI can
normalize and stage provider data, but the apply step that safely compares and
updates `npi_records` is not complete.

Therefore, there are currently two data concerns to finish:

1. Cut provider search over to the same-project `npi_records` table.
2. Build a staged, compare-before-update refresh pipeline.

## What is already complete

### Database foundation

The identity schema and Tier 1 backfill are in place. The strict grouping key
uses normalized provider name, state, authorized official, and the first valid
10-digit phone number. If required signals are missing, the safe backfill
creates a singleton group instead of guessing.

The schema is additive and keeps `leads.group_id` nullable during rollout.
Existing lead ownership, statuses, notes, reminders, and provider snapshots
are preserved.

### Local verification

The pulled migration is:

`supabase/migrations/20260909151917_remote_schema.sql`

The local Docker database successfully applied it. Verification showed:

- local migration status is applied;
- local migration diff is empty;
- direct local-versus-linked schema diff is empty;
- local lint has no schema errors;
- linked lint has no schema errors.

### Branches in the Claimed view

`GET /leads/list` attaches each claimed lead's identity group (`sql/010`): the
other NPIs in the group come back as `branches`, each marked `yours`,
`teammate`, `none` (released) or `disconnected`. The Claimed tab shows them as
an "N locations" badge and an "Other locations of this business" panel in the
expanded row, and a branch NPI typed into the search box finds the lead that
holds it. Rows stay one per NPI, because each branch has its own status, call
log and reminder. A failed branch lookup degrades to plain ungrouped leads.

### Partial application work

The admin conflict queue can list groups whose active claims are split across
multiple owners. This is a review surface, not yet the enforcement point for
new claims.

## What is not complete

- Undoing a merge or dismissal from the UI (decisions are one-way today).
- Automated intake/import from source files or provider refreshes.
- Notifying a rep when their held claim is decided (they retry the claim).
- Claiming every branch NPI of a merged "N locations" search row at once
  (the branches are exported and shown, but only the primary NPI is claimed).
- Explicit reassign and release APIs.
- Group and ownership-history API endpoints.
- NPPES/Medicare compare-before-update application.
- Final import and reassignment decisions for unresolved cases.

## Target operating model

Every source row follows this pipeline:

```text
Source file/API
    |
    v
Normalize and validate
    |
    v
Stage the raw candidate + import run
    |
    v
Identity/preflight check
    |
    +--> reject: invalid or duplicate NPI
    +--> review: ambiguous group, ownership, or successor signal
    +--> accept: safe new lead or safe update
    |
    v
Atomic database operation
    |
    +--> create/update lead and group membership
    +--> write ownership/provider history
    +--> expose the result to the app
```

No importer should write directly into the live sales workflow without passing
through staging and preflight.

## Grouping rules

Implemented in `worker/src/services/leadPreflight.js` (`MATCH_RULES`,
`matchRecords`) and, for existing leads, `sql/008_identity_match_tiers.sql`.
The two must normalize identically.

### Keys

| Key | Normalization |
|---|---|
| **N** name | Lowercased, accents/punctuation removed, legal suffixes stripped (inc, incorporated, llc, ltd, limited, corp, corporation, co, company, pc, pllc, lp, llp) |
| **S** state | Uppercased letters only |
| **O** authorized official | First + last name only; middle names and single-letter initials ignored |
| **P** phone | Practice-location phone first, authorized-official phone as fallback; leading `1` dropped, 10 digits |

Suffix stripping applies to the name in every tier.

### Rules (first match wins)

| Tier | Keys matched | Action |
|---|---|---|
| 1 | N + S + O + P | Auto-group |
| 2 | N + O + P (any state) | Auto-group — same business across states shares ownership |
| 2 | N + S + P | Flag for review |
| 2 | N + S + O | Flag for review (phone changed) |
| 2 | S + O + P | Flag for review (renamed business) |
| 3 | O + P | Flag for review |
| 3 | N + P | Flag for review |
| 3 | N + O | Flag for review |

Deliberately not matched: N + S, S + O, S + P, or phone alone. Those are
too common between unrelated businesses (generic names, common official
names, shared billing/answering-service numbers).

A **fuzzy** name (suffix-stripped `token_sort_ratio ≥ 88`) can satisfy the N
key, but a match that relied on it is always flagged, never auto-grouped.

Because Tier 1 is a subset of N + O + P, both auto-group tiers use one group
key: `group:<name>|<official>|<phone>`. Groups whose members share a state
have `grouping_tier = 'strict'`; groups spanning states are `'cross_state'`.
Records missing N, O, or P get `singleton:<npi>`.

Same NPI is always the same provider record and is a definite duplicate.

Grouping is idempotent. Running it twice must not create duplicate groups or
move a membership a person has reviewed.

### Ownership conflicts from auto-grouping

Auto-grouping can put leads claimed by different users into one group. Those
groups appear in the Admin tab's **Ownership conflicts** panel, labelled with
the tier that grouped them, and are resolved with an explicit owner decision.
`sql/008` writes a pending `conflict_detected` event for every conflict the
regroup newly creates.

### Review flags

Flagged pairs never merge leads, change owners, or delete records on their
own. For new candidates, preflight returns `needs_review` with each match's
tier and keys. For existing leads, `public.identity_review_candidates` lists
the exact-key Tier 2/3 pairs that sit in different groups, and
`public.identity_review_queue` (sql/009) is the subset nobody has decided.

Admins work that queue in the Admin tab's **Possible duplicates** panel. Each
card shows both NPIs side by side with the matching keys ticked, group sizes,
and current owners. The two decisions, both requiring a reason:

- **Same business — merge:** the two groups become one. Moved memberships are
  marked as reviewed. If the merged group now holds claims from different
  users, it appears under Ownership conflicts for an owner decision.
- **Not the same:** recorded as dismissed; the pair is not flagged again.

Decisions are stored in `public.identity_match_decisions` with who decided,
when, and why.

### Manual decisions

An administrator can confirm, reject, or defer a proposed relationship. A
confirmed relationship records who approved it, when, why, and which evidence
was used. Existing ownership is never reassigned automatically because a new
provider row resembles an old one.

## How automated lead intake will work

### 1. Create an import run

Create one `refresh_runs` row for every source file or API run. Store source,
version/date, actor, mode, and status. Every staged row and history record
must reference that run.

### 2. Normalize into a staging shape

Normalize before matching:

- NPI as a validated 10-digit value;
- names using a shared normalization function;
- state using a canonical two-letter value;
- phone by extracting the first valid 10-digit number;
- addresses into comparable components;
- authorized official into a comparable name key;
- source timestamps and source identifiers.

Keep the original source values for audit and troubleshooting.

### 3. Run preflight

For each candidate NPI, check in batches:

- whether the NPI already exists;
- whether it already has a lead;
- whether it belongs to an existing group;
- whether that group has an active owner;
- whether it conflicts with another owner;
- whether it is a possible duplicate or successor;
- whether it passes required data-quality rules.

Return a structured result such as `accept`, `duplicate`, `owned_conflict`,
`needs_review`, or `invalid`, with evidence and the proposed action.

### 4. Apply only accepted candidates

Accepted candidates are inserted or updated through a server-side transaction.
The operation creates the lead/group membership and the relevant audit event
together. A partial write must roll back.

Provider refreshes may update provider-owned fields, but never overwrite sales
ownership, status, notes, reminders, or approval decisions.

### 5. Review exceptions

The admin UI should show conflicts and ambiguous matches with enough evidence
to decide. Review decisions then call explicit server-side endpoints and write
their own audit events.

## How claims are group-aware

Implemented by `claim_leads()` in `sql/010_group_aware_claim.sql`, called by
`POST /export/sheets`. In one transaction, per lead:

1. Find or create the NPI's identity group (same keys as the tiers above;
   an existing or reviewed membership wins) and lock every touched group in
   a fixed order.
2. Skip it if the caller already actively claims the NPI.
3. **Block** it if anyone else actively claims the NPI or any NPI in its
   group. Nothing is written and nobody's ownership changes.
4. **Hold it for review** if it has a Tier 2/3 match to someone else's active
   lead with no admin decision between the two businesses. The request is
   recorded (`identity_claim_requests`) and appears in Possible duplicates
   marked "Claim request". After "Not the same" the rep can claim it; after
   a merge it stays blocked because the business is owned.
5. Otherwise insert the lead with its `group_id` and write a `claimed` event.

A batch is partial: allowed leads are claimed, and the rep sees a dialog
listing blocked leads (with owner) and held leads (with the matching lead
and owner). Search hides NPIs whose group a teammate owns. Tier 2/3 blocking
uses exact keys only — a match that needs a fuzzy name doesn't hold a claim.

Reassign and release must be separate admin-authorized operations. Each must
require a reason and preserve the previous owner in the event history.

## How provider refresh will work

Provider refreshes must be staged first. The apply job compares canonical old
and new values, writes `provider_field_history` before updating a provider
field, and creates review alerts for high-signal changes such as:

- provider name or organization name;
- authorized official;
- phone;
- deactivation/status;
- territory/address;
- a major Medicare claims decrease.

A provider name or phone change may trigger a grouping review, but must not
silently move a claimed lead into another group.

## Implementation sequence

### Phase A: finish and verify grouping

1. Add reusable normalization and Tier 1 grouping code.
2. Add Tier 2 candidate generation with corroborating-signal gates.
3. Add tests for Genome Insight → Inocras and Jane → Kaity James.
4. Produce a review report for current multi-owner conflicts.
5. Resolve approved conflicts manually; do not auto-reassign.

### Phase B: build intake preflight

1. Define the staged candidate contract.
2. Implement batched NPI/group/ownership checks.
3. Add a dry-run CLI/report that makes no writes.
4. Add accepted/review/rejected output counts.
5. Test reruns for idempotency.

### Phase C: make claim writes atomic

1. Add the server-side transaction/RPC.
2. Replace the read-then-insert claim path.
3. Return explicit group conflict responses.
4. Add claim, release, and reassign audit events.
5. Add group and history endpoints.

### Phase D: finish provider refresh

1. Complete NPPES staged apply logic.
2. Add Medicare staging and compare logic.
3. Write field history before updates.
4. Add review alerts and admin handling.
5. Cut provider search over to same-project `npi_records`.

### Phase E: controlled rollout

1. Run all imports in dry-run mode.
2. Compare accepted/review/rejected counts with expected samples.
3. Apply to local Supabase and run migration/schema/lint checks.
4. Deploy Worker code behind a feature flag or admin-only path.
5. Run a small production batch after a fresh backup.
6. Verify ownership, audit events, and unchanged sales fields.
7. Expand gradually and keep rollback/stop conditions documented.

## Safety rules

- Local first; production second.
- Back up before every production mutation. A schema dump is not a data
  backup.
- Keep all source rows and review decisions; do not delete duplicates as part
  of grouping.
- Never let a fuzzy name match auto-group or reassign ownership.
- Never let an importer change `claimed_by`, status, notes, reminders, or
  ownership decisions.
- Keep `leads.group_id` nullable until verification proves complete coverage.
- Run read-only verification after every mutating step.
- Treat the service-role Worker as the only trusted writer for these operations.

## Definition of done

The system is ready for normal automated intake when:

- every accepted candidate has a deterministic preflight result;
- every ambiguous candidate is reviewable and remains ungrouped until decided;
- repeated imports are idempotent;
- group-level ownership conflicts are blocked atomically;
- claims, releases, reassignments, and provider changes are auditable;
- provider refreshes preserve sales-owned fields;
- local migration, schema diff, lint, unit, route, and dry-run tests pass;
- a small production canary completes with no unexpected ownership or data
  changes.

## Current next step

The next implementation task should be the reusable grouping/preflight layer
and its dry-run report. It creates the contract that both automated intake and
group-aware claiming will use, while keeping the existing application path
safe until the new behavior is proven locally.

## Related documents

- `MASTER_PLAN.md` — phase status and original roadmap.
- `../architecture/ARCHITECTURE.md` — detailed current Worker and database architecture.
- `../planning/task_plan.md` — implementation checklist.
- `documentation/reviews/IMPLEMENTATION_REVIEW.md` — compatibility and safety
  review.
- `documentation/plans/PROVIDER_CHANGE_TRACKING_PLAN.md` — refresh design.
- `supabase/migrations/20260909151917_remote_schema.sql` — pulled schema
  migration used for local verification.
