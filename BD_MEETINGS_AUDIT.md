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
