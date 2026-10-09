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

## Architecture and request-path coverage

The deployed path is a static browser client -> Hono Cloudflare Worker ->
Supabase (service-role client), with optional Google, Gemini, website, and
mirror-NPPES calls. The Worker creates a Supabase client for each request and
the global middleware verifies the JWT and refreshes user flags from Supabase
once per warm isolate every 30 seconds.

This audit covers:

- authentication/session gate, search, search insights, territory refresh,
  claim and ownership flows, disposition/status writes, sheet status sync,
  lead lists, Today/due data, related-claim checks, call analytics, admin
  overview/activity/funnel/status cleanup/export, and optional integrations;
- Worker concurrency, Supabase request count and cardinality, indexes known to
  the repository, cache scope, memory growth, external I/O resilience, error
  behavior, observability, and test coverage.

It does not assert the live database's exact plan or installed-index state.
Those must be established with the read-only measurement plan below.

## Health score

| Dimension | Score | Key finding |
|---|---:|---|
| Worker request execution | 2/4 | Search fan-out is bounded, but disposition sync is serial and optional scraping has no request deadline or response-size limit. |
| Database efficiency | 2/4 | Search SQL is indexed and capped; status/list/admin paths still perform redundant or whole-table work. |
| External dependency resilience | 2/4 | NPPES retries are bounded, while scraper, AI, Google, and debug fetches have no explicit deadline. |
| Caching and scalability | 2/4 | Useful per-isolate caches exist, but cold isolates repeat full Supabase scans and there is no shared cache. |
| Observability and performance tests | 2/4 | Cloudflare observability is enabled and unit tests pass, but no endpoint-level latency/query telemetry or timeout/load tests cover the slow paths. |
| **Total** | **10/20** | **Acceptable: significant backend performance work remains.** |

## Findings

### P1 - Interactive lead dispositions perform serial, avoidable round trips

**Location:** `worker/src/index.js:475-479`,
`worker/src/repos/leadsRepo.js:834-879`,
`worker/src/repos/buddyRepo.js:87-115`

For every `POST /leads/status`, the Worker first performs an ownership read
through `requireOwnLead()` and then performs the status update. An onboarding
disposition performs a second read for the current status/company, then waits
for `announceWin()`. The announcement reads settings and, when enabled, writes
both a team note and its seen marker. On a cold isolate, the shared request
middleware may add a user-flag read before this handler starts.

**Impact:** A normal status click requires at least two sequential Supabase
round trips after middleware. A first-time onboarding disposition requires at
least four and commonly six. The team announcement is deliberately
best-effort, but it is still awaited, so an otherwise-successful disposition
can feel slow whenever the buddy tables or database are slow.

**Recommendation:** Replace the ownership read plus update with one reviewed
`set_lead_status` SQL RPC that scopes the update by `claimed_by`, returns the
previous status/company, and reports zero updated rows as 404. Move win
announcement creation to a transactional outbox or a post-response Worker
task; the status response must depend only on the lead write. Cache the
team-wins setting briefly only if its admin-toggle freshness requirement is
made explicit. Add timing tests that assert normal and onboarding disposition
request counts.

### P1 - Sheet disposition sync performs one update per changed lead

**Location:** `worker/src/repos/leadsRepo.js:704-767`

`syncLeadStatusesFromSheet()` accepts up to 200 leads and does one batched
read, but then awaits each changed row's `update()` inside a `for` loop. A
200-row reconciliation can therefore issue 200 sequential Supabase requests,
turning normal network latency into seconds or minutes of wall-clock time.

**Impact:** This is the most likely backend cause when bulk dispositions from
BD MEETINGS take a long time. It also makes a transient failure leave a
partially applied batch without one atomic result contract.

**Recommendation:** Implement one reviewed SQL RPC that accepts validated
JSON rows, matches only the target owner's active leads, applies the existing
status/date rules set-wise, and returns `updated`, `unchanged`, `notOwned`, and
`skipped` results. Preserve the current rule that this sync does not announce
wins or change ownership. Test 1, 5, 50, and 200-row inputs plus rollback/error
behavior.

