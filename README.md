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

## Free, no-card deployment: GitHub Pages + Google Apps Script

If you don't have a card, a domain, or a machine you can leave running,
there's a second way to deploy this that needs none of those: a static
frontend on GitHub Pages talking to a backend that runs on Google Apps
Script (free with just a Google account) instead of Node. The code for it
lives in `appscript/` (backend) and `docs/` (frontend) at the repo root —
`backend/` is untouched and still works if you ever want to switch to
Node hosting later.

**What's different from the Node version, worth knowing up front:**
- The website scraper has no equivalent of `cheerio` available in Apps
  Script, so it's reimplemented with regex/line-based heuristics instead of
  real DOM traversal. It's noticeably less accurate on messy real-world
  HTML. Since scraping was always an optional supplement to NPPES data
  (never the primary source), this is a "works, but finds fewer names"
  situation, not a broken one.
- Apps Script caps a single request at 6 minutes and has no true
  concurrency, so a large `limit` with scraping enabled on many companies
  at once is slower here than on Node.
- Every response is HTTP 200 (Apps Script Web Apps can't set custom status
  codes) — the frontend checks a `success` field in the JSON body instead.
- Auth is a single shared access code entered once per browser (stored in
  `localStorage`), not the Basic Auth browser prompt, since Apps Script
  Web Apps don't support custom request headers without triggering CORS
  preflight issues they don't handle well.
- **Your GitHub repo needs to be public for free GitHub Pages hosting.**
  The `backend/` Node source and `appscript/`/`docs/` code become
  world-readable (already-scrubbed of secrets), but nothing sensitive lives
  in git either way — real API keys and the access code are set directly in
  Apps Script's Script Properties, never committed.

### 1. Make the repo public

GitHub → your repo → **Settings → Danger Zone → Change visibility → Make
public**. One-time, done in the browser.

### 2. Turn on GitHub Pages

GitHub → **Settings → Pages** → under "Build and deployment", set
**Source: Deploy from a branch**, **Branch: `main`**, folder **`/docs`** →
**Save**. GitHub gives you a URL like
`https://<your-username>.github.io/dmedesk-prospector/` after a minute or
two.

### 3. Create the Apps Script backend

1. Go to [script.google.com](https://script.google.com) → **New project**.
   Rename it (e.g. "DME Desk Prospector Backend").
2. For each file in `appscript/`, create a matching script file in the
   editor (the **+** next to "Files") and paste in its contents:
   `Code`, `Config`, `CompanyModel` (put this under a `models` naming or
   just flat — Apps Script doesn't have real folders, flat names are fine),
   `NppesService`, `FoursquareService`, `AiBriefService`, `ScraperService`,
   `UrlUtils`, `RoleClassifier`, `ScoringService`, `CsvExport`,
   `SheetsStore`, `CompanyService`. The exact file names don't matter to
   Apps Script (everything shares one global scope) — just get every
   file's content in.
3. Click **Project Settings** (gear icon) → check **"Show `appsscript.json`
   manifest file in editor"** → open it → replace its contents with
   `appscript/appsscript.json` from this repo.

### 4. Set Script Properties (this is where your secrets actually live)

**Project Settings → Script Properties → Add script property**, one at a
time:

| Property | Required? | Value |
|---|---|---|
| `APP_TOKEN` | **required** | make up any password-like string — this is what your team enters to use the app |
| `GOOGLE_SHEET_ID` | required for Sheets export/dedup | the ID from your sheet's URL |
| `FOURSQUARE_SERVICE_API_KEY` | optional | from the Foursquare developer console |
| `GEMINI_API_KEY` | optional | from Google AI Studio |
| `GEMINI_MODEL` | optional | defaults to `gemini-2.5-flash` |
| `GOOGLE_SHEET_TAB_NAME` | optional | defaults to `Leads` |
| `NPPES_VERSION` | optional | defaults to `2.1` |

No service account or key file needed — since this runs as your own Apps
Script, it already has native access to any Sheet you own.

### 5. Deploy as a Web App

**Deploy → New deployment** → gear icon → **Web app** → Execute as:
**Me** → Who has access: **Anyone** → **Deploy**. Google will prompt you
to authorize it — since this is your own personal script (not a published,
verified app), you'll see an "unverified app" warning; click **Advanced →
Go to (project name) (unsafe) → Allow**. That's expected and safe: it's
your script accessing your own Google account's Sheets and making outbound
requests, nobody else's.

Copy the Web app URL (ends in `/exec`).

### 6. Point the frontend at it

Edit `docs/config.js` in this repo (directly on GitHub — click the pencil
icon on the file, since the repo is public you can do this from a
browser, no local clone needed) and paste your `/exec` URL into
`APPS_SCRIPT_URL`. Commit directly to `main`.

### 7. Test it

Visit your Pages URL. It'll prompt for the access code — enter the
`APP_TOKEN` value you set in step 4. Run a real search, generate a brief,
export to CSV, export to Sheets, and confirm each works end to end.

### Updating the Apps Script code later

Editing files in the Apps Script editor and saving does **not** update the
live Web App by itself — you need **Deploy → Manage deployments** → edit
(pencil icon) the existing deployment → **New version** → **Deploy**. The
`/exec` URL stays the same either way.

## What's not built yet

- Authentication / user accounts (dedup tracks *that* a lead was claimed,
  not *who* claimed it)
- A database (Google Sheets is the only persistent store)
- Any CRM integration beyond Google Sheets
