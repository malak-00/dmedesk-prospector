# Supabase Change Log

Running log of changes made to the Supabase project (`dmedesk-prospector`,
project ref `pcvyrkisvvtiteoiuplg`) and why. Newest entries at the top.
Changes are applied live via migrations (`mcp__Supabase__apply_migration`),
so this file is the record of what ran — there is no local `migrations/`
folder for this project.

---

## 2026-08-21 — Fix `resetProgress` not actually resetting

**Scope note:** Worker code only (`worker/src/services/companyService.js`),
no schema change. Follow-up to the 2026-08-20 entry below.

**Why:** the "Start over from the beginning" switch only skipped loading
this user's saved `search_progress` bookmark from the DB — it did
nothing about a `variantSkips`/`excludeNpis` already present on the
request itself (e.g. the frontend echoing back a prior response's
now-stale `variantSkips`, which can already carry an
`EXHAUSTED_SKIP = -1` for that combo from before the reset was
requested). That let a reset request immediately no-op: the response
came back `scannedFromRegistry: 0`, `companies: []` — the variant
treated as already exhausted without ever actually re-fetching from
skip 0.

**Change:** `resetProgress` now unconditionally resets
`effectiveCriteria`'s `variantSkips`/`excludeNpis` to empty, regardless
of what was already on the request, before the DB-lookup branch even
runs.

**Follow-up (same day):** that first fix was still wrong in two ways,
caught immediately after: it saved the reset run's results back to
`search_progress` afterward, silently overwriting the user's real
resume point with the reset run's; and it re-wiped to skip 0 on every
subsequent "Search more" click too (the switch's state persists across
follow-up requests), making "Search more" unusable after a reset.
Fixed both: `resetProgress` now never reads OR writes
`search_progress` at all (fully self-contained detour, real bookmark
untouched), and client-provided `variantSkips` (what "Search more"
actually sends) always takes priority over `resetProgress`, so paging
forward after a reset works correctly.

---

## 2026-08-20 — Add a Medicare claims minimum filter and a search-reset switch

**Scope note:** Worker/frontend code only (`worker/src/`, `docs/`), no schema change.

**Why:** requested directly -- let a search require a minimum Medicare
claims count, and let a rep deliberately re-scan a filter combo from the
top of the registry instead of always continuing from their saved
bookmark.

**Changes:**

1. **`minMedicareClaims`** — new optional search field. Post-filters
   results to companies whose `medicare.totalClaims` is at least the
   given value. Independent of the existing `requireCmsClaims` checkbox
   (which only checks `> 0`) (`worker/src/services/companyService.js`,
   `worker/src/index.js`, `docs/index.html`).
2. **`resetProgress`** — new "Start over from the beginning" checkbox.
   Skips loading the signed-in user's saved `search_progress` row for
   that exact filter combination, so the scan starts at skip 0 with no
   excluded NPIs again, re-showing leads a previous search already paged
   past. Progress still saves normally afterward, becoming the new
   bookmark for any "Search more" clicks that follow
   (`worker/src/services/companyService.js`, `worker/src/index.js`,
   `docs/index.html`, `docs/app.js`).

---

## 2026-08-18 — Add `is_admin` and an admin dashboard

**Migration:** `add_is_admin_to_app_users`

**Why:** requested directly -- a way to see per-user activity (claimed
leads, disconnected, suggestions submitted, distinct searches run),
review all suggestions in one place, and inspect any teammate's claimed
leads, gated to admin accounts only.

**Changes:**

1. **Schema:** `app_users.is_admin boolean not null default false`.
   Set `true` for Caroline Richards' account
   (`c4e38805-970b-4cde-a03d-585cc0778872`); everyone else defaults
   `false`.
2. **Auth:** `isAdmin` now flows through the JWT payload end to end —
   `login()`, `getSession()`, and the exclude-keywords token re-mint
   (which previously would have silently dropped it on the next token
   refresh) (`worker/src/lib/auth.js`).
3. **New admin-only routes**, gated by a `requireAdmin(session)` check:
   `GET /admin/overview` (user activity summary + all suggestions + team
   stats, one query per table tallied in JS rather than an N+1 per-user
   fan-out) and `GET /admin/leads?userId=` (any user's claimed leads)
   (`worker/src/index.js`, `worker/src/repos/adminRepo.js`, new
   `leadsRepo.listClaimedLeadsForUser` / `suggestionsRepo.listAllSuggestions`
   exports alongside the existing session-scoped versions).
4. **Frontend:** a third "Admin" tab, hidden unless `session.isAdmin` —
   stat cards, a user activity table, an all-suggestions table, and a
   modal to view any user's claimed leads (`docs/index.html`,
   `docs/app.js`, `docs/style.css`). Tab visibility is UI convenience
   only; the real boundary is server-side `requireAdmin`.

---

## 2026-08-12 — Consume fakeNPI's joined CMS data instead of a separate live lookup

**Scope note:** spans two Supabase projects — this app's own
(`dmedesk-prospector`, `pcvyrkisvvtiteoiuplg`) for the Worker code
change, and the separate self-hosted `fakeNPI` replica project
(`zvthhjediuelpvzkkzvy`) for the new table and Edge Function join.
Logged together since they're one feature.

**Why:** every search was making a separate live call to the real CMS
DMEPOS API per NPI to enrich with Medicare claims data. fakeNPI (see the
2026-08-11 entry below) already sits in front of a Postgres database, so
joining CMS data in there instead removes a whole external round trip
per search.