### P1 - Claim/preflight batch size is a documented statement-timeout risk

**Location:** `worker/src/repos/leadsRepo.js:394-416`,
`worker/src/repos/leadsRepo.js:419-430`,
`documentation/operations/WORKLOG.md:3-11`,
`documentation/plans/SHEET_LEAD_IMPORT_PROTOCOL.md:199`

The group-aware `claim_leads` RPC intentionally performs identity matching,
locking, and auditing atomically. Repository operations notes document
statement timeouts when a batch of more than five leads reaches that path. The
Worker still exposes direct claim/preflight paths that can pass much larger
batches, and delegated claiming permits up to 200 companies.

**Impact:** Imports and bulk disposition/claim workflows can time out before a
useful response. Retrying must preserve the existing ownership and append-only
audit guarantees, so this cannot be addressed with blind client retries.

**Recommendation:** Establish a server-enforced batch ceiling based on a
measured query plan, or introduce a keyset/batched RPC with an explicit
idempotency key and per-row result contract. Profile the identity matching
queries before adding indexes or altering lock order.

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

### P2 - The authentication freshness check adds an unmeasured read to cold paths

**Location:** `worker/src/index.js:61-91`, `worker/src/lib/userGate.js:10-35`

All authenticated routes verify a JWT and then load the full active-user flag
set on the first request per isolate and every 30 seconds afterward. The team
is intentionally small today, so this is not a current table-size problem,
but a cold-start burst adds the same Supabase query to every business route,
including a disposition click.

**Impact:** It increases tail latency and database concurrency during deploys
or isolate churn. The cost is currently unknown because it is not timed.

**Recommendation:** Keep the freshness behavior, which is security-relevant,
but instrument it separately. If it becomes material, cache a small revision
or per-user flag record with a short TTL and an explicit invalidation path from
user administration; do not trade away immediate user disable/admin demotion
without an approved policy decision.

### P2 - Other synchronous integrations also lack deadlines

**Location:** `worker/src/services/aiBrief.js:67-108`,
`worker/src/services/googleSheets.js`,
`worker/src/services/googleCalendar.js`, `worker/src/services/scraper.js:20-50`

AI brief generation, Google OAuth/token calls, Google Sheets/Calendar API
calls, and website scraping use `fetch()` without an explicit abort deadline.
Several error paths read complete upstream bodies. The legacy CMS, Foursquare,
and OSM modules have the same pattern, though they are not in the current live
search pipeline.

**Impact:** One stalled upstream can consume a Worker invocation until the
platform terminates it. This makes the latency and failure mode inconsistent
across integrations.

**Recommendation:** Use one shared, privacy-safe outbound client with per
provider timeouts, a response-size ceiling, retry policy only for idempotent
requests, and classified error metrics. Keep writes such as calendar booking
and sheet export idempotent before adding retries.

### P2 - Analytics and funnels parse growing note blobs on every admin request

**Location:** `worker/src/repos/adminRepo.js:839-887`,
`worker/src/lib/teamActivity.js`, `worker/src/lib/funnel.js:24-86`

Team activity and funnel endpoints page broad lead/event/tap datasets, then
parse `leads.notes` in JavaScript to infer calls, meetings, and funnel stages.
The funnel applies its date restriction after all claimed rows are fetched.
Status cleanup similarly fetches every lead status into the Worker.

**Impact:** Historical notes make both payload and CPU cost grow over time.
These admin endpoints can compete with frontline disposition traffic for the
same Supabase and Worker resources.

**Recommendation:** Record structured call/meeting/status events at write
time and build SQL aggregates from them. Until migration is approved, apply
time filters in SQL, paginate admin output, define explicit export limits, and
separate admin analytics from latency-sensitive user workflows.

