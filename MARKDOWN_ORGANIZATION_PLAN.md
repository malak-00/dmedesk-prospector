# Markdown Organization Plan

## Goal

Make the project documentation easy to navigate without breaking relative
links, agent instructions, SQL execution guidance, or the active application.

## Principles

- Keep the canonical project entry points visible at the repository root.
- Keep `task_plan.md`, `findings.md`, and `progress.md` at the root because the
  planning workflow expects them there.
- Keep `README.md` at the root.
- Keep `worker/README.md` beside the Worker package.
- Keep `sql/README.md` beside the manual SQL bundle.
- Keep `agents.md` at the root because it is environment guidance, even though
  it is currently empty.
- Do not place project Markdown inside `docs/`; that directory is the static
  frontend and its assets.
- Move documents with link-aware commands, then repair relative links and
  verify every Markdown reference.

## Proposed structure

```text
README.md                         # project entry point
MASTER_PLAN.md                    # canonical roadmap
ARCHITECTURE.md                  # canonical system architecture
MIGRATION_TO_VERCEL_SUPABASE.md  # migration/reference architecture
SUPABASE_CHANGELOG.md             # chronological database history
agents.md                         # local environment instructions
task_plan.md                      # active planning memory
findings.md                       # active discovery notes
progress.md                       # active session log

documentation/
  plans/
    MASTER_PLAN_NAME_HISTORY_ADDENDUM.md
    NAME_CHANGE_OWNERSHIP_PLAN_DRAFT.md
    PROVIDER_CHANGE_TRACKING_PLAN.md
  reviews/
    IMPLEMENTATION_REVIEW.md
    EDIT_OVERVIEW.md
  operations/
    WORKLOG.md

temp/
  audits/
    BD_MEETINGS_AUDIT.md
  archive/
    findings.md
    progress.md

sql/
  README.md
  000_schema_checkpoint.sql
  ...

worker/
  README.md
```

## File classification

### Keep at root

- `README.md`
- `MASTER_PLAN.md`
- `ARCHITECTURE.md`
- `MIGRATION_TO_VERCEL_SUPABASE.md`
- `SUPABASE_CHANGELOG.md`
- `agents.md`
- `task_plan.md`
- `findings.md`
- `progress.md`

These are the first files a contributor or agent needs to find.

### Move to `documentation/plans/`

- `MASTER_PLAN_NAME_HISTORY_ADDENDUM.md`
- `NAME_CHANGE_OWNERSHIP_PLAN_DRAFT.md`
- `PROVIDER_CHANGE_TRACKING_PLAN.md`

These are feature and design plans supporting the canonical master plan.

### Move to `documentation/reviews/`

- `IMPLEMENTATION_REVIEW.md`
- `EDIT_OVERVIEW.md`

These describe decisions and changes made during implementation rather than
the target architecture itself.

### Move to `documentation/operations/`

- `WORKLOG.md`

This is an operational history and should not compete with the active
`progress.md` file.

### Move within `temp/`

- `temp/BD_MEETINGS_AUDIT.md` → `temp/audits/BD_MEETINGS_AUDIT.md`
- `temp/findings.md` → `temp/archive/findings.md`
- `temp/progress.md` → `temp/archive/progress.md`

These are historical artifacts, not active project guidance.

## Execution sequence

1. Inventory all Markdown links with `rg -n "\\]\([^)]*\\.md|file:///"`.
2. Create the destination directories.
3. Move files with `git mv` so Git preserves history.
4. Update links in `README.md`, `MASTER_PLAN.md`, and any moved documents.
5. Replace obsolete `file:///` links with repository-relative links where the
   target exists in this repository.
6. Run the link/reference scan again.
7. Check that frontend files under `docs/`, SQL files under `sql/`, and Worker
   files under `worker/` are unchanged.
8. Review the final tree and commit the documentation-only change separately
   from application/database work.

## Risks and safeguards

- Do not move the active planning files out of the root.
- Do not rename `agents.md` casually on Windows; casing/filename changes can
  affect environment tooling.
- Do not move `README.md` or `MASTER_PLAN.md` without updating links from the
  repository README and contributor workflows.
- Do not combine this documentation cleanup with Worker or Supabase changes in
  the same commit.
- Do not delete duplicate historical files; archive them so their context is
  recoverable.

## Completion criteria

- Every Markdown file has one intentional home.
- Root contains only canonical entry points and active planning memory.
- Feature plans, reviews, and worklogs are grouped by purpose.
- Historical temp notes are clearly marked as archived/audit material.
- No broken Markdown links remain.
- No application, SQL, or frontend behavior changes.

