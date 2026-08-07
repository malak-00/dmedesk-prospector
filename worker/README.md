# DME Desk Prospector -- API (Cloudflare Worker)

Replaces `appscript/` (Google Apps Script) as the backend. Same feature set
(auth, NPPES/company search, claimed-leads tracking, taxonomies, search
resume, suggestions), same Supabase database as the migration plan in
`../MIGRATION_TO_VERCEL_SUPABASE.md` -- just deployed to Cloudflare Workers
instead of Vercel, and with real routes/HTTP status codes/CORS instead of
Apps Script's `?path=` dispatcher.

Auth is custom (bcrypt-hashed passwords in `app_users`, signed JWT
sessions) rather than Supabase Auth -- see `src/lib/auth.js`.

## Layout

```
src/
  index.js           Hono app: routes, CORS, auth middleware, error handling
  lib/                config, Supabase client, JWT auth, enrichment cache,
                       and pure-logic ports (scoring, csvExport, roleClassifier, companyModel)
  services/            NPPES, CMS, Foursquare, OSM, scraper, Gemini brief,
                       and companyService (the search/enrich/score orchestrator)
  repos/                Supabase-backed replacements for SheetsStore /
                       TaxonomyService / SearchProgressService / suggestions
scripts/
  seed-user.mjs         create/update a teammate's account (bcrypt-hashed
                       password, run locally -- never commit real passwords)
```

## One-time setup

1. **Install dependencies**

   ```bash
   cd worker
   npm install
   ```

2. **Log in to Cloudflare** (once per machine)

   ```bash
   npx wrangler login
   ```

3. **Set secrets** (never go in `wrangler.toml` or git)

   ```bash
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY   # Supabase project settings -> API -> service_role key
   npx wrangler secret put JWT_SECRET                  # any long random string, e.g. `openssl rand -base64 48`

   # optional, feature degrades gracefully if unset:
   npx wrangler secret put FOURSQUARE_SERVICE_API_KEY
   npx wrangler secret put GEMINI_API_KEY
   npx wrangler secret put GEMINI_MODEL                # defaults to gemini-2.5-flash
   npx wrangler secret put NPPES_VERSION                # defaults to 2.1

   # optional -- only needed for the "Export to Sheet" button (see below):
   npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL
   npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
   npx wrangler secret put GOOGLE_SHEET_ID
   ```

   **Setting up "Export to Sheet"** (writes claimed leads into a real,
   shared Google Sheet -- separate from claiming, which writes to
   Supabase): in the [Google Cloud Console](https://console.cloud.google.com/),
   create a service account, generate a JSON key for it, then:
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL` -- the `client_email` field from that JSON key
   - `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` -- the `private_key` field (paste it
     as-is, including the `-----BEGIN PRIVATE KEY-----`/`-----END...-----`
     lines -- the Worker handles either real newlines or literal `\n`)
   - `GOOGLE_SHEET_ID` -- the ID from the target spreadsheet's URL
     (`https://docs.google.com/spreadsheets/d/<THIS PART>/edit`)
   - Share that spreadsheet with the service account's email (Editor access)
     -- it can't write to a sheet it hasn't been granted access to.

   Leave all three unset and the button will show a clear "not configured"
   error instead of failing silently.

4. **Create teammate accounts** -- there's no sign-up flow; run this once per
   person (locally, with the same Supabase env vars as above in your shell):

   ```bash
   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
     node scripts/seed-user.mjs --username caro --password "a-real-password" --displayName "Caroline Richards"
   ```

## Deploy

```bash
npm run deploy
```

Wrangler prints the deployed URL, e.g. `https://dmedesk-prospector-api.<your-subdomain>.workers.dev`.
Put that in `docs/config.js` as `API_BASE_URL`.

## Local dev

```bash
npm run dev
```

Runs the Worker locally (Wrangler dev server); point `docs/config.js` at
`http://127.0.0.1:8787` temporarily to test against it.

## What's deliberately different from the Apps Script version

- **Real routes, real HTTP status codes, real CORS** -- no more `?path=`
  query-param dispatch or "every response is HTTP 200, check `success` in
  the body" workaround. The response body shape (`{success, data}` /
  `{success, status, error}`) was kept identical on purpose so
  `docs/app.js`'s existing `unwrap()` needed no changes.
- **Auth is `Authorization: Bearer <token>`**, not a `?token=` query
  param -- Apps Script needed the query param to dodge CORS preflight;
  a real host handles preflight properly, so there's no reason to keep
  routing credentials through the URL (and query params end up in server
  logs).
- **Sessions are stateless JWTs**, not server-side cache entries -- there's
  no `CacheService` equivalent to revoke a token early; `auth/logout` is
  client-side only (discard the token). Add a revocation table if that ever
  matters.
- **Notes are a single text field** (`leads.notes`), matching the existing
  Sheets-era model exactly (a running, newest-first call log the client
  prepends to) rather than a normalized `lead_notes` table.
- **Suggestions are stored but not emailed** -- the old MailApp notification
  has no equivalent wired up here (would need an email API + key). Add one
  in `src/repos/suggestionsRepo.js` if wanted.
- **Scraping has no real HTML parser**, same tradeoff the Apps Script port
  already made (no cheerio/DOM in Apps Script; Workers doesn't ship one by
  default either) -- regex/heuristic extraction, best-effort only.
