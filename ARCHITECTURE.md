# Architecture

How DME Desk Prospector actually works today, end to end. Read this if
you're picking up the codebase, debugging a production issue, or planning
the Vercel + Supabase migration (see `MIGRATION_TO_VERCEL_SUPABASE.md`).

## The short version

There are **two parallel implementations** of this app in one repo. Only
one of them is where active development actually happens.

| | `appscript/` + `docs/` | `backend/` |
|---|---|---|
| Status | **Active — this is the real app** | Frozen / reference only |
| Hosting | Google Apps Script (backend) + GitHub Pages (frontend) | Node/Express, self-hosted |
| Database | Google Sheets | Google Sheets (via service account) |
| Auth, claimed leads, statuses, notes, reminders, taxonomies, search-resume | ✅ | ❌ never built here |
| Fax field, postal code search, sticky headers, per-user Claimed scoping | ✅ (latest) | ❌ predates all of this |

`backend/` was the original Node implementation. It was abandoned once
free Node hosts started requiring card verification and the team had no
machine to self-host — `appscript/` + `docs/` is the free replacement, and
every feature built since then (sign-in, claimed leads, taxonomies, search
resume, sticky UI, etc.) only exists there. **Treat `backend/` as a
historical snapshot, not a second copy of the current app.** The rest of
this document describes `appscript/` + `docs/` exclusively.

## Request flow

```
Browser (docs/index.html + app.js)
   │  fetch(`${APPS_SCRIPT_URL}?path=search/companies&token=...`)
   │  (GET: query string. POST: query string + JSON body sent as text/plain)
   ▼
Google Apps Script Web App (appscript/Code.js -- doGet/doPost)
   │  dispatches on the `path` query param (Apps Script has no real router)
   │  every response is HTTP 200 -- body has a `success` boolean instead
   ▼
appscript/services/*.js
   │
   ├─ NppesService        → https://npiregistry.cms.hhs.gov (public NPPES API)
   ├─ FoursquareService    → Foursquare Places API (optional, needs a key)
   ├─ OsmService           → OpenStreetMap Nominatim (free, no key, website fallback)
   ├─ CmsService           → CMS Medicare DMEPOS supplier data (free, no key)
   ├─ ScraperService       → fetches a company's own website (regex-based extraction)
   ├─ ScoringService       → pure function, no I/O
   ├─ AiBriefService       → Gemini API (optional, needs a key)
   └─ SheetsStore / AuthService / TaxonomyService / SearchProgressService
          → Google Sheets (SpreadsheetApp), see "Data model" below
```

Nothing is cached across requests except `EnrichmentCache` (Foursquare/OSM
results, in a Sheets-backed cache tab, to avoid re-hitting those APIs for a
company already seen) and `AuthService`'s session tokens (in
`CacheService`, Apps Script's built-in key-value cache, max 6h TTL).
**There is no database in the conventional sense** — every request that
needs persistent state reads/writes a Google Sheet directly, live, on that
request.

## Why the API looks the way it does (and why it's CORS-free by design)

Google Apps Script Web Apps have three real constraints that shaped
everything in `Code.js` and `docs/app.js`'s request layer:

1. **No custom router.** Every request — GET or POST — carries a `?path=`
   query param that `handleRequest_` switches on.
2. **No custom HTTP status codes.** Every response is HTTP 200; the JSON
   body's `success` field is the real signal, and `status` inside an error
   body is a *logical* status (400/401/502/503), not a real one.
3. **No real CORS preflight support.** Apps Script Web Apps don't reliably
   handle an `OPTIONS` preflight request. Rather than fight that, the app
   is built so the browser never sends one — every request is kept a CORS
   "simple request":
   - the session token travels as a `?token=` query param, never an
     `Authorization` header (a custom header is what triggers preflight)
   - POST bodies are sent with `Content-Type: text/plain` (not
     `application/json`, which also triggers preflight) — `Code.js`'s
     `readJsonBody_` parses it as JSON regardless of the declared type

This is **not** a real CORS bug or misconfiguration — it's a deliberate
workaround for what Apps Script Web Apps can't do. See
`MIGRATION_TO_VERCEL_SUPABASE.md` for why this whole layer disappears once
the API moves to a real host.

## Auth & sessions

- Accounts live in a `Users` tab: `Username | Password | Display Name`
  (plus an auto-created `Exclude Keywords` column for each user's saved
  search default). Passwords are **plain text** — the tradeoff that makes
  it possible for a non-technical owner to set/reset accounts by editing a
  spreadsheet cell, with no hashing tool involved.
