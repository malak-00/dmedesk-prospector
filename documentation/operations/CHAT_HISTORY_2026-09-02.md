# DME Desk Prospector — Working History Through 2026-09-02

## Purpose

This document records the decisions, database work, verification results, and
remaining implementation work discussed during the lead identity, ownership,
and NPPES refresh planning effort. It is a durable handoff document, not a
replacement for `MASTER_PLAN.md`.

## Project direction

The objective is to turn the current claimed-lead workflow into a system that
can:

- identify a real-world provider across name, phone, and NPI changes;
- prevent silent ownership conflicts;
- record all claim, reassignment, release, and significant provider-data
  changes;
- process weekly NPPES changes, monthly NPPES full files, deactivation files,
  and monthly Medicare data safely;
- preserve the existing sales workflow while provider data is refreshed.

The primary compatibility rule is additive schema first, data backfill second,
application adoption third, and only then stricter enforcement. Existing claims
must never be deleted, silently reassigned, or overwritten by an import.

## Active implementation and projects

### Active codebase

- `worker/` is the active API implementation: a Cloudflare Worker using Hono
  and a Supabase service-role client.
- `docs/` is the current static frontend.
- `appscript/` and `backend/` are historical/reference implementations.
- Authentication is custom `app_users` + bcrypt password hashes + stateless
  JWTs; it is not Supabase Auth.

### Supabase projects

Two projects were involved and were initially easy to confuse:

| Project | Reference | Role |
|---|---|---|
| fakeNPI | `zvthhjediuelpvzkkzvy` | Earlier self-hosted NPI search implementation |
| DME Desk Prospector | `pcvyrkisvvtiteoiuplg` | Current application database; owns leads and now also has `npi_records` |

The correct project for ownership, lead groups, refresh tracking, and future
NPI ingestion is DME Desk Prospector.

The current Worker configuration still defaults to the fakeNPI Edge Function
through `FAKENPI_BASE_URL`. The intended future direction is to remove that
dependency and query the DME Desk `npi_records` table directly through the
Worker's existing server-side Supabase client. No separate fakeNPI project or
new public/internal Edge Function is needed for normal Worker search once this
is implemented.

## Existing data model before this work

### `leads`

The sales workflow table. It stores:

- `npi`;
- `claimed_by`, `claimed_at`;
- provider snapshot fields (company name, phone, address, specialty, Medicare
  values, NPPES update date);
- sales fields (`status`, notes, reminder);
- `is_disconnected`.

Existing indexes included:

- `idx_leads_npi`;
- `idx_leads_claimed_by` for active claims;
- `idx_leads_npi_claimed_by_active`, a partial unique index on `(npi,
  claimed_by)` for active claims;
- `idx_leads_status_updated_by`.

### Current claim behavior

The Worker currently claims leads through the export route and
`worker/src/repos/leadsRepo.js`. It performs a read-then-insert check through
the Supabase REST client. That is sufficient for its current exact-NPI rule,
but it is not safe enough for a future group-level ownership check because two
simultaneous requests can pass a client-side pre-check before either inserts.

Group-aware claims therefore require an atomic database-side RPC/SQL operation
or a transaction-capable server-side contract.

### `npi_records`

The DME Desk project has a copied NPI table using fakeNPI-compatible headers:

- `npi` (primary key);
- `name`, `enumerationtype`, `isorganization`, `status`;
- address fields;
- provider `phone`;
- taxonomy fields;
- authorized-official fields;
- `lastupdated` and `enumeration_date`.

The required identity fields were verified present:

- `npi`;
- `name`;
- `address_state`;
- `authorizedofficial_firstname`;
- `authorizedofficial_lastname`;
- `phone`;
- `authorizedofficial_phone`.

## Python input workflow discovered

The existing external formatter is:

`C:\Users\ben.arthur\AppData\Local\Programs\Python\Python313\nppes_filter.py`

It currently:

- uses a hardcoded NPPES CSV file path and output directory;
- filters by state, taxonomy codes, Last Update Date, and Enumeration Date;
- can output a filtered CSV, SQLite database, or both;
- supports up to 15 NPPES taxonomy columns;
- creates a local taxonomy lookup table for SQLite output.

