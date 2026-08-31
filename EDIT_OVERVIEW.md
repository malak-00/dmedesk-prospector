# Edit Overview

## Files added

### Planning and tracking

- `task_plan.md` — implementation phases and constraints.
- `findings.md` — repository discoveries, risks, and design decisions.
- `progress.md` — session progress and verification record.
- `IMPLEMENTATION_REVIEW.md` — backward-compatibility review and SQL
  guardrails.
- `WORKLOG.md` — chronological record of work completed and database results.
- `EDIT_OVERVIEW.md` — this file.

### Supabase SQL

- `sql/000_schema_checkpoint.sql` — read-only schema/table/index/column check.
- `sql/001_identity_schema.sql` — additive identity and audit schema.
- `sql/002_identity_backfill.sql` — original draft; do not run.
- `sql/002_identity_backfill_safe.sql` — executed safe backfill that preserves
  existing memberships on rerun.
- `sql/003_identity_verification.sql` — read-only validation queries.
- `sql/README.md` — SQL execution notes.

## Database edits actually applied

`001_identity_schema.sql` added:

- `lead_groups`
- `lead_group_members`
- `refresh_runs`
- `lead_ownership_events`
- `provider_field_history`
- `leads.group_id`
- Supporting foreign keys and indexes.
- RLS enabled on the new tables.
- Append-only triggers on ownership and provider history tables.

`002_identity_backfill_safe.sql` added:

- Strict groups using normalized name, state, authorized official, and first
  valid 10-digit phone.
- Singleton groups for incomplete identity signals.
- One membership per NPI.
- `leads.group_id` values for all existing leads.
- Historical `claimed` events for existing claimed leads.

## Existing application files changed

None. No files in `worker/src/`, `docs/`, `appscript/`, or `backend/` were
changed during the database foundation work.

## What has not been implemented yet

- Reusable JavaScript grouping service.
- RapidFuzz Tier 2 review generation.
- NPI preflight command/report.
- Atomic group-aware claim operation.
- Reassign and release APIs.
- Group/history endpoints.
- NPPES/Medicare refresh staging and field history updates.
- Admin review UI for ownership/provider alerts.

## Current compatibility position

The existing app still follows its original flow. It does not read or write
`group_id`, group memberships, or audit events yet. The new database fields are
available for the next implementation stage without requiring an immediate
frontend or Worker cutover.

