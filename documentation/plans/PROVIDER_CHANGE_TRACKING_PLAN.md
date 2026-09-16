# Provider Name and Information Change Tracking Plan

## Current status

The database foundation is installed:

- `refresh_runs` exists to identify each import.
- `provider_field_history` exists to record old and new provider values.
- `lead_ownership_events` can record high-signal provider-change alerts.
- `npi_records` is the canonical provider source used by the search service.

The monthly refresh pipeline itself is not implemented yet. No monthly import
should update `npi_records` or claimed lead snapshots until it goes through the
workflow below.

## Source-of-truth model

| Data | Source of truth | Purpose |
|---|---|---|
| NPPES identity/name/address/phone/status | `npi_records` | Current provider registry data |
| Medicare claims/beneficiaries/payment | Medicare staging/current enrichment data | Current Medicare enrichment |
| Historical provider changes | `provider_field_history` | Audit and investigation |
| Current sales ownership/status/notes | `leads` | Sales workflow; never replaced by an import |
| Review alerts | `lead_ownership_events` with `requires_review = true` | Admin action queue |

The provider import may update provider-owned fields, but it must never change
`leads.claimed_by`, status, notes, reminders, or ownership decisions.

## Monthly NPPES update flow

### 1. Create a refresh run

Create one `refresh_runs` row with:

- `source = 'nppes'`
- source release/version/date
- status `staged`
- source file checksum and row count in `metadata`

The resulting `refresh_run_id` is attached to every staging and history row.

### 2. Load the source into staging

Load the NPPES release into a staging table. Staging is separate from
`npi_records`, so a malformed or incomplete file cannot partially overwrite the
live provider source.

The staging row should retain the raw source values plus canonical values for
comparison:

- NPI
- organization/person name
- address line, city, state, postal code
- provider phone
- authorized official name, title, and phone
- NPI status
- last-updated/enumeration dates
- source row metadata

Reject or quarantine rows with missing/invalid NPI, duplicate NPI rows in the
same release, or an unexpectedly low row count.

### 3. Compare canonical values

Compare staging to `npi_records` using normalized values:

- trim and case-fold text;
- normalize whitespace and punctuation;
- extract the first valid 10-digit phone number;
- compare dates as dates;
- compare numeric Medicare values numerically;
- treat null and empty text consistently.

Only changed fields create history rows. Formatting-only changes should not
create false alerts.

### 4. Write history before updating the source

For each changed field:

1. Insert one `provider_field_history` row containing NPI, field name, old
   value, new value, source, and `refresh_run_id`.
2. For a new NPI, use `old_value = null` and write one history row per loaded
   provider field or one documented initial-snapshot row.
3. Only after history inserts succeed, update or insert `npi_records`.

The compare, history insert, and `npi_records` update must run in one SQL
transaction. If any step fails, roll back the entire refresh run and mark it
`failed`.

### 5. Create review alerts

Create a `lead_ownership_events` row with `event_type = 'provider_data_changed'`
when any of these changes occur:

- provider phone;
- authorized official name, title, or phone;
- organization/provider name;
- NPI deactivation or status change;
- city or state;
- Medicare claims decrease greater than 50% month over month.

Set:

- `requires_review = true`;
- `review_status = 'pending'`;
- `source = 'nppes'` or `source = 'medicare'`;
- `source_ref = refresh_run_id`;
- `metadata` containing changed fields and old/new summary values.

Do not create an alert for ordinary low-risk fields such as dates or taxonomy
metadata unless product rules later require it. Those changes still belong in
`provider_field_history`.

## Monthly Medicare update flow

The Medicare DMEPOS supplier release follows the same sequence:

1. Create a `refresh_runs` row with `source = 'medicare'`.
2. Load the release into Medicare staging keyed by NPI.
3. Compare claims, beneficiaries, payment, services, and other tracked fields
   to the previous current Medicare values.
4. Write `provider_field_history` before replacing current values.
5. Flag a review event when claims drop by more than 50% month over month.
6. Mark the refresh run `applied` only after counts and error checks pass.

The Medicare loader must distinguish “zero claims” from “missing NPI row”. A
missing row in a partial release must not automatically erase existing data.

## How claimed leads are enriched after a refresh

The current `leads` table stores a snapshot captured at claim time. To keep the
existing sales workflow safe:

1. Refresh `npi_records` and Medicare current data first.
2. Find active leads whose NPI changed in the refresh run.
3. Record the changes in `provider_field_history` before touching lead
   snapshots.
4. Update only provider-owned snapshot fields on `leads`:
   `company_name`, `phone`, address fields, contact fields, specialty,
   Medicare fields, and `nppes_last_updated`.
5. Never update `claimed_by`, `claimed_at`, `status`, `notes`, `reminder_at`,
   or disconnect state.
6. Create one `provider_data_changed` review event per affected active lead or
   per affected group, according to the final admin UI design.
7. Recompute the lead's group identity only as a review operation. A name or
   phone change must not silently move a lead into another group.

This lets the Claimed Leads view show current provider information while
preserving the salesperson's activity and ownership history.

## Required SQL additions before implementation

The next SQL bundle should add:

- `nppes_refresh_staging` keyed by `(refresh_run_id, npi)`;
- `medicare_refresh_staging` keyed by `(refresh_run_id, npi)`;
- current Medicare fields or a clearly defined canonical enrichment table;
- indexes on staging run/NPI;
- a transactional refresh function or controlled SQL procedure;
- validation queries for duplicate staging NPIs, row-count thresholds, changed
  counts, and failed runs.

These SQL changes will be delivered for manual execution only.

## Operational cadence

- Weekly NPPES update: stage and apply the weekly file.
- Monthly NPPES full dissemination: use as a reconciliation run and compare
  counts against the weekly state.
- Monthly Medicare DMEPOS release: stage and apply after validating the file.
- After each run: save the run ID, source checksum, row counts, changed-field
  count, review-alert count, and verification output.

## Safety gates

Do not mark a refresh `applied` unless:

- staging has no duplicate NPIs;
- the source row count is within an approved range;
- history rows exist for every changed field;
- no provider update occurs without a preceding history row;
- active lead ownership/status/notes counts are unchanged;
- high-signal changes appear in the review queue;
- the refresh verification SQL returns no missing history rows.

