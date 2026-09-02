# Architecture

How DME Desk Prospector actually works today, end to end. Read this if
you're picking up the codebase, debugging a production issue, or working on
the lead-identity/ownership-audit layer described in `MASTER_PLAN.md`.

## The short version

There are **three implementations** of this app's backend in one repo. Only
one of them is live.

| | `worker/` + `docs/` | `appscript/` | `backend/` |
|---|---|---|---|
| Status | **Live — this is the real app** | Frozen predecessor | Frozen / reference only |
| Hosting | Cloudflare Workers (API) + GitHub Pages (frontend) | Google Apps Script + GitHub Pages | Node/Express, self-hosted |
| Database | Supabase Postgres | Google Sheets | Google Sheets (service account) |
| Auth | `app_users` + bcrypt + signed JWT | `Users` sheet tab, plaintext passwords | ❌ never built |
| Claimed leads, statuses, notes, reminders, taxonomies, search resume, admin | ✅ | ✅ (Sheets-backed) | ❌ never built |

`backend/` was the original Node implementation, abandoned once free Node
hosts started requiring card verification. `appscript/` was its free
replacement and carried the app for most of its life — every feature that
exists today was designed there first. `worker/` is the current port of
`appscript/` onto real hosting and a real database; the frontend in `docs/`
was carried across almost unchanged.

**Treat `appscript/` and `backend/` as historical snapshots, not second
copies of the current app.** The rest of this document describes
`worker/` + `docs/` exclusively. The tail section, *How we got here*,
explains the Apps Script-era decisions that are still visible in the code.

## Request flow

```
Browser (docs/index.html + app.js + config.js)
   │  fetch(`${API_BASE_URL}/search/companies?...`)
   │  Authorization: Bearer <JWT>       POST bodies are real application/json
   ▼
Cloudflare Worker (worker/src/index.js -- Hono)
   │  real routes, real HTTP status codes, real CORS
   │  middleware: makeConfig(env) -> verify JWT -> attach session
   ▼
worker/src/services/* and worker/src/repos/*
   │
   ├─ services/nppes.js        → fakeNPI Edge Function (self-hosted NPPES replica)
   ├─ services/companyService.js → the search/dedup/score orchestrator
   ├─ services/scraper.js       → the company's own website (regex extraction, opt-in)
   ├─ services/aiBrief.js       → Gemini (optional, needs a key)
   ├─ services/googleSheets.js  → Google Sheets API ("Export to Sheet" only)
   ├─ services/{cms,foursquare,osm}.js → present but not in the live pipeline (see below)
   ├─ lib/scoring.js            → pure function, no I/O
   └─ repos/*.js                → Supabase (service-role client)
```

The Worker is the trusted server side. It holds the Supabase
**service-role** key and therefore bypasses RLS — the browser never talks
to Supabase directly and never sees that key. All secrets live in
Wrangler's secret store (`wrangler secret put`), never in `wrangler.toml`
and never in the repo; `worker/.dev.vars.example` lists them for local dev.

### Response shape

Every response is `{ success: true, data }` or
`{ success: false, status, error }`. That shape is an Apps Script holdover
kept **on purpose** so `docs/app.js`'s existing `unwrap()` needed no
changes during the port. Unlike Apps Script, the Worker also sends a real
HTTP status code matching `status`, so both signals agree.

`app.onError` maps any error named `*NotConfiguredError`
(Foursquare/Gemini/Sheets/Auth/GoogleSheets) to **503** — that's how an
unset optional API key surfaces as a clear "not configured" message
instead of a generic failure.

## Auth & sessions

- Accounts live in `app_users` (`id`, `username`, `password_hash`,
  `display_name`, `exclude_keywords`, `is_admin`). Passwords are
  **bcrypt-hashed** — the plaintext-in-a-spreadsheet tradeoff of the Apps
  Script era is gone.
- There is no sign-up flow. Accounts are created by running
  `worker/scripts/seed-user.mjs` locally with the Supabase env vars set.
