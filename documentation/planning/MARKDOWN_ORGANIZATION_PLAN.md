# Markdown Organization Plan

**Status:** Current documentation policy
**Last reviewed:** 2026-09-22

## Goal

Keep active plans, working notes, operational evidence, architecture, and
historical references separate enough that an old proposal cannot be mistaken
for the current application behavior.

## Folder policy

- `documentation/plans/` contains stable roadmaps, feature specifications,
  and design decisions.
- `documentation/planning/` contains active working checklists, findings,
  investigations, and temporary drafts. These may be superseded.
- `documentation/operations/` contains dated worklogs, deployment handoffs,
  and database-change history. It is the evidence of what was done.
- `documentation/architecture/` contains the current live-system boundary.
- `documentation/reference/` contains historical migration and design
  references.
- `documentation/reviews/` contains completed reviews and compatibility
  assessments.
- `docs/` remains the deployed frontend; project documentation must not be
  placed there.

The canonical entry point is [documentation/README.md](../README.md).

## Current homes

```text
documentation/
  README.md
  plans/
    MASTER_PLAN.md
    LEAD_INTAKE_AND_GROUPING_GUIDE.md
    MASTER_PLAN_NAME_HISTORY_ADDENDUM.md
    NAME_CHANGE_OWNERSHIP_PLAN_DRAFT.md
    PHONE_DELETION_AND_DISCONNECTED_GROUP_HANDLING.md
    PROVIDER_CHANGE_TRACKING_PLAN.md
  planning/
    task_plan.md
    findings.md
    MARKDOWN_ORGANIZATION_PLAN.md
    feature plans and dated working notes
  architecture/
    ARCHITECTURE.md
  operations/
    WORKLOG.md
    SUPABASE_CHANGELOG.md
    deployment handoffs and historical logs
  reference/
    MIGRATION_TO_VERCEL_SUPABASE.md
  reviews/
    IMPLEMENTATION_REVIEW.md
    EDIT_OVERVIEW.md
```

Outside this folder, keep `README.md` as the repository entry point,
`agents.md`/`AGENTS.md` as environment instructions, `worker/README.md` as
Worker operations, and `sql/README.md` as the manual SQL guide.

## Status requirements

Every document that can become stale should state its status and review date.
Use these labels:

- **Current** — safe starting point.
- **Working** — active notes that may change.
- **Historical** — retained for context only.
- **Superseded** — retained, but another document is authoritative.

The following files are intentionally historical working notes and should not
be used as the current roadmap: `planning/progress.md`,
`planning/plan-sept-8.md`, and `planning/sept17.md`.

## Link rules

- Use repository-relative Markdown links.
- Do not use machine-specific `file:///C:/Users/...` links for files in this
  repository.
- From a file under `documentation/plans/`, link to another plan as
  `./OTHER_PLAN.md`.
- From a file under `documentation/planning/`, link to a plan as
  `../plans/OTHER_PLAN.md`.
- Link to external sister repositories only by clearly labelled path or
  operational handoff; do not pretend those files are inside this repository.

## Completion state

This organization policy is applied in stages. The index and status vocabulary
are current. Remaining cleanup is to add status/review headers to older
documents and repair remaining machine-specific links.