- The `Users` tab is strongly recommended to live in a **separate,
  private** spreadsheet (`AUTH_SHEET_ID` Script Property) that only the
  app owner can open — otherwise teammates who share edit access to the
  leads sheet could read each other's passwords.
- `AuthService.login` checks the password via a constant-time SHA-256
  comparison (hardens the *comparison*, not the plaintext storage), then
  mints an opaque token (`Utilities.getUuid()` twice, concatenated) and
  stores `{ username, displayName, excludeKeywords }` in `CacheService`
  keyed by that token, TTL 21600s (6h — `CacheService`'s own maximum).
- Every non-public route calls `requireSession_`, which is just a
  `CacheService` lookup by token — no JWT, no signature, nothing else.
- `PUBLIC_PATHS_` (only `health` and `auth/login`) are the sole routes
  reachable without a valid token.

## The data model (today: entirely Google Sheets)

One spreadsheet (`GOOGLE_SHEET_ID`) holds:

| Tab | Purpose | Created by |
|---|---|---|
| `Claimed - <Display Name>` (one per teammate) | That teammate's claimed leads — full lead columns (see below) + tracking columns | `SheetsStore.getUserSheet_`, auto-created on first claim |
| `Disconnected` | Shared dead-lead bin — leads sent here from Prospect or moved out of a Claimed tab | `SheetsStore.getDisconnectedSheet_`, auto-created |
| `Leads` (legacy) | Pre-per-teammate-tabs claims. Still *read* for dedup, never written to | manual, historical |
| `Users` | Sign-in accounts (see Auth above) | manual, required |
| `Taxonomies` | `Facility Type \| Code \| Description \| Enabled` — the searchable specialty reference table behind the search form's taxonomy multiselect | manual (`Facility Type`/`Code`/`Description`), auto-appends `Enabled` |
| `SearchProgress` | Per-user, per-filter-combination pagination bookmark (`Username \| Filter Fingerprint \| Variant Skips \| Seen Npis \| Updated At`) | `SearchProgressService`, auto-created (lives in `AUTH_SHEET_ID` if set, else the main sheet) |
| `Suggestions` | In-app feedback submissions | `SheetsStore`, auto-created (same private-sheet preference as `Users`) |
| `EnrichmentCache` (tab name may vary) | Cached Foursquare/OSM lookups keyed by something like normalized name+city | `EnrichmentCache.js` |

**Lead columns** (every Claimed/Disconnected/legacy tab), from
`CsvExport.CSV_COLUMNS` + `SheetsStore.TRACKING_COLUMNS`:

```
Company Name, NPI, Phone, Website, Email, Address, City, State, Postal Code,
Specialty, Contact Name, Contact Title, Contact Role, Contact Source,
Additional Contacts Found, Rating, Score, Score %, Data Sources,
Medicare Claims, Medicare Beneficiaries, Medicare Payment $, Contact Phone,
NPPES Last Updated,
Claimed By, Claimed At, Status, Status Updated By, Status Updated At,
Notes, Reminder At
```

Two architectural rules make this whole system safe to extend without a
migration step, and matter a lot if you're designing a Postgres schema to
replace it:

1. **Everything is looked up by column *label*, never position.**
   `buildColMap_`/`colIndex_` read row 1 as a header and build a
   label→index map every time. Adding a new field is just appending a
   label to `CSV_COLUMNS`/`TRACKING_COLUMNS` — old rows in old tabs simply
   don't have a value there (reads as blank), nothing shifts or breaks.
2. **Rows are found by NPI, scanned across every relevant tab.** There's
   no primary key/foreign key — `findLeadLocations_` reads a whole tab's
   NPI column and does a linear scan. This is the single biggest thing a
   real database fixes (see the migration doc): an indexed `WHERE npi = $1`
   query replaces an O(rows) or, for a bulk action across many leads,
   O(rows × leads) full-column scan. That scan cost is exactly what caused
   the "Return to Prospect" timeout bug fixed on 2026-07-21 — Apps
   Script's ~6-minute execution cap got hit mid-scan for a large
   multi-select, and the killed request looked to the browser like a hung
   fetch (easy to misdiagnose as a CORS failure, since the response never
   arrived at all).

## The enrichment + scoring pipeline (`CompanyService.searchCompanies`)

For a broad search (not an exact NPI lookup):

1. **NPPES** (`NppesService.searchProviders`) — the only *source* of leads.
   Queries the public NPI Registry API for NPI-2 (organization) records.
   NPPES's own filters are unreliable/partial matches for
   name-contains/taxonomy/state, so the app re-filters everything itself
   client-side (server-side, but "client" relative to NPPES) against the
   *displayed* location, not just whatever NPPES happened to match.
2. **Branch-merge + resume** — `buildCriteriaVariants_` expands a
   multi-state/multi-taxonomy search into one NPPES query per
   state×taxonomy combination, round-robins across them (so one abundant
   variant can't crowd out the others before `desiredLimit` is hit), and
   merges duplicate companies found via more than one variant into a
   single row. `criteria.variantSkips`/`excludeNpis` (from the frontend's
   "Search more" button, or auto-loaded from a `SearchProgress` bookmark
   for a brand-new "Search" click) let it resume exactly where a previous
   call left off instead of re-showing the same top-of-registry results
   every time.
3. **Claimed-lead exclusion** — every result is checked against
   `SheetsStore.getClaimedNpis()` (union of every Claimed tab + Disconnected)
   so a lead already in someone's pipeline never resurfaces in Prospect.
4. **Enrichment**, each independently optional/degradable:
   - `FoursquareService` → phone/website/rating (needs a key; cached)
   - `OsmService` → Nominatim, free fallback specifically for a missing
     website
   - `CmsService` → Medicare DMEPOS claim volume/beneficiaries/payment for
     that NPI, from CMS's free public data API
   - `ScraperService` (only if the user opted in — slower) → regex-based
     extraction of contact names/titles from the company's own website
     (Apps Script has no `cheerio`/real DOM, so this is a lossy,
     line-heuristic reimplementation of what `backend/`'s Node scraper
     does properly)
5. **`ScoringService.scoreCompany`** — a pure function over a fixed
   `WEIGHTS` map (has website, has phone, has rating, Medicare volume,
   etc.) — `MAX_POSSIBLE_SCORE` is derived from `WEIGHTS` automatically, so
   adding/removing a signal never requires updating a second constant.
6. **`AiBriefService`** (Gemini, optional) — generates a call-prep brief
   for one company at a time, on demand (not part of the bulk search).

## Frontend (`docs/`)

Plain HTML/CSS/vanilla JS — no build step, no framework, so a plain static
host (GitHub Pages today) can serve it as-is.

- `config.js` — the one file that changes per-deployment: `APPS_SCRIPT_URL`
  (the Apps Script Web App's `/exec` URL).
- `app.js` — everything: the request layer (`apiGet`/`apiPost`, see the CORS
  note above), session storage (`sessionStorage`, deliberately not
  `localStorage`, so closing the tab/browser signs you out rather than
  persisting indefinitely up to the 6h server-side TTL), the Prospect
  search view, the Claimed Leads view (own-leads-only, searchable,
  sortable), taxonomy multiselect, reminders/notifications, light/dark
  theme, and the sticky header/toolbar/table-header layout mechanics.
- `style.css` — includes a `ResizeObserver`-driven mechanism: since
  `.search-panel`/`.results-toolbar` heights genuinely vary (responsive
  wrapping, a chip appearing), `app.js` keeps `--search-panel-h`/
  `--toolbar-h` CSS custom properties live, and every sticky element below
  references them via `calc()` for its `top` offset — the app header,
  search panel, results toolbar, and table `<thead>` all stack correctly
  under each other while scrolling, on any screen size. Short (laptop)
  viewports get a `@media (max-height: 820px)` rule that shrinks that whole
  stack so it doesn't crowd out the actual result rows.

## Known limitations of the current architecture

Worth naming explicitly, since they're exactly what motivates the Vercel +
Supabase migration:

- **Apps Script's ~6-minute execution cap.** A slow enough request (large
  bulk action, cold Sheets access, many NPPES pages) can get killed
  mid-flight with no response ever sent — this already caused one real bug
  (see above).
- **Google Sheets as a database has no indexes.** Every lookup by NPI is a
  linear scan of a tab's column; every "how many leads does X have" is a
  full read. Fine at the current, modest per-teammate row counts; will not
  scale gracefully.
- **No real transactions.** A multi-step write (e.g. move a row from a
  Claimed tab to Disconnected) is "append then delete," not atomic — a
  crash mid-operation could in theory leave a row duplicated or dropped.
- **Every response is HTTP 200; every request is a CORS workaround.** Not
  wrong, just entirely a byproduct of the hosting choice — a real host
  removes the need for all of it.
- **Plaintext passwords.** Acceptable today only because the `Users` tab
  is meant to live in a private, owner-only spreadsheet that teammates
  never see.