- `Auth.login` looks the user up case-insensitively, `bcrypt.compare`s the
  password (with a 400 ms delay on failure to slow brute-forcing), then
  mints an **HS256 JWT** (`jose`) with `sub = user.id` and
  `{ username, displayName, excludeKeywords, isAdmin }` claims, expiring in
  6 h.
- Sessions are **stateless**. There is no server-side session store, so
  there is also no way to revoke a token early — `POST /auth/logout` is
  client-side only (discard the token). Add a `revoked_tokens` table keyed
  by JTI if that ever matters.
- One `app.use("*")` middleware gates everything: it reads
  `Authorization: Bearer <token>` (falling back to a `?token=` query param
  for compatibility), verifies it, and attaches `session` to the request.
  A bad/expired/missing token is a plain 401, never a throw.
- `PUBLIC_PATHS` is only `/health` and `/auth/login`.
- Admin routes call `requireAdmin(session)`, which throws 403 unless
  `session.isAdmin`. That claim is baked into the JWT at login from
  `app_users.is_admin` — **the server-side check is the actual control**;
  the frontend hiding an admin tab is only cosmetic.
- The 6 h expiry is inherited from the old `CacheService` TTL ceiling for
  parity. Nothing forces it now that it's just a JWT claim.

## The data model (Supabase Postgres)

### Tables the live app reads and writes

| Table | Purpose |
|---|---|
| `leads` | The sales workflow table. One row per claimed or disconnected lead: `npi`, `claimed_by`, `claimed_at`, the provider snapshot captured at claim time (company name, phone, address, specialty, Medicare values, `nppes_last_updated`), and the sales fields (`status`, `status_updated_by/at`, `notes`, `reminder_at`, `is_disconnected`) |
| `app_users` | Sign-in accounts (see Auth above) |
| `taxonomies` | `Facility Type / Code / Description / Enabled` — the specialty reference behind the search form's multiselect, and the description→code lookup the search path needs |
| `search_progress` | Per-user, per-filter-combination pagination bookmark (variant skips + seen NPIs) |
| `suggestions` | In-app feedback submissions (stored only — the old email notification has no equivalent wired up) |
| `enrichment_cache` | Key/value cache with a 1 h TTL, replacing Apps Script's `CacheService`. Distinguishes "never looked up" (absent) from "looked up, found nothing" (a real cached `null`) |

One `leads` table with `claimed_by` + `is_disconnected` replaced the old
per-teammate `Claimed - <Name>` tabs plus a shared `Disconnected` tab
entirely.

### Tables present but not yet read by the Worker

| Table | Purpose |
|---|---|
| `npi_records` | A copy of the NPPES provider registry, in the same project as `leads`. Populated, and its identity columns verified — but the Worker still reaches the registry through the fakeNPI Edge Function rather than querying this table. Cutting over is a planned step (`MASTER_PLAN.md` Phase 3) |
| `lead_groups`, `lead_group_members`, `lead_ownership_events`, `provider_field_history`, `refresh_runs`, `leads.group_id` | The identity and audit layer. Installed and backfilled. The admin ownership-conflict queue is the first thing to read it; the claim, search and export paths still don't — see below |
| `nppes_refresh_staging` | Where `scripts/nppes_ingest` puts a validated NPPES release. Nothing reads it at runtime; the apply step that turns staged rows into `npi_records` updates doesn't exist yet |

### Claiming, and why it isn't atomic yet

Claiming a lead is `POST /export/sheets` →
`leadsRepo.exportCompaniesToLeads`. It does a **read-then-insert**: select
the caller's existing active claims for those NPIs, filter those out,
insert the rest.

It is deliberately a plain `insert`, not an `upsert({ onConflict })`. The
active-claim uniqueness rule `idx_leads_npi_claimed_by_active` is a
*partial* unique index (only where `NOT is_disconnected`), and Postgres can
only use a partial index as an `ON CONFLICT` arbiter if the same `WHERE`
predicate is repeated in the `ON CONFLICT` clause — something PostgREST's
`on_conflict` param cannot express. Trying anyway is what broke Claim Lead
in production once.

