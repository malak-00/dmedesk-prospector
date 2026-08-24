# Draft Plan: NPI Name Changes and Ownership Changes

## Goal

Prevent valid DME/NPI name changes from being treated as duplicates while preventing a renamed or successor company from silently inheriting or changing ownership.

## Current example for review

`GENOME INSIGHT INC` appears in the meeting data, while the current NPPES result is:

- NPI: `1881462752`
- Legal name: `INOCRAS INC`
- State: `CA`
- Authorized official: `VEENA SINGH`
- Authorized phone: `858-665-2120`
- Meeting owner: Jane, mapped to Kaity James

Because the NPI and phone differ, this is a rename/successor candidate—not an automatic confirmed rename.

## Proposed data model

### 1. Canonical lead identity

Keep the NPI as the primary identity for a provider record. Store the current legal name and current NPPES details on the canonical lead.

### 2. Name history / aliases

Add an `npi_aliases` table or equivalent fields:

- `npi`
- `alias_name`
- `alias_type` (`former_legal_name`, `trade_name`, `reported_name`)
- `source`
- `verified_at`
- `confidence`

### 3. Successor relationships

Add an `npi_successor_links` table for different-NPI relationships:

- `old_npi`
- `new_npi`
- `relationship_type` (`possible_successor`, `confirmed_successor`, `acquisition`)
- `evidence`
- `review_status`
- `reviewed_by`
- `reviewed_at`

### 4. Ownership history

Add `lead_ownership_events` rather than overwriting history:

- `npi`
- `from_owner`
- `to_owner`
- `reason`
- `source_sheet`
- `source_row`
- `approved_by`
- `approved_at`

## Matching and review rules

1. Same NPI + changed legal name: treat as a name-history update; preserve the current owner.
2. Different NPI + same authorized official/contact: create a possible-successor review; do not auto-merge.
3. Exact name/state/official/phone match: flag as a strong identity-group match.
4. Existing NPI claimed by another person: block the claim and show the owner conflict.
5. Meeting owner and current claimant differ: require explicit reassignment approval.
6. Jane maps to Kaity James; retain the original meeting source and mapping evidence.

## Application changes

- Add a normalized identity-group key to search results and preflight requests.
- Preflight both NPI and identity/successor links before import.
- Display current name, former names, linked NPIs, current owner, and meeting owner together.
- Add explicit actions: `Confirm rename`, `Confirm successor`, `Reassign owner`, `Keep separate`.
- Log every approval; never silently overwrite ownership.

## Performance and free-quota safeguards

- Compute normalized keys during enrichment/import, not with full-table scans during every search.
- Index NPI, normalized identity key, and successor-link NPIs.
- Check only candidate NPIs/groups in batches.
- Keep full duplicate audits as an occasional admin job.

## Rollout

1. Review and approve this plan.
2. Add read-only tables/views and indexes.
3. Import the Genome/Inocras case as `possible_successor` for review.
4. Add preflight warnings without changing claim behavior.
5. Test same-NPI rename, different-NPI successor, and wrong-owner conflict cases.
6. Enable explicit approval actions and ownership-event logging.

## Decisions needed before adding to the master plan

- Should different-NPI successor links ever be auto-confirmed, or always require review?
- Should a confirmed successor inherit the old owner automatically, or only after approval?
- Should aliases be searchable in the main search results?
- Is `GENOME INSIGHT INC → INOCRAS INC` a possible successor only, or do you have evidence that it is a confirmed rename?
