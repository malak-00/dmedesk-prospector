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
   npx wrangler secret put GOOGLE_OAUTH_CLIENT_ID
   npx wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET
   npx wrangler secret put GOOGLE_OAUTH_REFRESH_TOKEN
   npx wrangler secret put GOOGLE_SHEET_ID
   ```

   **Setting up "Export to Sheet"** (writes claimed leads into a real,
   shared Google Sheet -- separate from claiming, which writes to
   Supabase). This uses an OAuth client authorized as a real Google account,
   **not** a service account key -- some Google Workspace orgs block
   service-account key creation entirely (`iam.disableServiceAccountKeyCreation`),
   and this setup works even under that policy since it isn't a
   service-account key.

   1. In the [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
      make sure the **Google Sheets API** is enabled for your project
      (APIs & Services -> Library -> search "Google Sheets API" -> Enable).
   2. Still in Credentials, click **Create Credentials -> OAuth client ID**.
      - If prompted, configure the OAuth consent screen first (External or
        Internal, doesn't matter for this -- User Type "Internal" is simplest
        if your Google account is on a Workspace org; add the
        `.../auth/spreadsheets` scope if asked).
      - Application type: **Desktop app**. Give it any name.
      - This gives you a **Client ID** and **Client Secret** -- save both.
   3. Get a refresh token via [Google's OAuth 2.0 Playground](https://developers.google.com/oauthplayground):
      - Click the gear icon (top right) -> check **"Use your own OAuth
        credentials"** -> paste in the Client ID and Client Secret from
        step 2.
      - In the left panel (Step 1), find **Google Sheets API v4**, expand
        it, check `https://www.googleapis.com/auth/spreadsheets`, click
        **Authorize APIs**, and sign in with the Google account that owns
        (or has edit access to) the target spreadsheet.
      - Click **Exchange authorization code for tokens** (Step 2) -- copy
        the **Refresh token** shown. That's `GOOGLE_OAUTH_REFRESH_TOKEN`.
        It doesn't expire on its own (only if revoked), so this is a
        one-time step.
   4. `GOOGLE_SHEET_ID` -- the ID from the target spreadsheet's URL
      (`https://docs.google.com/spreadsheets/d/<THIS PART>/edit`). The
      account you authorized as in step 3 needs edit access to it.

   Leave all four unset and the button will show a clear "not configured"
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