It does not currently:

- read enabled taxonomies from DME Desk's `taxonomies` table;
- create a durable refresh manifest/run record;
- map raw NPPES fields directly into DME Desk `npi_records` staging;
- detect data changes against the current database;
- write history before updating provider data;
- handle deactivation files as a distinct source type;
- safely upload/apply data to the DME Desk project.

The repository also contains `scripts/migrate_npi_records.py`, a one-off CSV
loader that inserts fakeNPI-shaped CSV data into `npi_records` in batches. It
uses hardcoded paths and plain inserts, so it is not appropriate for recurring
monthly or incremental refreshes.

## SQL files prepared

The following manual SQL bundle was added under `sql/`:

| File | Purpose | Status |
|---|---|---|
| `000_schema_checkpoint.sql` | Read-only confirmation of required tables, columns, and indexes | Executed |
| `001_identity_schema.sql` | Adds identity, audit, and refresh-run schema | Executed |
| `002_identity_backfill.sql` | First draft of backfill | Do not run; superseded |
| `002_identity_backfill_safe.sql` | Safe one-time identity and historical-claim backfill | Executed |
| `003_identity_verification.sql` | Read-only validation queries | Executed; CLI only displays last result of a multi-statement file, so checks were also run separately |

## Schema changes applied manually

`001_identity_schema.sql` was applied to DME Desk Prospector successfully.

### Tables created

- `lead_groups` — stable real-world provider identity group.
- `lead_group_members` — maps each NPI to one group, including relationship
  and review metadata.
- `refresh_runs` — one row per NPPES or Medicare import/apply run.
- `lead_ownership_events` — append-only claim/ownership and provider-alert
  history.
- `provider_field_history` — append-only provider old/new field value history.

### Existing table extended

- `leads.group_id uuid` was added with a foreign key to `lead_groups`.

### Protections added

- Indexes for group membership, group/event history, review events, provider
  history, refresh runs, and `leads.group_id`.
- RLS enabled on all newly added tables.
- Browser roles `anon` and `authenticated` revoked from the new tables; the
  current Worker service-role path is the intended access path.
- Append-only triggers on `lead_ownership_events` and
  `provider_field_history`; updates and deletes of audit rows are rejected.

### Verification of schema installation

The following were confirmed with read-only Supabase queries:

- all five new tables exist;
- `leads.group_id` exists and is nullable;
- all planned indexes exist;
- RLS is enabled on the five new tables;
- append-only triggers exist on both audit tables.

No existing Worker, frontend, App Script, or backend source file was changed
when this schema was applied.

## Lead identity grouping backfill

### Rule used

The deterministic Tier 1 grouping key is:

```text
normalized organization name + state + authorized official + first valid 10-digit phone
```

Normalization strips punctuation/whitespace, uppercases identity text, and
extracts the first valid 10-digit number from provider phone, falling back to
authorized-official phone.

If any strict signal is unavailable, the backfill creates a singleton group:

```text
singleton:<npi>
```

This deliberately avoids inferring that two providers are the same entity from
only a name match. Tier 2 fuzzy matching is not yet implemented.

### Safety correction

The original backfill draft could have overwritten a previously reviewed NPI
membership during a rerun. It was superseded by
`002_identity_backfill_safe.sql`, which uses `ON CONFLICT (npi) DO NOTHING` to
preserve an existing membership decision.

### Backfill results

The safe backfill was manually executed on DME Desk Prospector.

| Check | Result |
|---|---:|
| Total leads | 4,599 |
| Leads without `group_id` | 0 |
| Unique NPI memberships | 4,495 |
| Total memberships | 4,495 |
| Strict groups | 4,168 |
| Singleton groups | 315 |
| Historical `claimed` events inserted | 3,494 |
| Claimed leads missing historical claim event | 0 |
| Exact-NPI active ownership conflicts | 0 |
| Group-level active ownership conflicts | 2 groups |

The difference between 4,599 leads and 4,495 unique NPIs reflects historical
or disconnected rows sharing an NPI; each NPI has exactly one group membership.

### Existing group-level ownership conflicts

