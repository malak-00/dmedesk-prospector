# BD Meetings duplicate-claim audit

Scope: `New Meetings`, `Follow Ups`, `Contract Sent`, `Invoice Sent`, `Temporary Inactive`, and `No-Show` in `BD MEETINGS 2026 (11).xlsx`. `Settings` and admin/system sheets were excluded.

## Data coverage

- 319 non-empty lead records audited.
- 1 record contains an NPI; there are no duplicate NPIs.
- 307 records contain a phone number; 318 contain an authorized person; 317 contain a company name.
- The workbook has no `State` column in the audited tabs. State could not be used as a matching key.
- Match method: exact normalized NPI first; then normalized phone + authorized person; exact normalized company name is a separate review signal.

## Rick, Nora, and Caroline

| Claimant | Records found | NPI conflicts | Phone + authorized-person conflicts | Exact-company conflicts |
| --- | ---: | ---: | ---: | ---: |
| Rick | 0 | 0 | 0 | 0 |
| Nora | 9 | 0 | 0 | 0 |
| Caroline | 0 | 0 | 0 | 0 |

Nora's nine records do not match a lead owned by another opener on any available definitive key. Rick and Caroline do not appear in the `Opener` column of the six in-scope tabs; their claims cannot be audited from this workbook unless they use a different name or source sheet.

## Confirmed duplicate records

These pairs share the same normalized phone number and authorized-person value. They should be consolidated or one copy removed after confirming the intended pipeline location.

| Company | First location | Duplicate location | Opener | Notes |
| --- | --- | --- | --- | --- |
| SYNERGENIX DIAGNOSTICS | New Meetings row 3 | Follow Ups row 52 | Jane | Same company, phone, authorized person, date added, and status. |
| PRISTINE MEDICAL EQUIPMENT AND ACCESSORIES INC | Follow Ups row 63 | No-Show row 78 | Jimmy | Same company, phone, and authorized person; statuses differ. |
| LYMPHMED LLC | Follow Ups row 88 | Temporary Inactive row 5 | Jane | Same company, phone, and authorized person. |
| GREEN MEDICAL SUPPLY LLC | Follow Ups row 101 | Temporary Inactive row 9 | Selene | Same company, phone, and authorized person; statuses differ. |
| SFRN VENTURES LLC | Temporary Inactive row 50 | No-Show row 59 | Jimmy | Same company, phone, and authorized person; statuses match. |
| Southland Auto Insurance Services | No-Show row 19 | No-Show row 35 | Selene | Exact duplicate within the same tab, including date added and status. |

## Company-level review items

These are the remaining exact-company matches that do not share the full phone + authorized-person key. Review before merging.

| Company | Locations | Why review |
| --- | --- | --- |
| SML MEDICAL SUPPLIES, INC. | Follow Ups rows 11 and 12 | Same date and phone; different authorized persons (Samir Ramadan / Sameh Awad). |
| MEDEX DIAGNOSTIC SERVICES INC | Temporary Inactive row 66; No-Show row 9 | Different authorized persons and phone numbers; may be different contacts at the same company. |

## Limitation and next input

The audit cannot validate State-based matches because State is not present in the six selected tabs, and it cannot run a meaningful NPI comparison because almost every NPI cell is blank. To make future audits definitive, populate `NPI` and add a `State` column (or provide the external reference sheet containing those values).

## Supabase audit (dmedesk-prospector)

The Supabase `leads` table is now the reference database: 3,930 leads are claimed, and all have NPI, State, phone, and contact-name values.

### Database cleanup candidates

- 102 duplicate-NPI groups (206 rows total); one group is claimed by more than one person.
- 133 duplicate State + phone + contact groups (271 rows total); eight groups are claimed by more than one person.
- These are review candidates, not automatic deletions: a shared contact and phone can legitimately occur on separate NPIs or companies.

