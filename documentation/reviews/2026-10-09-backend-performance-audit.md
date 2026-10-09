# Backend Performance Audit - 2026-10-09

## Scope and method

This is a static, backend-only review of the live Cloudflare Worker (`worker/`)
and its Supabase SQL support. `docs/`, legacy paths, production data, and
automated browser testing are out of scope. No production request, mutation,
or SQL execution was performed.

The review used the local `audit`, `architecture-designer`, `code-reviewer`,
and `javascript-pro` guidance. The generic audit skill's UI scoring categories
do not apply to this backend-only scope; the score below instead covers the
request path, database work, external I/O, and operational visibility.

## Health score

| Dimension | Score | Key finding |
|---|---:|---|
| Worker request execution | 3/4 | Search fan-out is bounded, but optional scraping has no request deadline or response-size limit. |
| Database efficiency | 2/4 | Search SQL is indexed and capped; several endpoints still reconstruct whole-table datasets in the Worker. |
| External dependency resilience | 2/4 | NPPES retries are bounded, while scraper fetches can wait indefinitely. |
| Caching and scalability | 2/4 | Useful per-isolate caches exist, but cold isolates repeat full Supabase scans and there is no shared cache. |
| Observability and performance tests | 2/4 | Cloudflare observability is enabled and unit tests pass, but no endpoint-level latency/query telemetry or timeout tests cover external fetches. |
| **Total** | **11/20** | **Acceptable: significant backend performance work remains.** |

## Findings

### P1 - Website enrichment can create unbounded outbound work

**Location:** `worker/src/services/companyService.js:513-515`,
`worker/src/services/scraper.js:20-50`, `worker/src/services/scraper.js:156-179`

`searchCompanies()` launches website enrichment for every returned company in
an unbounded `Promise.all`. Each scrape makes a robots request plus up to four
sequential HTML fetches. Neither fetch uses an `AbortSignal` deadline nor
limits response-body size before calling `response.text()`.

**Impact:** A slow or very large third-party site can hold a Worker request
open and consume memory. With a large requested result set, concurrent scrapes
can exhaust Worker subrequest/connection capacity and degrade unrelated search
traffic.

**Recommendation:** Establish a shared outbound-fetch helper with a bounded
deadline and maximum body size. Process company scrapes with a small fixed
concurrency limit, validate the requested search limit at the HTTP boundary,
and return per-company best-effort failures as the code does today. Add unit
tests for timeout, oversized body, and concurrency ceiling behavior.

### P2 - Cold Worker isolates reload all claimed leads for related-claim checks

**Location:** `worker/src/repos/relatedClaimsRepo.js:11-52`

Each cold isolate, and each isolate after a one-minute TTL, pages up to 60,000
claimed leads into Worker memory before comparing up to 200 inputs locally.
Cloudflare isolates do not share this cache, so concurrent cold instances
multiply the database reads. At more than 60,000 matching rows, the result is
silently incomplete because the loop stops at `MAX_PAGES`.

**Impact:** Database/network work grows with the entire active pipeline rather
than the submitted companies, with a future correctness ceiling.

**Recommendation:** Move the matching predicates into a bounded Supabase RPC
that receives the candidate NPIs/phones/owners, or build a small normalized
identity lookup table with appropriate indexes. Preserve the current
best-effort response semantics and make a hard ceiling explicit rather than
silently returning partial data.

### P2 - Best-time analytics rebuilds an entire notes corpus per cold isolate

**Location:** `worker/src/repos/insightsRepo.js:11-38`

`getBestTimes()` reads every claimed lead with notes (up to 100,000 rows) and
parses the notes in Worker memory whenever its ten-minute per-isolate cache is
cold. The cache avoids repeat work only within the same isolate.

**Impact:** Growth in historical notes increases response latency, memory, and
Supabase read volume. A traffic burst after a deploy can trigger identical
rebuilds in parallel.

**Recommendation:** Persist a compact call-outcome event or incremental
aggregate, then query the aggregate by owner/team. Until that exists, cap the
time horizon and document the result as a sample. A shared cache may reduce
repeat reads but must not become authoritative.

### P2 - Claimed-lead page performs redundant exact counts and a full status scan

