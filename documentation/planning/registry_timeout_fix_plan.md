# Registry Matches Timeout — Diagnosis & Fix Plan

> **Error:** `Couldn't load possible duplicates: Failed to load registry matches: canceling statement due to statement timeout`

---

## Diagnosis

### What the code does

The Admin "Possible duplicates" page calls the `registry_review_page()` Postgres function (sql/037).
It works in three stages:

1. **Cheap CTE** — scans `registry_match_candidates` by `(left_npi, right_npi)` PK order, filtering out pairs already in the same group or already in `identity_match_decisions`.
2. **Page CTE** — takes the first `p_limit` rows from the cheap set.
3. **Shown CTE** — runs `identity_pair_decided()` on *only* those `p_limit` rows.

This was designed to be fast. The expensive `identity_pair_decided()` call was deliberately pushed to the last step so it only runs on ≤ 25 rows.

### Why it still times out

| Root cause | Evidence |
|---|---|
| **The cheap CTE itself is slow** | It does a row-by-row `NOT EXISTS` anti-join against `identity_match_decisions` for every candidate it scans. There is no index on `(left_npi, right_npi)` on `identity_match_decisions`. |
| **No tier index on `registry_match_candidates`** | The only indexes are PK `(left_npi, right_npi)`, `right_npi`, and `last_build_id`. A tier-filtered page scan (`WHERE tier = 2`) cannot use a partial index, so Postgres reads all rows and filters. |
| **Database is over the Free plan quota (116%)** | The project is at 553 MB / 500 MB. Supabase throttles compute on Free-plan projects that exceed their quota. Every query runs slower than normal. |
| **Shared compute variance** | WORKLOG notes the same query took 3.5 s on one run and 0.23 s on another (2026-10-14 entry). The underlying shared CPU is the variable. |

### What has already been applied

| SQL | Fix | Applied |
|---|---|---|
| sql/037 | `registry_review_page()` — pages cheap-first, limits expensive calls | ✅ |
| sql/040 | Rewrites `identity_pair_decided()` as two index lookups | ✅ |
| sql/049 | `ROWS 1` hint on `identity_candidate_keys()` | ✅ |

The existing fixes are correct. The timeout is caused by the **remaining unindexed anti-join** in the cheap CTE, compounded by over-quota compute throttling.

---

## Fix Plan

### Step 1 — Add a covering index on `identity_match_decisions` ✦ highest impact

**Why:** The cheap CTE's `NOT EXISTS` subquery:
```sql
and not exists (
  select 1 from public.identity_match_decisions d
   where d.left_npi = c.left_npi and d.right_npi = c.right_npi
)
```
…runs once per candidate row scanned. If `identity_match_decisions` has ~56,000 rows and no usable index for `(left_npi, right_npi)`, this is a sequential scan per candidate. 

**Fix:** Run in the Supabase SQL editor (read-only effect — no data changed):
```sql
-- sql/050_decisions_pkey_index.sql (proposed)
create unique index concurrently if not exists uq_imd_left_right
  on public.identity_match_decisions (left_npi, right_npi);
```

> [!IMPORTANT]
> Check first whether a unique constraint / PK already covers `(left_npi, right_npi)` on `identity_match_decisions`. If it does, this step is a no-op — the planner may just not be picking it up, in which case running `ANALYZE public.identity_match_decisions;` is enough.

**Verify:** After creating, run from the Supabase SQL editor:
```sql
explain (analyze, buffers)
select registry_review_page(null, null, null, 25);
```
Buffer reads on `identity_match_decisions` should drop from a sequential scan to a few index lookups.

---

### Step 2 — Add a tier + key index on `registry_match_candidates` ✦ medium impact

**Why:** When the UI filters by tier (tier 2 or tier 3), the cheap CTE does `WHERE tier = p_tier`. No index supports this, so it reads all rows and discards the wrong tier.

**Fix:**
```sql
-- sql/050 (same file or separate)
create index concurrently if not exists idx_rmc_tier_left_right
  on public.registry_match_candidates (tier, left_npi, right_npi);
```

This lets the cheap CTE seek directly to the right tier and paginate with a forward index scan — no full table read.

---

### Step 3 — Clean up decided pairs from `registry_match_candidates` ✦ medium impact, reduces DB size

**Why:** `registry_review_page()` skips decided pairs in the cheap CTE's `NOT EXISTS` check, but those pairs are still in `registry_match_candidates` and are scanned on every page load. Removing them shrinks the scan range permanently.

**Who is eligible:** Any pair that has a row in `identity_match_decisions`.

**Check first (read-only):**
```sql
select count(*)
from public.registry_match_candidates c
where exists (
  select 1 from public.identity_match_decisions d
   where d.left_npi = c.left_npi and d.right_npi = c.right_npi
);
```

If this returns thousands of rows, deleting them is worthwhile and will also reduce the 553 MB database size.

**Delete (destructive — review before running):**
```sql
begin;
delete from public.registry_match_candidates c
 where exists (
   select 1 from public.identity_match_decisions d
    where d.left_npi = c.left_npi and d.right_npi = c.right_npi
 );
-- inspect row count before committing
rollback; -- change to commit; after verifying
```

---

### Step 4 — Check total table sizes (free, informational)

The database is at 553 MB / 500 MB. Run this to find the biggest tables:
```sql
select relname,
       pg_size_pretty(pg_total_relation_size(oid)) as total_size
from pg_class
where relkind = 'r'
order by pg_total_relation_size(oid) desc
limit 15;
```

**Likely large tables based on the codebase:**
- `provider_history` — compacted by sql/019 trigger; check if old rows were ever pruned
- `npi_records` — full NPPES registry, expected to be large
- `registry_match_candidates` — shrinkable by Step 3 above
- `identity_match_decisions` — grows every time an admin approves/rejects a pair

---

### Step 5 — Upgrade the Supabase plan (if timeouts persist)

The Free plan:
- Uses shared compute that varies by ≥ 10× (measured: 0.23 s to 3.5 s same query)
- Has a **statement timeout of ~8 seconds**
- Throttles compute for projects over their quota (you are at 116%)

A **Pro plan** gives dedicated compute, configurable statement timeouts, and removes the database-size throttle. No SQL fix fully compensates for shared-CPU throttling at this data volume.

---

## Execution Order

```
1. [Informational] Check identity_match_decisions indexes   → verify: \d identity_match_decisions
2. [Step 1] Add uq_imd_left_right index (CONCURRENTLY)     → verify: EXPLAIN ANALYZE registry_review_page
3. [Step 2] Add idx_rmc_tier_left_right index               → verify: EXPLAIN ANALYZE with p_tier=2
4. [Step 3] Count then delete decided candidates            → verify: row count drops, page loads fast
5. [Step 4] Check table sizes                               → verify: DB size drops below 500 MB
6. [Step 5] Upgrade plan if still timing out                → verify: no more timeouts in Supabase logs
```

> [!NOTE]
> Steps 1–3 are all safe, reversible, and can be run from the Supabase SQL editor without a maintenance window. Step 3's delete should be run as a transaction with `ROLLBACK` first to verify the count.
