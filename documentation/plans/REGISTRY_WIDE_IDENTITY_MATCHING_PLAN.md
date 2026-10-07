# Registry-wide identity matching (npi_records) with monthly refresh

Status: migration drafted in `sql/030_registry_identity_matching.sql` and ingest hook added; NOT yet
run anywhere. Decisions made 2026-10-07: (1) match on either phone, (2) queue shows every registry
pair, not only pairs touching a lead, (3) cover every organization, no taxonomy filter.
Worker pagination and the Admin tab "Compare: All providers" view are written (not deployed).
Still open: the bucket cap (25 is a guess).

## Problem

`identity_review_candidates` (sql/010) only compares **active leads**. On 2026-10-07 five NPIs
sharing authorized official Furqan Saadat were checked (read-only):

| NPI | In leads? | Group | Phone key |
| --- | --- | --- | --- |
| 1598576696 United Medical Supply USA | yes | c03ef11f... | 8132526078 (location) |
| 1396559274 Pinnacle Management Solutions | yes | 27ab620f... | 8137205106 |
| 1902722879 PrimeCare Supplies | no | none | 8137205106 |
| 1801616321 Malik Traders | no | none | 8137205106 |
| 1164310546 Mobility Care | no | none | 8137205106 |

Two separate gaps:

1. **Registry blind spot.** Three NPIs are only in `npi_records`, so they can never be flagged.
2. **Phone key gap.** `identity_phone_key` takes the location phone and only falls back to the
   official's phone when the location phone is empty. 1598576696 has the same official and the
   same official phone as the rest, but a different location phone, so it never matches.

## Why not just point the existing view at npi_records

`npi_records` is about 9.7M rows. The view self-joins on phone, official and name; across the
full registry that is not viable live. It must be precomputed and refreshed.

## Proposed design

### 1. Key table (one row per organization NPI)

`public.npi_identity_keys`
`(npi pk, name_key, state_key, official_key, phone_key, official_phone_key, keys_hash, updated_at)`

- Built with the existing `identity_*_key` functions (no new normalization rules).
- Only NPI-2 records with a non-empty official or phone. Individuals (NPI-1) have no official and
  are left out, which removes most of the 9.7M.
- Indexes on `official_key`, `phone_key`, `official_phone_key`, `name_key`.
- `phone_key` and `official_phone_key` are kept separate so a match on **either** counts as
  "phone matches". This is the fix for gap 2.

### 2. Candidate pairs table (precomputed)

`public.registry_match_candidates`
`(left_npi, right_npi, tier, matched_keys, first_seen_run_id, last_seen_run_id, primary key (left_npi, right_npi))`

Built by grouping on keys instead of a blind self-join:

- bucket by `official_key + any phone`, `name_key + any phone`, `name_key + official_key`
- emit pairs per bucket, same tier rules as sql/008 (Tier 2 and Tier 3, with state where known)
- **bucket size cap** (proposal: skip buckets over 25 NPIs and list them in a separate
  `registry_match_big_buckets` table). A shared billing-company phone or a common name would
  otherwise generate thousands of useless pairs.
- pairs that are already one group, or already have an `identity_match_decisions` row (same
  group-aware check as `identity_pair_decided`), are excluded at read time, not stored away.
  Decisions therefore survive every rebuild.

### 3. Monthly refresh hook

After `apply_nppes_refresh_batch` / `finish_nppes_apply` (sql/007) finishes a run:

1. `refresh_npi_identity_keys(run_id)`: upsert keys only for NPIs the run inserted or changed
   (the run already records these via `provider_field_history` / staging); compare `keys_hash`
   so unchanged rows are not rewritten.
2. `refresh_registry_match_candidates(run_id)`: recompute only buckets that contain a touched
   NPI, then stamp `last_seen_run_id`. Pairs that stop matching (an official or phone changed)
   are removed. First version can do a full rebuild if that finishes in a few minutes; start with
   that and add incremental only if needed.
3. Called from `scripts/nppes_ingest/apply.py` next to the existing lead sync, with the same
   "function missing" tolerance (`_is_missing_function`) so an older database does not break the
   ingest.
4. Writes a summary row (new pairs, removed pairs, big buckets) so each month shows what changed.

### 4. Review queue

`identity_review_queue` gains a second source, `registry`, reading `registry_match_candidates`.

- **Default view: actionable.** Pairs where at least one NPI is an active lead. Merging has an
  ownership consequence, so an admin should decide.
- **Optional view: registry-only.** Pairs where neither NPI is a lead yet. Shown on request.
  They become actionable automatically the day someone claims one side, with no extra job.
- The bulk-merge eligibility rule (different owners block it) is unchanged.

### 5. Merging NPIs that have no group yet

`resolve_identity_match` (sql/009) currently raises when either NPI has no `lead_group_members`
row. For registry pairs it must first call `ensure_identity_membership` (sql/010) to create the
membership from the `npi_records` row, then merge as today. Everything else (audit event, lock,
decision row) is unchanged. Ownership still never changes in a merge.

## Open decisions

1. **Phone matching:** accept either phone (location or official) as a match? Recommended, but it
   will flag more pairs, including offices that share only a common official phone.
2. **Scope of the default queue:** pairs touching at least one lead (recommended), or all
   registry pairs?
3. **Bucket cap:** 25 is a guess. Sizing query below will show the real distribution.
4. **Taxonomy filter:** restrict to DME-relevant taxonomies to shrink the table, or cover every
   organization?

## Sizing check (read-only, run in the SQL Editor before building)

```sql
-- 1. how many organization NPIs have an official
select count(*) filter (where enumerationtype = 'NPI-2') as orgs,
       count(*) filter (where enumerationtype = 'NPI-2'
                          and coalesce(authorizedofficial_lastname, '') <> '') as orgs_with_official
from public.npi_records;

-- 2. how big are the official+phone buckets (this decides the cap)
with k as (
  select npi,
         public.identity_official_key(authorizedofficial_firstname, authorizedofficial_lastname) as o,
         public.identity_phone_key(phone, authorizedofficial_phone) as p
    from public.npi_records
   where enumerationtype = 'NPI-2'
)
select width_bucket(c, 1, 100, 10) as size_band, count(*) as buckets, sum(c) as npis
  from (select o, p, count(*) as c from k where o <> '' and p <> '' group by o, p having count(*) > 1) b
 group by 1 order by 1;
```

## Safety

All new objects are additive. No existing table is altered except the `resolve_identity_match`
replacement, which keeps its current behaviour for pairs that already have groups. Migration
would go in `sql/` as a reviewed manual file, tested on a Supabase branch before production, with
a WORKLOG entry.
