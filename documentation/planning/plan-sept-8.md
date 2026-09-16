# Finalize NPPES CLI and Lead Grouping System

Summary
Complete the NPPES staging CLI and lead-grouping system while preserving the current app flow until each new layer is verified. npi_records remains in the DME Desk Supabase project; fakeNPI is retired only after equivalent same-project search and Medicare enrichment are ready.
CLI and refresh pipeline
Refactor ingestion to stream rows and batches; do not retain every accepted row or rejection in memory for national monthly files.
Write rejects incrementally and maintain manifest counters during processing.
Keep the existing staging command compatible; add explicit recovery commands:--recover-run <uuid>: complete a previously interrupted upload only when database row counts exactly match its expected count.
--abort-run <uuid> --reason <text>: atomically delete staging rows and mark the run failed.

Write a provisional local manifest before remote writes. After a successful database finalization, treat a local manifest-write failure as a recoverable reporting failure, not a reason to delete a complete staging run.
Add SQL lifecycle functions:finalize_nppes_staging(run_id): locks the run, verifies uploading status and exact staging count, then marks it complete.
abort_nppes_refresh(run_id, reason): locks the run, deletes only its staging rows, marks it failed, and records the reason.
apply_nppes_refresh(run_id): only accepts a complete run; writes field history before current-data updates in one transaction.

Preserve source checksum, expected count, actual staged count, failure reason, and staging state as first-class refresh metadata. Reject a repeated completed/applied source checksum unless an explicit operator override is supplied.
Weekly files update only NPIs present in that file. Monthly full files reconcile supplied rows but never infer deactivation from omission. Deactivation files update only status/deactivation data and never null unrelated provider fields.
Grouping, ownership, and claims
Keep lead_group_members for confirmed membership only.
Add a separate candidate-review table for Tier 2 fuzzy matches; one NPI must not be silently placed in multiple groups.
Tier 1 auto-groups only when normalized name, state, authorized official, and first valid phone are all present. Otherwise create/retain a singleton group.
New NPI records receive group membership during the transactional NPPES apply. Name, phone, official, or address changes on an existing member create a review candidate; they never silently move that NPI between groups.
Implement an atomic claim RPC used by the Worker:validates the NPI exists in same-project npi_records;
checks all active claims in its confirmed group;
inserts the lead and claimed event only when no other owner has an active group claim;
returns structured conflict results without changing ownership;
treats a multi-lead claim batch as all-or-nothing.

Add Worker endpoints for NPI/group preflight and group history while retaining the existing export/claim response shape for the frontend.
Keep resolve_ownership_conflict as the only reassignment path. Retain 006’s username placeholders because it verifies exactly one matching username before resolving; do not use display names.
Run 006 only after the approved admin username and target usernames are filled in and verified. It must remain a manual, audited operation.
Same-project search cutover
Add a Worker repository for direct queries to DME Desk npi_records.
Preserve the current normalized search response shape so docs/app.js does not require a rewrite.
Move/copy the current Medicare enrichment data into DME Desk before switching search; direct search must not silently lose Medicare values.
Deploy the direct-query path behind a configuration flag, compare results with fakeNPI for selected searches, then remove the cross-project default only after parity is confirmed.
SQL order and manual execution
For a fresh environment, execute and verify in this order:
001_identity_schema.sql
002_identity_backfill_safe.sql
003_identity_verification.sql
004_nppes_refresh_staging.sql
005_ownership_conflict_resolution.sql
006_resolve_known_conflicts.sql after approved usernames are supplied
New refresh lifecycle/apply SQL
New group-candidate and atomic-claim SQL
For the current production environment, treat 001–003 as already applied and verified; begin with verifying 004/005 status before applying any later SQL.
Test plan
Replace the hardcoded .test-tmp override with an explicit NPPES_TEST_TMP environment setting; document C:\tmp\dmedesk-nppes-tests for this managed PC.
Make the full 26-test suite pass locally, including staging failure, finalization failure, recovery, abort, duplicate source checksum, and manifest-write failure scenarios.
Add fixture tests for:full monthly update;
weekly incremental update;
deactivation-only update;
new NPI;
changed name/phone;
no-op rerun;
incomplete/interrupted staging run;
Tier 1 group creation;
Tier 2 review-only candidate;
exact-NPI and group-level claim conflicts.

Validate SQL with read-only preflight and post-apply queries after every manual execution.
Run Supabase advisors after functions, policies, and indexes are installed.
Assumptions
All Supabase changes remain reviewed SQL for manual execution.
The current custom app_users/JWT model remains in place.
No claim, owner, status, notes, reminder, or disconnect state is changed by NPPES refreshes.
Medicare ingestion remains a separate follow-on pipeline, but direct same-project search cutover waits until current Medicare enrichment is available locally.</proposed_plan>