The consequence worth knowing: **two concurrent requests can both pass the
pre-check before either inserts.** That's tolerable for today's exact-NPI
rule, which the partial unique index still backstops at the database level.
It is *not* good enough for a group-level ownership check, where there's no
single index to fall back on. That's why the planned group-aware claim has
to be one atomic database-side operation (an RPC or SQL function), not
another read-then-write in the repo layer.

Related lifecycle operations:

- `POST /leads/disconnect` — `update` sets `is_disconnected = true`, scoped
  to the caller's own rows.
- `POST /leads/return-to-prospect` — **deletes** the caller's rows, so the
  lead resurfaces in Prospect.
- Status/notes/reminder writes all go through `requireOwnLead`, which
  scopes every write to `claimed_by = session.id`.

## The search pipeline (`companyService.searchCompanies`)

For a broad search (not an exact NPI lookup):

1. **Taxonomy resolution.** `attachTaxonomyCodes` turns the selected
   taxonomy *descriptions* into *codes* using our own `taxonomies` table,
   because the registry data has `taxonomy_code` populated but not
   `taxonomy_description`.
2. **Resume.** Unless the request carries its own `variantSkips` (a "Search
   more" click) or `resetProgress=true`, the saved `search_progress`
   bookmark for this user + filter combination is loaded, so a fresh
   "Search" continues where the last one stopped instead of re-showing the
   top of the registry. `resetProgress` is a self-contained detour: it
   starts from skip 0 for this run without reading *or* writing the saved
   bookmark.
3. **Branch-merge fan-out.** `buildCriteriaVariants` expands a
   multi-state/multi-taxonomy search into one query per state×taxonomy
   combination and round-robins across them, so one abundant variant can't
   crowd out the others before the limit is hit. Duplicate companies found
   via more than one variant merge into a single row.
   - Page size 200, at most 30 fetches per request, and **at most 2 in
     flight at once** — fakeNPI runs on a Nano-tier Supabase project and
     reliably 500s several queries at a time under an unbounded
     `Promise.all`.
   - A variant that returns a short or empty page is marked exhausted with
     an `EXHAUSTED_SKIP = -1` sentinel, so resuming reads back as "done"
     rather than querying past its real total (which fakeNPI 500s on).
   - A variant whose query fails is dropped and reported in
     `rejectedVariants` rather than failing the whole search.
4. **Claimed-lead exclusion.** Each round does **one batched** check of
   that round's candidate NPIs against `leads`, so a lead already in
   someone's pipeline never resurfaces in Prospect. (This replaced an
   up-front whole-table preload.)
5. **Scraping** (opt-in, `?scrape=true`) — regex/heuristic extraction of
   contact names and titles from the company's own website. Workers ships
   no DOM or `cheerio`, so this is best-effort only, the same tradeoff the
   Apps Script port already made.
6. **Medicare filters** — `requireCmsClaims` and `minMedicareClaims` filter
   on the Medicare data already attached to each provider.
7. **`scoreCompany`** — a pure function over a fixed `WEIGHTS` map.
   `MAX_POSSIBLE_SCORE` is derived from `WEIGHTS` automatically, so adding
   or removing a signal never requires updating a second constant. Results
   are sorted by score.

### Enrichment services that are no longer in the pipeline

`foursquare.js`, `osm.js`, and `cms.js` are all still in the tree but
**not called by the live search**:

- **Foursquare** — the API key is over its rate limit and no longer usable.
  `foursquare.js` still backs `GET /debug/foursquare`.
- **OSM/Nominatim** — was only a website fallback for companies Foursquare
  didn't cover. With Foursquare gone that meant nearly every company, and
  Nominatim's 1 req/sec throttle added roughly a second each while eating
  into Cloudflare's per-invocation subrequest budget.