**Location:** `worker/src/repos/leadsRepo.js:1041-1049`,
`worker/src/repos/leadsRepo.js:1062-1101`

Every claimed-lead page starts the page query plus four independent exact
counts and an unbounded select of all active lead statuses. The status list is
not scoped to the current user and grows with the team table.

**Impact:** One routine table page costs six Supabase requests, four of which
count overlapping subsets. Exact counts can become expensive as a rep's lead
set grows.

**Recommendation:** Return the page and summary counts from one SQL RPC (or a
view/materialized aggregate), and cache or normalize allowed statuses rather
than rediscovering them from every active lead on each page request.

### P2 - Admin summary paths materialize full tables in the Worker

**Location:** `worker/src/repos/adminRepo.js:25-61`,
`worker/src/repos/adminRepo.js:845-912`

Admin overview, activity, export, and cleanup paths use `fetchAllRows()` to
page whole tables, including `leads`, `suggestions`, `search_progress`, events,
and call taps, before calculating summaries in JavaScript.

**Impact:** Admin requests become slower and more memory-intensive with table
growth; paging masks the work rather than reducing it. The 200,000-row safety
cap can eventually create truncated summaries.

**Recommendation:** Shift grouped counts, date filtering, and aggregates into
reviewed SQL RPCs with narrow result shapes. Keep whole-row exports explicitly
export-only, streamed/paged, and protected by a documented maximum.

### P2 - Request timing is not attributable to endpoint or dependency

**Location:** `worker/wrangler.toml:35-36`, `worker/src/index.js:61-102`

Cloudflare observability is enabled, and errors log the method/path/message,
but the Worker emits no structured latency, route, upstream, or Supabase-RPC
timing data. Existing search comparison timing only covers its admin endpoint.

**Impact:** A statement timeout or slow third party cannot be ranked by route,
dependency, percentile, or cache state, so future optimization remains
guesswork.

**Recommendation:** Add privacy-safe structured timing at the Worker boundary:
route, status, duration, source (`dmedesk`/mirror), cache state, and an
opaque error category only. Instrument expensive RPCs/outbound calls, sample
successes, and never log authorization headers, tokens, notes, or full search
payloads. Establish p50/p95/p99 and timeout/error-rate alerts before changing
database indexes.

## Positive findings

- Provider-search SQL constrains result pages to 200 rows, caps counts at
  5,000, and has expression/partial indexes aligned with its predicates
  (`sql/018_provider_search.sql`, `sql/022_search_speed.sql`, and
  `sql/024_remove_scoring.sql`).
- The primary search pipeline bounds registry fan-out to 30 fetches and two
  concurrent calls, batches claimed/owned checks, and preserves failed page
  positions for retry (`worker/src/services/companyService.js`).
- Territory calculation uses a small derived cache table, bounded refresh
  concurrency, and a 20-second refresh budget (`sql/025_territory_cache.sql`,
  `worker/src/services/searchInsights.js`).
- Search insights cache brief repeat requests and batch quick-pick counts when
  `sql/022` is installed.
- Static verification passed: all Worker source files pass `node --check`, and
  all 212 Worker tests passed under Node's built-in test runner.

## Required measurement before fixes

1. Run `EXPLAIN (ANALYZE, BUFFERS)` in an isolated/staging Supabase target for
   representative `search_providers_v2`, claimed-page, related-claim, and
   admin-aggregate workloads.
2. Capture Cloudflare route p50/p95/p99, CPU time, subrequest count, and error
   rate for at least one normal business cycle.
3. Record table/index sizes and active-row cardinalities, as required by
   `documentation/plans/SUPABASE_FREE_TIER_SUPPORT_PLAN.md`, before selecting
   cache or aggregate thresholds.

## Priority order

1. **P1:** Bound website scraping and validate its concurrency/timeout behavior.
2. **P2:** Replace full claimed-lead and notes scans with queryable aggregates
   or targeted RPCs.
3. **P2:** Consolidate claimed-page counts and status discovery.
4. **P2:** Move admin summaries into SQL aggregates and define export limits.
5. **P2:** Add privacy-safe performance instrumentation, then measure again.

## Limitations

This review cannot determine actual production latency, query plans, cache hit
rates, storage size, or deployed migration state. Those require read-only
production telemetry and/or a verified staging dataset; none was accessed.
