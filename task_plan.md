# Task Plan: Lead Identity, Ownership Audit, and Provider Refresh Tracking

## Goal

Implement the remaining `MASTER_PLAN.md` phases in the Cloudflare Worker and provide all Supabase schema, backfill, security, and refresh SQL as manually runnable files for the user to apply.

## Current Phase

Phase 1 — Baseline and contract definition

## Constraints

- Supabase changes must be written as SQL only; do not execute SQL against a remote project.
- Active implementation is `worker/`; `appscript/` and `backend/` are reference/legacy paths.
- Preserve existing lead data and ownership; no destructive reassignment or deletion without an explicit approved decision.
- Keep the existing custom `app_users` + bcrypt/JWT model unless implementation discovery proves a migration is required.
- Every schema object in exposed schemas must have appropriate RLS, grants, indexes, and documented service-role access.

## Phases

### Phase 1: Baseline and contract definition

- [x] Read `MASTER_PLAN.md`, addendum, architecture, migration notes, and Supabase change history.
- [x] Inspect current Worker routes, repositories, auth, NPPES normalization, and package scripts.
- [x] Record current schema assumptions and implementation gaps in `findings.md`.
- [ ] Confirm the exact current production schema from the user-provided Supabase export/query before final SQL is applied.
- **Status:** in_progress

### Phase 2: Identity-group SQL and backfill design

- [ ] Write idempotent SQL for `lead_groups`, `lead_group_members`, `lead_ownership_events`, `provider_field_history`, and `leads.group_id`.
- [ ] Add constraints, indexes, append-only protections, RLS, and least-privilege grants.
- [ ] Define normalized identity-key SQL/functions or a deterministic staging output for strict grouping.
- [ ] Define the one-time backfill order: groups → members → `leads.group_id` → historical claim events → Tier 2 review rows.
- [ ] Add validation queries for null groups, duplicate memberships, same-NPI collisions, and ownership conflicts.
- **Status:** pending

### Phase 3: Grouping and preflight tooling

- [ ] Implement a repeatable local/Worker-safe grouping script using normalized name, state, official, phone, and corroborating address signals.
- [ ] Make Tier 1 deterministic and idempotent.
- [ ] Make Tier 2 produce review records only; never auto-group from fuzzy name similarity alone.
- [ ] Add a preflight report for accepted NPIs covering exact duplicate, group membership, active owner, and proposed owner.
- [ ] Test against the known Genome Insight → Inocras possible-successor case and Jane → Kaity mapping.
- **Status:** pending

### Phase 4: Claim, reassign, release, and group-history APIs

- [ ] Refactor claim/export flow to use a single server-side transaction boundary or SQL RPC for conflict check + insert + event.
- [ ] Block claims when another user owns an active lead in the same group; return a reviewable conflict payload.
- [ ] Add explicit admin-only reassign and release operations with required reason/approval metadata.
- [ ] Emit `claimed`, `reassigned`, and `released` events for all paths, including disconnect/return behavior as defined by the final contract.
- [ ] Add `GET /leads/:npi/group`, `GET /groups/:id/history`, and admin `POST /groups/:id/members`.
- [ ] Update frontend handling only where required by response shapes and conflict review UX.
- **Status:** pending

### Phase 5: Refresh staging and provider-change tracking

- [ ] Write SQL for refresh runs/staging inputs if needed, with `refresh_run_id` on history and imported provider rows.
- [ ] Implement compare-before-update logic for NPPES/Medicare fields.
- [ ] Insert `provider_field_history` before overwriting changed values; log new NPIs with `old_value = null`.
- [ ] Generate admin review alerts for phone, official, organization name, deactivation, territory, and >50% claims drops.
- [ ] Keep silent field changes in history without creating review alerts.
- **Status:** pending

### Phase 6: Preflight, migration execution guide, and verification

- [ ] Produce the final SQL bundle in execution order, including rollback/stop conditions and manual checkpoints.
- [ ] Run static tests, unit tests, and route tests locally; do not run remote Supabase mutations.
- [ ] Add SQL verification queries for every completion criterion in `MASTER_PLAN.md`.
- [ ] Process `PIS_TO_RESOLVE.csv` only through explicit decisions and save import/reassignment logs in `temp/`.
- [ ] Review diff, commit implementation and SQL artifacts, and report exact manual Supabase steps.
- **Status:** pending

## Key decisions

| Decision | Rationale |
|---|---|
| Treat `worker/` as the implementation source | `ARCHITECTURE.md` identifies it as the active Supabase/Cloudflare implementation; `appscript/` and `backend/` are legacy/reference. |
| SQL files are deliverables, not executed changes | User explicitly requested manual Supabase implementation. |
| Use append-only ownership and provider history | The master plan requires auditable claims and field changes before overwrite. |
| Separate strict grouping from fuzzy review | A fuzzy name match alone must never auto-group. |
| Prefer one atomic server-side operation for claim conflicts | A client-side pre-check can race with another claim and silently violate the ownership rule. |

## Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| None | 1 | — |