- **CMS** — no longer a separate live lookup: fakeNPI's Edge Function joins
  `npi_cms_enrichment` into every result, so `provider.medicare` is already
  populated by the time the result is normalized.

All three files are left untouched in case any is revived (e.g. a live CMS
lookup for NPIs fakeNPI has no enrichment for).

### The provider registry dependency

`services/nppes.js` talks to **fakeNPI** — a self-hosted NPPES replica with
the same request/response shape as the public NPI Registry API but no cap
on `skip` — through `FAKENPI_BASE_URL`. It defaults to an Edge Function on
the *separate* fakeNPI Supabase project (`zvthhjediuelpvzkkzvy`), not the
DME Desk project that holds `leads`.

That split is the thing to keep in mind when reading this code: **the app's
database and the app's provider search currently live in two different
Supabase projects.** `npi_records` now exists in the DME Desk project too,
so the planned cutover is to query it directly through the Worker's
existing service-role client and drop the cross-project Edge Function hop.
Pointing `FAKENPI_BASE_URL` back at the real NPPES API also works without a
code change, at the cost of the `skip` cap.

## Export to Sheet (separate from claiming)

`POST /export/google-sheet` and `POST /export/google-sheet/claimed` paste a
copy of selected leads into a real shared Google Sheet. This is **not**
claiming — claiming writes to Supabase and is what powers the Claimed Leads
view; this is a convenience copy for people who want a spreadsheet.

It authenticates with an OAuth client + refresh token authorized as a real
Google account, **not** a service-account key, because some Workspace orgs
block service-account key creation outright
(`iam.disableServiceAccountKeyCreation`). Setup steps are in
`worker/README.md`. Leave the four secrets unset and the button returns a
clear "not configured" 503.

The `/claimed` variant takes NPIs rather than a client-supplied companies
payload and re-fetches them server-side, scoped to the caller's own claimed
leads — the same trust boundary as `/leads/disconnect`.

## Frontend (`docs/`)

Plain HTML/CSS/vanilla JS — no build step, no framework, so a static host
(GitHub Pages) serves it as-is. Carried over from the Apps Script era
nearly unchanged.

- `config.js` — the one file that changes per deployment: `API_BASE_URL`,
  the deployed Worker URL. Nothing sensitive goes here.
- `app.js` — everything: the request layer (`apiGet`/`apiPost`/`unwrap`),
  session storage, the Prospect search view, the Claimed Leads view
  (own-leads-only, searchable, sortable), the admin view, taxonomy
  multiselect, reminders/notifications, light/dark theme, and the sticky
  layout mechanics.
  - Sessions live in `sessionStorage`, deliberately not `localStorage`, so
    closing the tab signs you out rather than persisting up to the full 6 h
    token lifetime.
- `style.css` — includes a `ResizeObserver`-driven mechanism: because the
  search panel and results toolbar genuinely vary in height (responsive
  wrapping, a chip appearing), `app.js` keeps `--search-panel-h` and
  `--toolbar-h` live as CSS custom properties, and every sticky element
  below references them via `calc()` for its `top` offset — so the header,
  search panel, toolbar, and table `<thead>` stack correctly while
  scrolling at any screen size. A `@media (max-height: 820px)` rule shrinks
  the stack on laptop viewports so it doesn't crowd out result rows.

## The NPPES ingestion CLI (`scripts/nppes_ingest`)

A dependency-free Python CLI that loads an NPPES release into
`nppes_refresh_staging` under one `refresh_runs` row. It is not part of the
Worker and never runs in production — someone runs it by hand when a
release lands.

Its defining property is the boundary it refuses to cross: it writes
`refresh_runs` and `nppes_refresh_staging`, and nothing else. It never
touches `npi_records`, and never touches `leads`. Turning staged rows into
provider updates — comparing canonical values, writing
`provider_field_history` before any overwrite, raising review alerts — is a
separate transactional SQL step that has not been built yet. Staging a
release is therefore safe on its own: nothing downstream happens until
someone deliberately builds and runs that step.

Worth knowing when reading it:

