# DME Desk Prospector Documentation

This is the canonical documentation index for DME Desk Prospector.

## 1. Multi-Agent & Multi-Contributor Collaboration System

Multiple human engineers and AI assistants actively develop and maintain this codebase:
- **Engineers**: Ben Arthur, Malak Adam
- **AI Systems**: Antigravity, Claude, OpenAI Codex

To prevent context drift, hallucinations, and conflicting implementations, **all contributors must follow this strict file tree division**:

| Directory | Purpose | Lifecycle & Authority |
|---|---|---|
| [`architecture/`](architecture/) | Current live-system architecture as built | **Authoritative (Live State)**: Describes active boundaries, models, and APIs. |
| [`plans/`](plans/) | Stable roadmaps, feature specifications, and system integration designs | **Authoritative (Target State)**: Approved architectural blueprints and protocols. |
| [`planning/`](planning/) | Active working checklists, scratch investigation notes, and task boards | **Ephemeral (WIP)**: Working material; safe to draft and iterate on. |
| [`operations/`](operations/) | Chronological worklog, live database migration logs, and deployment handoffs | **Authoritative (Historical Evidence)**: Exact record of what was executed and deployed. |
| [`reference/`](reference/) | Historical migration docs and legacy designs | **Reference Only**: Background context; do not assume active. |
| [`reviews/`](reviews/) | Audit reports, test sweeps, and compatibility reviews | **Guardrails**: Lessons learned and regression checks. |

---

## 2. Quick Links: Where to Start

1. **System Map**: [Architecture](architecture/ARCHITECTURE.md) — live Worker + Supabase + static frontend boundaries.
2. **Current Master Roadmap**: [Master Plan](plans/MASTER_PLAN.md) — canonical roadmap and phase statuses.
3. **Execution History**: [Worklog](operations/WORKLOG.md) — dated record of every completed deployment and database migration.
4. **Lead Intake & Grouping**: [Lead Intake Guide](plans/LEAD_INTAKE_AND_GROUPING_GUIDE.md) — business grouping rules and duplicate detection.
5. **Sheet Import Protocol**: [Sheet Lead Import Protocol](plans/SHEET_LEAD_IMPORT_PROTOCOL.md) — standardized protocol for qualifying, enriching, and claiming sheet leads.
6. **Sheet Sync Bridge**: [BD Meetings Sync Bridge Plan](plans/BD_MEETINGS_SYNC_BRIDGE_PLAN.md) — live automated connection between Google Sheets and Prospector.

---

## 3. Core Operational Invariants for AI Agents

Whenever any agent (Antigravity, Claude, or Codex) works in this repository:
1. **Never write docs to `docs/`**: `docs/` is the deployed client-side web application frontend. Documentation belongs strictly under `documentation/`.
2. **Consult `operations/WORKLOG.md` before assuming state**: Never infer production status solely from a plan in `plans/` or `planning/`. If it is not logged in `WORKLOG.md`, it has not been deployed.
3. **Document live changes**: Whenever a schema modification, migration, or critical pipeline run is executed, append a dated entry to [`operations/WORKLOG.md`](operations/WORKLOG.md).
4. **Respect repository boundaries**:
   - Live API & Auth: `worker/`
   - Live Frontend: `docs/`
   - Migrations: `sql/`
   - Supporting / External Tools: `scripts/` and `C:\Users\ben.arthur\Desktop\BD MEETINGS 2026`
   - Legacy: `backend/` and `appscript/`
