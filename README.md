# dmedesk-prospector

AI-powered lead intelligence platform for DME Desk. Searches the public NPPES
NPI Registry for DMEPOS suppliers, enriches results with Foursquare Places
data and website scraping, scores each lead, generates AI call briefs, and
exports to CSV or a shared Google Sheet (which also doubles as the
cross-team dedup log, so two people don't chase the same lead).

There's no login system yet and no database — everything is stateless
per-request, and the Google Sheet is the only persistent store.

## Requirements

- Node.js 18+
- A Google Sheet to use as the shared lead log (optional, but needed for
  Sheets export and cross-team dedup)
- API keys for Foursquare and Gemini (both free tier, optional — the app
  runs fine without them, just with less enrichment)

## Local setup

```bash
cd backend
npm install
cp .env.example .env
```

Fill in `.env`:

| Variable | Required? | Where to get it |
|---|---|---|
| `PORT` | no (defaults to 3000) | — |
| `FOURSQUARE_SERVICE_API_KEY` | optional | [Foursquare developer console](https://location.foursquare.com/developer/) — Places API (new, not legacy V3) |
| `GEMINI_API_KEY` | optional | [Google AI Studio](https://aistudio.google.com/) — free tier, no card needed |
| `GEMINI_MODEL` | no (defaults to `gemini-2.5-flash`) | — |
| `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` or `GOOGLE_SERVICE_ACCOUNT_KEY_JSON` | optional | see below |
| `GOOGLE_SHEET_ID` | optional | the ID in your sheet's URL: `docs.google.com/spreadsheets/d/<THIS_PART>/edit` |
| `GOOGLE_SHEET_TAB_NAME` | no (defaults to `Leads`) | — |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` | optional | pick your own — see below |

Any integration left unconfigured degrades gracefully — a warning is logged
once and the app keeps working with less data, it never crashes the request.

Run it:

```bash
npm start        # or: npm run dev  (auto-restart on change)
```

Then open `http://localhost:3000` — the dashboard is served from the same
Express app, no separate frontend build/deploy needed.

### Setting up Google Sheets export + dedup

1. Create a Google Cloud service account, generate a JSON key for it.
2. Create (or reuse) a Google Sheet, add a tab (default name `Leads`), and
   share the sheet with the service account's email address (found inside
   the JSON key) as an Editor.
3. Point `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` at the downloaded JSON file
   locally, **or** set `GOOGLE_SERVICE_ACCOUNT_KEY_JSON` to the file's
   contents (or its base64 encoding) — use the JSON-in-env-var form for any
   host where you can only set environment variables, not upload files.
4. Never commit the key file or its contents — `service-account-key.json`
   is already gitignored.

### Locking it down with Basic Auth

Set both `BASIC_AUTH_USER` and `BASIC_AUTH_PASS` to put the whole app
(dashboard + every `/api` route except `/api/health`, so hosting platform
health checks still pass) behind an HTTP Basic Auth prompt. Leave both
unset for open access — that's the default for local dev. Share the
username/password with your team out of band (Slack DM, password
manager), not in the repo.

This is a single shared credential, not per-user accounts — good enough to
keep the tool off the open internet until real login is built, not a
substitute for one.

## API

All endpoints are mounted under `/api`:

- `GET /api/search/nppes` — raw NPPES search
- `GET /api/search/companies` — full pipeline: NPPES → dedup → enrich
  (Foursquare) → optionally scrape → score → sort. Query params:
  `organizationName, city, state, postalCode, taxonomyDescription, limit,
  enrich, scrape`
- `GET /api/scrape/website?url=` — standalone scraper
- `POST /api/brief/generate` — body `{ company: {...} }`
- `POST /api/export/csv` — body `{ companies: [...] }`
- `POST /api/export/sheets` — body `{ companies: [...] }`
- `GET /api/health` — status check

## Deploying so your team can use it

The frontend and backend are one Node process (Express serves the static
dashboard and the API from the same origin), so any host that can run
`npm install && npm start` works — no separate frontend deploy, no CORS
config needed cross-origin.

1. Push this repo to GitHub (already done) and connect it to a host such as
   Render, Railway, or Fly.io.
2. Set the root/start directory to `backend`, build command `npm install`,
   start command `npm start`.
3. Set the same env vars from `.env` in the host's dashboard — use
   `GOOGLE_SERVICE_ACCOUNT_KEY_JSON` there since you can't upload the key
   file.
4. Share the resulting URL with your team.

**Before sharing the URL widely:** set `BASIC_AUTH_USER`/`BASIC_AUTH_PASS`
in the host's env vars (see above). Without them, anyone with the link can
search, generate AI briefs (spending your Gemini/Foursquare quota), and
export to your shared sheet.

## What's not built yet

- Authentication / user accounts (dedup tracks *that* a lead was claimed,
  not *who* claimed it)
- A database (Google Sheets is the only persistent store)
- Any CRM integration beyond Google Sheets