- **Values are canonicalized on the way in** (first valid 10-digit phone,
  trimmed/collapsed text, real dates, hyphenated ZIP+4), so the eventual
  compare step is a plain equality test rather than a pile of formatting
  special cases. A reformatted phone number must not read as a provider
  data change.
- **NPIs are checked against the CMS check digit** (Luhn over the 80840
  issuer prefix), not just their length — a transposition typo would
  otherwise create a phantom provider that never matches anything.
- **A truncated release is refused** via `--expect-rows` /
  `--row-count-tolerance`, because a partial file that is structurally fine
  is the dangerous input: it reads as "thousands of providers changed".
- **Filtered rows and malformed rows are counted separately** in the
  manifest, since "12,000 rows filtered out by state" and "3 rows were
  malformed" mean very different things.
- **A failed load rolls itself back** — staging rows deleted, run marked
  `failed` — so a half-loaded release can't be mistaken for a complete one.
- **Taxonomy scope comes from `public.taxonomies`**, the same table the
  search form uses, so there's no second list to keep in sync.

Setup, usage, run types and the test suite are in
[`scripts/README.md`](./scripts/README.md).

## Ownership conflicts in the Admin tab

An identity group whose active claims are held by more than one person is a
conflict. The Admin tab lists them at the top and can resolve one by
assigning the whole group to a single owner.

Two details matter architecturally:

- **Listing is aggregated in the Worker** from `leads` + `lead_groups`
  rather than from a database view, so the queue works as soon as the
  Worker deploys — before any new SQL is installed. If `leads.group_id`
  doesn't exist, the endpoint reports that in the panel instead of failing
  the admin page.
- **Resolving is a SQL function**, `resolve_ownership_conflict()`, not a
  sequence of REST calls. PostgREST gives the Worker no transaction, so a
  read-then-write resolve could interleave with a concurrent claim and
  leave a group half-moved with a partial audit trail. Inside the function
  the affected rows are locked, every move writes a `reassigned` event
  carrying the approving admin and a required reason, and only `claimed_by`
  changes — `claimed_at`, status, notes, reminders and disconnect state are
  untouched. If the target owner already holds that NPI (which the partial
  unique index would reject) the row is skipped and reported rather than
  failing the whole resolution.

The approver is always taken from the session, never from the request body.

## The identity & audit layer (built, not connected)

This is the current area of active work, and the most important thing to
understand about the repo's present state:

**The new schema is installed, backfilled, and verified in production, and
the app is only just beginning to read it.** That is deliberate. The
approach is to build each piece and prove it in isolation first, then
connect it to the running app as a separate, reviewable step.

As of 2026-09-02 exactly one feature reads this layer: the admin
ownership-conflict queue described above. The live claim, search, export,
status, notes and reminder paths still don't — claiming remains the
exact-NPI flow, and `group_id` is still write-once-by-backfill everywhere
else.

What exists in the database today (installed via `sql/001_identity_schema.sql`
and populated by `sql/002_identity_backfill_safe.sql`):

| Object | Purpose |
|---|---|
| `lead_groups` | One row per real-world provider entity, keyed by a normalized identity key |
| `lead_group_members` | Maps each NPI to exactly one group, with relationship type (`primary`, `alias`, `possible_duplicate`, `possible_successor`, `confirmed_successor`) and review metadata |
| `lead_ownership_events` | **Append-only** claim/reassign/release/provider-alert history |
| `provider_field_history` | **Append-only** old→new provider field values, written *before* the current value is overwritten |
| `refresh_runs` | One row per NPPES or Medicare import run; every staging and history row carries its `refresh_run_id` |
| `leads.group_id` | Nullable FK to `lead_groups` |

Protections that came with it: RLS enabled on all five new tables, `anon`
and `authenticated` revoked (the service-role Worker path is the intended
access route), and `BEFORE UPDATE OR DELETE` triggers on both history
tables that raise an exception — audit rows cannot be edited or deleted,
only inserted.