### P3 - Repository SQL does not prove the status-write access path is indexed

**Location:** `worker/src/repos/leadsRepo.js:834-875`,
`documentation/operations/SUPABASE_CHANGELOG.md:410-415`,
`documentation/operations/WORKLOG.md:716-721`

The status read/update filters by `claimed_by` and `npi`; list and disposition
paths also filter by `is_disconnected`. The repository records an index on
`status_updated_by` and a historical suggestion for
`(claimed_by, is_disconnected)`, but it cannot establish the deployed index
set or planner choice for the status-write predicates.

**Impact:** Missing composite coverage would turn an otherwise small
disposition write into a table scan as `leads` grows.

**Recommendation:** First run a read-only production/staging index inventory
and `EXPLAIN (ANALYZE, BUFFERS)` for the exact scoped select/update. Add an
index only if the plan demonstrates need; this avoids unnecessary write cost
and index bloat.

## Disposition-specific measurement plan

Collect these metrics without recording lead names, NPIs, notes, tokens, or
full request bodies:

| Route / operation | Measure | Target question |
|---|---|---|
| `POST /leads/status` | p50/p95/p99 total duration; user-gate, ownership-read, update, and announcement durations; Supabase call count | Is slowness in the database, announcement path, or cold auth gate? |
| First onboarding disposition | Same as above, with announcement enabled/disabled | What latency is added by noncritical team-win work? |
| Sheet status sync | Batch sizes 1/5/50/200; total duration; per-row result count; partial/error rate | Does sequential updating explain the observed delay? |
| Claim/preflight | Batch size; RPC duration; SQL timeout rate; held/blocked/claimed counts | What server-enforced batch size stays under the statement timeout? |
| Claimed page / status dropdown | Route duration; page/count/status query timing | Do repeated exact counts/status scans dominate UI latency? |
| Admin activity/funnel/cleanup | Rows read; bytes returned; CPU time; duration | Which workloads need SQL aggregation first? |

## Database verification queries (read-only)

Run these only against an explicitly confirmed staging target first, then an
approved read-only production session. Do not run `CREATE INDEX` from this
audit.

```sql
-- Confirm actual lead indexes before proposing a new one.
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'leads'
order by indexname;

-- Inspect the exact interactive disposition ownership lookup.
explain (analyze, buffers)
select npi, notes
from public.leads
where claimed_by = '<user-uuid>'
  and npi = '<npi>';

-- Inspect the claimed table's common base filter.
explain (analyze, buffers)
select id
from public.leads
where claimed_by = '<user-uuid>'
  and is_disconnected = false;
```

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
   representative status-write, sheet-sync, claim/preflight,
   `search_providers_v2`, claimed-page, related-claim, and admin-aggregate
   workloads.
2. Capture Cloudflare route p50/p95/p99, CPU time, subrequest count, and error
   rate for at least one normal business cycle.
3. Record table/index sizes and active-row cardinalities, as required by
   `documentation/plans/SUPABASE_FREE_TIER_SUPPORT_PLAN.md`, before selecting
   cache or aggregate thresholds.

## Priority order

1. **P1:** Instrument and collapse the interactive disposition write to one
   transactional status update; remove team-win work from its critical path.
2. **P1:** Replace serial sheet disposition updates with a set-based RPC.
3. **P1:** Measure and enforce a safe claim/preflight batch contract.
4. **P1:** Bound website scraping and validate timeout, body-size, and
   concurrency behavior.
5. **P2:** Replace full claimed-lead and notes scans with queryable aggregates
   or targeted RPCs.
6. **P2:** Consolidate claimed-page counts and status discovery.
7. **P2:** Move admin summaries into SQL aggregates and define export limits.
8. **P2:** Add privacy-safe performance instrumentation, then measure again.

## Limitations

This review cannot determine actual production latency, query plans, cache hit
rates, storage size, or deployed migration state. Those require read-only
production telemetry and/or a verified staging dataset; none was accessed.
