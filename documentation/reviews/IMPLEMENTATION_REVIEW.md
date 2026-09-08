# Implementation Review: Identity and Ownership Hardening

## Executive summary

The work so far has added a new, isolated data layer for provider identity
grouping and audit history. The current Worker application has not been
changed to depend on it yet, so search, authentication, claiming, exports,
lead status, notes, reminders, and admin views continue to use the existing
tables and routes.

The main compatibility rule going forward is: additive SQL first, application
adoption second, constraint tightening last. We should not change the existing
lead lifecycle until the new data has been validated and the Worker has a
backward-compatible path for older rows.

## What we have done

### 1. Confirmed the active system

- The active implementation is the Cloudflare Worker in `worker/`.
- It uses the DME Desk Supabase project, not the separate fakeNPI project.
- The DME Desk database contains `app_users`, `leads`, and `npi_records`.
- The existing custom authentication remains `app_users` + bcrypt + JWT.

### 2. Ran the read-only schema checkpoint

The checkpoint confirmed that the required NPPES identity fields exist in
`npi_records`:

- `npi`
- `name`
- `address_state`
- `authorizedofficial_firstname`
- `authorizedofficial_lastname`
- `phone`
- `authorizedofficial_phone`

Existing lead indexes were preserved, including the active-claim uniqueness
index `idx_leads_npi_claimed_by_active`.

### 3. Installed the additive schema

`001_identity_schema.sql` was manually applied successfully. It created:

- `lead_groups`
- `lead_group_members`
- `refresh_runs`
- `lead_ownership_events`
- `provider_field_history`
- `leads.group_id`

It also added indexes, RLS to the new tables, and append-only triggers to the
two history tables.

No existing lead rows were populated or deleted by this step.

### 4. Prepared the backfill

The backfill creates deterministic groups from:

`normalized name + state + authorized official + first valid 10-digit phone`

When those signals are incomplete, it creates a singleton group for the NPI so
every existing lead can eventually have a non-null group without guessing that
two providers are the same entity.

The safe version also preserves an existing NPI membership if the backfill is
rerun after a manual review.

## What we are trying to achieve

The target system should:

1. Keep every valid lead and NPI record.
2. Track real-world provider identity across name, phone, and NPI changes.
3. Prevent a user from claiming an NPI whose identity group is actively owned
   by another user.
4. Record every claim, reassignment, release, and provider-data change.
5. Record provider field history before replacing old values.
6. Surface high-signal changes for admin review.
7. Require explicit approval for ambiguous grouping and ownership changes.
8. Preserve the existing application behavior during the migration.

## Why the current app should not break

The applied schema change is additive:

- Existing table names and existing columns were not removed or renamed.
- Existing lead indexes and uniqueness rules were not changed.
- Existing Worker queries do not require `group_id` to be populated.
- New tables are protected from browser roles and are intended to be accessed
  by the server-side service-role Worker path.
- The new audit triggers apply only to the new audit tables, not to `leads`.
- No existing claims were reassigned or deleted.

The backfill itself updates only `leads.group_id` and inserts audit records. It
does not change `claimed_by`, `claimed_at`, status, notes, reminders, or lead
provider fields.

## Compatibility guardrails for the remaining work

### SQL guardrails

- Never drop or rename an existing column during this migration.
- Do not make `leads.group_id` `NOT NULL` until verification proves every lead
  has a valid group.
- Do not replace the existing active-claim unique index until the new claim
  behavior is deployed and tested.
- Do not add triggers to `leads` that silently change ownership or provider
  fields.
- Do not delete duplicate leads as part of grouping; grouping is advisory and
  auditable.
- Do not overwrite a reviewed `lead_group_members` decision on rerun.
- Keep all schema changes in reviewed SQL files and apply them manually.
- Run read-only verification after every mutating SQL file.

### Application guardrails

- Existing routes must continue working when `group_id` is null during the
  transition.
- Claiming must use the new group check only after the SQL/RPC contract exists.
- The new group conflict response must be an explicit error/review signal, not
  a silent claim failure or automatic reassignment.
- Reassign and release must be new explicit operations; existing disconnect
  behavior must not be reinterpreted without a compatibility decision.
- Provider refresh logic must compare canonical values and write history before
  updates.
- New admin endpoints must be server-side admin-gated; hiding a frontend tab
  is not an authorization control.

## Current state

Completed:

- Schema checkpoint against the correct project.
- `001_identity_schema.sql` applied and verified.
- Safe backfill SQL prepared.
- Current Worker JavaScript syntax validation passed.

Not yet completed:

- Identity backfill execution.
- Tier 2 fuzzy review generation.
- Atomic group-aware claim operation.
- Reassign/release APIs.
- Group/history APIs.
- NPPES and Medicare refresh tracking.
- Final NPI preflight and import/reassignment decisions.

## Recommended next step

Run the safe backfill only after preserving the output of the current database
backup/export:

```powershell
supabase db query --linked --file sql/002_identity_backfill_safe.sql
```

Then run the read-only checks in:

```powershell
supabase db query --linked --file sql/003_identity_verification.sql
```

The expected result is zero leads without groups, zero duplicate memberships,
zero missing historical claim events, and a reviewable list of any groups with
multiple active owners. Any active-owner conflict must be reviewed; it must not
be automatically reassigned.