Why it doesn't break anything: the change was purely additive. No existing
column was dropped or renamed, no existing index or uniqueness rule
changed, no trigger was added to `leads`, `group_id` stays nullable, and
the backfill wrote only `leads.group_id` plus audit inserts — it never
touched `claimed_by`, `claimed_at`, status, notes, reminders, or provider
snapshots.

The grouping rule used for the backfill is deterministic (Tier 1):
`normalized name + state + authorized official + first valid 10-digit
phone`. When any of those signals is missing it creates a singleton group
(`singleton:<npi>`) rather than guessing that two providers are the same
entity. Fuzzy matching (Tier 2) is not implemented, and by design will only
ever *flag for review* — a name match alone must never auto-group.

See `MASTER_PLAN.md` for the phase plan and `sql/README.md` for execution
order. All Supabase changes are delivered as reviewed SQL files and run
manually.

## Known limitations of the current architecture

- **Claiming is not atomic** (see above). Fine for the exact-NPI rule the
  partial unique index backstops; a blocker for group-level conflict
  checks, which is why that work needs a database-side RPC.
- **Two Supabase projects.** Provider search goes cross-project to
  fakeNPI's Edge Function while all app data lives in the DME Desk project.
  `npi_records` is already copied over; the cutover hasn't happened.
- **fakeNPI runs on Nano-tier compute**, which is why search concurrency is
  pinned at 2 and why a variant can fail mid-search and get dropped.
- **No token revocation.** Stateless JWTs mean a compromised token is valid
  until it expires.
- **Enrichment is thinner than it looks.** Three enrichment services are in
  the tree but disabled; scoring signals that depended on Foursquare
  (rating, some phone/website coverage) are effectively degraded.
- **Scraping has no real HTML parser** — regex heuristics only.
- **Suggestions are stored but never delivered** — no email path is wired
  up in the Worker.
- **Two ownership conflicts are known and unresolved.** The identity
  backfill surfaced two groups whose NPIs are actively claimed by different
  people. They are documented in
  `documentation/operations/CHAT_HISTORY_2026-09-02.md` and must be settled
  by an explicit human decision — nothing in the system will resolve them
  automatically, and the group-aware claim path shouldn't ship before they
  are.

## How we got here

Some of the code's shape only makes sense with the history, especially in
`docs/`, which predates the Worker.

**Google Apps Script (`appscript/`) had three constraints** that dictated
the original API design:

1. **No custom router** — every request carried a `?path=` query param that
   a single `doGet`/`doPost` switch dispatched on.
2. **No custom HTTP status codes** — every response was HTTP 200, and the
   body's `success` field was the real signal. That's why the response
   envelope exists at all.
3. **No reliable CORS preflight** — so every request was kept a CORS
   "simple request": the session token travelled as `?token=` rather than
   an `Authorization` header, and POST bodies were sent as `text/plain`.

The Worker fixed all three (real routes, real status codes, real CORS,
`Authorization: Bearer`, real `application/json`), but **kept the response
envelope** so the frontend's `unwrap()` didn't have to change. The
`?token=` fallback in the auth middleware is the last visible remnant.

**Google Sheets as the database** had its own consequences, which the
Postgres schema was designed to fix:

- Every lookup was a linear scan of a tab's NPI column — there were no
  indexes and no keys. That scan cost is what caused the "Return to
  Prospect" timeout bug in July 2026: Apps Script's ~6-minute execution cap
  got hit mid-scan on a large multi-select, and the killed request looked
  to the browser like a hung fetch (easy to misdiagnose as a CORS failure,
  since no response ever arrived).
- Multi-step writes were "append then delete", not transactions.
- Passwords were plaintext, acceptable only because the `Users` tab was
  meant to live in a private, owner-only spreadsheet.

`MIGRATION_TO_VERCEL_SUPABASE.md` is the original migration plan and still
documents the Supabase schema design; the app landed on Cloudflare Workers
rather than Vercel, but the database half is what was actually built.
`SUPABASE_CHANGELOG.md` records every database change since.