The backfill did not create or change any ownership. It exposed two existing
conflicts that must remain review cases until an explicit owner decision exists.

| Group | NPIs | Current active owners |
|---|---|---|
| 1FOOT 2FOOT Centre for Foot and Ankle Care, PC (VA) | `1548921265`, `1831477868` | Rick Nelson; Kaity James |
| Advanced Home Medical Supplies Inc. (CT) | `1598747552`, `1891506093` | Nora Atkins; Rick Nelson |

Detailed current claims at the time of verification:

| Provider | NPI | Owner | Claimed at (UTC) |
|---|---|---|---|
| 1FOOT 2FOOT Centre for Foot and Ankle Care, PC | `1548921265` | Rick Nelson | 2026-07-06 14:39:53 |
| 1FOOT 2FOOT Centre for Foot and Ankle Care, PC | `1831477868` | Kaity James | 2026-08-11 15:35:04 |
| Advanced Home Medical Supplies Inc. | `1598747552` | Nora Atkins | 2026-07-06 19:43:06 |
| Advanced Home Medical Supplies Inc. | `1891506093` | Rick Nelson | 2026-07-17 14:03:13 |

No claim should be reassigned until a human makes an explicit approved-owner
decision and the future reassignment path writes a corresponding audit event.

## Current compatibility state

The applied database work is additive and has not changed the live app flow.

### Unchanged behavior

- Existing lead claims still use the existing exact-NPI flow.
- Search still uses the Worker’s configured fakeNPI API dependency.
- Authentication remains custom JWT authentication.
- Claimed Lead views, exports, status updates, notes, reminders, and admin
  views use their existing routes and table fields.
- No claim, status, note, reminder, disconnect value, or provider snapshot was
  overwritten by identity grouping.

### New data currently unused by application code

- `leads.group_id`
- `lead_groups`
- `lead_group_members`
- `lead_ownership_events`
- `provider_field_history`
- `refresh_runs`

The data exists and is validated, but the Worker has not yet been changed to
read/write it in runtime behavior.

## Documentation created and organized

### Active/canonical root documents retained

- `README.md`
- `MASTER_PLAN.md`
- `ARCHITECTURE.md`
- `MIGRATION_TO_VERCEL_SUPABASE.md`
- `SUPABASE_CHANGELOG.md`
- `agents.md`
- `task_plan.md`
- `findings.md`
- `progress.md`

### Documentation organization

- Feature plans: `documentation/plans/`
- Reviews: `documentation/reviews/`
- Operational logs: `documentation/operations/`
- Historical notes: `temp/archive/`
- Audit records: `temp/audits/`

`MASTER_PLAN.md` was updated to remove stale machine-specific `file:///` links
and point to repository-relative documents. An external `LEAD_GROUPING_PLAN.md`
reference remains documented as an external working document not present in the
repository.

## Detailed change-tracking and refresh design

The detailed design lives in:

`documentation/plans/PROVIDER_CHANGE_TRACKING_PLAN.md`

Key decisions:

- `npi_records` is the canonical current NPPES provider record.
- Medicare data should have a defined current canonical table/columns, with
  historical values stored in `provider_field_history`.
- `leads` is sales data and retains ownership/status/notes/reminders.
- `provider_field_history` records every provider-owned field change before
  current data is overwritten.
- `lead_ownership_events` produces pending admin-review alerts for meaningful
  changes: name, phone, authorized official, deactivation/status, city/state,
  and Medicare claims drop greater than 50% month over month.
- A provider name or phone change requests group re-evaluation; it does not
  silently merge groups or move membership.

## Intended unified architecture

The confirmed direction as of 2026-09-02 is:

```text
Raw NPPES monthly / weekly / deactivation files
  -> repository-owned Python ingestion CLI
  -> DME Desk Supabase staging tables
  -> transactional compare/history/current-data update
  -> npi_records + provider_field_history + review events
  -> Worker queries same-project npi_records directly
  -> existing frontend receives the current response shape
```

### Python ingestion CLI requirements

Refactor the existing `nppes_filter.py` logic into a repository-owned, typed,
command-line Python tool. It should:

