# Findings & Decisions

## Requirements

- Implement `MASTER_PLAN.md` from the current state, starting with Phase 3 completion and Phases 4–7.
- Keep all Supabase edits as SQL for manual execution by the user.
- Application code may be edited, pushed, and committed on the user's branch.
- Preserve explicit ownership decisions and audit history.

## Repository findings

- `worker/` is the active implementation. It uses Supabase through `worker/src/lib/supabase.js` and repository modules.
- `worker/src/repos/leadsRepo.js` currently performs client-side pre-checks followed by inserts/updates. This is unsafe for group-level conflict checks unless moved behind an atomic SQL operation/RPC or equivalent transaction-capable endpoint.
- Current lead lifecycle routes are `/export`, `/leads/disconnect`, `/leads/return-to-prospect`, `/leads/status`, notes, reminders, and `/leads/list`; there is no claim/reassign/group API yet. Claiming is currently implemented through `POST /export` and `exportCompaniesToLeads`.
- Current `leads` rows contain the provider snapshot and ownership fields, but no `group_id`, ownership event log, provider field history, refresh run, or admin review queue.
- Current `npi_records` is consumed through fakeNPI's API. Its authoritative schema is not present in this repository, so final refresh SQL must be aligned with an actual schema export before execution.
- The repository has no committed `supabase/` migration directory; SQL should be added under a clearly named reviewable directory (for example `sql/`) unless the user prefers another location.
- Existing auth is custom `app_users` + bcrypt passwords + stateless JWT. Group and admin routes must use the existing `session.isAdmin` boundary, with database policies still treated as defense in depth.
- `MASTER_PLAN.md` reports 11,684 strict-group flagged rows in 4,695 groups and RapidFuzz 3.14.3 installed; this should be treated as an input to validate, not blindly assumed during backfill.
- The current user-facing active manual resolution file is `PIS_TO_RESOLVE.csv`; it must remain untouched until preflight and explicit decisions are complete.

## Proposed data contract

- `lead_groups`: stable provider entity, strict normalized identity key, review/status metadata.
- `lead_group_members`: NPI-to-group relationship with relationship type and review metadata; unique active membership per NPI.
- `lead_ownership_events`: append-only event stream with NPI/group, event type, from/to users, reason, source, approver, and timestamp.
- `provider_field_history`: append-only old/new values by NPI, field, source, refresh run, and timestamp.
- `leads.group_id`: nullable during migration, non-null after validated backfill, FK to `lead_groups`.
- Review alerts should be represented explicitly rather than inferred from free-text event reasons; the final shape must support unresolved review states and dismissal/approval.

## Implementation risks

- The existing `leads` table may contain multiple rows for the same NPI across disconnected/history states. The schema must distinguish current active ownership from historical rows before enforcing uniqueness.
- A Worker using the Supabase REST client cannot assume multi-request atomicity. Claim conflict checks and event writes need a database-side atomic contract, documented as SQL for manual installation.
- `provider_field_history` needs a canonical comparison representation so nulls, phone formatting, whitespace, and numeric Medicare values do not create false changes.
- Supabase RLS policies must not rely on editable `user_metadata`; existing custom JWT sessions also mean `auth.uid()` is not the app user's identity unless the app is migrated to Supabase Auth. Service-role access is currently the Worker path.
- Refresh import source schemas are not in this repo; implement the comparison contract against a staging table and require a schema confirmation checkpoint.

## Resources

- `MASTER_PLAN.md`
- `MASTER_PLAN_NAME_HISTORY_ADDENDUM.md`
- `ARCHITECTURE.md`
- `MIGRATION_TO_VERCEL_SUPABASE.md`
- `SUPABASE_CHANGELOG.md`
- `worker/src/repos/leadsRepo.js`
- `worker/src/index.js`
- `worker/src/services/nppes.js`
- `worker/src/lib/auth.js`

