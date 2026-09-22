# DME Desk Prospector documentation

This is the documentation index for the live DME Desk Prospector system.

## Which folder to use

| Folder | Use it for | Authority |
|---|---|---|
| `plans/` | Stable roadmaps, feature specifications, and design decisions | Current target behavior; check status headers |
| `planning/` | Active working notes, investigation checklists, and temporary implementation planning | Working material; may be superseded |
| `operations/` | Chronological worklog, deployment handoffs, and database-change history | Evidence of what was actually done |
| `architecture/` | Current live-system architecture | Current implementation boundary |
| `reference/` | Historical migration/design references | Background only unless explicitly marked current |
| `reviews/` | Completed implementation and compatibility reviews | Historical evidence and guardrails |

## Start here

1. [Architecture](architecture/ARCHITECTURE.md) — what is live now.
2. [Master plan](plans/MASTER_PLAN.md) — canonical roadmap and phase status.
3. [Worklog](operations/WORKLOG.md) — dated record of completed work.
4. [Internal provider-search handoff](operations/INTERNAL_PROVIDER_SEARCH_CUTOVER_HANDOFF.md) — current search-source cutover status.
5. [Active working checklist](planning/task_plan.md) — implementation details not yet folded into the master plan.

## Current status snapshot — 2026-09-22

- Live application path: `worker/` API + `docs/` frontend + Supabase.
- Apps Script and `backend/` are historical/reference implementations.
- Internal provider search is implemented in code but production cutover remains a separately verified operation.
- Taxonomy lookup fallback for legacy blank descriptions is implemented; see the dated worklog entry.
- Search-more repetition is an open audit item; it is not marked fixed.

## Document status vocabulary

- **Current:** safe starting point for implementation or operations.
- **Working:** active notes that may change as the investigation continues.
- **Historical:** retained for context; do not treat its unchecked statements as current.
- **Superseded:** retained because it records an earlier decision, but another document is authoritative.

When a document makes a claim about production, confirm it against
`operations/WORKLOG.md` and the relevant deployment handoff. Do not infer
production state from a plan alone.