| Match basis | Leads / claimants | Review outcome |
| --- | --- | --- |
| Same NPI, State, phone, contact: ADMIRAL MEDICAL SUPPLY | Rick Nelson / Nora Atkins | Confirmed duplicate claim. Rick claimed first (2026-07-21); Nora claimed later (2026-07-27). |
| State + phone + contact: ADVANCED HOME MEDICAL SUPPLIES INC. | Nora Atkins / Rick Nelson | Potential duplicate; different NPIs. |
| State + phone + contact: AMERICAN LABS LLC / BEACH ROAD LABS LLC | Kaity James / Jasmine Green | Potential shared contact; different companies and NPIs. |
| State + phone + contact: ABC HOME CARE AGENCY INC. / ABC HOME CARE SUPPLIES | Nora Atkins / Rick Nelson | Potential duplicate; different NPIs. |
| State + phone + contact: AMAZING GRACE HOME CARE SERVICES / AG SCREENING LAB, LLC | Rick Nelson / Jasmine Green | Potential shared contact; different companies and NPIs. |
| State + phone + contact: AAA MEDICAL EQUIPMENT SERVICES LLC | Kaity James / Nora Atkins | Potential duplicate; same company/contact, different NPIs. |
| State + phone + contact: ACCESS MEDICAL SUPPLIES, INC | Rick Nelson / Nora Atkins | Potential duplicate; same company/contact, different NPIs. |
| State + phone + contact: 1FOOT 2FOOT CENTRE FOR FOOT AND ANKLE CARE, PC | Rick Nelson / Kaity James | Potential duplicate; same company/contact, different NPIs. |

### Workbook leads already claimed in Supabase

The workbook has no usable State and only one NPI, so this check uses the strongest available key: normalized company + phone + authorized person.

| Workbook location | Workbook opener | Existing Supabase claimant | Company | Result |
| --- | --- | --- | --- | --- |
| Follow Ups row 36 | Jimmy | Nora Atkins | RUSH LAB LLC | Claim conflict — decide whether Jimmy or Nora keeps it. |
| New Meetings row 10 | Selene | Selene myles | GUARDIAN ANGEL DME | Already claimed by the same person; do not upload again. |
| New Meetings row 13 | Nora | Nora Atkins | DIAGNOSTIC TESTING SOLUTIONS INC | Already claimed by the same person; do not upload again. |
| New Meetings row 17 | Nora | Nora Atkins | NUA AESTHETICS LLC | Already claimed by the same person; do not upload again. |
| New Meetings row 19 | Nora | Nora Atkins | BENDA HEALTH EDUCATION AND TESTING SERVICES LLC | Already claimed by the same person; do not upload again. |
| New Meetings row 20 | Nora | Nora Atkins | WELCARE DIAGNOSTICS LLC | Already claimed by the same person; do not upload again. |

The remaining 313 workbook rows do not match a claimed Supabase lead on the fields available in the workbook. They still need NPI and State before a fully safe, de-duplicated import.

### Assignment readiness

Supabase users available for assignment are Ben Arthur, Caroline Richards, Jasmine Green, Jimmy Pearson, Kaity James, Nora Atkins, Rick Nelson, and Selene Myles. Workbook openers `Jane`, `George`, and `Russ` do not have corresponding Supabase users, so their rows cannot be assigned without an explicit user mapping.

No database rows have been deleted, reassigned, or inserted by this audit.

## Import split (pending NPI enrichment)

- **Hold/review:** 18 records — six already claimed in Supabase and 12 records belonging to six confirmed duplicate pairs inside the workbook. These stay untouched for now.
- **Clean candidates:** 301 records — they do not match the hold criteria.
- **Importable now:** 1 clean candidate has an NPI. The Supabase schema requires `npi`, so the other 300 cannot be inserted safely until their NPIs are supplied or enriched.

Clean candidates by workbook opener: Jasmine 9, Selene 103, Jane 79, Jimmy 56, Nora 5, Ben 45, George 3, Russ 1.