- accept source path, run type, release date/version, output/run label, and
  optional state/taxonomy filters as arguments rather than hardcoded paths;
- read enabled taxonomy codes from `public.taxonomies` by default;
- support `monthly-full`, `weekly-incremental`, and `deactivation` run types;
- map raw NPPES headers to the existing fakeNPI-compatible `npi_records`
  columns;
- validate NPI format, duplicate NPI rows, taxonomy inclusion, required source
  fields, and expected source count;
- calculate a source checksum and write a manifest with source metadata and
  accepted/rejected counts;
- upload normalized rows to staging, never directly to `npi_records`;
- retain rejected rows/errors in an inspectable output/report;
- use environment configuration for Supabase credentials and never commit
  secrets or personal machine paths.

### Required database additions for refreshes

Future manual SQL must add:

- `nppes_refresh_staging` keyed by `(refresh_run_id, npi)`;
- `medicare_refresh_staging` keyed by `(refresh_run_id, npi)`;
- a canonical current Medicare enrichment data model;
- staging indexes by run and NPI;
- a controlled transactional refresh procedure/RPC;
- validation and reconciliation queries.

The procedure must do the following in one transaction:

1. Validate staging data.
2. Compare canonical values with current data.
3. Insert all changed-field history records.
4. Insert new NPIs or update `npi_records`.
5. Update only provider-owned snapshots for affected active `leads`.
6. Insert review events for high-signal changes.
7. Mark `refresh_runs.status = 'applied'` only after success.

It must never modify `claimed_by`, `claimed_at`, sales status, notes, reminders,
or `is_disconnected`.

### Worker/runtime changes required

1. Replace the fakeNPI API dependency with direct same-project `npi_records`
   queries through the existing Worker service-role client.
2. Preserve the current normalized provider/search response shape so the
   frontend does not need a major rewrite.
3. Add an atomic group-aware claim RPC contract that checks active claims in
   the group, inserts/updates the lead as appropriate, and writes an ownership
   event in one operation.
4. Add explicit admin-only reassign/release paths, both with required reason
   and approval information.
5. Add group and history endpoints:
   - `GET /leads/:npi/group`
   - `GET /groups/:id/history`
   - `POST /groups/:id/members` for admin review decisions.
6. Add an admin review interface/API for pending ownership and provider-change
   events.

## Work not yet implemented

- Repository-owned recurring NPPES/Medicare ingestion CLI.
- Staging tables and transactional refresh SQL.
- Direct DME Desk `npi_records` search in the Worker.
- Tier 2 RapidFuzz possible-duplicate review generation.
- Group-aware atomic claim operation.
- Reassignment and release APIs.
- Group/history/admin-review API endpoints and UI.
- Medicare current-data model and refresh pipeline.
- Automated scheduling for weekly/monthly source runs.
- Formal test suite for the Python ingestion tool and new Worker behavior.

## Recommended implementation order

1. Build the repository-owned Python ingestion CLI and fixture tests.
2. Deliver manual SQL for staging and transactional NPPES refresh, then test it
   with a small monthly fixture.
3. Add the Worker direct-query repository for same-project `npi_records`,
   preserving current frontend data shapes.
4. Add refresh verification reports and provider-change review events.
5. Add group-aware atomic claim behavior and resolve the two pre-existing
   ownership conflicts through explicit decisions.
6. Add reassign/release and group/history review endpoints/UI.
7. Add Medicare staging/current data and monthly change tracking.
8. Add scheduled operational runs after manual runs are proven reliable.

## Operational rules to retain

- All Supabase schema/data changes are delivered as SQL files for manual review
  and execution by the user.
- Execute read-only validation queries after each mutating SQL step.
- Do not run the superseded `sql/002_identity_backfill.sql`.
- Preserve `PIS_TO_RESOLVE.csv` as the manual resolution file until individual
  decisions are explicitly approved.
- Ignore audit rows matching the established exclusion rules (`SUB = SUB`,
  Entourage Me UAE, George, Russ); map Jane to Kaity James.
- Treat same NPI as a definite duplicate and same group as a review signal.
- A fuzzy name match without corroborating phone, official, or address evidence
  must never auto-group records.

