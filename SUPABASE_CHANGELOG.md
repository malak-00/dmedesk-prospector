# Supabase Change Log

Running log of changes made to the Supabase project (`dmedesk-prospector`,
project ref `pcvyrkisvvtiteoiuplg`) and why. Newest entries at the top.
Changes are applied live via migrations (`mcp__Supabase__apply_migration`),
so this file is the record of what ran — there is no local `migrations/`
folder for this project.

---

## 2026-08-10 — Fix Worker query patterns causing search lag

**Scope note:** unlike the other entries here, this is a Worker code
change (`worker/src/`), not a DB migration — no schema changed. Logged
here anyway since it's entirely about how the app talks to Supabase.

**Why:** search felt laggy. Profiling the `/search/companies` path found
the slowness wasn't the DB schema, it was how the Worker was querying it
and sequencing external calls.

**Changes:**

1. **Stopped reloading the whole `leads` table on every search.**
   `leadsRepo.getClaimedNpis()` used to page through *every* row of
   `leads` (1000 at a time) on every single search request just to know
   which NPIs were already claimed — pure overhead that grows with the
   table. Replaced with `getClaimedNpisAmong(supabase, npis)`, a targeted
   `.in("npi", [...])` check run once per round against only the NPIs
   NPPES actually returned that round (`worker/src/repos/leadsRepo.js`,
   `worker/src/services/companyService.js`).

2. **Parallelized NPPES registry paging.** `fetchFreshProviders()` was
   fetching each state/taxonomy variant's page from NPPES one at a time in
   a sequential `for` loop (up to 30 sequential round trips). Independent
   variants in the same round now fetch concurrently via `Promise.all`
   (`worker/src/services/companyService.js`).

3. **Batched `enrichment_cache` reads/writes.** `enrichmentCache.js` did
   one `select` and one `upsert` per company. Added `getMany`/`putMany`
   (one `.in()` select, one bulk `upsert`) and switched Foursquare, CMS,
   and OSM lookups to use them (`worker/src/lib/enrichmentCache.js`,
   `worker/src/services/foursquare.js`, `worker/src/services/cms.js`,
   `worker/src/services/osm.js`).

4. **Fixed a racy rate limiter.** OSM's Nominatim throttle compared a
   shared `lastRequestAt` timestamp, which is safe for one call at a time
   but not for concurrent calls (e.g. from `Promise.all`) — each reads the
   same stale timestamp before any of them updates it, so they'd burst
   through instead of spacing out. Replaced with a promise-chain queue so
   concurrent OSM lookups actually wait their turn
   (`worker/src/services/osm.js`). Also batched OSM lookups the same way
   as Foursquare/CMS (`Osm.lookupWebsites`, called once per search instead
   of once per company).

---

## 2026-08-10 — Fix Supabase advisor lints (RLS perf + missing FK indexes)

**Migration:** `fix_advisor_lints_rls_initplan_and_indexes`

**Why:** `get_advisors` flagged several WARN/INFO-level lints after the
schema stabilized. None were exploitable (the Worker talks to Postgres with
the service-role key, which bypasses RLS entirely), but they're cheap to
fix and matter if anon/authenticated roles are ever queried directly (e.g.
future Supabase Auth usage) or at higher row counts.

**Changes:**

1. **`auth_rls_initplan` (performance, 12 policies)** — RLS policies on
   `app_users`, `leads`, `lead_notes`, `search_progress`, `suggestions`,
   `taxonomies` called `auth.uid()` / `auth.role()` directly, which
   Postgres re-evaluates per row. Rewrote each to
   `(select auth.uid())` / `(select auth.role())` so the planner evaluates
   it once per query (`InitPlan`) instead of once per row.

2. **`multiple_permissive_policies` (performance, `taxonomies`)** — The
   `any signed-in user can write taxonomies` policy was `FOR ALL`, which
   includes `SELECT` and therefore overlapped with the dedicated
   `any signed-in user can read taxonomies` `SELECT` policy — both had to
   run on every read. Split the `ALL` policy into three (`INSERT`,
   `UPDATE`, `DELETE`) so `SELECT` is only covered by the read policy.

3. **`unindexed_foreign_keys` (performance, 4 columns)** — Added covering
   indexes for FK columns with none:
   - `lead_notes.created_by` → `idx_lead_notes_created_by`
   - `lead_notes.lead_id` → `idx_lead_notes_lead_id`
   - `leads.status_updated_by` → `idx_leads_status_updated_by`
   - `suggestions.submitted_by` → `idx_suggestions_submitted_by`

   (These show up as `unused_index` INFO lints immediately after creation
   since there's no query history yet — expected, not a problem.)

**Left as-is (checked, not fixed):**

- **`rls_enabled_no_policy` on `enrichment_cache`** — RLS is enabled with
  no policies, which means `anon`/`authenticated` get zero access by
  default. That's the correct state: only the Worker's service-role key
  should ever touch this cache table.
- **`auth_leaked_password_protection`** — Supabase Auth setting (checks
  passwords against HaveIBeenPwned). Not applicable: the app doesn't use
  Supabase Auth for login (custom bcrypt + JWT via `app_users`), so no
  passwords ever flow through `auth.users`. Would need a dashboard toggle
  (Authentication → Policies) only if Supabase Auth login is adopted later.
