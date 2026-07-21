# Vercel + Supabase deployment (in progress)

This is the Vercel + Supabase implementation described in
`/MIGRATION_TO_VERCEL_SUPABASE.md` and `/ARCHITECTURE.md` at the repo root.
It lives on the **`migrate/vercel-supabase`** branch, deliberately **not
merged into `main`** -- `appscript/` + `docs/` (Apps Script + GitHub Pages)
remains the live, production system until this is fully built, tested, and
explicitly cut over.

## What's implemented

A working vertical slice, ported from `appscript/services/` with the same
behavior wherever the underlying platform allows it:

- **Database**: `supabase/migrations/0001_init.sql` -- full schema
  (`leads`, `taxonomies`, `search_progress`, `suggestions`,
  `enrichment_cache`, `profiles`) with Row-Level Security replacing every
  Google Sheets tab.
- **Auth**: Supabase Auth (email + password) instead of a plaintext Users
  tab + `CacheService` sessions. See `lib/auth.js`.
- **Search pipeline**: `lib/services/nppesService.js`,
  `foursquareService.js`, `osmService.js`, `cmsService.js`,
  `scraperService.js` (real `cheerio` again, not Apps Script's regex
  degradation), `scoringService.js`, `companyService.js` (full
  branch-merge/round-robin/resume orchestration, ported faithfully from
  `appscript/services/CompanyService.js`).
- **Claimed leads**: `lib/services/leadsService.js` -- claim, list, status,
  notes (append-only call log, unchanged format), reminders, disconnect,
  return-to-prospect. Every "own leads only" guarantee is enforced by
  Postgres RLS, not just application code.
- **Taxonomies**: `lib/services/taxonomyService.js` -- list/search/enable,
  simplified since Postgres doesn't need the "seed legacy defaults on first
  read" dance the Sheets version needed (the migration seeds them
  directly).
- **Search resume**: `lib/services/searchProgressService.js` -- same
  fingerprint logic, now a real indexed upsert instead of a Sheets scan.
- **API routes**: `api/**/*.js`, one file per endpoint (Vercel's
  file-based serverless function routing) -- real HTTP status codes, real
  CORS headers, `Authorization: Bearer <token>` instead of Apps Script's
  `?token=` query-param workaround (see `lib/http.js` and
  `ARCHITECTURE.md`'s CORS section for why the old app needed that at all).

## What's deferred (not yet ported)

- **`suggestions/submit`, `debug/foursquare`, `debug/suggestion-email`
  routes** -- small, low-risk, straightforward to add the same way as
  everything else here; skipped only to keep this first pass focused on
  the core search + claimed-leads flow.
- **The frontend** -- `docs/app.js`'s `apiGet`/`apiPost` still target the
  Apps Script `?path=&token=` convention. Pointing it at this API means
  rewriting that request layer to real REST calls with an `Authorization`
  header (see `MIGRATION_TO_VERCEL_SUPABASE.md` section 5 for the exact
  before/after) and updating the login form to ask for an email instead of
  a username. Not done yet -- this branch is API/database-only so far.
- **Data migration from the live Google Sheet** -- see
  `MIGRATION_TO_VERCEL_SUPABASE.md` section 6. Do this once, right before
  an actual cutover, not before.
- **Account creation flow** -- accounts are created via Supabase Auth
  directly (dashboard, or `supabase.auth.admin.createUser`) for now, not a
  self-serve signup page.

## Local setup

```bash
cd vercel
npm install
cp .env.example .env.local   # fill in SUPABASE_URL / keys, etc.
```

Apply the schema to a Supabase project (SQL editor, or `supabase db push`
if using the Supabase CLI):

```
supabase/migrations/0001_init.sql
```

Create at least one test user in Supabase Auth (dashboard -> Authentication
-> Add user), then run the API locally:

```bash
npx vercel dev
```

Test the health check:

```bash
curl http://localhost:3000/api/health
```

Test login:

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"..."}'
```

Use the returned `token` as `Authorization: Bearer <token>` on every other
route.

## Deploying

Import this repo into Vercel, set the project **root directory to
`vercel`**, set the environment variables from `.env.example` in the
Vercel dashboard, and deploy. See `MIGRATION_TO_VERCEL_SUPABASE.md` section
3 for the full walkthrough.
