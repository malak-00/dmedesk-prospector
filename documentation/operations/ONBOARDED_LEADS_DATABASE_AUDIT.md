# Onboarded Leads Database Audit (Supabase Ground Truth)

**Scope:** All claimed and onboarded lead records within the Supabase `public.leads` table (3,930 active leads).

---

## 1. Executive Summary & Database Health

- **Total claimed leads in database:** 3,930 leads.
- **Completeness:** All 3,930 leads possess an NPI, State, Phone, and Contact Name.
- **Duplicate NPIs:** **102 duplicate-NPI groups** (206 rows total). 1 group is actively claimed by more than one person.
- **Identity Group Collisions:** **133 duplicate (State + Phone + Contact) groups** (271 rows total). 8 groups are claimed by different teammates.

---

## 2. Cross-Agent Claim Conflicts (Immediate Attention)

The following records are claimed by multiple active users in Supabase and require admin resolution:

### A. Confirmed Same-NPI Conflict
| Company | NPI | Claimants | Priority / Timeline |
|---|---|---|---|
| **ADMIRAL MEDICAL SUPPLY** | Duplicate across 2 rows | **Rick Nelson** vs. **Nora Atkins** | Rick claimed first (2026-07-21); Nora claimed later (2026-07-27). Reassign or unclaim Nora's duplicate. |

### B. Shared Contact & Phone Across Different NPIs (Identity Group Collisions)
These represent situations where different NPIs share the exact same State, Phone, and Contact Name under separate owners:

| Match Basis (State + Phone + Contact) | Conflicting Claimants | Investigation Notes |
|---|---|---|
| **ADVANCED HOME MEDICAL SUPPLIES INC.** | Nora Atkins / Rick Nelson | Likely duplicate branch or re-enumeration of the same business. |
| **AMERICAN LABS LLC / BEACH ROAD LABS LLC** | Kaity James / Jasmine Green | Potential shared billing contact across two affiliated organizations. |
| **ABC HOME CARE AGENCY INC. / ABC HOME CARE SUPPLIES** | Nora Atkins / Rick Nelson | Affiliated corporate entities claimed by two different openers. |
| **AMAZING GRACE HOME CARE SERVICES / AG SCREENING LAB** | Rick Nelson / Jasmine Green | Same phone/contact; distinct clinic operations. |
| **AAA MEDICAL EQUIPMENT SERVICES LLC** | Kaity James / Nora Atkins | Same company and contact; distinct NPIs. |
| **ACCESS MEDICAL SUPPLIES, INC** | Rick Nelson / Nora Atkins | Same company and contact; distinct NPIs. |
| **1FOOT 2FOOT CENTRE FOR FOOT AND ANKLE CARE, PC** | Rick Nelson / Kaity James | Practice location re-enumerated under distinct provider IDs. |

---

## 3. Completeness of Onboarded Records

While basic fields (NPI, state, phone, contact name) are 100% populated:
1. **Identity Group Assignment (`group_id`)**:
   - Leads added before `sql/010_group_aware_claim.sql` was installed do not have populated `group_id` memberships.
   - Run `sql/002_identity_backfill_safe.sql` to link legacy claimed rows to their canonical identity groups.
2. **Medicare / CMS Data Enrichment**:
   - Leads claimed prior to the CMS enrichment join in fakeNPI lack `medicare_claims` and `medicare_payment` values.
   - These are refreshed as monthly NPPES/Medicare sync runs are applied via `scripts/nppes_ingest`.
3. **Provider Field Change Alerting**:
   - Claims must be synced with `provider_field_history` to alert owners of provider relocations or deactivations (installed via `sql/015_provider_change_alerts.sql` and `sql/017_lead_sync_restart.sql`).

---

## 4. Remediation Steps for Onboarded Leads

1. **Resolve Cross-Agent Collisions**:
   - Utilize `POST /admin/resolve-conflict` (or `sql/006_resolve_known_conflicts.sql` / `sql/021_conflict_unclaim.sql`) to award `ADMIRAL MEDICAL SUPPLY` to Rick Nelson and unclaim Nora's copy.
2. **Review Identity Group Collisions**:
   - Review the 8 cross-claimant groups with sales reps to determine whether branches should be merged under a single owner or remain independent locations.
3. **Run Backfill**:
   - Complete the `assign_lead_groups` backfill to ensure `group_id` is populated for all 3,930 onboarded leads.
