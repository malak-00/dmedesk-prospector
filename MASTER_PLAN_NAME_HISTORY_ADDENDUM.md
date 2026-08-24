# Master Plan Addendum: Name Changes and Ownership History

- Keep every valid lead in `leads`; aliases are supplemental, never a filter.
- Keep `fakeNPI.npi_records` as the faithful NPPES source; store business history in the dmedesk-prospector database.
- Add `npi_aliases` for approved former/trade names, with source, verification date, and confidence.
- Add `npi_successor_links` for different-NPI possible/confirmed successor relationships; different NPIs require review.
- Add `lead_ownership_events` so owner changes preserve from-owner, to-owner, reason, source row, approver, and timestamp.
- Same NPI plus a changed name updates name history and preserves ownership.
- Different NPI plus matching official/contact information creates a pending successor review.
- A meeting owner different from the current claimant always requires explicit reassignment approval.
- Keep Genome Insight → Inocras as `possible_successor` until business continuity is confirmed; Jane maps to Kaity James.
- Compute and index normalized identity keys during enrichment/import; preflight only candidate NPIs/groups in batches.
