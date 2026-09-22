# Agent Instructions — dmedesk-prospector

This repository contains the DME Desk Prospector application. The live path is a Cloudflare Worker API in `worker/` with the deployed static frontend in `docs/`, backed by Supabase. `backend/` and `appscript/` are legacy/supporting implementations; do not treat them as the live path without confirming the request.

## Documentation and planning

- Keep plans, operational notes, architecture notes, and worklogs under `documentation/` (`plans/`, `planning/`, `operations/`, `reference/`, or `reviews/`).
- Never place project documentation in `docs/`; `docs/` is the deployed browser frontend and its assets.
- Significant fixes, schema changes, migrations, and architectural work must add a dated section to `documentation/operations/WORKLOG.md` with Objective, Actions Completed, Database / System Result, and Safety Status.
- Keep active planning documents synchronized as implementation decisions are made. Use relative links and verify new links resolve.

## Safety and implementation rules

- State assumptions before coding and make surgical changes only in files relevant to the request.
- Never run `DROP`, `TRUNCATE`, broad `DELETE`, bucket destruction, or production mutations without explicit user consent and a verified target.
- Preserve append-only audit behavior and existing claim/ownership rules. Prefer reviewed SQL migrations and local verification before any production schema change.
- Do not use automated browser testing. Provide the user with the relevant URL and ask them to test manually in their browser.
- Keep secrets out of source, logs, plans, and worklogs. Do not modify `.env`, deployed secrets, or production data unless explicitly requested.

## Repository boundaries

- Live API and authentication: `worker/`.
- Live frontend: `docs/`.
- Database migrations and schema references: `sql/` and `supabase/`.
- Legacy/supporting paths: `backend/` and `appscript/`.
- Related spreadsheet workflow: `C:\Users\ben.arthur\Desktop\BD MEETINGS 2026`; coordinate cross-repository changes explicitly.

## Environment and tooling

- Use PowerShell only. Do not use `cmd`, `cmd /c`, or Unix shell commands.
- The system PATH is not configured. Use absolute executable paths.
- No administrator privileges are available; never request elevation.
- Use the repository's pinned Node/npm tooling where available and run checks from the relevant subproject directory.

## Verification handoff

- Use `rg` first for code searches.
- Run safe, relevant static checks and unit tests; do not claim deployment or production verification unless it actually occurred.
- Summarize changed files, checks run, database impact, and any manual deployment/browser steps still required.