**Changes:**

1. **fakeNPI project:** new `npi_cms_enrichment` table (`npi` PK/FK to
   `npi_records.npi` `on delete cascade`; `total_claims`,
   `total_services`, `total_beneficiaries`, `medicare_payment`,
   `medicare_allowed`, `fetched_at`). Imported from the CMS DMEPOS
   Supplier public use file (60,060 rows), filtered at import time to
   NPIs already present in `npi_records` to satisfy the FK.
2. **fakeNPI Edge Function (`nppes-search`):** every result now embeds
   `npi_cms_enrichment` via a PostgREST join into a new `medicare` field
   — not part of the real NPPES API, an intentional fakeNPI-only
   addition.
3. **Worker:** `nppes.js` normalizes the embedded `medicare` field the
   same shape `cms.js` used to produce; `companyService.js`'s separate
   `Cms.lookupByNpis()` round trip is gone entirely.  `cms.js` itself is
   `Cms.lookupByNpis()` round trip is gone entirely. `cms.js` itself is
   left in place unused (same as `foursquare.js`/`osm.js`), in case a
   live fallback is needed later for NPIs fakeNPI doesn't have
   enrichment for.

---

## 2026-08-11 — Wire fakeNPI in as the live NPPES search source; drop Foursquare/OSM

**Scope note:** spans two Supabase projects — this app's own
(`dmedesk-prospector`, `pcvyrkisvvtiteoiuplg`) and the self-hosted
`fakeNPI` replica project (`zvthhjediuelpvzkkzvy`, github.com/prodbyabdo/fakeNPI).

**Why:** the real NPPES API caps `skip` at ~1000, capping how deep a
search can page. fakeNPI is a self-hosted replica with the same
request/response shape but no such cap, backed by our own
`npi_records` table — this is the work to get it actually reachable,
correct, and wired in as the Worker's real search source instead of the
real NPPES API.

**Changes — fakeNPI project:**

1. `npi_records` schema was missing `enumeration_date`, a column the
   Edge Function's own code already read — added.
2. Phone columns (`phone`, `authorizedofficial_phone`) were importing
   with a trailing `.0` (pandas coercing the column to `float64` on CSV
   import, an Excel/pandas artifact, not a schema issue) — fixed at the
   import script (`dtype=str`) and cleaned on already-imported rows.
3. `taxonomy_description` came back empty for every row (data gap in
   the import, not the API). Since `taxonomy_code` **is** populated,
   added a `taxonomy_code` exact-match filter to the Edge Function; the
   Worker resolves each selected specialty to its code via this app's
   own `taxonomies` table before querying, falling back to the old
   description filter when no code is on file.
4. Edge Function routing broke repeatedly on wrong assumptions about
   how Supabase's Edge Runtime rewrites the incoming request path
   (guessed `/functions/v1/nppes-search`, then bare `/`, before
   confirming via a raw `Deno.serve` diagnostic that it actually arrives
   as `/nppes-search/...`) — fixed by registering every route under
   both the bare path and the confirmed prefix, so it isn't sensitive to
   the runtime's path-rewriting behavior changing again (as it did once
   already, mid-session, after a routine redeploy pulled a newer Edge
   Runtime image).

**Changes — dmedesk-prospector Worker:**

1. `nppes.js` now builds its search URL from `config.fakeNpiBaseUrl()`
   instead of the hardcoded real NPPES API URL. `/debug/fakenpi`
   (temporary scaffolding used to get here) removed once confirmed
   working.
2. Capped concurrent fakeNPI fetches per search round to 2
   (`NPPES_FETCH_CONCURRENCY`) — fakeNPI runs on Nano-tier compute and
   was 500ing several variants at once under unbounded concurrency.
3. Fixed a real pagination bug: a variant whose page came back short
   (genuinely exhausted) was still persisting an incremented-but-bogus
   `skip` instead of a value that reads back as "done" — so the next
   request (resuming from `search_progress`, or the frontend just
   echoing back the `variantSkips` a response returned) would query it
   again past its real total, which fakeNPI 500s on instead of
   returning an empty page. Now stored via an `EXHAUSTED_SKIP` (`-1`)
   sentinel. Removed the artificial `NPPES_MAX_SKIP` (1000) ceiling
   entirely — copied from the real NPPES API's own cap, which fakeNPI
   doesn't have.
4. `cms.js`: `Promise.all` → `Promise.allSettled`, so one failed NPI
   lookup (e.g. hitting Cloudflare's per-invocation subrequest cap)
   doesn't null out CMS data for every other NPI in the same batch.
5. Dropped Foursquare (its API key is over its rate limit, no longer
   usable) and OSM (its 1 req/sec throttle was adding ~1s per
   website-less company to every search, and eating into the same
   subrequest budget CMS enrichment needs) from the search pipeline
   entirely. Both source files left in place unused.
   `scoring.js`'s weights rescoped to only the signals still populated
   (phone, address, decision maker, active Medicare billing), since the
   Foursquare/OSM-only signals could now never score above 0.
6. Added an "Export to Sheet" button to the Claimed leads view
   (previously Prospect-only) — a new `googleSheets.js` path reads the
   already-flat `leadsRepo` DTO shape directly instead of the nested
   company-model shape `flattenCompany` expects.

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
   `leadsRepo.getClaimedNpis()` used to page through _every_ row of
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
