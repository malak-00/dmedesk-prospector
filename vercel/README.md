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
  (`leads`, `lead_notes`, `taxonomies`, `search_progress`, `suggestions`,
  `enrichment_cache`, `app_users`) with Row-Level Security (enabled in
  `0002_enable_rls_and_google_oauth_bridge.sql`) replacing every Google
  Sheets tab.
- **Auth**: Google OAuth via Supabase Auth, bridged onto the `app_users`
  table (`app_users.id` is a foreign key into `auth.users(id)`, created on
  first Google sign-in) instead of a plaintext Users tab + `CacheService`
  sessions. See `lib/auth.js`. The Google provider itself is configured in
  the Supabase dashboard (Authentication -> Providers -> Google) -- not
  something the Supabase MCP tooling can set.
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
if using the Supabase CLI), in order:

```
supabase/migrations/0001_init.sql
supabase/migrations/0002_enable_rls_and_google_oauth_bridge.sql
```

Enable the Google provider (dashboard -> Authentication -> Providers ->
Google -- needs a Google Cloud OAuth Client ID/Secret, redirect URI
`https://<project-ref>.supabase.co/auth/v1/callback`), then run the API
locally:

```bash
npx vercel dev
```

Test the health check:

```bash
curl http://localhost:3000/api/health
```

Test the Google sign-in flow:

```bash
# 1. Get the Google sign-in URL and open it in a browser
curl "http://localhost:3000/api/auth/google?redirectTo=http://localhost:3000/callback"

# 2. After completing Google sign-in, Supabase redirects to redirectTo with
#    #access_token=... in the URL fragment -- copy that token and exchange it:
curl -X POST http://localhost:3000/api/auth/session \
  -H "Content-Type: application/json" \
  -d '{"access_token":"..."}'
```

Use the returned `token` as `Authorization: Bearer <token>` on every other
route.

## Deploying

Import this repo into Vercel, set the project **root directory to
`vercel`**, set the environment variables from `.env.example` in the
Vercel dashboard, and deploy. See `MIGRATION_TO_VERCEL_SUPABASE.md` section
3 for the full walkthrough.
