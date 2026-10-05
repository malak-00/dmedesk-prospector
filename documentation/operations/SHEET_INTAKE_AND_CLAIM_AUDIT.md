# BD Meetings Sheet Intake & Duplicate-Claim Audit

**Scope:** External spreadsheet tabs (`New Meetings`, `Follow Ups`, `Contract Sent`, `Invoice Sent`, `Temporary Inactive`, `No-Show`) in `BD MEETINGS 2026.xlsx`. `Settings` and system tabs excluded.

---

## 1. Data Coverage & Completeness Issues

- **319 non-empty records** audited from the workbook.
- **NPI Coverage:** Only **1 record** contains an NPI. The remaining 318 records have blank NPIs.
- **State Column:** The audited workbook tabs contain **no State column**. Matching cannot rely on state codes.
- **Contact & Phone Coverage:** 307 records contain a phone number; 318 contain an authorized person; 317 contain a company name.
- **Core Problem:** The Supabase `leads` table requires an `npi` (and preferably a `state` for identity grouping). The workbook cannot be cleanly bulk-imported without an NPI enrichment step.

---

## 2. Opener Assignment & Unmapped Users

| Opener in Sheet | Records Found | Supabase User Exists? | Assignment Readiness |
|---|---|---|---|
| Selene | 103 | Yes (`Selene Myles`) | Ready for import upon NPI enrichment |
| Jane | 79 | No (maps to `Kaity James` per rule) | Requires explicit user mapping to Kaity James |
| Jimmy | 56 | Yes (`Jimmy Pearson`) | Ready for import upon NPI enrichment |
| Ben | 45 | Yes (`Ben Arthur`) | Ready for import upon NPI enrichment |
| Nora | 14 | Yes (`Nora Atkins`) | Ready for import upon NPI enrichment |
| Jasmine | 9 | Yes (`Jasmine Green`) | Ready for import upon NPI enrichment |
| George | 3 | No | Blocked — no DME Desk account |
| Russ | 1 | No | Blocked — no DME Desk account |
| Rick / Caroline | 0 in scope | Yes | No records found in audited tabs under these names |

---

## 3. Confirmed Duplicate Records Within the Spreadsheet

The following pairs share the exact same normalized phone number and authorized-person value within the workbook itself. One copy should be removed or consolidated:

| Company | Location A | Location B | Opener | Notes |
|---|---|---|---|---|
| **SYNERGENIX DIAGNOSTICS** | New Meetings (row 3) | Follow Ups (row 52) | Jane | Same company, phone, contact, date added, and status |
| **PRISTINE MEDICAL EQUIPMENT** | Follow Ups (row 63) | No-Show (row 78) | Jimmy | Same company, phone, and contact; statuses differ |
| **LYMPHMED LLC** | Follow Ups (row 88) | Temporary Inactive (row 5) | Jane | Same company, phone, and contact |
| **GREEN MEDICAL SUPPLY LLC** | Follow Ups (row 101) | Temporary Inactive (row 9) | Selene | Same company, phone, and contact; statuses differ |
| **SFRN VENTURES LLC** | Temporary Inactive (row 50) | No-Show (row 59) | Jimmy | Same company, phone, contact; statuses match |
| **Southland Auto Insurance Services** | No-Show (row 19) | No-Show (row 35) | Selene | Exact duplicate within the same tab |

---

## 4. Company-Level Review Items (Potential Discrepancies)

Exact company name matches with mismatched authorized persons or phone numbers:

| Company | Locations | Review Trigger |
|---|---|---|
| **SML MEDICAL SUPPLIES, INC.** | Follow Ups (rows 11 & 12) | Same date and phone; different contacts (Samir Ramadan / Sameh Awad) |
| **MEDEX DIAGNOSTIC SERVICES INC** | Temp Inactive (row 66) & No-Show (row 9) | Different contacts and phone numbers; likely different branch offices |

---

## 5. Sheet-to-Database Collision Summary

Using normalized company + phone + authorized person matching against live claimed leads:
- **6 records** in the sheet collide with leads already claimed in Supabase:
  - `RUSH LAB LLC`: Claim conflict (Sheet: Jimmy Pearson vs. Supabase: Nora Atkins).
  - 5 records already claimed by the same user (`Selene` & `Nora`): Do not upload again.
- **313 records** have no current match in Supabase and require NPI lookup before ingestion.

---

## 6. Action Items for Sheet Intake

1. Run NPI enrichment across the 313 clean candidates before attempting import.
2. Apply the user alias mapping: `Jane` &rarr; `Kaity James`.
3. Exclude `George` and `Russ` records until accounts are configured or reassigned.
4. Dedup the 6 internal workbook pairs before triggering `POST /admin/claim-for-user`.
