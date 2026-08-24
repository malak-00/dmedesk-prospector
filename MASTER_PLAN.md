# DME Desk Prospector Master Plan

## Current objective

Finish the BD Meetings audit and make duplicate/ownership checks safe before any new import or reassignment.

## Working rules

- Do not import a lead until its NPI passes duplicate and owner preflight.
- Do not reassign an existing claim without an explicit approved owner decision.
- Ignore rows with `SUB = SUB`, Entourage Me UAE, George, and Russ according to the audit rules.
- Jane maps to Kaity James.
- Normalize phone fields by extracting the first valid 10-digit number from mixed text or multi-phone cells.
- Treat same NPI as a definite duplicate; treat same identity group as a review signal.

## Phases

1. **File organization** — move working CSV/Python artifacts into `temp/`; keep `PIS_TO_RESOLVE.csv` in the root as the active manual-resolution file.
2. **Meeting reconciliation** — resolve duplicate workbook rows and owner conflicts using the meeting owner.
3. **NPI enrichment** — use the local `august.db`; accept only exact legal name plus phone or authorized-person corroboration.
4. **Preflight** — check every accepted NPI against Supabase for existing claims and owners.
5. **Import/reassignment** — perform only explicitly approved clean imports or owner changes.
6. **Application hardening** — add indexed identity-group checks to dmedesk-prospector so future claims stop on NPI or identity-owner conflicts.

## Current known state

- 319 source rows reconciled: 191 resolved, 86 unresolved, 42 ignored in the earlier audit state.
- The current review artifacts contain the remaining NPI and ownership decisions.
- Med Supplies Express was identified as a Selene meeting with an existing Rick claim and is documented for preflight.
- `npi_records` strict grouping uses company name + state + authorized official + normalized phone.

## Completion criteria

- `PIS_TO_RESOLVE.csv` is reviewed and decisions are explicit.
- Accepted NPIs have passed Supabase duplicate/owner preflight.
- No unapproved claim is deleted, reassigned, or overwritten.
- Final import and reassignment logs are saved in `temp/`.
